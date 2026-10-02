// League scoring engine: converts canonical stat lines (actual or projected) into league-specific fantasy points.

import { normCdf } from './util/stats.js';
import { deepMerge } from './util/objects.js';

/** Canonical stat keys (Sleeper vocabulary). Every adapter maps into these. */
export const CANONICAL_STATS = [
  'pass_att', 'pass_cmp', 'pass_inc', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'pass_fd', 'pass_sack',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt', 'rush_fd',
  'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'rec_2pt', 'rec_fd',
  'fum_lost', 'fp_src',
];

// Stats awarded linearly by the scoring map.
const LINEAR_KEYS = [
  'pass_att', 'pass_cmp', 'pass_inc', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'pass_fd', 'pass_sack',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt', 'rush_fd',
  'rec', 'rec_yd', 'rec_td', 'rec_2pt', 'rec_fd', 'fum_lost',
];

// League-average first downs per yard (used ONLY when a source omits first-down stats but the league scores them).
const FD_PER_YARD = { pass_fd: ['pass_yd', 0.047], rush_fd: ['rush_yd', 0.058], rec_fd: ['rec_yd', 0.054] };

// Per-game coefficient of variation used to estimate threshold bonuses from aggregate projections.
const BONUS_GAME_CV = 0.5;

/** Build the full scoring map for a league from defaults + preset + custom overrides. */
export function resolveScoring(league, leagueDefaults) {
  const preset = leagueDefaults.scoring_presets[league.scoring_preset] || {};
  return deepMerge(deepMerge(leagueDefaults.base_scoring, preset), league.scoring || {});
}

/**
 * Points for a stat line.
 * @param stats    canonical stats object
 * @param position QB/RB/WR/TE/K/DEF
 * @param scoring  resolved scoring map
 * @param opts     { games: number of games the line covers (aggregates), perGame: true if a single game line }
 * @returns { points, estimated: string[] }
 */
export function scoreStats(stats, position, scoring, { games = 1, perGame = false } = {}) {
  const estimated = [];
  if (!stats) return { points: null, estimated };
  if (position === 'K' || position === 'DEF') {
    // K/DEF are scored with the source's own fantasy points (custom K/DST scoring is not modelled in v1).
    const v = stats.fp_src;
    return { points: typeof v === 'number' ? v : null, estimated: typeof v === 'number' ? ['source_points'] : [] };
  }
  let pts = 0;
  let any = false;
  for (const k of LINEAR_KEYS) {
    const w = scoring[k];
    if (!w) continue;
    let v = stats[k];
    if ((v === undefined || v === null) && FD_PER_YARD[k]) {
      const [yk, rate] = FD_PER_YARD[k];
      if (typeof stats[yk] === 'number') { v = stats[yk] * rate; estimated.push(k); }
    }
    if (typeof v === 'number') { pts += v * w; any = true; }
  }
  const rec = typeof stats.rec === 'number' ? stats.rec : 0;
  if (position === 'TE' && scoring.bonus_rec_te) pts += rec * scoring.bonus_rec_te;
  if (position === 'RB' && scoring.bonus_rec_rb) pts += rec * scoring.bonus_rec_rb;
  if (position === 'WR' && scoring.bonus_rec_wr) pts += rec * scoring.bonus_rec_wr;
  if (position === 'TE' && scoring.bonus_fd_te) {
    let fd = stats.rec_fd;
    if (typeof fd !== 'number' && typeof stats.rec_yd === 'number') { fd = stats.rec_yd * FD_PER_YARD.rec_fd[1]; estimated.push('rec_fd'); }
    if (typeof fd === 'number') pts += fd * scoring.bonus_fd_te;
  }
  for (const b of scoring.bonuses || []) {
    if (!b.points) continue;
    const v = stats[b.stat];
    if (typeof v !== 'number') continue;
    if (perGame) {
      if (v >= b.threshold) pts += b.points;
    } else {
      const g = Math.max(games || 1, 1e-6);
      const m = v / g;
      if (m <= 0) continue;
      const p = 1 - normCdf((b.threshold - m) / (BONUS_GAME_CV * m));
      pts += g * p * b.points;
      if (!estimated.includes('bonuses')) estimated.push('bonuses');
    }
  }
  return { points: any ? pts : null, estimated };
}

/** Short human-readable description of a scoring map (for exports / audit). */
export function describeScoring(s) {
  const parts = [`${s.rec} PPR`, `Pass TD ${s.pass_td}`, `INT ${s.pass_int}`];
  if (s.bonus_rec_te) parts.push(`TE +${s.bonus_rec_te}/rec`);
  if (s.pass_fd || s.rush_fd || s.rec_fd) parts.push('1st downs');
  if ((s.bonuses || []).some((b) => b.points)) parts.push('yardage bonuses');
  return parts.join(' · ');
}
