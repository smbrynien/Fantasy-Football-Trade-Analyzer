// My Team / roster context (FEATURE_AUDIT F1): best lineup and how a trade changes it. Pure functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { bestLineup, rosterImpact } from '../js/core/roster.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const ds = makeDataset();
const red = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config });
const sf = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_12_sf_ppr'), mode: 'redraft', config });
const dyn = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_dyn_12_1qb'), mode: 'dynasty', config });
const A = (r, id) => r.getAsset(id);
const byPos = (r, pos) => [...r.assets.values()].filter((a) => a.kind === 'player' && a.position === pos).sort((x, y) => y.value - x.value);

// A plausible roster: QB, 4 RB, 5 WR, 2 TE (1QB PPR: QB1 RB2 WR2 TE1 FLEX1 K1 DEF1).
const team = (r) => [byPos(r, 'QB')[8], ...byPos(r, 'RB').slice(10, 14), ...byPos(r, 'WR').slice(12, 17), ...byPos(r, 'TE').slice(6, 8)].map((a) => a.id);

test('bestLineup: dedicated slots take the best at each position, FLEX the best remaining RB/WR/TE', () => {
  const ids = team(red);
  const L = bestLineup(ids.map((id) => A(red, id)), red.league);
  const slots = L.slots.map((s) => s.slot);
  assert.deepEqual(slots, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF', 'FLEX']);
  const rbs = byPos(red, 'RB').slice(10, 14), wrs = byPos(red, 'WR').slice(12, 17), tes = byPos(red, 'TE').slice(6, 8);
  assert.deepEqual(L.slots.filter((s) => s.slot === 'RB').map((s) => s.asset.id), rbs.slice(0, 2).map((a) => a.id));
  assert.deepEqual(L.slots.filter((s) => s.slot === 'WR').map((s) => s.asset.id), wrs.slice(0, 2).map((a) => a.id));
  const flex = L.slots.find((s) => s.slot === 'FLEX').asset;
  const bestRemaining = [rbs[2], wrs[2], tes[1]].sort((x, y) => y.value - x.value)[0];
  assert.equal(flex.id, bestRemaining.id);
  assert.deepEqual(L.emptySlots, ['K', 'DEF'], 'no kicker/defense on this roster');
  assert.equal(L.starters.length + L.bench.length, ids.length);
});

test('bestLineup in Superflex: the SF slot takes the most valuable remaining player (QB or not)', () => {
  const qbs = byPos(sf, 'QB');
  const ids = [qbs[3].id, qbs[6].id, ...byPos(sf, 'RB').slice(30, 33).map((a) => a.id), ...byPos(sf, 'WR').slice(40, 44).map((a) => a.id), byPos(sf, 'TE')[10].id];
  const L = bestLineup(ids.map((id) => A(sf, id)), sf.league);
  const sfSlot = L.slots.find((s) => s.slot === 'SUPERFLEX');
  assert.ok(sfSlot, 'SF preset has a SUPERFLEX slot');
  assert.ok(sfSlot && sfSlot.asset);
  // The SF slot holds the most valuable player left after the dedicated and FLEX slots — nobody on the bench beats it.
  for (const b of L.bench) assert.ok(b.value <= sfSlot.asset.value);
});

test('rosterImpact: a starter-for-better-starter trade raises lineup value; names who moves in and out', () => {
  const ids = team(red);
  const wrs = byPos(red, 'WR');
  const give = [wrs[12].id], get = [wrs[2].id];
  const r = rosterImpact(red, ids, give, get, { points: () => 10 });
  assert.ok(r.after.starterValue > r.before.starterValue);
  assert.deepEqual(r.startersIn.map((a) => a.id), [wrs[2].id]);
  assert.deepEqual(r.startersOut.map((a) => a.id), [wrs[12].id]);
  assert.deepEqual(r.notOnRoster, []);
  assert.equal(r.overLimit, 0);
  assert.equal(r.before.points.total, 10 * r.before.lineup.starters.length);
  assert.equal(r.before.points.missing, 0);
});

test('rosterImpact: giving a bench player for a bench player leaves starters unchanged', () => {
  const ids = team(red);
  const rb = byPos(red, 'RB');
  const r = rosterImpact(red, ids, [rb[13].id], [rb[40].id]);
  assert.equal(r.startersIn.length, 0);
  assert.equal(r.startersOut.length, 0);
  assert.ok(Math.abs(r.after.starterValue - r.before.starterValue) < 1e-9);
  assert.equal(r.before.points, null, 'no points function → no points');
});

test('rosterImpact: assets not on the roster are flagged; 2-for-1 that overflows the roster is flagged', () => {
  const ids = team(red);
  const wrs = byPos(red, 'WR');
  const r = rosterImpact(red, ids, [wrs[0].id], [wrs[1].id]);
  assert.deepEqual(r.notOnRoster, [wrs[0].id]);
  // Fill the roster to its limit (9 starters + 6 bench = 15), then receive two for one.
  const full = [...ids, ...byPos(red, 'RB').slice(20, 23).map((a) => a.id)];
  assert.equal(full.length, 15);
  const over = rosterImpact(red, full, [full[1]], [wrs[30].id, wrs[31].id]);
  assert.equal(over.overLimit, 1);
});

test('rosterImpact (dynasty): picks count in total value, never in the lineup; duplicate generic picks removed once', () => {
  const up = dyn.picks.upcoming;
  const ids = [...team(dyn), `pick:${up}:1`, `pick:${up}:1`];
  const r = rosterImpact(dyn, ids, [`pick:${up}:1`], [byPos(dyn, 'TE')[20].id]);
  assert.equal(r.before.picks, 2);
  assert.equal(r.after.picks, 1, 'one of the two identical picks is traded');
  assert.ok(r.before.lineup.starters.every((a) => a.kind === 'player'));
});
