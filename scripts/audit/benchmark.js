// Builds (or loads) the REAL HISTORICAL benchmark used by the model audit.
//
// Sources (public, reproducible):
//   * nflverse weekly player stats 2018-2025 (stats_player_week_YYYY.csv), players.csv, schedules (games.csv)
//   * FantasyPros ECR archive as republished by DynastyProcess (db_fpecr.csv.gz): preseason redraft cheat sheets,
//     in-season rest-of-season (ROS) rankings, preseason dynasty rankings, rookie rankings
//   * DynastyProcess ID crosswalk (FantasyPros id → GSIS id)
// Output: data/benchmark/benchmark.json (git-ignored; label: REAL HISTORICAL DATA). Rebuild with --rebuild.
//
// Leakage rules enforced here:
//   * every ranking snapshot is taken from a scrape dated strictly BEFORE the first game of the target window
//   * weekly stats are stored per week so later analyses can cut "to-date" information at any checkpoint

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../server/lib/paths.js';
import { loadCSV, cached, streamECRArchive } from '../lib/history-data.js';
import { parseCSV, toNumber } from '../../js/core/util/csv.js';
import { mapNflverseStats } from '../../adapters/nflverse.js';
import { normalizePosition } from '../../js/core/util/positions.js';
import { normalizeTeam } from '../../js/core/util/teams.js';

export const BENCH_FILE = path.join(DATA_DIR, 'benchmark', 'benchmark.json');
const SEASONS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const POS = new Set(['QB', 'RB', 'WR', 'TE']);

export async function loadBenchmark({ rebuild = false } = {}) {
  if (!rebuild && fs.existsSync(BENCH_FILE)) return JSON.parse(fs.readFileSync(BENCH_FILE, 'utf8'));
  console.log('Building real-data benchmark (first run downloads ~60 MB, streams the 105 MB ECR archive)…');
  const players = await loadCSV('players.csv', 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv');
  const meta = {};
  for (const p of players) {
    const pos = normalizePosition(p.position);
    if (!POS.has(pos)) continue;
    meta[p.gsis_id] = { name: p.display_name, pos, birth: p.birth_date || null, dy: toNumber(p.draft_year), dr: toNumber(p.draft_round), dp: toNumber(p.draft_pick), rookie: toNumber(p.rookie_season) };
  }
  // ---- schedules
  const gamesFile = await cached('games.csv', 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv');
  const games = parseCSV(fs.readFileSync(gamesFile, 'utf8')).records.filter((g) => g.game_type === 'REG' && SEASONS.includes(toNumber(g.season)));
  const schedule = {};
  for (const g of games) {
    const s = toNumber(g.season), w = toNumber(g.week);
    const sch = (schedule[s] ||= { weeks: {}, opp: {} });
    const wk = (sch.weeks[w] ||= { first: g.gameday, last: g.gameday });
    if (g.gameday < wk.first) wk.first = g.gameday;
    if (g.gameday > wk.last) wk.last = g.gameday;
    const h = normalizeTeam(g.home_team), a = normalizeTeam(g.away_team);
    (sch.opp[h] ||= {})[w] = a;
    (sch.opp[a] ||= {})[w] = h;
  }
  // ---- weekly stats
  const weekly = {}; // gsis -> season -> [{w, team, opp, st}]
  for (const y of SEASONS) {
    const rows = await loadCSV(`stats_player_week_${y}.csv`, `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${y}.csv`);
    for (const r of rows) {
      if (r.season_type && r.season_type !== 'REG') continue;
      const pos = normalizePosition(r.position);
      if (!POS.has(pos)) continue;
      const st = mapNflverseStats(r);
      const compact = {};
      for (const [k, v] of Object.entries(st)) if (v) compact[k] = v;
      const ws = (((weekly[r.player_id] ||= {})[y]) ||= []);
      ws.push({ w: toNumber(r.week), team: normalizeTeam(r.team), opp: normalizeTeam(r.opponent_team), st: compact, ts: toNumber(r.target_share) });
      if (!meta[r.player_id]) meta[r.player_id] = { name: r.player_display_name, pos, birth: null, dy: null, dr: null, dp: null };
    }
  }
  // ---- rankings
  const ids = await loadCSV('db_playerids.csv', 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv');
  const fp2g = new Map(ids.filter((r) => r.fantasypros_id && r.gsis_id).map((r) => [r.fantasypros_id, r.gsis_id]));
  const rows = await streamECRArchive((o) => {
    const p = o.fp_page || '';
    return /ppr-cheatsheets|ros-ppr-(overall|rb|wr|te)|ros-qb|dynasty-overall|dynasty-superflex|rookies/.test(p) && !/idp|dst|-k\b/.test(p);
  });
  const lists = {}; // key -> date -> [{g, pos, ecr}]
  for (const r of rows) {
    const g = fp2g.get(r.id);
    const pos = normalizePosition(r.pos);
    if (!g || !POS.has(pos)) continue;
    const page = r.fp_page.replace(/^\/nfl\/rankings\//, '').replace(/\.php$/, '');
    const key = /rookies/.test(page) ? 'rookie' : /dynasty-superflex/.test(page) ? 'dynasty_sf' : /dynasty/.test(page) ? 'dynasty' : /^ros-/.test(page) ? `ros:${page.replace(/^ros-(ppr-)?/, '')}` : 'redraft';
    const d = r.scrape_date.slice(0, 10);
    (((lists[key] ||= {})[d]) ||= []).push({ g, pos, ecr: toNumber(r.ecr), sd: toNumber(r.sd) });
  }
  const bench = {
    label: 'REAL HISTORICAL DATA — nflverse stats + FantasyPros ECR archive (DynastyProcess). Built ' + new Date().toISOString(),
    seasons: SEASONS, meta, schedule, weekly, rankings: lists,
  };
  fs.mkdirSync(path.dirname(BENCH_FILE), { recursive: true });
  fs.writeFileSync(BENCH_FILE, JSON.stringify(bench));
  console.log(`  benchmark: ${Object.keys(meta).length} players, ${Object.keys(lists).length} ranking lists, ${(fs.statSync(BENCH_FILE).size / 1e6).toFixed(1)} MB`);
  return bench;
}

/** Latest snapshot of a ranking list strictly before `beforeDate` (YYYY-MM-DD) and not older than maxAgeDays. */
export function snapshotBefore(bench, key, beforeDate, maxAgeDays = 21) {
  const dates = Object.keys(bench.rankings[key] || {}).filter((d) => d < beforeDate).sort();
  const d = dates[dates.length - 1];
  if (!d) return null;
  if ((new Date(beforeDate) - new Date(d)) / 864e5 > maxAgeDays) return null;
  return { date: d, rows: bench.rankings[key][d] };
}
