// My Team Sleeper import: which rookie picks each team owns (mocked Sleeper API responses, offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleeperPickIds, sleeperHasPicks } from '../js/ui/sleeper-import.js';
import { computeValuations } from '../js/core/valuation/engine.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const rosters = [1, 2, 3, 4].map((roster_id) => ({ roster_id }));
const sorted = (m) => Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort()]));

test('sleeper picks: every team owns its own picks unless traded; traded picks move, duplicates kept', () => {
  const tradedPicks = [
    { season: '2027', round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 }, // team 1 holds two 2027 1sts
    { season: '2028', round: 2, roster_id: 1, owner_id: 3, previous_owner_id: 1 },
    { season: '2027', round: 2, roster_id: 4, owner_id: 4, previous_owner_id: 3 }, // traded back: still its own
    { season: '2027', round: 1, roster_id: 3, owner_id: 99 }, // owner no longer in the league: dropped
  ];
  const m = sorted(sleeperPickIds({ rosters, tradedPicks, seasons: [2027, 2028], rounds: 2 }));
  assert.deepEqual(m[1], ['pick:2027:1', 'pick:2027:1', 'pick:2027:2', 'pick:2028:1']);
  assert.deepEqual(m[2], ['pick:2027:2', 'pick:2028:1', 'pick:2028:2']);
  assert.deepEqual(m[3], ['pick:2027:2', 'pick:2028:1', 'pick:2028:2', 'pick:2028:2']);
  assert.deepEqual(m[4], ['pick:2027:1', 'pick:2027:2', 'pick:2028:1', 'pick:2028:2']);
  // Conservation: every (season, round, original team) pick is owned exactly once, minus the one sent to team 99.
  const total = Object.values(m).reduce((s, l) => s + l.length, 0);
  assert.equal(total, 2 * 2 * 4 - 1);
});

test('sleeper picks: exact slots from the draft order (linear and snake); completed drafts skipped', () => {
  const order = { 1: 3, 2: 1, 3: 4, 4: 2 }; // slot → roster
  const linear = sorted(sleeperPickIds({ rosters, drafts: [{ season: '2027', status: 'pre_draft', type: 'linear', slot_to_roster_id: order }], seasons: [2027], rounds: 2 }));
  assert.deepEqual(linear[3], ['pick:2027:1:1', 'pick:2027:2:1']);
  assert.deepEqual(linear[2], ['pick:2027:1:4', 'pick:2027:2:4']);
  const snake = sorted(sleeperPickIds({ rosters, drafts: [{ season: '2027', status: 'pre_draft', type: 'snake', slot_to_roster_id: order }], seasons: [2027], rounds: 2 }));
  assert.deepEqual(snake[3], ['pick:2027:1:1', 'pick:2027:2:4']);
  // A traded pick keeps the original team's slot.
  const traded = sorted(sleeperPickIds({ rosters, tradedPicks: [{ season: 2027, round: 1, roster_id: 3, owner_id: 2 }], drafts: [{ season: '2027', status: 'pre_draft', type: 'linear', slot_to_roster_id: order }], seasons: [2027], rounds: 1 }));
  assert.deepEqual(traded[2], ['pick:2027:1:1', 'pick:2027:1:4']);
  assert.deepEqual(traded[3], []);
  // Incomplete order (not every team placed) → generic picks; a completed draft → none; auction → generic.
  assert.deepEqual(sorted(sleeperPickIds({ rosters, drafts: [{ season: '2027', status: 'pre_draft', slot_to_roster_id: { 1: 3 } }], seasons: [2027], rounds: 1 }))[3], ['pick:2027:1']);
  assert.deepEqual(sorted(sleeperPickIds({ rosters, drafts: [{ season: '2027', status: 'complete', slot_to_roster_id: order }], seasons: [2027, 2028], rounds: 1 }))[3], ['pick:2028:1']);
  assert.deepEqual(sorted(sleeperPickIds({ rosters, drafts: [{ season: '2027', status: 'pre_draft', type: 'auction', slot_to_roster_id: order }], seasons: [2027], rounds: 1 }))[3], ['pick:2027:1']);
});

test('sleeper picks: junk responses are ignored; only dynasty/keeper leagues import picks; ids are valued', () => {
  const m = sleeperPickIds({ rosters, tradedPicks: [null, { season: 'x' }, 'bad'], drafts: { not: 'a list' }, seasons: [2027], rounds: 1 });
  assert.equal([...m.values()].flat().length, 4);
  assert.equal(sleeperHasPicks({ settings: { type: 2 } }), true);
  assert.equal(sleeperHasPicks({ settings: { type: 1 } }), true);
  assert.equal(sleeperHasPicks({ settings: { type: 0 } }), false);
  assert.equal(sleeperHasPicks(null), false);
  // Every imported id resolves to a valued dynasty asset (generic and exact slot).
  const config = loadTestConfig();
  const league = readConfig('profiles.json').presets.find((p) => p.id === 'preset_dyn_12_1qb');
  const dyn = computeValuations({ dataset: makeDataset(), league, mode: 'dynasty', config });
  const seasons = [...new Set([...dyn.assets.values()].filter((a) => a.kind === 'pick').map((a) => a.descriptor?.season ?? Number(a.id.split(':')[1])))];
  const ids = [...sleeperPickIds({ rosters, drafts: [{ season: String(seasons[0]), status: 'pre_draft', type: 'linear', slot_to_roster_id: { 1: 1, 2: 2, 3: 3, 4: 4 } }], seasons, rounds: 2 }).values()].flat();
  assert.ok(ids.length === 4 * 2 * seasons.length && ids.some((id) => /^pick:\d+:1:\d+$/.test(id)));
  for (const id of ids) assert.ok(dyn.getAsset(id)?.value > 0, id);
});
