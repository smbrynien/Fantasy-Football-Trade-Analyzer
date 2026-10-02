// Numeric helpers shared by the valuation engine, data-quality checks and research scripts.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function sum(a) { let s = 0; for (const x of a) s += x; return s; }
export function mean(a) { return a.length ? sum(a) / a.length : null; }

export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
}

/** items: [{v, w}] */
export function weightedMean(items) {
  let sw = 0, s = 0;
  for (const { v, w } of items) if (isNum(v) && w > 0) { sw += w; s += v * w; }
  return sw > 0 ? s / sw : null;
}

/** Weighted (population) standard deviation of [{v,w}]. */
export function weightedSd(items) {
  const m = weightedMean(items);
  if (m === null) return null;
  let sw = 0, s = 0;
  for (const { v, w } of items) if (isNum(v) && w > 0) { sw += w; s += w * (v - m) ** 2; }
  return sw > 0 ? Math.sqrt(s / sw) : null;
}

export function weightedMedian(items) {
  const xs = items.filter((x) => isNum(x.v) && x.w > 0).sort((a, b) => a.v - b.v);
  if (!xs.length) return null;
  const total = sum(xs.map((x) => x.w));
  let acc = 0;
  for (const x of xs) { acc += x.w; if (acc >= total / 2) return x.v; }
  return xs[xs.length - 1].v;
}

/** Linear-interpolated quantile, q in [0,1], on an unsorted array. */
export function quantile(a, q) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Value at a (possibly fractional, 1-based) rank on a descending-sorted curve.
 * Beyond the end the curve is extrapolated flat to the last value (never invents a lower/higher number).
 */
export function valueAtRank(sortedDesc, rank) {
  if (!sortedDesc.length || !isNum(rank)) return null;
  if (rank <= 1) return sortedDesc[0];
  const n = sortedDesc.length;
  if (rank >= n) return sortedDesc[n - 1];
  const lo = Math.floor(rank) - 1, hi = lo + 1;
  const f = rank - Math.floor(rank);
  return sortedDesc[lo] + (sortedDesc[hi] - sortedDesc[lo]) * f;
}

/** Piecewise-linear interpolation over sorted points [[x,y],...]; flat extrapolation. */
export function interp(points, x) {
  if (!points.length) return null;
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/** Standard normal pdf / cdf (Abramowitz-Stegun 7.1.26, |err| < 1.5e-7). */
export function normPdf(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }
export function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** E[max(0, X - r)] for X ~ Normal(mu, sigma). The core of the dynasty "upside optionality" calculation. */
export function expectedSurplus(mu, sigma, r) {
  if (!(sigma > 1e-9)) return Math.max(0, mu - r);
  const z = (mu - r) / sigma;
  return (mu - r) * normCdf(z) + sigma * normPdf(z);
}

/** P(X > r) for X ~ Normal(mu, sigma) */
export function probAbove(mu, sigma, r) {
  if (!(sigma > 1e-9)) return mu > r ? 1 : 0;
  return 1 - normCdf((r - mu) / sigma);
}

/** Pool-adjacent-violators: non-increasing least-squares fit. ys in order of x; optional weights. */
export function isotonicDecreasing(ys, ws) {
  const blocks = [];
  ys.forEach((y, i) => {
    blocks.push({ v: y, w: ws ? ws[i] : 1, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v < blocks[blocks.length - 1].v) {
      const b = blocks.pop(), a = blocks.pop();
      const w = a.w + b.w;
      blocks.push({ v: (a.v * a.w + b.v * b.w) / w, w, n: a.n + b.n });
    }
  });
  const out = [];
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.v);
  return out;
}

/** Spearman rank correlation for paired arrays. */
export function spearman(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n);
    for (let i = 0; i < n;) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(x), rank(y));
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export function round(x, d = 0) {
  if (!isNum(x)) return x;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
