// Local server: static files + JSON API for sync, status, imports, profiles and trade audit.
// Zero npm dependencies. Start with `npm start`, then open http://localhost:5177

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT, P } from './lib/paths.js';
import { loadEnv } from './lib/env.js';
import { readJSON, writeJSON, readGzJSON } from './lib/store.js';
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
      try { resolve(JSON.parse(txt)); } catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, urlPath) {
  if (urlPath === '/') urlPath = '/index.html';
  if (!STATIC_ALLOW.some((re) => re.test(urlPath))) return send(res, 404, { error: 'Not found' });
  const file = path.normalize(path.join(ROOT, decodeURIComponent(urlPath)));
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'Forbidden' });
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
  return { app_version: APP_VERSION, sources, last_sync: lastSync, nfl_state: nflState, dataset: datasetMeta, sync_running: isSyncRunning(), progress: syncProgress() };
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
  if (!Array.isArray(body.profiles)) throw Object.assign(new Error('profiles must be an array'), { status: 400 });
  await writeJSON(P.userProfiles, { profiles: body.profiles, updated_at: new Date().toISOString() }, { pretty: true });
  return { ok: true };
});
route('GET', /^\/api\/trades$/, async () => (await readJSON(P.trades, { trades: [] })));
route('POST', /^\/api\/trades$/, async (req) => {
  const body = await readBody(req);
  const t = await readJSON(P.trades, { trades: [] });
  const entry = { id: `t_${Date.now().toString(36)}`, saved_at: new Date().toISOString(), ...body };
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
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
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    return send(res, status, { error: e.message, detail: e.detail || null });
  }
});

server.listen(PORT, HOST, () => {
  const has = fs.existsSync(P.dataset);
  console.log(`\n  Fantasy Football Trade Analyzer ${APP_VERSION}`);
  console.log(`  ➜  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
  console.log(has ? '  Cached dataset found — the app works offline; click "Sync All" to refresh.' : '  No data yet — open the app and click "Sync All" (or run `npm run sync`).');
});
