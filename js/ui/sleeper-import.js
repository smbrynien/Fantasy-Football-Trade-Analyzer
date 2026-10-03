// Sleeper league import helpers (My Team): which rookie draft picks each team owns, from Sleeper's public API
// (`league/<id>`, `league/<id>/traded_picks`, `league/<id>/drafts`). Pure functions, so they are unit-tested offline.
//
// Sleeper lists only TRADED picks: every team owns its own pick of each round of each future rookie draft unless an
// entry in traded_picks moved it (roster_id = original team, owner_id = current team). A draft that already happened
// (status "complete") has no picks left. The slot is known only once Sleeper has a draft order for that season
// (`slot_to_roster_id`); otherwise the pick is the generic "unknown slot" asset, the same as "2027 1st" in the search.

import { pickAssetId } from '../core/pick-labels.js';

/** Sleeper league types with rookie picks worth importing: 1 = keeper, 2 = dynasty (0 = redraft). */
export const sleeperHasPicks = (league) => [1, 2].includes(Number(league?.settings?.type));

/**
 * @param rosters      Sleeper rosters [{roster_id}]
 * @param tradedPicks  Sleeper traded_picks [{season, round, roster_id, owner_id}]
 * @param drafts       Sleeper drafts of the league [{season, status, type, slot_to_roster_id}]
 * @param seasons      seasons the app values picks for (e.g. [2027, 2028, 2029])
 * @param rounds       rookie rounds to import (the smaller of the league's draft rounds and the app's rounds)
 * @returns Map roster_id → [pick asset ids] (a team holding two generic 2027 1sts gets the id twice)
 */
export function sleeperPickIds({ rosters, tradedPicks = [], drafts = [], seasons, rounds }) {
  const ids = (rosters || []).map((r) => Number(r.roster_id)).filter(Number.isFinite);
  const teams = ids.length;
  const draftOf = new Map();
  for (const d of Array.isArray(drafts) ? drafts : []) {
    const s = Number(d?.season);
    if (Number.isFinite(s)) draftOf.set(s, d);
  }
  // Current owner of (season, round, original team): the original team unless traded.
  const owner = new Map();
  for (const t of Array.isArray(tradedPicks) ? tradedPicks : []) {
    const s = Number(t?.season), r = Number(t?.round), orig = Number(t?.roster_id), cur = Number(t?.owner_id);
    if ([s, r, orig, cur].every(Number.isFinite)) owner.set(`${s}|${r}|${orig}`, cur);
  }
  const out = new Map(ids.map((id) => [id, []]));
  for (const season of seasons) {
    const draft = draftOf.get(Number(season));
    if (draft && draft.status === 'complete') continue; // already drafted: those picks are players now
    // Draft order known → exact slots (linear: the same slot every round; snake: even rounds reversed).
    const slotOf = new Map();
    if (draft && draft.slot_to_roster_id && typeof draft.slot_to_roster_id === 'object' && draft.type !== 'auction') {
      for (const [slot, rid] of Object.entries(draft.slot_to_roster_id)) if (Number(slot) >= 1 && Number(slot) <= teams) slotOf.set(Number(rid), Number(slot));
    }
    for (let round = 1; round <= rounds; round++) {
      for (const orig of ids) {
        const cur = owner.get(`${season}|${round}|${orig}`) ?? orig;
        if (!out.has(cur)) continue; // traded to a roster that no longer exists
        let slot = slotOf.size === teams ? slotOf.get(orig) ?? null : null;
        if (slot && draft.type === 'snake' && round % 2 === 0) slot = teams + 1 - slot;
        out.get(cur).push(pickAssetId({ season: Number(season), round, slot }));
      }
    }
  }
  return out;
}
