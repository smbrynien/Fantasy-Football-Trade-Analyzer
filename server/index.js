// Local server: static files + JSON API for sync, status, imports, profiles and trade audit.
// Zero npm dependencies. Start with `npm start`, then open http://localhost:5177

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { ROOT, P, DATA_DIR } from './lib/paths.js';
import { loadEnv } from './lib/env.js';
import { readJSON, writeJSON, readGzJSON, recoveredFiles } from './lib/store.js';
import { loadConfig } from './lib/config.js';
import { runSync, rebuild, syncProgress, isSyncRunning } from './sync-engine.js';
import { previewImport, commitImport, clearManualSource } from './import-service.js';
import { toCSV } from '../js/core/util/csv.js';
import { APP_VERSION } from '../js/core/version.js';

loadEnv();
const PORT = Number(process.env.PORT) || 5177;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.webmanifest': 'application/manifest+json' };
// Only these paths are served statically (never raw caches, user data or .env).
const STATIC_ALLOW = [/^\/index\.html$/, /^\/css\//, /^\/js\//, /^\/config\//, /^\/docs\//, /^\/assets\//, /^\/data\/calculated\/(dataset|history)\.json$/, /^\/favicon\.svg$/, /^\/reports\/[\w.-]+\.json$/, /^\/manifest\.webmanifest$/];

function send(res, status, body, headers = {}, req = null) {
  const isBuf = Buffer.isBuffer(body);
  let payload = isBuf ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { 'Content-Type': isBuf || typeof body === 'string' ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers };
  if (req && payload.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    payload = zlib.gzipSync(payload);
    h['Content-Encoding'] = 'gzip';
  }
  h['Content-Length'] = payload.length;
  res.writeHead(status, h);
  res.end(payload);
}

async function readBody(req, limit = 25e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const txt = Buffer.concat(chunks).toString('utf8');
      if (!txt) return resolve({});
      let v;
      try { v = JSON.parse(txt); } catch { return reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
      // Every endpoint expects an object; `null`, arrays or scalars used to surface as 500 TypeErrors.
      if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(Object.assign(new Error('Request body must be a JSON object'), { status: 400 }));
      resolve(v);
    });
    req.on('error', reject);
  });
}

/**
 * Resolve a request path to a file under ROOT, or null. The allow-list is checked on the DECODED, normalized path
 * relative to ROOT: checking the raw URL let `/js/..%2f.env` pass the `/js/` rule and escape to any file in the repo.
 */
function resolveStaticPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(ROOT, `.${decoded}`);
  const rel = path.relative(ROOT, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const clean = `/${rel.split(path.sep).join('/')}`;
  return STATIC_ALLOW.some((re) => re.test(clean)) ? file : null;
}

async function serveStatic(req, res, urlPath) {
  const file = resolveStaticPath(urlPath);
  if (!file) return send(res, 404, { error: 'Not found' });
  try {
    const data = await fsp.readFile(file);
    const ext = path.extname(file);
    return send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, req);
  } catch {
    return send(res, 404, { error: 'Not found' });
  }
}

async function statusPayload() {
  const config = loadConfig();
  const status = await readJSON(P.sourceStatus, {});
  const lastSync = await readJSON(P.lastSync, null);
  const nflState = await readJSON(P.nflState, null);
  let datasetMeta = null;
  try {
    const st = await fsp.stat(P.dataset);
    const ds = await readJSON(P.dataset, null);
    if (ds) datasetMeta = { data_version: ds.data_version, built_at: ds.built_at, players: ds.players.length, picks: ds.picks.length, state: ds.state, size_bytes: st.size, sources: ds.sources, substitutions: ds.meta?.substitutions || [] };
  } catch { /* no dataset yet */ }
  const sources = config.sources.sources.map((s) => {
    const st = status[s.id] || {};
    const freshness = Math.min(...s.data_types.map((t) => config.sources.freshness_hours[t] || 168));
    const ageH = st.last_success ? (Date.now() - new Date(st.last_success).getTime()) / 36e5 : null;
    return {
      ...s, state: st.status || (s.adapter === 'manual' ? 'not imported' : 'never synced'),
      last_success: st.last_success || null, last_attempt: st.last_attempt || null, last_failure: st.last_failure || null,
      error: st.error || null, records: st.records || null, types: st.types || null, duration_ms: st.duration_ms ?? null,
      freshness_hours: freshness, age_hours: ageH, stale: ageH !== null && s.adapter !== 'manual' ? ageH > freshness * 2 : false,
      due: ageH === null ? s.adapter !== 'manual' : ageH > (s.update_frequency_hours || 24),
    };
  });
  const recovered = recoveredFiles.map((r) => ({ file: path.relative(DATA_DIR, r.file), moved_to: path.relative(DATA_DIR, r.moved_to), error: r.error, at: r.at }));
  return { app_version: APP_VERSION, sources, last_sync: lastSync, nfl_state: nflState, dataset: datasetMeta, sync_running: isSyncRunning(), progress: syncProgress(), recovered_files: recovered };
}

const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });

route('GET', /^\/api\/health$/, async () => ({ ok: true, app_version: APP_VERSION, has_dataset: fs.existsSync(P.dataset), sync_running: isSyncRunning() }));
route('GET', /^\/api\/config$/, async () => loadConfig());
route('GET', /^\/api\/status$/, async () => statusPayload());
route('GET', /^\/api\/sync\/progress$/, async () => syncProgress() || { running: false });
route('POST', /^\/api\/sync$/, async (req) => {
  const body = await readBody(req);
  if (isSyncRunning()) return { started: false, already_running: true, progress: syncProgress() };
  runSync({ sources: body.sources, force: Boolean(body.force), failedOnly: Boolean(body.failedOnly), formats: body.formats || [] })
    .catch((e) => console.error('sync failed', e));
  return { started: true };
});
route('POST', /^\/api\/rebuild$/, async () => { const b = await rebuild(); return { ok: true, data_version: b.dataset.data_version }; });
route('GET', /^\/api\/dataset$/, async () => { const d = await readJSON(P.dataset, null); if (!d) throw Object.assign(new Error('No dataset yet — run a sync first.'), { status: 404 }); return d; });
route('GET', /^\/api\/quality$/, async () => (await readJSON(P.quality, null)) || { sources: [], identity: {}, generated_at: null });
route('GET', /^\/api\/history$/, async (req, url) => {
  const h = await readJSON(P.history, { entries: [], series: {} });
  const cid = url.searchParams.get('cid');
  if (!cid) return { entries: h.entries, players: Object.keys(h.series).length };
  return { entries: h.entries, series: h.series[cid] || null };
});
route('GET', /^\/api\/snapshots$/, async () => {
  let files = [];
  try { files = (await fsp.readdir(P.snapshots)).filter((f) => f.endsWith('.json.gz')).sort().reverse(); } catch { /* none */ }
  return files.map((f) => { const [stamp, ver] = f.replace('.json.gz', '').split('__'); return { file: f, built_at: stamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'), data_version: ver }; });
});
route('GET', /^\/api\/snapshots\/([\w.:-]+\.json\.gz)$/, async (req, url, m) => {
  const file = path.join(P.snapshots, path.basename(m[1]));
  const d = await readGzJSON(file, null);
  if (!d) throw Object.assign(new Error('Snapshot not found'), { status: 404 });
  return d;
});
route('POST', /^\/api\/import\/preview$/, async (req) => { const r = await previewImport(loadConfig(), await readBody(req)); delete r._normalized; return r; });
route('POST', /^\/api\/import\/commit$/, async (req) => commitImport(loadConfig(), await readBody(req), () => rebuild()));
route('DELETE', /^\/api\/import\/([\w-]+)$/, async (req, url, m) => clearManualSource(loadConfig(), m[1], () => rebuild()));
route('GET', /^\/api\/profiles$/, async () => (await readJSON(P.userProfiles, { profiles: [] })));
route('PUT', /^\/api\/profiles$/, async (req) => {
  const body = await readBody(req);
  if (!Array.isArray(body.profiles) || !body.profiles.every((p) => p && typeof p === 'object' && !Array.isArray(p) && typeof p.id === 'string')) {
    throw Object.assign(new Error('profiles must be an array of profile objects with an id'), { status: 400 });
  }
  await writeJSON(P.userProfiles, { profiles: body.profiles, updated_at: new Date().toISOString() }, { pretty: true });
  return { ok: true };
});
route('GET', /^\/api\/trades$/, async () => (await readJSON(P.trades, { trades: [] })));
route('POST', /^\/api\/trades$/, async (req) => {
  const body = await readBody(req);
  const t = await readJSON(P.trades, { trades: [] });
  // Server-assigned fields win: a client-supplied id could collide or be undeletable (DELETE only matches \w+).
  const entry = { ...body, id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, saved_at: new Date().toISOString() };
  t.trades = [entry, ...t.trades].slice(0, 500);
  await writeJSON(P.trades, t);
  return { ok: true, id: entry.id };
});
route('DELETE', /^\/api\/trades\/([\w]+)$/, async (req, url, m) => {
  const t = await readJSON(P.trades, { trades: [] });
  t.trades = t.trades.filter((x) => x.id !== m[1]);
  await writeJSON(P.trades, t);
  return { ok: true };
});
route('GET', /^\/api\/overrides$/, async () => readJSON(P.playerOverrides, {}));
route('POST', /^\/api\/overrides$/, async (req) => {
  const body = await readBody(req);
  if (!body.key || !(body.cid || body.ignore)) throw Object.assign(new Error('key and cid (or ignore) are required'), { status: 400 });
  const o = await readJSON(P.playerOverrides, {});
  o[body.key] = body.ignore ? 'IGNORE' : body.cid;
  await writeJSON(P.playerOverrides, o, { pretty: true });
  const b = await rebuild();
  return { ok: true, data_version: b.dataset.data_version };
});
route('GET', /^\/api\/export\/health\.csv$/, async () => {
  const s = await statusPayload();
  const csv = toCSV(s.sources.map((x) => ({ source: x.name, id: x.id, priority: x.priority, method: x.method, data: x.data_types.join(' '), status: x.state, last_success: x.last_success, last_failure: x.last_failure, age_hours: x.age_hours === null ? '' : x.age_hours.toFixed(1), stale: x.stale, records: x.records ? Object.entries(x.records).map(([k, v]) => `${k}:${v}`).join(' ') : '', error: x.error || '', fallback: x.fallback || '' })));
  return { __raw: csv, type: 'text/csv; charset=utf-8', filename: 'data-source-health.csv' };
});

// Requests are only accepted for a loopback Host unless HOST deliberately exposes the app (DNS-rebinding guard), and
// state-changing API calls must come from the app itself: same Origin (when the browser sends one) and a JSON body.
// A cross-site page can otherwise POST text/plain "simple" requests that need no CORS preflight (sync, imports,
// identity overrides, trades).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const LOCAL_ONLY = LOOPBACK_HOSTS.has(HOST);
const hostName = (h) => String(h || '').replace(/:\d+$/, '').toLowerCase();
function requestRejection(req) {
  if (LOCAL_ONLY && !LOOPBACK_HOSTS.has(hostName(req.headers.host))) return { status: 403, error: 'Forbidden host' };
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let o; try { o = new URL(origin); } catch { return { status: 403, error: 'Forbidden origin' }; }
    if (o.host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) return { status: 403, error: 'Cross-origin request refused' };
  } else if (origin === 'null') return { status: 403, error: 'Cross-origin request refused' };
  if ((req.method === 'POST' || req.method === 'PUT') && !/^application\/json\b/i.test(req.headers['content-type'] || '')) return { status: 415, error: 'Content-Type must be application/json' };
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const rejected = requestRejection(req);
    if (rejected) return send(res, rejected.status, { error: rejected.error });
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'Bad request' }); }
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        const m = url.pathname.match(r.re);
        if (m && r.method === req.method) {
          const out = await r.fn(req, url, m);
          if (out && out.__raw !== undefined) return send(res, 200, out.__raw, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.filename}"` }, req);
          return send(res, 200, out, {}, req);
        }
      }
      return send(res, 404, { error: `No route ${req.method} ${url.pathname}` });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    return send(res, status, { error: e.message, detail: e.detail || null });
  }
});

// ---------------------------------------------------------------- startup
const OPEN_BROWSER = process.argv.includes('--open') || process.env.FFTA_OPEN === '1';
const AUTO_SYNC = !process.argv.includes('--no-auto-sync') && process.env.FFTA_NO_AUTOSYNC !== '1';
// Refresh automatically on launch when the cached data is older than this (0 = never).
const AUTO_REFRESH_HOURS = Number(process.env.FFTA_AUTO_REFRESH_HOURS ?? 12);

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    p.on('error', () => console.log(`  Open this address in your web browser: ${url}`));
    p.unref();
  } catch {
    console.log(`  Open this address in your web browser: ${url}`);
  }
}

async function isOurServer(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return Boolean(j && j.ok && j.app_version);
  } catch { return false; }
}

function maybeAutoSync() {
  if (!AUTO_SYNC) return;
  let ageH = Infinity;
  try { ageH = (Date.now() - fs.statSync(P.dataset).mtimeMs) / 36e5; } catch { /* no data yet */ }
  const first = ageH === Infinity;
  if (!first && !(AUTO_REFRESH_HOURS > 0 && ageH > AUTO_REFRESH_HOURS)) return;
  console.log(first ? '  First launch: downloading football data (about 30 seconds)…' : `  Data is ${Math.round(ageH)} hours old: refreshing in the background…`);
  runSync({}).then((s) => {
    console.log(`  Data ready: ${s.succeeded} sources updated${s.failed ? `, ${s.failed} unavailable (the app keeps working without them)` : ''}.`);
  }).catch((e) => console.log(`  Data download failed (${e.message}). Check your internet connection, then click "Sync All" in the app.`));
}

function start(port, attemptsLeft) {
  const onError = async (e) => {
    if (e.code === 'EADDRINUSE') {
      if (await isOurServer(port)) {
        const url = `http://localhost:${port}`;
        console.log(`\n  The Trade Analyzer is already running at ${url} — opening it.`);
        if (OPEN_BROWSER) openBrowser(url);
        setTimeout(() => process.exit(0), 800);
        return;
      }
      if (attemptsLeft > 0) return start(port + 1, attemptsLeft - 1);
    }
    console.error(`\n  Could not start the server: ${e.message}`);
    process.exit(1);
  };
  server.once('error', onError);
  server.listen(port, HOST, () => {
    server.off('error', onError);
    const url = `http://${HOST === '0.0.0.0' || HOST === '127.0.0.1' ? 'localhost' : HOST}:${port}`;
    const has = fs.existsSync(P.dataset);
    console.log(`\n  Fantasy Football Trade Analyzer ${APP_VERSION}`);
    console.log(`  ➜  ${url}\n`);
    console.log(has ? '  Cached data found — the app also works offline.' : '  No data yet — it will download automatically.');
    console.log('  Keep this window open while you use the app. Close it (or press Ctrl+C) to stop.\n');
    if (OPEN_BROWSER) openBrowser(url);
    maybeAutoSync();
  });
}

start(PORT, process.env.PORT ? 0 : 10);
