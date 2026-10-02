// "Why this value?" and "Why did this value change?" helpers.

import { COMPONENT_LABELS, COMPONENT_ORDER } from './engine.js';

export function explainComponents(asset) {
  const rows = [];
  for (const k of COMPONENT_ORDER) {
    if (asset.components[k] === undefined) continue;
    rows.push({ key: k, label: COMPONENT_LABELS[k] || k, value: asset.components[k], weight: asset.weights ? asset.weights[k] ?? null : null });
  }
  for (const [k, v] of Object.entries(asset.components)) if (!COMPONENT_ORDER.includes(k)) rows.push({ key: k, label: k, value: v, weight: null });
  return rows;
}

/**
 * Compare two valuations of the same asset (e.g. from an older data snapshot vs today, same settings).
 * Returns { from, to, delta, drivers:[{key,label,delta}] sorted by |delta| } — drivers sum to delta.
 */
export function diffAsset(oldA, newA) {
  if (!oldA || !newA) return null;
  const keys = new Set([...Object.keys(oldA.components || {}), ...Object.keys(newA.components || {})]);
  const drivers = [...keys].map((k) => ({ key: k, label: COMPONENT_LABELS[k] || k, delta: (newA.components[k] || 0) - (oldA.components[k] || 0), from: oldA.components[k] || 0, to: newA.components[k] || 0 }))
    .filter((d) => Math.abs(d.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const notes = [];
  const wKeys = new Set([...Object.keys(oldA.weights || {}), ...Object.keys(newA.weights || {})]);
  for (const k of wKeys) {
    const a = oldA.weights?.[k], b = newA.weights?.[k];
    if (a === undefined && b !== undefined) notes.push(`${COMPONENT_LABELS[k] || k} signal became available.`);
    if (a !== undefined && b === undefined) notes.push(`${COMPONENT_LABELS[k] || k} signal is no longer available.`);
  }
  if (oldA.team && newA.team && oldA.team !== newA.team) notes.push(`Team changed ${oldA.team} → ${newA.team}.`);
  const oi = oldA.details?.injury?.status, ni = newA.details?.injury?.status;
  if (oi !== ni) notes.push(`Injury status ${oi || 'none'} → ${ni || 'none'}.`);
  return { from: oldA.value, to: newA.value, delta: newA.value - oldA.value, drivers, notes };
}
