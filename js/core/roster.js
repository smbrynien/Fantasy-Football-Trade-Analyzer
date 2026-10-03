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

// ---- Expected lineup points (model 2.3.0, audit E12) ---------------------------------------------------------------
// In historical league simulations, the change in a team's EXPECTED weekly lineup points — every player available
// with his availability, the best available lineup starting, empty slots filled from waivers — predicted what a trade
// did to that team better than generic values (0.576 vs 0.549) or the starters' projected points (0.538): depth that
// covers injuries and byes counts, a second star who would sit on the bench doesn't.

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Per-player uniform draws (same player → same draws before and after a trade, so the difference has little noise). */
function drawsFor(id, n) {
  let a = hash32(String(id));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return out;
}

function lineupSlots(league) {
  const R = league.roster || {};
  const elig = league.flex_eligibility || DEFAULT_ELIG;
  const slots = [];
  for (const p of DEDICATED) for (let i = 0; i < (R[p] || 0); i++) slots.push([p]);
  for (const s of FLEX_SLOTS) for (let i = 0; i < (R[s] || 0); i++) slots.push(elig[s] || []);
  return slots;
}

/**
 * Expected points per week of a roster's best available lineup (Monte Carlo over who is available, deterministic).
 * @param assets players (picks ignored)
 * @param league built league (roster, flex_eligibility)
 * @param rate   asset → projected points per game (null = no projection: never starts)
 * @param avail  asset → probability of being available in a given week (0..1)
 * @param waiver position → points per week of the best free agent (fills a slot nobody can)
 */
export function expectedLineupPoints(assets, league, { rate, avail, waiver = {}, draws = 400 } = {}) {
  const ps = assets.filter((a) => a && a.kind === 'player')
    .map((a) => ({ a, r: rate(a), p: Math.min(1, Math.max(0, avail(a) ?? 1)) }))
    .filter((x) => Number.isFinite(x.r) && x.r > 0)
    .sort((x, y) => y.r - x.r || String(x.a.id).localeCompare(String(y.a.id)));
  const u = ps.map((x) => drawsFor(x.a.id, draws));
  const slots = lineupSlots(league);
  const fill = slots.map((ok) => Math.max(0, ...ok.map((pos) => waiver[pos] || 0)));
  let total = 0;
  const used = new Uint8Array(ps.length);
  for (let d = 0; d < draws; d++) {
    used.fill(0);
    slots.forEach((ok, k) => {
      for (let i = 0; i < ps.length; i++) {
        if (!used[i] && u[i][d] < ps[i].p && ok.includes(ps[i].a.position)) { used[i] = 1; total += ps[i].r; return; }
      }
      total += fill[k];
    });
  }
  return slots.length ? total / draws : null;
}

/**
 * Inputs for expectedLineupPoints from the REDRAFT valuations: projected points per game (production rate if there is
 * no projection), availability = the position's historical share of games × the availability shape at the player's
 * rank × the share of remaining games not lost to a current injury, and the league's waiver level per position.
 */
export function expectationInputs(red) {
  const share = red.model?.redraft?.production?.availability || {};
  const get = (a) => red.assets.get(a.id);
  const rate = (a) => {
    const d = get(a)?.details;
    if (!d) return null;
    const r = d.projection?.rate ?? d.production?.rate;
    return Number.isFinite(r) ? r : null;
  };
  const avail = (a) => {
    const d = get(a)?.details;
    if (!d) return 0;
    if (d.projection?.zeroedForInjury) return 0;
    const rem = d.production?.remGames, lost = d.production?.gamesLost || 0;
    const healthy = rem > 0 ? Math.max(0, 1 - lost / rem) : 1;
    return (share[a.position] ?? 0.85) * (d.availability?.factor ?? 1) * healthy;
  };
  const waiver = {};
  const byPos = {};
  for (const x of red.assets.values()) if (x.kind === 'player') { const r = x.details?.projection?.rate; if (Number.isFinite(r)) (byPos[x.position] ||= []).push(r); }
  for (const [pos, rs] of Object.entries(byPos)) {
    rs.sort((p, q) => q - p);
    const i = red.structure?.rostered?.[pos] ?? rs.length;
    waiver[pos] = (rs[Math.min(i, rs.length - 1)] ?? 0) * (share[pos] ?? 0.85);
  }
  return { rate, avail, waiver };
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
 * @param expected   optional expectationInputs(redraft valuations): adds expected lineup points per week
 */
export function rosterImpact(result, rosterIds, giveIds, getIds, { points = null, expected = null } = {}) {
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
  const exp = (xs) => (expected ? expectedLineupPoints(xs, result.league, expected) : null);
  const e0 = exp(before), e1 = exp(after);
  // How often a change this size helped (audit E12 simulations: + per week → share of teams that gained).
  const k = result.model?.trade_outcome?.roster_logit_slope_per_week;
  const expectedDelta = e0 !== null && e1 !== null ? e1 - e0 : null;
  const expectedOutcome = expectedDelta !== null && k > 0 && Math.abs(expectedDelta) >= 0.05
    ? { better: expectedDelta > 0, probability: 1 / (1 + Math.exp(-k * Math.abs(expectedDelta))) }
    : null;
  return {
    before: { lineup: L0, starterValue: sumValue(L0.starters), benchValue: sumValue(L0.bench), totalValue: sumValue(before), points: sumPoints(L0.starters), expected: e0, picks: pickCount(before) },
    after: { lineup: L1, starterValue: sumValue(L1.starters), benchValue: sumValue(L1.bench), totalValue: sumValue(after), points: sumPoints(L1.starters), expected: e1, picks: pickCount(after) },
    expectedDelta, expectedOutcome,
    startersIn: L1.starters.filter((a) => !ids0.has(a.id)),
    startersOut: L0.starters.filter((a) => !ids1.has(a.id)),
    depth,
    // Assets I'm "giving" that aren't on my roster: the roster may be out of date, or the sides are the wrong way round.
    notOnRoster: giveIds.filter((id) => !rosterIds.includes(id)),
    // More players than starting + bench spots after the trade: someone would have to be dropped.
    overLimit,
  };
}
