// E18 — WHAT SCALE SHOULD VALUES BE ON? (REAL HISTORICAL outcomes, SIMULATED leagues; the E6 league simulation)
//
// The app's value is expected surplus points × one factor, so 8,000 vs 4,000 claims "twice the surplus". A ranking
// mapped onto any increasing curve would give the same ORDER; what differs is how a sum of two mid-tier assets
// compares with one star. Each candidate scale below transforms the same preseason information (the 2.3.0 values of
// E6/E11, candidate s04_pg_relcap) and predicts every simulated trade by plain sums (no package adjustment, so the
// scales are compared on equal terms); the app's package-adjusted margin is listed for reference.
//   power_γ     value^γ (γ = 1 is the app's linear surplus scale; γ < 1 compresses stars, γ > 1 stretches them)
//   ordinal     N + 1 − overall rank (a ranking presented as a linear value)
//   chart_k     10,000 · e^(−(rank−1)/k), the shape of typical trade-value charts (k = 25, 45)
//   rawPoints   expected season points, no replacement level (production without scarcity)
//   par         deterministic points above replacement (σ = 0, no bench band)
// Outcome: realised season-points margin of the trade (E6). Metric: correlation, overall and for uneven player
// counts (where the scale matters most), plus per season.

import { leagueSimulation, candidateValues, predictTrade, CANDIDATES } from './league.js';
import { pearson } from '../../js/core/util/stats.js';

const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

export function valueScale(bench, { tradesPerSeason = 1000, seed = 7 } = {}) {
  const perSeason = new Map();
  const ctxFor = (y, season, priors, cands) => {
    if (perSeason.has(y)) return perSeason.get(y);
    const base = cands.s04_pg_relcap.assets;
    const ranked = [...base.values()].filter((a) => a.value > 0).sort((a, b) => b.value - a.value);
    const rankOf = new Map(ranked.map((a, i) => [a.id, i + 1]));
    const N = ranked.length;
    const par = candidateValues(season.players, priors, { sigmaMult: 0, beta: 0, availability: true, pkg: null }).assets;
    const byG = new Map(season.players.map((p) => [p.g, p]));
    const rawPts = (g) => { const p = byG.get(g); return p && p.rank ? priors.rateAt(p.pos, p.rank) * p.teamGames * priors.availAt(p.pos, p.rank) : 0; };
    const v = (g) => base.get(g)?.value || 0;
    const rk = (g) => rankOf.get(g) || N + 1;
    const perSeasonCands = {};
    const T = {
      power_0_5: (g) => v(g) ** 0.5, power_0_75: (g) => v(g) ** 0.75, power_1: (g) => v(g), power_1_25: (g) => v(g) ** 1.25,
      power_1_5: (g) => v(g) ** 1.5, power_2: (g) => v(g) ** 2,
      ordinal: (g) => Math.max(0, N + 1 - rk(g)),
      chart_15: (g) => (rankOf.has(g) ? 10000 * Math.exp(-(rk(g) - 1) / 15) : 0),
      chart_20: (g) => (rankOf.has(g) ? 10000 * Math.exp(-(rk(g) - 1) / 20) : 0),
      chart_25: (g) => (rankOf.has(g) ? 10000 * Math.exp(-(rk(g) - 1) / 25) : 0),
      chart_35: (g) => (rankOf.has(g) ? 10000 * Math.exp(-(rk(g) - 1) / 35) : 0),
      chart_45: (g) => (rankOf.has(g) ? 10000 * Math.exp(-(rk(g) - 1) / 45) : 0),
      rawPoints: rawPts,
      par: (g) => par.get(g)?.value || 0,
    };
    // Replacement level higher up the ranking (roster economics: what a team can field without trading).
    for (const sh of [0.25, 0.5, 0.75, 1]) {
      const c = candidateValues(season.players, priors, { ...CANDIDATES.s04_pg_relcap, replShift: sh });
      T[`repl_${sh}`] = (g) => c.assets.get(g)?.value || 0;
      perSeasonCands[`repl_${sh}_pkg`] = c;
    }
    // The same transforms WITH the app's package adjustment (computed on the transformed values).
    const withPkg = {};
    for (const k of ['power_1', 'power_1_25', 'power_1_5', 'chart_25', 'chart_35']) {
      const assets = new Map([...base].map(([g, a]) => [g, { ...a, value: T[k](g) }]));
      withPkg[`${k}_pkg`] = { assets, result: { ...cands.s04_pg_relcap.result, assets } };
    }
    Object.assign(withPkg, perSeasonCands);
    perSeason.set(y, { T, withPkg });
    return perSeason.get(y);
  };
  const sim = leagueSimulation(bench, {
    tradesPerSeason, seed,
    onTrade: ({ y, season, priors, cands, outA, outB }) => {
      const { T, withPkg } = ctxFor(y, season, priors, cands);
      // A receives outB, sends outA.
      const out = Object.fromEntries(Object.entries(T).map(([k, f]) => [k, outB.reduce((s, p) => s + f(p.g), 0) - outA.reduce((s, p) => s + f(p.g), 0)]));
      for (const [k, cand] of Object.entries(withPkg)) out[k] = predictTrade(cand, outB.map((p) => p.g), outA.map((p) => p.g));
      return out;
    },
  });
  const rows = sim.tradeRows;
  const keys = Object.keys(rows[0].extra);
  const years = [...new Set(rows.map((t) => t.y))].sort();
  const corr = (f, xs) => r3(pearson(xs.map(f), xs.map((t) => t.outcome)));
  const uneven = rows.filter((t) => t.nA !== t.nB), even = rows.filter((t) => t.nA === t.nB);
  // Sign accuracy: share of trades where the side the scale favours really gained more (ties/zero outcomes left out).
  const hit = (f, xs) => { const z = xs.filter((t) => t.outcome !== 0 && f(t) !== 0); return r3(z.filter((t) => Math.sign(f(t)) === Math.sign(t.outcome)).length / Math.max(1, z.length)); };
  const res = {};
  const row = (f) => ({ all: corr(f, rows), uneven: corr(f, uneven), even: corr(f, even), hit: hit(f, rows), hitUneven: hit(f, uneven), bySeason: Object.fromEntries(years.map((y) => [y, corr(f, rows.filter((t) => t.y === y))])) });
  for (const k of keys) res[k] = row((t) => t.extra[k]);
  res.app_with_package = row((t) => t.pred.s04_pg_relcap);
  const best = Object.entries(res).sort((a, b) => b[1].all - a[1].all)[0][0];
  return {
    experiment: 'E18 value scale: which transform of the same preseason information best predicts simulated trade outcomes',
    labels: sim.labels, trades: rows.length, uneven: uneven.length, results: res, best,
  };
}
