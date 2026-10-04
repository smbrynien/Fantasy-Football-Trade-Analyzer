// E8 — DYNASTY VALUE SPACING (REAL HISTORICAL DATA, walk-forward).
// Dynasty values are mostly consensus/market rankings mapped onto the fundamental curve (the k-th RB gets the k-th
// best RB fundamental), so the curve's SHAPE sets how much a top asset is worth relative to a mid one. Target: the
// hindsight-free lineup value of E5 summed over three seasons with the model's balanced discount (0.82). Prediction:
// the preseason dynasty ECR rank mapped onto the reduced fundamental curve (calibration refitted on earlier seasons,
// model settings γ 2 / prior 20 pseudo-games) for uncertainty multipliers on the year-t CV. Reported as tier ratios
// relative to ranks 1–12 (values are rescaled to the top assets).

import { snapshotBefore } from './benchmark.js';
import { positionalRanks, calibrateBefore, fundamental } from './backtests.js';
import { lineupExperiment } from './lineup.js';
import { mean } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TOPN = { QB: 32, RB: 60, WR: 72, TE: 32 };
const REPL_RANK = { QB: 12, RB: 30, WR: 42, TE: 12 };
const TIERS = [[1, 6], [7, 12], [13, 24], [25, 36], [37, 72]];
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

function ratios(rows, key) {
  const top = rows.filter((r) => r.rank <= 12);
  const k = top.reduce((a, r) => a + r.target, 0) / Math.max(1e-9, top.reduce((a, r) => a + r[key], 0));
  const t = TIERS.map(([a, b]) => { const xs = rows.filter((r) => r.rank >= a && r.rank <= b); return { tier: `${a}-${b}`, n: xs.length, ratio: r3(mean(xs.map((r) => k * r[key])) / mean(xs.map((r) => r.target))) }; });
  return { ratio: t, loss: r3(t.reduce((a, x) => a + (x.ratio > 0 ? Math.log(x.ratio) ** 2 : 0), 0)) };
}

export function dynastyShape(bench, hist, { discount = 0.82, mults = [0, 0.25, 0.5, 1], regularize = true, fundOpt = {} } = {}) {
  const e5 = lineupExperiment(bench, { startWeek: 1, kInfo: 4 });
  const seasonRows = new Map();
  for (const arr of hist.seasons.values()) for (const r of arr) seasonRows.set(`${r.gsis}|${r.season}`, r);
  const repl = (y, pos) => { const xs = [...seasonRows.values()].filter((r) => r.season === y && r.pos === pos).map((r) => r.pts).sort((a, b) => b - a); return xs[REPL_RANK[pos] - 1] ?? 0; };
  const rows = [];
  const seasons = [];
  for (const Y of [2020, 2021, 2022, 2023]) {
    if (![0, 1, 2].every((k) => e5.sim[Y + k])) continue;
    const snap = snapshotBefore(bench, 'dynasty', bench.schedule[Y]?.weeks[1]?.first, 45);
    if (!snap) continue;
    const cal = calibrateBefore(hist, Y, { regularize });
    const ranks = positionalRanks(snap.rows);
    const curves = {};
    const players = [];
    for (const [g, { rank, pos }] of ranks) {
      const m = hist.meta.get(g);
      if (!m) continue;
      const age = m.birth_date ? (new Date(`${Y}-09-01`) - new Date(m.birth_date)) / (365.25 * 864e5) : null;
      const F = Object.fromEntries(mults.map((cm) => [cm, fundamental(seasonRows, cal, g, m, pos, Y, age, repl(Y - 1, pos), { priorK: 20, agingPower: 2, cvMult: cm, ...fundOpt })]));
      for (const cm of mults) if (F[cm] !== null) ((curves[cm] ||= {})[pos] ||= []).push(F[cm]);
      players.push({ g, pos, rank, F });
    }
    for (const cm of mults) for (const pos of POS) curves[cm][pos].sort((a, b) => b - a);
    for (const p of players) {
      if (p.rank > TOPN[p.pos]) continue;
      const target = [0, 1, 2].reduce((a, k) => a + discount ** k * (e5.sim[Y + k].value.get(p.g) ?? 0), 0);
      const row = { Y, g: p.g, pos: p.pos, rank: p.rank, target };
      // Ranking mapped onto the curve (how the app values consensus/market) and the player's own fundamental.
      for (const cm of mults) { const c = curves[cm][p.pos]; row[`map_${cm}`] = c[Math.min(p.rank, c.length) - 1]; row[`own_${cm}`] = p.F[cm]; }
      rows.push(row);
    }
    seasons.push({ season: Y, snapshot: snap.date, n: rows.filter((r) => r.Y === Y).length });
  }
  const res = {};
  for (const cm of mults) {
    res[`ecr_on_curve_cv${cm}`] = ratios(rows, `map_${cm}`);
    res[`fundamental_cv${cm}`] = ratios(rows.filter((r) => r[`own_${cm}`] !== null), `own_${cm}`);
  }
  // Per-season stability of the best multiplier for the mapped (app-like) values.
  const perSeason = seasons.map((s) => ({ season: s.season, loss: Object.fromEntries(mults.map((cm) => [cm, ratios(rows.filter((r) => r.Y === s.season), `map_${cm}`).loss])) }));
  return { experiment: 'E8 dynasty value spacing (3-season hindsight-free lineup value, discount 0.82)', seasons, results: res, perSeason };
}
