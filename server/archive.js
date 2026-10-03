// Daily signal archive — the history that free sources don't keep (model 2.3.0, audit E9).
//
// Trade-market values (and current-season projections as they stood on a given day) have no public history, so their
// blend weights cannot be backtested. Every rebuild writes the day's signals in compact form to
// data/archive/signals-<YYYY-MM-DD>.json.gz (one file per UTC day; a later build the same day replaces it). Unlike
// snapshots (last 90 builds) the archive is never pruned: ≈130 KB a day, ≈50 MB a year. After a season,
// `npm run audit-model -- --only=e13` backtests every group's weight — market included — against realised points.
// Set FFTA_ARCHIVE=0 to turn it off.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { P } from './lib/paths.js';
import { writeGzJSON, readGzJSON } from './lib/store.js';

export const ARCHIVE_SCHEMA_VERSION = 1;
const FILE_RE = /^signals-(\d{4}-\d{2}-\d{2})\.json\.gz$/;
const r1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);

/**
 * Compact daily record. Players with at least one ranking, market value or projection (ADP-only players carry no
 * value since 2.1.0). Tuple layouts are listed in `fields` so the files stay readable without this code.
 */
export function compactSignals(dataset) {
  const players = [];
  for (const p of dataset.players || []) {
    const rank = (p.rankings || []).filter((r) => r.kind !== 'weekly');
    const mkt = p.market || [], proj = p.projections || [];
    if (!rank.length && !mkt.length && !proj.length) continue;
    players.push({
      cid: p.cid, gsis: p.ids?.gsis || null, sleeper: p.ids?.sleeper || null, name: p.name, pos: p.position, team: p.team,
      status: p.status || null, injury: p.injury || null,
      rank: rank.map((r) => [r.src, r.kind, r.scope, r.qb, r.pos, r.rank, r.sd ?? null]),
      mkt: mkt.map((m) => [m.src, m.dynasty ? 1 : 0, m.qb, m.ppr, m.teams, m.tep, m.value, m.trend30 ?? null]),
      adp: (p.adp || []).map((a) => [a.src, a.format, a.adp]),
      proj: proj.map((q) => [q.src, q.scope, q.season ?? null, q.games ?? null, Object.fromEntries(Object.entries(q.stats || {}).map(([k, v]) => [k, r1(v)]))]),
    });
  }
  return {
    schema_version: ARCHIVE_SCHEMA_VERSION,
    date: (dataset.built_at || new Date().toISOString()).slice(0, 10),
    data_version: dataset.data_version, built_at: dataset.built_at, state: dataset.state || null,
    fields: {
      rank: ['src', 'kind', 'scope', 'qb', 'pos', 'rank', 'sd'],
      mkt: ['src', 'dynasty', 'qb', 'ppr', 'teams', 'tep', 'value', 'trend30'],
      adp: ['src', 'format', 'adp'],
      proj: ['src', 'scope', 'season', 'games', 'stats'],
      picks: ['src', 'season', 'round', 'slot', 'bucket', 'dynasty', 'qb', 'value'],
    },
    players,
    picks: (dataset.picks || []).map((k) => [k.src, k.season, k.round, k.slot ?? null, k.bucket ?? null, k.dynasty ? 1 : 0, k.qb ?? null, k.value]),
  };
}

/** Write (or replace) today's archive file. Returns {file, date, players} or null when disabled. */
export async function archiveSignals(dataset, { dir = P.archive } = {}) {
  if (process.env.FFTA_ARCHIVE === '0') return null;
  const rec = compactSignals(dataset);
  const file = path.join(dir, `signals-${rec.date}.json.gz`);
  await writeGzJSON(file, rec);
  return { file, date: rec.date, players: rec.players.length };
}

/** Archived days, oldest first: [{date, file}]. */
export async function listArchive({ dir = P.archive } = {}) {
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return []; }
  return files.map((f) => f.match(FILE_RE)).filter(Boolean).map((m) => ({ date: m[1], file: path.join(dir, m[0]) })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadArchiveDay(file) {
  const rec = await readGzJSON(file, null);
  if (!rec || rec.schema_version !== ARCHIVE_SCHEMA_VERSION || !Array.isArray(rec.players)) return null;
  return rec;
}
