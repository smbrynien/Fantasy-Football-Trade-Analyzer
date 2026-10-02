// Normalization of heterogeneous sources onto the model's own value curves.
//
// Raw numbers from unrelated systems are never averaged. Instead each source's ORDERING is mapped onto the
// league-specific value curve:
//   * position-rank mapping — the k-th RB in a source receives the value of the k-th RB on our curve
//   * overall-rank mapping  — the k-th asset overall receives the k-th value overall (used for ADP)
//   * value-function mapping — a monotone map from a source's value scale to ours, fitted on players and then
//                               applied to that source's draft picks (picks have no position).

import { valueAtRank, interp } from '../util/stats.js';

/** Build descending curves per position (and 'ALL') from [{cid, position, score}]. */
export function buildCurves(items) {
  const curves = { ALL: [] };
  for (const x of items) {
    if (typeof x.score !== 'number' || !Number.isFinite(x.score)) continue;
    (curves[x.position] ||= []).push(x.score);
    curves.ALL.push(x.score);
  }
  for (const k of Object.keys(curves)) curves[k].sort((a, b) => b - a);
  return curves;
}

/** Average (fractional) ranks for a list sorted by a goodness key; ties share the mean rank. */
function rankList(items, better) {
  const sorted = [...items].sort(better);
  const ranks = new Map();
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && better(sorted[i], sorted[j + 1]) === 0) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks.set(sorted[k].cid, avg);
    i = j + 1;
  }
  return ranks;
}

/**
 * Position-rank mapping.
 * @param entries [{cid, position, key}] key = value (higher better) or rank (lower better)
 * @param higherIsBetter boolean
 * @returns Map cid → {mapped, posRank, n}
 */
export function mapByPositionRank(entries, curves, { higherIsBetter, minPlayers = 20 } = {}) {
  const out = new Map();
  const byPos = new Map();
  for (const e of entries) {
    if (typeof e.key !== 'number' || !Number.isFinite(e.key)) continue;
    if (!byPos.has(e.position)) byPos.set(e.position, []);
    byPos.get(e.position).push(e);
  }
  const better = higherIsBetter ? (a, b) => b.key - a.key : (a, b) => a.key - b.key;
  for (const [pos, list] of byPos) {
    const curve = curves[pos];
    if (!curve || !curve.length || list.length < Math.min(minPlayers, curve.length)) continue;
    const ranks = rankList(list, better);
    for (const e of list) {
      const r = ranks.get(e.cid);
      out.set(e.cid, { mapped: valueAtRank(curve, r), posRank: r, n: list.length });
    }
  }
  return out;
}

/** Overall-rank mapping onto curves.ALL (used for ADP). */
export function mapByOverallRank(entries, curves, { higherIsBetter, minPlayers = 20 } = {}) {
  const out = new Map();
  const list = entries.filter((e) => typeof e.key === 'number' && Number.isFinite(e.key));
  if (list.length < minPlayers || !curves.ALL.length) return out;
  const ranks = rankList(list, higherIsBetter ? (a, b) => b.key - a.key : (a, b) => a.key - b.key);
  for (const e of list) {
    const r = ranks.get(e.cid);
    out.set(e.cid, { mapped: valueAtRank(curves.ALL, r), overallRank: r, n: list.length });
  }
  return out;
}

/**
 * Fit a monotone function from a source's value scale onto ours using the source's players:
 * the source's k-th most valuable player ↔ our k-th most valuable asset (curveAll).
 * Returns f(x) or null if too few players.
 */
export function fitValueFunction(sourceValues, curveAll, minPlayers = 20) {
  const xs = sourceValues.filter((v) => typeof v === 'number' && v > 0).sort((a, b) => b - a);
  if (xs.length < minPlayers || !curveAll.length) return null;
  const pts = [];
  xs.forEach((x, i) => pts.push([x, valueAtRank(curveAll, i + 1)]));
  pts.reverse(); // ascending x
  // collapse duplicate x
  const clean = [];
  for (const p of pts) {
    if (clean.length && clean[clean.length - 1][0] === p[0]) clean[clean.length - 1][1] = Math.max(clean[clean.length - 1][1], p[1]);
    else clean.push(p);
  }
  const lowX = clean[0][0], lowY = clean[0][1];
  return (x) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    if (x < lowX) return Math.max(0, lowY * (x / lowX));
    return interp(clean, x);
  };
}
