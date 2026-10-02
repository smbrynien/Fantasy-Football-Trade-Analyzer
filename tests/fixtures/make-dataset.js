// Deterministic SYNTHETIC dataset for tests. Player names are fake ("Test QB 1" …); no real data.
// Shape matches data/calculated/dataset.json (schema v1).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const readConfig = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', f), 'utf8'));

export function loadTestConfig({ calibration = true } = {}) {
  const cal = {};
  if (calibration) {
    const dir = path.join(ROOT, 'config', 'calibration');
    for (const f of fs.readdirSync(dir)) cal[f.replace('.json', '').replace(/-/g, '_')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return { model: readConfig('model.json'), leagueDefaults: readConfig('league-defaults.json'), sources: readConfig('sources.json'), calibration: cal };
}

const TEAMS = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC'];

function statLine(pos, q) {
  // q in (0,1]: quality → per-game stat line
  if (pos === 'QB') return { pass_att: 34, pass_cmp: 22, pass_yd: 180 + 120 * q, pass_td: 1 + 1.4 * q, pass_int: 0.8, rush_att: 3 + 4 * q, rush_yd: 12 + 25 * q, rush_td: 0.1 + 0.25 * q };
  if (pos === 'RB') return { rush_att: 8 + 12 * q, rush_yd: 35 + 60 * q, rush_td: 0.2 + 0.6 * q, rec_tgt: 2 + 3 * q, rec: 1.5 + 2.5 * q, rec_yd: 10 + 20 * q, rec_td: 0.05 + 0.1 * q };
  if (pos === 'WR') return { rec_tgt: 4 + 6 * q, rec: 2.5 + 4 * q, rec_yd: 30 + 60 * q, rec_td: 0.15 + 0.45 * q };
  if (pos === 'TE') return { rec_tgt: 3 + 5 * q, rec: 2 + 3.5 * q, rec_yd: 20 + 45 * q, rec_td: 0.1 + 0.4 * q };
  return { fp_src: 6 + 4 * q };
}
const scale = (st, g) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v * g]));

/** Build a synthetic dataset. counts per position; quality declines with index. */
export function makeDataset({ season = 2026, week = 6, counts = { QB: 36, RB: 70, WR: 90, TE: 36, K: 16, DEF: 16 } } = {}) {
  const players = [];
  let n = 0;
  for (const [pos, cnt] of Object.entries(counts)) {
    for (let i = 0; i < cnt; i++) {
      const q = Math.max(0.05, 1 - i / cnt);
      const team = TEAMS[(i + n) % TEAMS.length];
      const age = pos === 'QB' ? 24 + (i % 12) : 22 + (i % 9);
      const birth = `${season - age}-03-15`;
      const cid = pos === 'DEF' ? `DEF_${team}` : `T${pos}${i + 1}`;
      const remGames = 18 - week;
      const per = statLine(pos, q);
      const p = {
        cid, name: pos === 'DEF' ? `${team} Defense` : `Test ${pos} ${i + 1}`, position: pos, positions: [pos], team,
        birth_date: pos === 'DEF' ? null : birth, college: 'Test U', draft: { year: season - (age - 22), round: 1 + (i % 7), pick: 1 + (i * 3) % 32 },
        status: 'Active', years_exp: Math.max(0, age - 22), ids: { sleeper: `${9000 + n}` }, aliases: [],
        rankings: [], projections: [], market: [], adp: [], weekly: [], last_season: null, injury: null, bye_week: 10,
      };
      p.projections.push({ src: 'sleeper_projections', scope: 'ros', season, games: remGames, stats: scale(per, remGames) });
      p.projections.push({ src: 'espn', scope: 'ros', season, games: remGames, stats: scale(per, remGames * (0.95 + 0.1 * ((i % 3) / 2))) });
      if (pos !== 'K' && pos !== 'DEF') {
        for (let w = 1; w < week; w++) p.weekly.push({ s: season, w, team, opp: TEAMS[(i + w) % TEAMS.length], st: scale(per, 0.9 + 0.2 * ((w + i) % 3) / 2), u: { snap_pct: 0.5 + 0.4 * q, target_share: 0.05 + 0.2 * q } });
        p.last_season = { season: season - 1, games: 15, st: scale(per, 15), src: 'nflverse' };
        const posRank = i + 1;
        p.rankings.push({ src: 'fantasypros_ecr', kind: 'ros', scope: 'position', qb: '1qb', pos, rank: posRank, ecr: posRank, sd: 2, best: Math.max(1, posRank - 3), worst: posRank + 4 });
        p.rankings.push({ src: 'fantasypros_ecr', kind: 'dynasty', scope: 'position', qb: '1qb', pos, rank: posRank + (age > 28 ? 3 : 0), ecr: posRank + (age > 28 ? 3 : 0) });
        const mv = Math.round(10000 * q ** 2 * (pos === 'QB' ? 0.6 : 1));
        for (const dynasty of [true, false]) for (const qb of ['1qb', 'sf']) {
          const v = qb === 'sf' && pos === 'QB' ? mv * 2.2 : mv;
          p.market.push({ src: 'fantasycalc', dynasty, qb, ppr: 1, teams: 12, value: Math.round(dynasty ? v * (age < 26 ? 1.15 : 0.9) : v), trend30: 0 });
        }
        p.adp.push({ src: 'sleeper_projections', format: 'redraft_ppr', adp: n + 1 });
      }
      players.push(p);
      n++;
    }
  }
  // rookie class (draft year = season) with rookie rankings
  for (let i = 0; i < 40; i++) {
    const pos = ['RB', 'WR', 'WR', 'TE', 'QB'][i % 5];
    const q = Math.max(0.05, 1 - i / 40);
    players.push({
      cid: `TR${i + 1}`, name: `Test Rookie ${i + 1}`, position: pos, positions: [pos], team: TEAMS[i % 16], birth_date: `${season - 21}-05-01`, college: 'Test U',
      draft: { year: season, round: 1 + Math.floor(i / 8), pick: 1 + (i % 32) }, status: 'Active', years_exp: 0, ids: { sleeper: `${8000 + i}` }, aliases: [],
      rankings: [{ src: 'fantasypros_ecr', kind: 'rookie', scope: 'overall', qb: '1qb', rank: i + 1, ecr: i + 1 }],
      projections: [{ src: 'sleeper_projections', scope: 'ros', season, games: 18 - week, stats: scale(statLine(pos, q * 0.6), 18 - week) }],
      market: [{ src: 'fantasycalc', dynasty: true, qb: '1qb', ppr: 1, teams: 12, value: Math.round(7000 * q ** 2), trend30: 0 }], adp: [], weekly: [], last_season: null, injury: null, bye_week: 10,
    });
  }
  const picks = [];
  for (const [label, v] of [['2027 1st (Early)', 6500], ['2027 1st (Mid)', 5000], ['2027 1st (Late)', 3800], ['2027 1st', 5100], ['2027 2nd (Early)', 2500], ['2027 2nd (Mid)', 2000], ['2027 2nd (Late)', 1600], ['2027 2nd', 2000], ['2028 1st', 4300], ['2028 2nd', 1700]]) {
    const m = label.match(/^(\d{4}) (\d)\w\w(?: \((\w+)\))?$/);
    picks.push({ src: 'fantasycalc', label, season: +m[1], round: +m[2], slot: null, bucket: m[3] ? m[3].toLowerCase() : null, dynasty: true, qb: '1qb', value: v });
  }
  const teams = Object.fromEntries(TEAMS.map((t) => [t, { bye: 10, remaining_games: 18 - week - 1, remaining_opponents: TEAMS.filter((x) => x !== t).slice(0, 18 - week - 1), games: 17 }]));
  return {
    schema_version: 1, data_version: 'test-fixture', built_at: `${season}-10-15T12:00:00.000Z`,
    state: { season, week, season_type: 'regular', as_of: `${season}-10-15T12:00:00.000Z` },
    meta: { stats_source: 'nflverse' }, sources: {}, teams, players, picks,
  };
}
