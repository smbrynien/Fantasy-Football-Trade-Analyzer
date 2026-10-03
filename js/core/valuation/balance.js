// "What would even this trade out?" — assets that, added to the side receiving less, bring the trade closest to even:
// single assets (balanceSuggestions) and two-asset combinations such as player + pick or two picks
// (comboSuggestions). Every candidate is scored with analyzeTrade itself, so the package (consolidation) adjustment
// is applied exactly: adding a player to a side that already receives more players is charged, a pick is not. This
// is a presentation helper on top of the existing valuations — it does not change any value.

import { analyzeTrade } from './trade.js';
import { getAsset } from './engine.js';

// Generic picks only ("2027 1st", "2027 1st (early)"): exact slots and custom ranges would flood the list.
const genericPick = (a) => a.descriptor && a.descriptor.slot === null && !a.descriptor.range;

const NONE = { side: null, gap: 0, oneSided: false };

/**
 * Shared setup: which side to top up, the gap, the candidate assets and an exact scorer. Null when there is nothing
 * to balance (no assets, or a complete trade that is already even).
 * `copies` = how often a candidate may appear in one combination: a generic pick 2 (two 2027 1sts), a player 1;
 * with `only`, as often as the list holds it.
 */
function setup(result, idsA, idsB, { exclude = [], only = null }) {
  if (!idsA.length && !idsB.length) return null;
  const base = analyzeTrade(result, idsA, idsB);
  // One side empty ("what is Player X worth?"): value matches for the empty side. Otherwise: top up the short side.
  const oneSided = !idsA.length || !idsB.length;
  if (!oneSided && (!(Math.abs(base.diff) > 0) || base.assessment.level === 'even')) return null;
  const side = oneSided ? (idsA.length ? 'b' : 'a') : base.diff < 0 ? 'a' : 'b';
  const used = new Set([...idsA, ...idsB, ...exclude]);
  const candidates = [];
  const copies = new Map();
  if (only) {
    // A given list (my roster): any of its assets, including exact picks; one entry per distinct asset.
    for (const id of only) copies.set(id, (copies.get(id) || 0) + 1);
    for (const id of copies.keys()) { const a = getAsset(result, id); if (a && !used.has(a.id) && a.value > 0) candidates.push(a); else copies.delete(id); }
  } else {
    for (const a of result.assets.values()) {
      if (used.has(a.id) || !(a.value > 0)) continue;
      if (a.kind === 'pick' ? !genericPick(a) : !a.team) continue; // free agents can't be part of a trade
      candidates.push(a);
      copies.set(a.id, a.kind === 'pick' ? 2 : 1);
    }
  }
  const score = (ids) => (side === 'a' ? analyzeTrade(result, [...idsA, ...ids], idsB) : analyzeTrade(result, idsA, [...idsB, ...ids]));
  // How much an addition moved the trade toward the short side (net of any package charge).
  const gained = (ana) => (side === 'a' ? ana.diff - base.diff : base.diff - ana.diff);
  return { side, gap: Math.abs(base.diff), oneSided, candidates, copies, score, gained };
}

const brief = (a) => ({ id: a.id, name: a.name, kind: a.kind, position: a.position, team: a.team || null, value: a.value });

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
  const s = setup(result, idsA, idsB, { exclude, only });
  if (!s) return { ...NONE, suggestions: [] };
  const { side, gap, oneSided, candidates } = s;
  // Players added to a side that already receives more players lose part of their value to the package adjustment,
  // so the best match can be worth more than the gap: look around the gap on both sides, then score exactly.
  candidates.sort((x, y) => Math.abs(x.value - gap * 1.15) - Math.abs(y.value - gap * 1.15));
  const out = [];
  for (const c of candidates.slice(0, pool)) {
    const ana = s.score([c.id]);
    out.push({ ...brief(c), diffAfter: ana.diff, level: ana.assessment.level });
  }
  out.sort((x, y) => Math.abs(x.diffAfter) - Math.abs(y.diffAfter) || y.value - x.value || x.id.localeCompare(y.id));
  return { side, gap, oneSided, suggestions: out.slice(0, limit) };
}

/**
 * Two-asset combinations for the side that receives less (usability audit F4: "player + pick", "two 2nds").
 * Each member is worth `minShare`–130% of the gap (a big asset plus a token filler is a single match, not a
 * combination). All such pairs are ranked by their raw sum against the gap, separately for 0, 1 and 2 players in the
 * pair because the package adjustment charges players only; each class's typical charge is measured with one exact
 * evaluation, then the `pool` most promising pairs are scored exactly with analyzeTrade.
 * The result is diverse: an asset appears in at most one combination, and the best even-level combination of each
 * kind (player + pick, two players, two picks) is kept when one exists.
 * @returns {{ side, gap, oneSided, combos: Array<{ids: string[], assets: object[], value, diffAfter, level, players}> }}
 */
export function comboSuggestions(result, idsA, idsB, { limit = 4, pool = 150, exclude = [], only = null, minShare = 0.15, maxMembers = 300 } = {}) {
  const s = setup(result, idsA, idsB, { exclude, only });
  if (!s) return { ...NONE, combos: [] };
  const { side, gap, oneSided, copies } = s;
  const members = s.candidates.filter((c) => c.value >= gap * minShare && c.value <= gap * 1.3)
    .sort((x, y) => Math.abs(x.value - gap / 2) - Math.abs(y.value - gap / 2) || x.id.localeCompare(y.id))
    .slice(0, maxMembers);
  const byClass = [[], [], []]; // number of players in the pair
  for (let i = 0; i < members.length; i++) {
    for (let j = i; j < members.length; j++) {
      if (i === j && (copies.get(members[i].id) || 0) < 2) continue;
      const x = members[i], y = members[j];
      byClass[(x.kind === 'player') + (y.kind === 'player')].push({ x, y, sum: x.value + y.value });
    }
  }
  const classes = byClass.map((pairs, n) => ({ n, pairs })).filter((c) => c.pairs.length);
  if (!classes.length) return { side, gap, oneSided, combos: [] };
  const scored = new Map();
  const evaluate = (p) => {
    const key = `${p.x.id}|${p.y.id}`;
    if (!scored.has(key)) {
      const ana = s.score([p.x.id, p.y.id]);
      scored.set(key, { ids: [p.x.id, p.y.id], assets: [brief(p.x), brief(p.y)], value: p.sum, diffAfter: ana.diff, level: ana.assessment.level, players: (p.x.kind === 'player') + (p.y.kind === 'player'), gained: s.gained(ana) });
    }
    return scored.get(key);
  };
  const per = Math.max(1, Math.floor(pool / classes.length));
  for (const { pairs } of classes) {
    // Calibrate: what share of its raw value does a pair of this kind actually add (after package charges)?
    const probe = pairs.reduce((b, p) => (Math.abs(p.sum - gap) < Math.abs(b.sum - gap) ? p : b));
    const r = evaluate(probe);
    const ratio = r.gained > 0 ? Math.min(1, r.gained / probe.sum) : 1;
    const target = gap / Math.max(ratio, 0.3);
    pairs.sort((p, q) => Math.abs(p.sum - target) - Math.abs(q.sum - target));
    for (const p of pairs.slice(0, per)) evaluate(p);
  }
  const all = [...scored.values()].sort((x, y) => Math.abs(x.diffAfter) - Math.abs(y.diffAfter) || y.value - x.value || x.ids.join().localeCompare(y.ids.join()));
  const taken = new Set();
  const chosen = [];
  const free = (c) => c.ids.every((id) => !taken.has(id));
  const take = (c) => { chosen.push(c); c.ids.forEach((id) => taken.add(id)); };
  // Variety first: the best even combination of each kind (player + pick before two players before two picks).
  for (const n of [1, 2, 0]) {
    if (chosen.length >= limit) break;
    const best = all.find((c) => c.players === n && c.level === 'even' && free(c));
    if (best) take(best);
  }
  for (const c of all) { if (chosen.length >= limit) break; if (!chosen.includes(c) && free(c)) take(c); }
  chosen.sort((x, y) => Math.abs(x.diffAfter) - Math.abs(y.diffAfter) || y.value - x.value);
  return { side, gap, oneSided, combos: chosen.map(({ gained: _g, ...c }) => c) };
}
