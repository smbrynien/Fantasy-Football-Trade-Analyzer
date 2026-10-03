// E7 — TRADE VERDICT CALIBRATION (from the E6 league simulation; REAL HISTORICAL outcomes, SIMULATED leagues).
// How often does the side the model favours actually end the season with more lineup points, by the size of the
// margin? Compares the verdict levels (z = |diff| / √Σσ², σ = f × value) and fits the one-parameter logistic used by
// the app (config trade_outcome.redraft_logit_slope).

import { mean } from '../../js/core/util/stats.js';

const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

export function tradeCalibration(trades) {
  const T = trades.filter((t) => t.detail && Math.max(t.detail.adjA, t.detail.adjB) > 0 && t.detail.diff !== 0);
  const pct = (t) => t.detail.diff / Math.max(t.detail.adjA, t.detail.adjB);
  const won = (t) => Math.sign(t.outcome) === Math.sign(t.detail.diff);
  const bins = [[0, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 0.75], [0.75, 1.01]];
  const byMargin = bins.map(([a, b]) => { const xs = T.filter((t) => Math.abs(pct(t)) >= a && Math.abs(pct(t)) < b); return { margin: `${Math.round(a * 100)}-${Math.round(Math.min(1, b) * 100)}%`, n: xs.length, hitRate: r3(xs.filter(won).length / Math.max(1, xs.length)) }; });
  const verdictLevels = [0.05, 0.1, 0.15].map((f) => {
    const z = (t) => Math.abs(t.detail.diff) / Math.sqrt([...t.detail.valuesA, ...t.detail.valuesB].reduce((s, v) => s + (f * v) ** 2, 0));
    const level = (t) => (z(t) < 1 ? 'close' : z(t) < 2 ? 'lean' : 'clear');
    return { sigmaPctOfValue: f, levels: Object.fromEntries(['close', 'lean', 'clear'].map((L) => { const xs = T.filter((t) => level(t) === L); return [L, { n: xs.length, hitRate: r3(xs.filter(won).length / Math.max(1, xs.length)) }]; })) };
  });
  let best = null;
  for (let a = 0.25; a <= 15; a += 0.25) {
    const ll = T.reduce((s, t) => { const p = 1 / (1 + Math.exp(-a * Math.abs(pct(t)))); return s + Math.log(won(t) ? p : 1 - p); }, 0);
    if (!best || ll > best.ll) best = { slope: a, ll };
  }
  const p = (m) => r3(1 / (1 + Math.exp(-best.slope * m)));
  return {
    experiment: 'E7 trade verdict calibration (share of simulated trades won by the side receiving more value)',
    trades: T.length, byMargin, verdictLevels,
    logistic: { slope: best.slope, logLik: r3(best.ll), at10pct: p(0.1), at20pct: p(0.2), at30pct: p(0.3), at50pct: p(0.5) },
    meanHitRate: r3(mean(T.map((t) => (won(t) ? 1 : 0)))),
  };
}
