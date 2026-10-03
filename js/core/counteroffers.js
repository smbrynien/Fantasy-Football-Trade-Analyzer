// Counteroffer table (usability audit F7): the original offer and its variants side by side, each re-analyzed with
// the current values — verdict, totals, what changed against the original and, with a roster, the lineup impact.
// Pure functions over analyzeTrade/rosterImpact; nothing here computes or changes an asset value.

import { analyzeTrade } from './valuation/trade.js';
import { rosterImpact } from './roster.js';

export const MAX_VARIANTS = 8;

const counts = (ids) => { const m = new Map(); for (const id of ids) m.set(id, (m.get(id) || 0) + 1); return m; };
const sameIds = (x, y) => {
  if (x.length !== y.length) return false;
  const c = counts(x);
  for (const id of y) { const k = c.get(id); if (!k) return false; c.set(id, k - 1); }
  return true;
};

/** Same trade: each side receives the same assets (order ignored; duplicate generic picks counted). */
export const sameTrade = (x, y) => !!x && !!y && sameIds(x.a, y.a) && sameIds(x.b, y.b);

/** What `next` changes against `base`, per side: ids added and removed (multiset difference). */
export function tradeChanges(base, next) {
  const diff = (from, to) => {
    const left = counts(from);
    const added = [];
    for (const id of to) { const k = left.get(id); if (k) left.set(id, k - 1); else added.push(id); }
    const removed = [...left].flatMap(([id, k]) => Array(k).fill(id));
    return { added, removed };
  };
  const a = diff(base.a, next.a), b = diff(base.b, next.b);
  return { a, b, none: !a.added.length && !a.removed.length && !b.added.length && !b.removed.length };
}

/**
 * Add a trade to the list unless it is incomplete, already there, or the list is full.
 * @returns {{ list, added: boolean, reason?: 'incomplete'|'duplicate'|'full', index: number }}
 */
export function addVariant(list, trade, { max = MAX_VARIANTS, label } = {}) {
  if (!trade.a.length || !trade.b.length) return { list, added: false, reason: 'incomplete', index: -1 };
  const at = list.findIndex((v) => sameTrade(v, trade));
  if (at >= 0) return { list, added: false, reason: 'duplicate', index: at };
  if (list.length >= max) return { list, added: false, reason: 'full', index: -1 };
  const v = { a: [...trade.a], b: [...trade.b] };
  if (label) v.label = String(label).slice(0, 40);
  return { list: [...list, v], added: true, index: list.length };
}

/** Default row names: "Original", then "Counter 1", "Counter 2" … (a stored label wins). */
export const variantLabel = (v, i) => (v.label ? v.label : i === 0 ? 'Original' : `Counter ${i}`);

/**
 * Analyze every variant with today's values.
 * @param variants  [{a, b, label?}] — the first one is the original the others are compared with
 * @param me        "which side is you" ('a'|'b'; anything else = neutral) — one negotiation, so the same for every row
 * @param rosterIds My Team roster (optional); with `me` it adds the lineup impact of each variant
 * @param points    points-per-game function for rosterImpact (optional)
 * @param names     id → name for analyzeTrade notes (optional)
 */
export function compareCounteroffers(result, variants, { me, rosterIds = [], points, names } = {}) {
  const base = variants[0];
  return variants.map((v, i) => {
    const ana = analyzeTrade(result, v.a, v.b, { names });
    const side = me === 'a' || me === 'b' ? me : null;
    let lineup = null;
    if (side && rosterIds.length && v.a.length && v.b.length) {
      const get = v[side], give = v[side === 'a' ? 'b' : 'a'];
      const r = rosterImpact(result, rosterIds, give, get, { points });
      lineup = {
        valueDelta: r.after.starterValue - r.before.starterValue,
        pointsDelta: r.before.points && r.after.points ? r.after.points.total - r.before.points.total : null,
        startersIn: r.startersIn.map((a) => a.name),
        startersOut: r.startersOut.map((a) => a.name),
      };
    }
    return {
      index: i,
      label: variantLabel(v, i),
      a: v.a, b: v.b,
      analysis: ana,
      totals: [ana.sides[0].adjusted, ana.sides[1].adjusted],
      diff: ana.diff,
      level: ana.assessment.level,
      changes: i === 0 ? null : tradeChanges(base, v),
      lineup,
    };
  });
}
