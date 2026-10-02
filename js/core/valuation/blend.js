// Shared helpers for turning per-source mapped signals into group signals and blending groups.

import { weightedMean, weightedSd } from '../util/stats.js';
import { mapByPositionRank, mapByOverallRank } from './mapping.js';

/**
 * Map every source list onto the curves and aggregate per player (within-group weighted mean across sources).
 * lists: Map src → array of list objects {items:[{cid, position, key, raw}], excludePositions?}
 * Returns Map cid → { value, sd, sources:[{src, mapped, posRank|overallRank, n, raw}] }
 */
export function aggregateGroup(lists, curves, { higherIsBetter, weights, minPlayers, overall = false }) {
  const perPlayer = new Map();
  for (const [src, srcLists] of lists) {
    const arr = Array.isArray(srcLists) ? srcLists : [srcLists];
    const mappedForSrc = new Map();
    for (const l of arr) {
      let items = l.items;
      if (l.excludePositions && l.excludePositions.size) items = items.filter((i) => !l.excludePositions.has(i.position));
      const mapped = overall
        ? mapByOverallRank(items, curves, { higherIsBetter, minPlayers })
        : mapByPositionRank(items, curves, { higherIsBetter, minPlayers });
      const rawBy = new Map(items.map((i) => [i.cid, i.raw]));
      for (const [cid, m] of mapped) {
        if (!mappedForSrc.has(cid)) mappedForSrc.set(cid, { ...m, raw: rawBy.get(cid), list: l.kind ? `${l.kind}${l.scope === 'position' ? ` ${l.pos}` : ''}` : l.format || null });
      }
    }
    for (const [cid, m] of mappedForSrc) {
      if (!perPlayer.has(cid)) perPlayer.set(cid, []);
      perPlayer.get(cid).push({ src, ...m, weight: weights[src] ?? 0.5 });
    }
  }
  const out = new Map();
  for (const [cid, srcs] of perPlayer) {
    const items = srcs.map((s) => ({ v: s.mapped, w: s.weight }));
    out.set(cid, { value: weightedMean(items), sd: weightedSd(items) || 0, sources: srcs });
  }
  return out;
}

/**
 * Blend available groups. groups: {name: value|null}; weights: {name: w}.
 * Returns { score, effWeights, contributions:{name: value*w/sumW}, totalWeight }
 */
export function blendGroups(groups, weights) {
  let sumW = 0, totalWeight = 0;
  for (const [g, w] of Object.entries(weights)) {
    if (!(w > 0)) continue;
    totalWeight += w;
    if (typeof groups[g] === 'number' && Number.isFinite(groups[g])) sumW += w;
  }
  const effWeights = {}, contributions = {};
  let score = 0;
  for (const [g, w] of Object.entries(weights)) {
    if (!(w > 0) || typeof groups[g] !== 'number' || !Number.isFinite(groups[g])) continue;
    effWeights[g] = w / sumW;
    contributions[g] = (groups[g] * w) / sumW;
    score += contributions[g];
  }
  return { score: sumW > 0 ? score : null, effWeights, contributions, totalWeight, availableWeight: sumW };
}
