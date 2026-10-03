// E10 — IS THE ± RANGE CALIBRATED? (REAL HISTORICAL DATA; trades: E6 SIMULATED leagues with real outcomes)
//
// The app's ± per asset is a heuristic (js/core/valuation/confidence.js): σ = max(value × floor, SD of the signal
// groups' values), floor = 5% + 10% × missing weight share. Trade verdicts use z = |diff| / √Σσ² (close < 1 ≤ lean
// < 2 ≤ clear). With the leak-free projection and ADP archives (E9) the signal disagreement can be reconstructed for
// past preseasons, so both uses can be checked against outcomes:
//   1. player level — does disagreement predict how wrong a value turns out? what share of season outcomes fall
//      inside ±1σ (68% if σ were an outcome SD)? what range would actually contain 80% of outcomes?
//   2. trade level — which uncertainty definition best predicts how often the favoured side wins: the margin alone
//      (|diff| / larger side, the app's outcome line since 2.2.0), z with σ = a fixed share of value, z with the app's
//      disagreement σ, or z with disagreement only? One parameter per definition, fitted on earlier seasons.

import { preseasonRows, preseason, inSeasonRows, inSeason, appWeightsAt } from './weights.js';
import { sleeperToGsis } from '../lib/signal-history.js';
import { leagueSimulation } from './league.js';
import { mean, median, quantile, spearman, normCdf } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const W = { consensus: 0.40, projection: 0.30, adp: 0.15 }; // app preseason weights of the testable groups
const TOTAL_W = 0.85; // + market 0.15, which has no history: coverage is measured against the testable groups only
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

function wsd(items) {
  const ws = items.reduce((s, x) => s + x.w, 0);
  if (!ws || items.length < 2) return 0;
  const m = items.reduce((s, x) => s + x.w * x.v, 0) / ws;
  return Math.sqrt(items.reduce((s, x) => s + x.w * (x.v - m) ** 2, 0) / ws);
}

/** App-style σ for a set of group values (confidence.js with min_range_pct 0.05, range_sd_multiplier 1). */
function appSigma(groups, value) {
  const avail = Object.entries(groups).filter(([, v]) => Number.isFinite(v)).map(([g, v]) => ({ v, w: W[g] }));
  const coverage = avail.reduce((s, x) => s + x.w, 0) / TOTAL_W;
  const floor = 0.05 + 0.10 * (1 - Math.min(1, coverage));
  return { sigma: Math.max(value * floor, wsd(avail)), disagreement: wsd(avail) };
}

function playerLevel(rows) {
  // rows: walk-forward test rows (E9 preseason, same sample: consensus, projection, adp all present), points space
  const xs = rows.filter((r) => r.app >= 60).map((r) => {
    const { sigma, disagreement } = appSigma({ consensus: r.consensus, projection: r.projection, adp: r.adp }, r.app);
    return { pos: r.pos, pred: r.app, target: r.target, relErr: Math.abs(r.target - r.app) / r.app, ratio: r.target / r.app, dis: disagreement / r.app, inside: Math.abs(r.target - r.app) <= sigma, sigmaPct: sigma / r.app };
  });
  const sorted = [...xs].sort((a, b) => a.dis - b.dis);
  const terciles = [0, 1, 2].map((i) => {
    const part = sorted.slice(Math.floor((i * sorted.length) / 3), Math.floor(((i + 1) * sorted.length) / 3));
    return { disagreement: `${r3(part[0].dis)}–${r3(part[part.length - 1].dis)}`, n: part.length, medianAbsErrorPct: r3(median(part.map((x) => x.relErr))), outcome80: [r3(quantile(part.map((x) => x.ratio), 0.1)), r3(quantile(part.map((x) => x.ratio), 0.9))], insideAppRange: r3(part.filter((x) => x.inside).length / part.length) };
  });
  const tiers = [[60, 120], [120, 180], [180, 250], [250, 1e9]].map(([a, b]) => {
    const part = xs.filter((x) => x.pred >= a && x.pred < b);
    return { predictedPoints: `${a}–${b < 1e9 ? b : '+'}`, n: part.length, outcome80: [r3(quantile(part.map((x) => x.ratio), 0.1)), r3(quantile(part.map((x) => x.ratio), 0.9))], outcome50: [r3(quantile(part.map((x) => x.ratio), 0.25)), r3(quantile(part.map((x) => x.ratio), 0.75))], medianAbsErrorPct: r3(median(part.map((x) => x.relErr))) };
  });
  return {
    n: xs.length,
    appRangeMedianPct: r3(median(xs.map((x) => x.sigmaPct))),
    shareInsideAppRange: r3(xs.filter((x) => x.inside).length / xs.length),
    medianAbsErrorPct: r3(median(xs.map((x) => x.relErr))),
    spearmanDisagreementVsError: r3(spearman(xs.map((x) => x.dis), xs.map((x) => x.relErr))),
    byPosition: Object.fromEntries(POS.map((p) => { const q = xs.filter((x) => x.pos === p); return [p, { n: q.length, spearman: r3(spearman(q.map((x) => x.dis), q.map((x) => x.relErr))) }]; })),
    byDisagreement: terciles, byPredictedPoints: tiers,
  };
}

/** One-parameter models of P(favoured side wins), fitted on earlier seasons (log-likelihood), scored on the next. */
const MODELS = {
  margin: { label: 'logistic in |diff| / larger side (app outcome line since 2.2.0)', stat: (t) => Math.abs(t.pct), p: (k, x) => 1 / (1 + Math.exp(-k * x)), grid: Array.from({ length: 60 }, (_, i) => 0.25 * (i + 1)) },
  zShare: { label: 'Φ(k·z), σ = 10% of each asset value', stat: (t) => t.zShare, p: (k, x) => normCdf(k * x), grid: Array.from({ length: 80 }, (_, i) => 0.025 * (i + 1)) },
  zApp: { label: 'Φ(k·z), σ = the app\'s disagreement σ (max(floor, signal SD))', stat: (t) => t.zApp, p: (k, x) => normCdf(k * x), grid: Array.from({ length: 80 }, (_, i) => 0.025 * (i + 1)) },
  zDis: { label: 'Φ(k·z), σ = signal disagreement only (floor 1% of value)', stat: (t) => t.zDis, p: (k, x) => normCdf(k * x), grid: Array.from({ length: 80 }, (_, i) => 0.025 * (i + 1)) },
};

function scoreModels(trades) {
  const years = [...new Set(trades.map((t) => t.y))].sort();
  const out = {};
  for (const [name, m] of Object.entries(MODELS)) {
    let ll = 0, brier = 0, n = 0;
    const ks = {};
    for (const y of years.slice(1)) {
      const train = trades.filter((t) => t.y < y), test = trades.filter((t) => t.y === y);
      let best = null;
      for (const k of m.grid) { const L = train.reduce((s, t) => { const p = Math.min(0.999, m.p(k, m.stat(t))); return s + Math.log(t.won ? p : 1 - p); }, 0); if (!best || L > best.L) best = { k, L }; }
      ks[y] = best.k;
      for (const t of test) { const p = Math.min(0.999, m.p(best.k, m.stat(t))); ll += Math.log(t.won ? p : 1 - p); brier += ((t.won ? 1 : 0) - p) ** 2; n++; }
    }
    // verdict levels under this statistic with the fitted k: how often did the favoured side win?
    const kAll = ks[years[years.length - 1]];
    const lvl = (t) => { const p = m.p(kAll, m.stat(t)); return p < 0.6 ? 'p<60%' : p < 0.7 ? '60–70%' : p < 0.8 ? '70–80%' : '≥80%'; };
    const calib = Object.fromEntries(['p<60%', '60–70%', '70–80%', '≥80%'].map((L) => { const xs = trades.filter((t) => lvl(t) === L); return [L, { n: xs.length, predicted: r3(mean(xs.map((t) => m.p(kAll, m.stat(t))))), won: r3(xs.filter((t) => t.won).length / Math.max(1, xs.length)) }]; }));
    out[name] = { label: m.label, testLogLikPerTrade: r3(ll / n), brier: r3(brier / n), n, fittedK: ks, calibration: calib };
  }
  return out;
}

/**
 * Rest-of-season outcome ranges in season (E9 in-season test rows: the app blend vs realised points), by remaining
 * games and predicted points per remaining game: realised ÷ predicted at the 10th/25th/75th/90th percentiles.
 */
function inSeasonRanges(rows) {
  const xs = rows.filter((r) => r.rem > 0 && r.app / r.rem >= 4).map((r) => ({ ...r, ppg: r.app / r.rem, ratio: r.target / r.app }));
  const cells = [];
  for (const [ra, rb] of [[1, 7], [8, 11], [12, 18]]) {
    for (const [pa, pb] of [[4, 8], [8, 12], [12, 16], [16, 99]]) {
      const q = xs.filter((r) => r.rem >= ra && r.rem <= rb && r.ppg >= pa && r.ppg < pb).map((r) => r.ratio);
      cells.push({ remainingGames: `${ra}-${rb}`, predictedPerGame: `${pa}-${pb < 99 ? pb : '+'}`, n: q.length, q10: r3(quantile(q, 0.1)), q25: r3(quantile(q, 0.25)), q75: r3(quantile(q, 0.75)), q90: r3(quantile(q, 0.9)) });
    }
  }
  return { n: xs.length, cells };
}

/**
 * The table the app uses (config redraft.outcome_range): realised ÷ predicted points by predicted points per game,
 * preseason rows (season points ÷ 17) and in-season rows (rest-of-season points ÷ remaining games) pooled — the spread
 * depends on the per-game level, hardly on the length of the window (see inSeason.cells).
 */
function outcomeRangeTable(preRows, inRows) {
  const xs = [
    ...preRows.filter((r) => r.app > 0).map((r) => ({ ppg: r.app / 17, ratio: r.target / r.app })),
    ...inRows.filter((r) => r.rem > 0 && r.app > 0).map((r) => ({ ppg: r.app / r.rem, ratio: r.target / r.app })),
  ];
  return [[4, 8], [8, 12], [12, 16], [16, 99]].map(([a, b]) => {
    const q = xs.filter((x) => x.ppg >= a && x.ppg < b).map((x) => x.ratio);
    return { fromPerGame: a, n: q.length, q10: r3(quantile(q, 0.1)), q25: r3(quantile(q, 0.25)), q50: r3(quantile(q, 0.5)), q75: r3(quantile(q, 0.75)), q90: r3(quantile(q, 0.9)) };
  });
}

export async function uncertaintyCalibration(bench, model) {
  const s2g = await sleeperToGsis();
  const data = await preseasonRows(bench, s2g);
  const pre = preseason(data);
  const player = playerLevel(pre.rows);
  const inRows = inSeason(await inSeasonRows(bench, s2g, model.redraft.production), appWeightsAt(model)).rows;
  player.inSeason = inSeasonRanges(inRows);
  player.outcomeRangeTable = outcomeRangeTable(pre.rows, inRows);
  // Group ranks per season for every E6 player; group values = the E6 candidate value at that group's positional rank.
  const groupRanks = new Map();
  for (const [y, d] of Object.entries(data)) for (const r of d.rows) groupRanks.set(`${y}:${r.g}`, r);
  const valueAtRank = new Map();
  const trades = [];
  leagueSimulation(bench, {
    tradesPerSeason: 1000,
    onTrade: ({ y, season, cands, outA, outB, outcome }) => {
      const cand = cands.s04;
      if (!valueAtRank.has(y)) {
        const byPos = {};
        for (const p of season.players) if (p.rank) (byPos[p.pos] ||= [])[p.rank - 1] = cand.assets.get(p.g)?.value ?? 0;
        valueAtRank.set(y, (pos, r) => (r ? byPos[pos]?.[Math.min(r, byPos[pos].length) - 1] ?? 0 : null));
      }
      const vAt = valueAtRank.get(y);
      const sig = (p) => {
        const v = cand.assets.get(p.g)?.value ?? 0;
        const gr = groupRanks.get(`${y}:${p.g}`);
        const adps = gr ? [gr.rAdpS, gr.rAdpF].filter((x) => x !== null).map((r) => vAt(p.pos, r)) : [];
        const groups = { consensus: v, projection: gr && gr.rProj !== null ? vAt(p.pos, gr.rProj) : null, adp: adps.length ? mean(adps) : null };
        const s = appSigma(groups, v);
        return { v, app: s.sigma, dis: Math.max(0.01 * v, s.disagreement), share: 0.1 * v };
      };
      const A = outB.map(sig), B = outA.map(sig); // A receives outB
      const d = { diff: null };
      return { A, B, outcome, d };
    },
  }).tradeRows.forEach((t) => {
    const diff = t.detail.diff, adjMax = Math.max(t.detail.adjA, t.detail.adjB);
    if (!diff || !(adjMax > 0) || !t.outcome) return;
    const all = [...t.extra.A, ...t.extra.B];
    const z = (key) => Math.abs(diff) / Math.sqrt(all.reduce((s, x) => s + x[key] ** 2, 0) || 1);
    trades.push({ y: t.y, pct: diff / adjMax, zShare: z('share'), zApp: z('app'), zDis: z('dis'), won: Math.sign(t.outcome) === Math.sign(diff) });
  });
  const levels = (key) => Object.fromEntries([['close', 0, 1], ['lean', 1, 2], ['clear', 2, 1e9]].map(([L, a, b]) => { const xs = trades.filter((t) => t[key] >= a && t[key] < b); return [L, { n: xs.length, won: r3(xs.filter((t) => t.won).length / Math.max(1, xs.length)) }]; }));
  return {
    experiment: 'E10 calibration of the ± range (player outcomes 2021–2025 preseason; E6 simulated trades)',
    labels: 'REAL HISTORICAL outcomes; signal disagreement rebuilt from leak-free archives (consensus, projection, ADP; no market history)',
    player,
    trades: { n: trades.length, appVerdictLevels: levels('zApp'), models: scoreModels(trades) },
  };
}
