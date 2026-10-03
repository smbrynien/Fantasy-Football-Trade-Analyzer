// "What would even this trade out?" — single assets that, added to the side receiving less, bring the trade closest
// to even. Every candidate is scored with analyzeTrade itself, so the package (consolidation) adjustment is applied
// exactly: adding a player to a side that already receives more players is charged, a pick is not. This is a
// presentation helper on top of the existing valuations — it does not change any value.

import { analyzeTrade } from './trade.js';
import { getAsset } from './engine.js';

// Generic picks only ("2027 1st", "2027 1st (early)"): exact slots and custom ranges would flood the list.
const genericPick = (a) => a.descriptor && a.descriptor.slot === null && !a.descriptor.range;

/**
 * @param result  computeValuations() output
 * @param idsA    asset ids Team A receives
 * @param idsB    asset ids Team B receives
 * @param only    optional list of candidate ids (e.g. my roster when the side to top up receives my assets)
 * @returns {{ side: 'a'|'b'|null, gap: number, oneSided: boolean, suggestions: Array<{id,name,kind,position,team,value,diffAfter,level}> }}
 *          `side` = the side that should receive one more asset (the empty side when only one side has assets);
 *          suggestions sorted by how even the result is.
 */
export function balanceSuggestions(result, idsA, idsB, { limit = 5, pool = 80, exclude = [], only = null } = {}) {
  const base = analyzeTrade(result, idsA, idsB);
  if (!idsA.length && !idsB.length) return { side: null, gap: 0, oneSided: false, suggestions: [] };
  // One side empty ("what is Player X worth?"): value matches for the empty side. Otherwise: top up the short side.
  const oneSided = !idsA.length || !idsB.length;
  if (!oneSided && (!(Math.abs(base.diff) > 0) || base.assessment.level === 'even')) return { side: null, gap: 0, oneSided: false, suggestions: [] };
  const side = oneSided ? (idsA.length ? 'b' : 'a') : base.diff < 0 ? 'a' : 'b';
  const gap = Math.abs(base.diff);
  const used = new Set([...idsA, ...idsB, ...exclude]);
  const candidates = [];
  if (only) {
    // A given list (my roster): any of its assets, including exact picks; one copy of each.
    for (const id of new Set(only)) { const a = getAsset(result, id); if (a && !used.has(a.id) && a.value > 0) candidates.push(a); }
  } else {
    for (const a of result.assets.values()) {
      if (used.has(a.id) || !(a.value > 0)) continue;
      if (a.kind === 'pick' ? !genericPick(a) : !a.team) continue; // free agents can't be part of a trade
      candidates.push(a);
    }
  }
  // Players added to a side that already receives more players lose part of their value to the package adjustment,
  // so the best match can be worth more than the gap: look around the gap on both sides, then score exactly.
  candidates.sort((x, y) => Math.abs(x.value - gap * 1.15) - Math.abs(y.value - gap * 1.15));
  const out = [];
  for (const c of candidates.slice(0, pool)) {
    const ana = side === 'a' ? analyzeTrade(result, [...idsA, c.id], idsB) : analyzeTrade(result, idsA, [...idsB, c.id]);
    out.push({ id: c.id, name: c.name, kind: c.kind, position: c.position, team: c.team || null, value: c.value, diffAfter: ana.diff, level: ana.assessment.level });
  }
  out.sort((x, y) => Math.abs(x.diffAfter) - Math.abs(y.diffAfter) || y.value - x.value || x.id.localeCompare(y.id));
  return { side, gap, oneSided, suggestions: out.slice(0, limit) };
}
