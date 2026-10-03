// Roster context ("My Team"): the best starting lineup a roster can field, and how a trade changes it.
// Objective information only — which starters change, lineup value and projected points before → after, depth by
// position. It never says whether to make the trade. Uses the existing asset values; no value is recomputed here.

import { getAsset } from './valuation/engine.js';

const DEDICATED = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const FLEX_SLOTS = ['FLEX', 'SUPERFLEX'];
const DEFAULT_ELIG = { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] };

/**
 * Best lineup for the league's starting slots: dedicated slots take the highest-scored players at their position,
 * then FLEX and SUPERFLEX take the best remaining eligible players (in that order — optimal for nested eligibility,
 * the same allocation the replacement-level code uses league-wide).
 * @param assets  asset objects (players; picks are ignored)
 * @param league  built league (roster, flex_eligibility)
 * @param score   ranking function (default: the asset's value)
 */
export function bestLineup(assets, league, { score = (a) => a.value } = {}) {
  const R = league.roster || {};
  const elig = league.flex_eligibility || DEFAULT_ELIG;
  const rank = (x, y) => score(y) - score(x) || String(x.id).localeCompare(String(y.id));
  const pool = assets.filter((a) => a && a.kind === 'player').sort(rank);
  const used = new Set();
  const slots = [];
  const take = (slot, ok) => {
    const a = pool.find((x) => !used.has(x.id) && ok(x));
    if (a) used.add(a.id);
    slots.push({ slot, asset: a || null });
  };
  for (const p of DEDICATED) for (let i = 0; i < (R[p] || 0); i++) take(p, (x) => x.position === p);
  for (const s of FLEX_SLOTS) for (let i = 0; i < (R[s] || 0); i++) take(s, (x) => (elig[s] || []).includes(x.position));
  return {
    slots,
    starters: slots.filter((s) => s.asset).map((s) => s.asset),
    bench: pool.filter((a) => !used.has(a.id)),
    emptySlots: slots.filter((s) => !s.asset).map((s) => s.slot),
  };
}

/** Remove one occurrence per id (two identical generic picks are two assets). */
function without(ids, remove) {
  const out = [...ids];
  for (const id of remove) { const i = out.indexOf(id); if (i >= 0) out.splice(i, 1); }
  return out;
}

/**
 * How a trade changes MY roster.
 * @param result     computeValuations() output (current mode)
 * @param rosterIds  asset ids on my roster (players and picks)
 * @param giveIds    asset ids I send (= what the other side receives)
 * @param getIds     asset ids I receive
 * @param points     optional id → projected points per game (redraft projection rate); null when unknown
 */
export function rosterImpact(result, rosterIds, giveIds, getIds, { points = null } = {}) {
  const resolve = (ids) => ids.map((id) => getAsset(result, id)).filter(Boolean);
  const beforeIds = [...rosterIds];
  const afterIds = [...without(rosterIds, giveIds), ...getIds];
  const before = resolve(beforeIds), after = resolve(afterIds);
  const L0 = bestLineup(before, result.league), L1 = bestLineup(after, result.league);
  const sumValue = (xs) => xs.reduce((s, a) => s + a.value, 0);
  const sumPoints = (xs) => {
    if (!points) return null;
    let total = 0, missing = 0;
    for (const a of xs) { const p = points(a.id); if (Number.isFinite(p)) total += p; else missing++; }
    return { total, missing };
  };
  const ids0 = new Set(L0.starters.map((a) => a.id)), ids1 = new Set(L1.starters.map((a) => a.id));
  const positions = [...new Set([...before, ...after].filter((a) => a.kind === 'player').map((a) => a.position))]
    .sort((x, y) => DEDICATED.indexOf(x) - DEDICATED.indexOf(y));
  const count = (xs, p) => xs.filter((a) => a.kind === 'player' && a.position === p).length;
  const depth = positions.map((p) => ({
    position: p,
    before: count(before, p), after: count(after, p),
    startersBefore: count(L0.starters, p), startersAfter: count(L1.starters, p),
  }));
  const pickCount = (xs) => xs.filter((a) => a.kind === 'pick').length;
  const benchLimit = result.league.roster?.BENCH;
  const players = (xs) => xs.filter((a) => a.kind === 'player').length;
  const rosterSpots = L1.slots.length + (benchLimit || 0);
  // Only what the trade adds counts: a roster that is already over (IR, taxi squad) isn't the trade's doing.
  const overLimit = benchLimit === undefined ? 0 : Math.max(0, Math.min(players(after) - players(before), players(after) - rosterSpots));
  return {
    before: { lineup: L0, starterValue: sumValue(L0.starters), benchValue: sumValue(L0.bench), totalValue: sumValue(before), points: sumPoints(L0.starters), picks: pickCount(before) },
    after: { lineup: L1, starterValue: sumValue(L1.starters), benchValue: sumValue(L1.bench), totalValue: sumValue(after), points: sumPoints(L1.starters), picks: pickCount(after) },
    startersIn: L1.starters.filter((a) => !ids0.has(a.id)),
    startersOut: L0.starters.filter((a) => !ids1.has(a.id)),
    depth,
    // Assets I'm "giving" that aren't on my roster: the roster may be out of date, or the sides are the wrong way round.
    notOnRoster: giveIds.filter((id) => !rosterIds.includes(id)),
    // More players than starting + bench spots after the trade: someone would have to be dropped.
    overLimit,
  };
}
