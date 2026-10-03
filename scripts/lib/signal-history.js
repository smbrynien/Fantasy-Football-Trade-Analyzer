// Historical projection and ADP archives that are free AND leak-free, for the E9 weight backtest (REAL HISTORICAL DATA).
//
// Checked 2026-10-03 (docs/MODEL_AUDIT.md §21, E9):
//   * Sleeper WEEKLY projections (Rotowire; /projections/nfl/<season>/<week>) are frozen before each week: a player hurt
//     in week 1 keeps his week-1 projection and has none from week 2. Usable as "the projection known before week w".
//   * Sleeper SEASON projections are revised during the season (injured players stripped, breakouts raised): NOT usable.
//   * Sleeper preseason ADP (adp_* inside the season object) stays at its draft-season value: usable.
//   * FantasyFootballCalculator ADP by year is the final preseason window (drafts dated before week 1): usable.
//   * ESPN past seasons (projections and ADP) are end-of-season values: NOT usable.
//   * Trade-market values (FantasyCalc) have no public history: only the app's own daily archive can provide it.
// Everything is cached compactly in scripts/.cache/ (git-ignored).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CACHE, loadCSV } from './history-data.js';
import { createHttp } from '../../server/lib/http.js';
import { mapSleeperStats } from '../../adapters/sleeper.js';
import { scoreStats, resolveScoring } from '../../js/core/scoring.js';
import { readJSONSync } from '../../server/lib/store.js';
import { ROOT } from '../../server/lib/paths.js';
import { normalizePosition } from '../../js/core/util/positions.js';
import { nameKey } from '../../js/core/util/names.js';

const http = createHttp({ timeoutMs: 120000 });
const ppr = resolveScoring({ scoring_preset: 'ppr', scoring: {} }, readJSONSync(path.join(ROOT, 'config', 'league-defaults.json')));
const SLEEPER = 'https://api.sleeper.app/projections/nfl';
const POSQ = 'position[]=QB&position[]=RB&position[]=WR&position[]=TE';
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

async function cachedJSON(name, build) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return JSON.parse(await fsp.readFile(file, 'utf8'));
  const data = await build();
  await fsp.mkdir(CACHE, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data));
  return data;
}

/** Sleeper id → GSIS id (DynastyProcess crosswalk). */
export async function sleeperToGsis() {
  const ids = await loadCSV('db_playerids.csv', 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv');
  return new Map(ids.filter((r) => r.sleeper_id && r.gsis_id && r.sleeper_id !== 'NA' && r.gsis_id !== 'NA').map((r) => [String(r.sleeper_id), r.gsis_id]));
}

/** Weekly projection known before week `w`: {gsis: PPR points for that game (app scoring)}. */
export async function sleeperWeekProjection(season, week, s2g) {
  const rows = await cachedJSON(`sleeper-proj-${season}-w${week}.json`, async () => {
    process.stdout.write(`  downloading Sleeper projections ${season} week ${week} … `);
    const d = await http.json(`${SLEEPER}/${season}/${week}?season_type=regular&${POSQ}`);
    console.log(`${d.length} rows`);
    return d.map((r) => {
      const pos = normalizePosition(r.player?.fantasy_positions?.[0] || r.player?.position);
      if (!SKILL.has(pos) || !r.stats) return null;
      const pts = scoreStats(mapSleeperStats(r.stats, pos), pos, ppr, { perGame: true }).points;
      return Number.isFinite(pts) ? [String(r.player_id), pos, Math.round(pts * 100) / 100] : null;
    }).filter(Boolean);
  });
  const out = new Map();
  for (const [sid, pos, pts] of rows) { const g = s2g.get(sid); if (g) out.set(g, { pos, pts }); }
  return out;
}

/** Sleeper preseason ADP for a season: {gsis: {ppr, half, sf}}. */
export async function sleeperADP(season, s2g) {
  const rows = await cachedJSON(`sleeper-adp-${season}.json`, async () => {
    process.stdout.write(`  downloading Sleeper ADP ${season} … `);
    const d = await http.json(`${SLEEPER}/${season}?season_type=regular&${POSQ}`);
    console.log(`${d.length} rows`);
    return d.map((r) => [String(r.player_id), r.stats?.adp_ppr ?? null, r.stats?.adp_half_ppr ?? null, r.stats?.adp_2qb ?? null]).filter((x) => x[1] !== null && x[1] < 500);
  });
  const out = new Map();
  for (const [sid, adp] of rows) { const g = s2g.get(sid); if (g) out.set(g, adp); }
  return out;
}

/** FantasyFootballCalculator 12-team PPR ADP (final preseason window), matched to GSIS by name + position. */
export async function ffcADP(season, meta) {
  const d = await cachedJSON(`ffc-adp-ppr-${season}.json`, async () => {
    process.stdout.write(`  downloading FFC ADP ${season} … `);
    const j = await http.json(`https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=${season}`);
    console.log(`${j.players?.length} players (${j.meta?.start_date}–${j.meta?.end_date})`);
    return { meta: j.meta, players: (j.players || []).map((p) => [p.name, p.position, p.adp]) };
  });
  const byKey = new Map();
  for (const [g, m] of Object.entries(meta)) { const k = `${nameKey(m.name)}|${m.pos}`; byKey.set(k, byKey.has(k) ? null : g); }
  const out = new Map();
  let unmatched = 0;
  for (const [name, pos, adp] of d.players) {
    const p = normalizePosition(pos);
    if (!SKILL.has(p)) continue;
    const g = byKey.get(`${nameKey(name)}|${p}`);
    if (g) out.set(g, adp); else unmatched++;
  }
  return { adp: out, window: d.meta ? `${d.meta.start_date}–${d.meta.end_date}` : null, unmatched };
}
