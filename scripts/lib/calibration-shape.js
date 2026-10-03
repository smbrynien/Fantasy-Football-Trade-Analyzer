// Shape constraints for calibrated age curves (used by scripts/calibrate.js and the audit's leak-free refits, so the
// backtests evaluate exactly what ships). Model audit 2026-10-03 (docs/MODEL_AUDIT.md §6): two artefacts at the
// thinly observed ends of the age range made dynasty values non-monotone in age — a 37-year-old TE stopped declining
// (the curve was copied from a flat default beyond the data) and 20–22-year-olds had higher exit hazards than
// 24-year-olds (one noisy cell, 9 exits of 36, pooled into its neighbours).

/** Weighted pool-adjacent-violators: the closest non-decreasing sequence (least squares, weights w). */
export function isotonicIncreasing(ys, ws = ys.map(() => 1)) {
  const blocks = [];
  ys.forEach((y, i) => {
    blocks.push({ v: y, w: ws[i], n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b = blocks.pop(), a = blocks.pop();
      const w = a.w + b.w;
      blocks.push({ v: w > 0 ? (a.v * a.w + b.v * b.w) / w : (a.v + b.v) / 2, w, n: a.n + b.n });
    }
  });
  return blocks.flatMap((b) => Array(b.n).fill(b.v));
}

/**
 * Annual exit hazard by age from raw counts {age: {exits, n}}. Each age pools ±1 year (±2 when that holds fewer than
 * `poolN` observations) and is kept when the pool has at least `minN`; the kept rates then get a weighted monotone
 * (non-decreasing) fit — older players are never LESS likely to drop out of fantasy relevance. Younger ages take the
 * first fitted value; past the last kept age the hazard rises by `step` a year (capped at `cap`).
 */
export function monotoneHazard(raw, { from = 21, to = 42, minN = 15, poolN = 30, step = 0.06, cap = 0.9 } = {}) {
  const pooled = [];
  for (let a = from; a <= to; a++) {
    let ex = 0, n = 0;
    for (const span of [1, 2]) {
      ex = 0; n = 0;
      for (let b = a - span; b <= a + span; b++) if (raw[b]) { ex += raw[b].exits; n += raw[b].n; }
      if (n >= poolN) break;
    }
    if (n >= minN) pooled.push({ a, rate: ex / n, n });
  }
  if (!pooled.length) return {};
  const fit = isotonicIncreasing(pooled.map((p) => p.rate), pooled.map((p) => p.n));
  const at = Object.fromEntries(pooled.map((p, i) => [p.a, fit[i]]));
  const last = pooled[pooled.length - 1].a;
  const out = {};
  let prev = fit[0];
  for (let a = from; a <= to; a++) {
    if (a > last) prev = Math.min(cap, prev + step);
    else if (at[a] !== undefined) prev = at[a];
    out[a] = Math.round(Math.min(cap, prev) * 1000) / 1000;
  }
  return out;
}

/**
 * Age curve {age: multiplier} → unimodal and still declining beyond the data: non-decreasing up to the peak,
 * non-increasing after it, and past `lastSupported` (last age with enough observations) the yearly decline never
 * slows down: each year's ratio v[a]/v[a−1] is capped by the previous year's, starting from the decline observed over
 * the `span` years before `lastSupported` (or `fallbackRate` if that window shows no decline). Values inside the
 * supported range are untouched apart from the unimodality fix.
 */
export function unimodalAgeCurve(curve, lastSupported, { span = 3, fallbackRate = 0.92 } = {}) {
  const ages = Object.keys(curve).map(Number).sort((a, b) => a - b);
  const v = Object.fromEntries(ages.map((a) => [a, curve[a]]));
  const peakAge = ages.reduce((p, a) => (v[a] > v[p] ? a : p), ages[0]);
  for (let i = ages.indexOf(peakAge) - 1; i >= 0; i--) v[ages[i]] = Math.min(v[ages[i]], v[ages[i + 1]]);
  for (let i = ages.indexOf(peakAge) + 1; i < ages.length; i++) v[ages[i]] = Math.min(v[ages[i]], v[ages[i - 1]]);
  const last = Math.max(peakAge, Math.min(lastSupported ?? ages[ages.length - 1], ages[ages.length - 1]));
  const base = v[last - span] ?? v[peakAge];
  const observed = base > 0 ? (v[last] / base) ** (1 / span) : 1;
  let cap = observed < 0.995 ? observed : fallbackRate;
  for (const a of ages) {
    if (a <= last || !(v[a - 1] > 0)) continue;
    const ratio = Math.min(v[a] / v[a - 1], cap);
    v[a] = v[a - 1] * ratio;
    cap = ratio;
  }
  return Object.fromEntries(ages.map((a) => [a, Math.round(v[a] * 1000) / 1000]));
}
