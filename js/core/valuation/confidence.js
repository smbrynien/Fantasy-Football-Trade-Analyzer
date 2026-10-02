// Confidence & uncertainty. Deliberately heuristic and labelled as such: it summarises data quality
// (coverage, agreement, sample size, freshness, independence), it is NOT a statistical confidence level.

import { weightedMean, weightedSd, clamp } from '../util/stats.js';

/**
 * @param o {
 *   groups: [{group, weight, value}]  available signal groups (value in score units)
 *   totalWeight: sum of weights of all groups configured for this mode
 *   games: sample size in games (current + last season, 0 for rookies)
 *   staleSources: [ids], independentSources: number, isRookie, extraCv (model-intrinsic uncertainty)
 *   final: final score (score units)
 * }
 */
export function assessConfidence(o, cfg) {
  const reasons = [];
  const avail = o.groups.filter((g) => typeof g.value === 'number');
  const availW = avail.reduce((a, g) => a + g.weight, 0);
  const coverage = o.totalWeight > 0 ? availW / o.totalWeight : 0;
  const m = weightedMean(avail.map((g) => ({ v: g.value, w: g.weight })));
  const s = weightedSd(avail.map((g) => ({ v: g.value, w: g.weight }))) || 0;
  const cv = m && m > 0 ? s / m : avail.length > 1 ? 1 : 0;

  const covF = Math.pow(clamp(coverage, 0, 1), 0.6);
  const dispF = clamp(1 - 0.6 * Math.min(1, cv / cfg.dispersion_full_penalty_cv), 0.4, 1);
  const sampleF = o.isRookie ? 0.7 : 0.7 + 0.3 * Math.min(1, (o.games || 0) / cfg.sample_games_full);
  const freshF = o.staleSources && o.staleSources.length ? 0.85 : 1;
  const indF = o.independentSources >= 3 ? 1 : o.independentSources === 2 ? 0.9 : 0.75;
  const score = Math.round(100 * covF * dispF * sampleF * freshF * indF);

  if (avail.length <= 1) reasons.push('only one signal type available');
  else if (coverage < 0.7) reasons.push(`signals cover ${Math.round(coverage * 100)}% of model weight`);
  if (o.independentSources < 2) reasons.push('fewer than 2 independent sources');
  else if (o.independentSources === 2) reasons.push('only 2 independent sources');
  if (cv >= 0.35) reasons.push('large disagreement between sources');
  else if (cv >= 0.2) reasons.push('moderate disagreement between sources');
  if (o.isRookie) reasons.push('no NFL production yet');
  else if ((o.games || 0) < 6) reasons.push('limited recent statistics');
  if (o.staleSources && o.staleSources.length) reasons.push(`stale data: ${o.staleSources.join(', ')}`);

  const label = score >= cfg.high ? 'High' : score >= cfg.moderate ? 'Moderate' : 'Low';
  // Approximate fair-value range (±1 "sd"): signal disagreement, a coverage-dependent floor, and model-intrinsic cv.
  const final = o.final || 0;
  const floorPct = cfg.min_range_pct + 0.10 * (1 - clamp(coverage, 0, 1)) + (o.extraCv || 0);
  const sigma = Math.max(final * floorPct, cfg.range_sd_multiplier * s * (availW / Math.max(availW, 1e-9)));
  return { score, label, reasons, coverage, cv, sigma, signalSd: s };
}
