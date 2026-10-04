// E17 — SCORING-FORMAT TRANSLATION OF CONSENSUS ORDER (REAL HISTORICAL DATA, walk-forward).
//
// Every consensus/market list the app uses is PPR (FantasyPros ECR pages "ppr-*", FantasyCalc 0.5/1 PPR only), and
// those lists are mapped by POSITIONAL RANK onto the league's value curve. So in a standard, half-PPR or TE-premium
// league the scoring changes the curve (how much the k-th RB is worth) but never the ORDER within a position: a
// pass-catching RB keeps his PPR rank in a standard league. Question: does translating the PPR order into the league's
// scoring with each player's own stat profile predict the league-format outcome better?
//   untranslated  PPR ECR positional order (what the app does)
//   translated    PPR level implied by the ECR rank (rank → PPR points per game, fitted on earlier seasons) × the
//                 player's format ratio (league-format points / PPR points from his previous season, shrunk toward the
//                 position's mean ratio with weight games/(games + 8)); re-ordered within position
//   oracleRatio   the same with the ratio from the target season itself (upper bound — LEAKS, for scale only)
// Targets: realised points in each format (preseason: season; in season: rest of season from the checkpoint).
// Metric: Spearman within position (RB, WR, TE; QBs have no receptions), averaged over seasons/checkpoints.

import path from 'node:path';
import { snapshotBefore } from './benchmark.js';
import { positionalRanks } from './backtests.js';
import { scoreStats, resolveScoring } from '../../js/core/scoring.js';
import { mean, spearman } from '../../js/core/util/stats.js';
import { readJSONSync } from '../../server/lib/store.js';
import { ROOT } from '../../server/lib/paths.js';

const defaults = readJSONSync(path.join(ROOT, 'config', 'league-defaults.json'));
const POS = ['RB', 'WR', 'TE'];
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const lastWeek = (y) => (y >= 2021 ? 18 : 17);
const played = (wk) => (wk.st.pass_att || 0) + (wk.st.rush_att || 0) + (wk.st.rec_tgt || 0) + (wk.st.rec || 0) > 0;

export const FORMATS = {
  ppr: resolveScoring({ scoring_preset: 'ppr', scoring: {} }, defaults),
  half: resolveScoring({ scoring_preset: 'half_ppr', scoring: {} }, defaults),
  standard: resolveScoring({ scoring_preset: 'standard', scoring: {} }, defaults),
  tep05: resolveScoring({ scoring_preset: 'ppr', scoring: { bonus_rec_te: 0.5 } }, defaults),
  tep10: resolveScoring({ scoring_preset: 'ppr', scoring: { bonus_rec_te: 1 } }, defaults),
};

function pts(bench, g, y, from, to, scoring) {
  const pos = bench.meta[g]?.pos;
  let p = 0, gp = 0;
  for (const wk of bench.weekly[g]?.[y] || []) if (wk.w >= from && wk.w <= to) { p += scoreStats(wk.st, pos, scoring, { perGame: true }).points || 0; if (played(wk)) gp++; }
  return { p, gp };
}

/** Format ratio of a player from a stats window: (format pts, ppr pts, games). */
function ratioStats(bench, g, y, from, to, fmt) {
  const a = pts(bench, g, y, from, to, FORMATS[fmt]), b = pts(bench, g, y, from, to, FORMATS.ppr);
  return { f: a.p, ppr: b.p, gp: b.gp };
}

export function formatTranslation(bench, { checkpoints = [1, 6, 10] } = {}) {
  const out = { experiment: 'E17 scoring-format translation of the PPR consensus order (within-position Spearman with format outcomes)', label: 'REAL HISTORICAL DATA', results: [], summary: {} };
  const curveFit = {}; // rank → PPR ppg per position (power law), from earlier seasons
  const fitPairs = {};
  for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) {
    for (const start of checkpoints) {
      const key = start === 1 ? 'redraft' : null;
      const first = start === 1 ? bench.schedule[y]?.weeks[1]?.first : bench.schedule[y]?.weeks[start]?.first;
      if (!first) continue;
      // Preseason: PPR cheat sheet; in season: ROS positional PPR lists (one per position).
      const rows = [];
      if (key) { const s = snapshotBefore(bench, key, first, 21); if (s) rows.push(...s.rows); }
      else for (const pos of POS) { const s = snapshotBefore(bench, `ros:${pos.toLowerCase()}`, first, 10); if (s) rows.push(...s.rows.map((r) => ({ ...r, pos }))); }
      if (!rows.length) continue;
      const ranks = positionalRanks(rows);
      const res = { season: y, startWeek: start, byFormat: {} };
      for (const fmt of ['standard', 'half', 'tep05', 'tep10']) {
        const rhos = { untranslated: [], translated: [], oracleRatio: [] };
        for (const pos of POS) {
          if (fmt.startsWith('tep') && pos !== 'TE') continue;
          const list = [];
          for (const [g, r] of ranks) {
            if (r.pos !== pos || r.rank > { RB: 60, WR: 84, TE: 32 }[pos]) continue;
            const target = pts(bench, g, y, start, lastWeek(y), FORMATS[fmt]);
            // Prior ratio: season to date (in season) + previous season, shrunk to the position mean below.
            const prev = ratioStats(bench, g, y - 1, 1, lastWeek(y - 1), fmt);
            const cur = start > 1 ? ratioStats(bench, g, y, 1, start - 1, fmt) : { f: 0, ppr: 0, gp: 0 };
            const oracle = ratioStats(bench, g, y, start, lastWeek(y), fmt);
            list.push({ g, rank: r.rank, target: target.p, f: prev.f + cur.f, ppr: prev.ppr + cur.ppr, gp: prev.gp + cur.gp, oracle });
          }
          if (list.length < 12) continue;
          const okR = list.filter((x) => x.ppr > 0);
          const posMean = okR.length ? okR.reduce((a, x) => a + x.f, 0) / okR.reduce((a, x) => a + x.ppr, 0) : 1;
          // Implied PPR level by rank: monotone, from the realised PPR points of earlier seasons' same ranks.
          // Strictly decreasing power law ppg = A·rank^b (b < 0) fitted on earlier seasons: a flat (tied) level curve
          // would throw away the consensus order inside each tie.
          const level = (rank) => { const c = curveFit[pos]; return c ? c.A * Math.pow(rank, c.b) : Math.pow(rank, -0.5); };
          for (const x of list) {
            const own = x.ppr > 0 ? x.f / x.ppr : posMean;
            const w = x.gp / (x.gp + 8);
            const ratio = w * own + (1 - w) * posMean;
            x.translated = level(x.rank) * ratio;
            x.oracleKey = level(x.rank) * (x.oracle.ppr > 0 ? x.oracle.f / x.oracle.ppr : posMean);
          }
          const tgt = list.map((x) => x.target);
          rhos.untranslated.push(spearman(list.map((x) => -x.rank), tgt));
          rhos.translated.push(spearman(list.map((x) => x.translated), tgt));
          rhos.oracleRatio.push(spearman(list.map((x) => x.oracleKey), tgt));
        }
        res.byFormat[fmt] = Object.fromEntries(Object.entries(rhos).map(([k, v]) => [k, r3(mean(v.filter(Number.isFinite)))]));
      }
      out.results.push(res);
    }
    // After the season: rank → realised PPR ppg curve per position (for later seasons' implied levels).
    const s = snapshotBefore(bench, 'redraft', bench.schedule[y]?.weeks[1]?.first, 21);
    if (s) {
      const ranks = positionalRanks(s.rows);
      for (const pos of POS) {
        const pairs = [...ranks].filter(([, r]) => r.pos === pos).map(([g, r]) => { const t = pts(bench, g, y, 1, lastWeek(y), FORMATS.ppr); return [r.rank, t.gp ? t.p / t.gp : 0]; }).sort((a, b) => a[0] - b[0]);
        // pooled with earlier seasons: least squares of ln(ppg) on ln(rank) over every pair seen so far
        const acc = (fitPairs[pos] ||= []);
        for (const [rk, v] of pairs) if (v > 0) acc.push([Math.log(rk), Math.log(v)]);
        const mx = mean(acc.map((q) => q[0])), my = mean(acc.map((q) => q[1]));
        const b = acc.reduce((t, q) => t + (q[0] - mx) * (q[1] - my), 0) / acc.reduce((t, q) => t + (q[0] - mx) ** 2, 0);
        curveFit[pos] = { A: Math.exp(my - b * mx), b: Math.min(-0.01, b) };
      }
    }
  }
  // Only results with an implied-level curve (seasons after the first) count in the summary.
  const valid = out.results.filter((r) => r.season >= 2021);
  for (const fmt of ['standard', 'half', 'tep05', 'tep10']) {
    for (const k of ['untranslated', 'translated', 'oracleRatio']) {
      const xs = valid.map((r) => r.byFormat[fmt]?.[k]).filter(Number.isFinite);
      (out.summary[fmt] ||= {})[k] = r3(mean(xs));
    }
    const wins = valid.filter((r) => r.byFormat[fmt]?.translated > r.byFormat[fmt]?.untranslated).length;
    out.summary[fmt].translatedBetterIn = `${wins}/${valid.filter((r) => Number.isFinite(r.byFormat[fmt]?.translated)).length}`;
  }
  return out;
}
