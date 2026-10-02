// Value-history helpers for the Trends tab (pure, no DOM — unit-tested in Node).
//
// history.json records the model_version of every entry. Model values from different model versions are not
// comparable: a model upgrade would otherwise look like the player's value moving. These helpers find the model
// boundaries so the chart can break the model line there and value changes are measured within one model version.
// Market, consensus and projection series are raw source data and are not affected.

const versionOf = (e) => e?.model_version ?? 'unknown';

/** Indices i where entries[i] starts a new model version (entries[i-1] used a different one). */
export function modelBoundaries(entries) {
  const out = [];
  for (let i = 1; i < entries.length; i++) if (versionOf(entries[i]) !== versionOf(entries[i - 1])) out.push(i);
  return out;
}

/** Chart markers [{x, label}] at each model change. xs[i] is the x value (time) of entries[i]. */
export function modelMarkers(entries, xs) {
  return modelBoundaries(entries).map((i) => ({ x: xs[i], label: `model ${versionOf(entries[i])}` }));
}

/**
 * Change of a series over the last `days`, measured only within the latest entry's model version (or over all
 * entries when sameModelOnly is false, e.g. for market values). Returns null when there is no earlier comparable point.
 */
export function windowDelta(arr, xs, entries, days, { sameModelOnly = true } = {}) {
  const last = arr.length - 1;
  if (last < 1 || arr[last] === null || arr[last] === undefined) return null;
  const cutoff = xs[last] - days * 864e5;
  const v = versionOf(entries[last]);
  for (let i = 0; i < last; i++) {
    if (xs[i] < cutoff || arr[i] === null || arr[i] === undefined) continue;
    if (sameModelOnly && versionOf(entries[i]) !== v) continue;
    return arr[last] - arr[i];
  }
  return null;
}

/** Earliest entry of the latest model version: {index, t, version}, or null without entries. */
export function currentModelStart(entries) {
  if (!entries.length) return null;
  const b = modelBoundaries(entries);
  const index = b.length ? b[b.length - 1] : 0;
  return { index, t: entries[index].t, version: versionOf(entries[index]) };
}
