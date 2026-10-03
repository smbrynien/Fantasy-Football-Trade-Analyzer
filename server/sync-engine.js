// Sync engine: runs source adapters independently (one failure never blocks the others), validates each batch,
// stores raw + normalized data, then rebuilds the player DB, dataset, snapshot, default values and value history.

import fs from 'node:fs/promises';
import path from 'node:path';
import { P, DATA_DIR } from './lib/paths.js';
import { readJSON, writeJSON, updateJSON, writeGz, writeGzJSON, pruneDir, ensureDir } from './lib/store.js';
import { createHttp } from './lib/http.js';
import { loadConfig } from './lib/config.js';
import { createAdapter } from '../adapters/index.js';
import { METHOD_FOR_TYPE } from '../adapters/base.js';
import { assessBatch, cleanBatch } from '../js/core/quality.js';
import { NORMALIZED_SCHEMA_VERSION } from '../js/core/version.js';
import { buildPlayerDB, buildDataset } from './dataset-builder.js';
import { updateHistory } from './history.js';
import { archiveSignals } from './archive.js';

const RAW_KEEP = 3;
const SNAPSHOT_KEEP = 90;
const MIN_REFETCH_MINUTES = 30;

let running = null;
let progress = null;

export function syncProgress() { return progress; }
export function isSyncRunning() { return Boolean(running); }

/**
 * The season the app should project. During the offseason Sleeper keeps `season` on the COMPLETED season and names
 * the upcoming one `league_season`; taken literally, adapters fetched (and the model valued from) last year's season
 * projections from February to August. Use the upcoming season while the type is 'off'.
 */
export function normalizeNflState(s) {
  let season = Number(s.season);
  const upcoming = Number(s.league_season);
  if (s.season_type === 'off' && Number.isInteger(upcoming) && upcoming > season) season = upcoming;
  return { season, week: Number(s.week) || 0, season_type: s.season_type };
}

/** Calendar fallback with the same meaning: Jan–Feb = previous season's postseason, Mar–Aug = upcoming offseason. */
export function calendarNflState(d = new Date()) {
  const m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  if (m <= 2) return { season: y - 1, week: 19, season_type: 'post', source: 'calendar' };
  if (m <= 8) return { season: y, week: 0, season_type: 'off', source: 'calendar' };
  return { season: y, week: 0, season_type: 'pre', source: 'calendar' }; // Sep–Dec without a state source: week unknown
}

/** Determine NFL state: live from Sleeper, else last known, else derived from the calendar. */
async function resolveState(config, http, log) {
  try {
    const srcId = (config.sources.exclusive_data_types.state || [])[0];
    const src = config.sources.sources.find((s) => s.id === srcId && s.enabled);
    const adapter = src && createAdapter(src, { http, log });
    if (!adapter || typeof adapter.fetchState !== 'function') throw new Error('no enabled state source');
    const s = (await adapter.fetchState()).records[0];
    const st = { ...normalizeNflState(s), fetched_at: new Date().toISOString(), source: src.id };
    await writeJSON(P.nflState, st, { pretty: true });
    return st;
  } catch (e) {
    log(`NFL state unavailable (${e.message}); using cached/derived state.`);
    const cached = await readJSON(P.nflState, null);
    if (cached) return { ...cached, source: 'cache' };
    return calendarNflState();
  }
}

function summarizeStatus(typeResults) {
  const vals = Object.values(typeResults);
  if (!vals.length) return 'skipped';
  const ok = vals.filter((v) => v.status === 'ok' || v.status === 'warning');
  const bad = vals.filter((v) => v.status === 'error' || v.status === 'quarantined');
  if (!bad.length) return vals.some((v) => v.status === 'warning') ? 'warning' : 'ok';
  if (!ok.length) return bad.some((v) => v.status === 'quarantined') ? 'quarantined' : 'error';
  return 'partial';
}

async function storeBatch(sourceId, type, result, runStamp) {
  const prev = await readJSON(P.normalizedFile(sourceId, type), null);
  const q = assessBatch({ type, records: result.records, schema: result.schema, minRecords: result.minRecords }, prev?.records || null);
  if (q.verdict === 'quarantine') {
    return { status: 'quarantined', records: result.records.length, issues: q.issues, kept_previous: Boolean(prev), previous_fetched_at: prev?.fetched_at || null };
  }
  const clean = cleanBatch(type, result.records);
  await writeJSON(P.normalizedFile(sourceId, type), {
    schema_version: NORMALIZED_SCHEMA_VERSION, source: sourceId, type, fetched_at: new Date().toISOString(), run: runStamp,
    meta: result.meta || null, quality: { verdict: q.verdict, issues: q.issues, dropped: clean.dropped }, records: clean.records,
  });
  return { status: q.verdict === 'warning' ? 'warning' : 'ok', records: clean.records.length, dropped: clean.dropped, issues: q.issues };
}

async function runSource(source, ctx, runStamp, log, factory = createAdapter) {
  const t0 = Date.now();
  const adapter = factory(source, { ...ctx, log });
  const typeResults = {};
  if (!adapter) return { status: 'error', error: `No adapter "${source.adapter}" registered`, types: {}, duration_ms: 0 };
  let firstError = null;
  for (const type of source.data_types) {
    if (type === 'state') continue;
    const method = METHOD_FOR_TYPE[type];
    if (!method || typeof adapter[method] !== 'function') continue;
    try {
      const result = await adapter[method]();
      typeResults[type] = await storeBatch(source.id, type, result, runStamp);
      for (const [xType, xRes] of Object.entries(result.extra || {})) {
        typeResults[xType] = await storeBatch(source.id, xType, xRes, runStamp);
      }
      if (typeResults[type].status === 'quarantined' && !firstError) firstError = `Data for "${type}" failed validation and was not used: ${typeResults[type].issues.filter((i) => i.level === 'error').map((i) => i.message).join(' ')}`;
    } catch (e) {
      typeResults[type] = { status: 'error', error: e.message };
      if (!firstError) firstError = `${type}: ${e.message}`;
      log(`[${source.id}] ${type} failed: ${e.message}`);
    }
  }
  return { status: summarizeStatus(typeResults), error: firstError, types: typeResults, duration_ms: Date.now() - t0 };
}

/**
 * @param opts { sources?: string[] (ids), force?: boolean, failedOnly?: boolean, formats?: [{dynasty, qb_format, ppr, teams}], rebuildOnly?: boolean,
 *               config?, state?, adapterFactory? (test injection points) }
 */
export async function runSync(opts = {}) {
  if (running) return running;
  // Publish this run's progress before anything can fail: a sync that died early used to leave the PREVIOUS run's
  // finished progress in place, which the UI then announced as this run's success.
  const startedAt = new Date().toISOString();
  progress = { running: true, started_at: startedAt, sources: {}, phase: 'starting' };
  running = (async () => {
    const started = new Date(startedAt);
    const runStamp = started.toISOString().replace(/[:.]/g, '-');
    const config = opts.config || loadConfig();
    const logLines = [];
    const log = (m) => { logLines.push(`${new Date().toISOString()} ${m}`); if (opts.verbose) console.log(m); };
    const statusAll = await readJSON(P.sourceStatus, {});
    const http = createHttp();
    const state = opts.state || (await resolveState(config, http, log));
    const auto = config.sources.sources.filter((s) => s.enabled && s.adapter !== 'manual');
    let targets = auto;
    if (opts.sources && opts.sources.length) targets = auto.filter((s) => opts.sources.includes(s.id));
    if (opts.failedOnly) targets = targets.filter((s) => ['error', 'partial', 'quarantined'].includes(statusAll[s.id]?.status));
    if (opts.rebuildOnly) targets = [];
    progress = { running: true, started_at: started.toISOString(), state, sources: Object.fromEntries(targets.map((s) => [s.id, { name: s.name, phase: 'queued' }])), phase: 'fetching' };

    const ctx = {
      http, state, formats: opts.formats || [], regularSeasonWeeks: config.model.phase.regular_season_weeks,
      saveRaw: async (sourceId, name, data, ext) => {
        const dir = path.join(P.raw(sourceId), runStamp);
        await ensureDir(dir);
        await writeGz(path.join(dir, `${name}.${ext}.gz`), typeof data === 'string' ? data : JSON.stringify(data));
      },
    };

    const results = {};
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        const prev = statusAll[s.id] || {};
        const ageMin = prev.last_success ? (Date.now() - new Date(prev.last_success).getTime()) / 6e4 : Infinity;
        if (!opts.force && !opts.sources && !opts.failedOnly && ageMin < MIN_REFETCH_MINUTES && prev.status === 'ok') {
          progress.sources[s.id] = { name: s.name, phase: 'skipped', message: `fetched ${Math.round(ageMin)} min ago` };
          results[s.id] = { status: 'skipped', reason: `fresh (fetched ${Math.round(ageMin)} min ago)` };
          continue;
        }
        progress.sources[s.id] = { name: s.name, phase: 'fetching', started_at: new Date().toISOString() };
        log(`[${s.id}] fetching…`);
        const r = await runSource(s, ctx, runStamp, log, opts.adapterFactory);
        results[s.id] = r;
        const now = new Date().toISOString();
        const ok = ['ok', 'warning', 'partial'].includes(r.status);
        statusAll[s.id] = {
          ...prev,
          last_attempt: now,
          last_success: ok ? now : prev.last_success || null,
          last_failure: ok && r.status !== 'partial' ? prev.last_failure || null : now,
          status: r.status,
          error: r.error || null,
          records: Object.fromEntries(Object.entries(r.types).map(([t, v]) => [t, v.records ?? 0])),
          types: r.types,
          duration_ms: r.duration_ms,
        };
        progress.sources[s.id] = { name: s.name, phase: r.status, message: r.error || null, records: statusAll[s.id].records };
        await pruneDir(P.raw(s.id), RAW_KEEP);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    // Merge only the sources this run touched into the CURRENT file: writing the copy read at the start erased any
    // status written meanwhile — e.g. a manual import committed during the sync showed "not imported" afterwards
    // (BUG_AUDIT 2, SY6). updateJSON serializes with the import service's status writes.
    const touched = Object.fromEntries(targets.filter((t) => results[t.id] && results[t.id].status !== 'skipped').map((t) => [t.id, statusAll[t.id]]));
    Object.assign(statusAll, await updateJSON(P.sourceStatus, {}, (cur) => ({ ...cur, ...touched }), { pretty: true }));

    // ---------- rebuild ----------
    progress.phase = 'building';
    let build = null, buildError = null;
    try {
      build = await rebuild(config, statusAll, state, log);
    } catch (e) {
      buildError = e.message;
      log(`Rebuild failed: ${e.stack || e.message}`);
    }

    const finished = new Date();
    const summary = {
      started_at: started.toISOString(), finished_at: finished.toISOString(), duration_ms: finished - started,
      forced: Boolean(opts.force), requested: opts.sources || (opts.failedOnly ? 'failed' : 'all'),
      state, http: http.stats(),
      results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { status: v.status, error: v.error || v.reason || null, records: v.types ? Object.fromEntries(Object.entries(v.types).map(([t, x]) => [t, x.records ?? 0])) : null }])),
      succeeded: Object.values(results).filter((r) => ['ok', 'warning'].includes(r.status)).length,
      partial: Object.values(results).filter((r) => r.status === 'partial').length,
      failed: Object.values(results).filter((r) => ['error', 'quarantined'].includes(r.status)).length,
      skipped: Object.values(results).filter((r) => r.status === 'skipped').length,
      build: build ? { data_version: build.dataset.data_version, players: build.dataset.players.length, picks: build.dataset.picks.length, unresolved: build.unresolvedCount, ambiguous: build.ambiguousCount } : null,
      build_error: buildError,
    };
    await writeJSON(P.lastSync, summary, { pretty: true });
    const prevLog = await readJSON(P.syncLog, []);
    await writeJSON(P.syncLog, [...prevLog, { ...summary, log: logLines.slice(-200) }].slice(-50));
    progress = { ...progress, running: false, phase: 'done', summary };
    return summary;
  })();
  try {
    return await running;
  } catch (e) {
    progress = { ...(progress || {}), running: false, phase: 'failed', error: e.message, summary: null };
    throw e;
  } finally { running = null; }
}

/**
 * Player DB → dataset → quality report → snapshot → default values/history.
 * Rebuilds are serialized: a sync, a manual import, an identity override and /api/rebuild can all trigger one, and two
 * interleaved rebuilds raced on the same output files (and on the value history).
 */
let rebuildChain = Promise.resolve();
export function rebuild(...args) {
  const run = rebuildChain.then(() => rebuildNow(...args));
  rebuildChain = run.catch(() => {});
  return run;
}

async function rebuildNow(config, statusAll, state, log = () => {}) {
  config = config || loadConfig();
  statusAll = statusAll || (await readJSON(P.sourceStatus, {}));
  state = state || (await readJSON(P.nflState, null)) || calendarNflState();
  const db = await buildPlayerDB(config);
  log(`player DB: ${db.players.length} players ${JSON.stringify(db.summary)}`);
  const { dataset, report } = await buildDataset(config, { players: db.players, overrides: db.overrides, sourceStatus: statusAll, state });
  await writeJSON(P.dataset, dataset);
  // One snapshot per data version: rebuilding identical inputs (rebuild, a sync with nothing new) used to add another
  // copy each time, so duplicates pushed older distinct versions out of the 90 kept (BUG_AUDIT 2, SY5).
  const existing = await fs.readdir(P.snapshots).catch(() => []);
  if (!existing.some((f) => f.endsWith(`__${dataset.data_version}.json.gz`))) {
    await writeGzJSON(path.join(P.snapshots, `${dataset.built_at.replace(/[:.]/g, '-')}__${dataset.data_version}.json.gz`), dataset);
    await pruneDir(P.snapshots, SNAPSHOT_KEEP, (f) => f.endsWith('.json.gz'));
  }
  try {
    await archiveSignals(dataset); // daily signal archive (never pruned) — the history projections/markets lack
  } catch (e) {
    log(`signal archive failed: ${e.message}`);
  }
  await writeJSON(P.unresolved, report, { pretty: true });
  const quality = await compileQualityReport(config, statusAll, report, dataset, db);
  await writeJSON(P.quality, quality, { pretty: true });
  try {
    await updateHistory(dataset, config);
  } catch (e) {
    log(`history update failed: ${e.stack || e.message}`);
  }
  const unresolvedCount = Object.values(report.unresolved).reduce((a, l) => a + l.length, 0);
  log(`dataset ${dataset.data_version}: ${dataset.players.length} players, ${dataset.picks.length} pick values, unresolved ${unresolvedCount}, ambiguous ${report.ambiguous.length}`);
  return { dataset, report, unresolvedCount, ambiguousCount: report.ambiguous.length };
}

async function compileQualityReport(config, statusAll, report, dataset, db) {
  const sources = [];
  for (const s of config.sources.sources) {
    const st = statusAll[s.id] || {};
    const types = {};
    for (const t of [...s.data_types, 'stat_season']) {
      const env = await readJSON(P.normalizedFile(s.id, t), null);
      if (env) types[t] = { fetched_at: env.fetched_at, records: env.records.length, verdict: env.quality?.verdict, issues: env.quality?.issues || [] };
    }
    for (const [t, v] of Object.entries(st.types || {})) {
      if (v.status === 'quarantined') types[t] = { ...(types[t] || {}), quarantined: true, quarantine_issues: v.issues };
      if (v.status === 'error') types[t] = { ...(types[t] || {}), error: v.error };
    }
    sources.push({ id: s.id, name: s.name, status: st.status || (s.adapter === 'manual' ? 'manual' : 'never'), stale: dataset.sources[s.id]?.stale || false, last_success: st.last_success || null, types, identity: report.matched[s.id] || null });
  }
  // Canonical duplicates: same normalized name + position + team (possible missed merge) — reported, never auto-merged.
  const seen = new Map();
  const dupes = [];
  for (const p of dataset.players) {
    const k = `${p.name.toLowerCase()}|${p.position}|${p.team}`;
    if (seen.has(k)) dupes.push({ name: p.name, position: p.position, team: p.team, cids: [seen.get(k), p.cid] });
    else seen.set(k, p.cid);
  }
  const recentEvents = db.events.filter((e) => ['team_change', 'name_variant', 'id_conflict', 'ambiguous_authoritative', 'multi_position', 'id_mismatch'].includes(e.type)).slice(-300);
  return {
    generated_at: new Date().toISOString(), data_version: dataset.data_version,
    sources, identity: { matched: report.matched, unresolved: report.unresolved, ambiguous: report.ambiguous, fuzzy: report.flags }, substitutions: report.substitutions,
    duplicates: dupes, player_events: recentEvents,
    stale_sources: Object.entries(dataset.sources).filter(([, v]) => v.stale).map(([k]) => k),
  };
}

export { DATA_DIR };
