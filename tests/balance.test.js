// "Even it out" suggestions (usability audit): exact, side-correct, never a free agent, never changes any value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { analyzeTrade } from '../js/core/valuation/trade.js';
import { balanceSuggestions } from '../js/core/valuation/balance.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const ds = makeDataset();
const red = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config });
const dyn = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_dyn_12_1qb'), mode: 'dynasty', config });
const players = (r) => [...r.assets.values()].filter((a) => a.kind === 'player' && a.team).sort((x, y) => y.value - x.value);

test('lopsided trade: suggestions go to the side that receives less and make it closer, scored exactly', () => {
  const ps = players(red);
  const A = [ps[30].id], B = [ps[0].id]; // B receives far more
  const base = analyzeTrade(red, A, B);
  assert.notEqual(base.assessment.level, 'even');
  const s = balanceSuggestions(red, A, B);
  assert.equal(s.side, 'a');
  assert.ok(Math.abs(s.gap - Math.abs(base.diff)) < 1e-6);
  assert.ok(s.suggestions.length > 0 && s.suggestions.length <= 5);
  for (const x of s.suggestions) {
    assert.ok(!A.includes(x.id) && !B.includes(x.id), 'never suggests an asset already in the trade');
    const exact = analyzeTrade(red, [...A, x.id], B);
    assert.ok(Math.abs(exact.diff - x.diffAfter) < 1e-6, 'diffAfter is the real analyzeTrade result (package adjustment included)');
    assert.ok(red.getAsset(x.id).team, 'free agents are not suggested');
  }
  for (let i = 1; i < s.suggestions.length; i++) assert.ok(Math.abs(s.suggestions[i - 1].diffAfter) <= Math.abs(s.suggestions[i].diffAfter) + 1e-9, 'sorted by how even the result is');
  assert.ok(Math.abs(s.suggestions[0].diffAfter) < Math.abs(base.diff), 'the best suggestion improves the balance');
});

test('mirror: when Team A receives more, suggestions are for Team B', () => {
  const ps = players(red);
  const s = balanceSuggestions(red, [ps[0].id], [ps[30].id]);
  assert.equal(s.side, 'b');
  for (const x of s.suggestions) assert.ok(Math.abs(analyzeTrade(red, [ps[0].id], [ps[30].id, x.id]).diff - x.diffAfter) < 1e-6);
});

test('close or empty trades get no suggestions', () => {
  const ps = players(red);
  assert.deepEqual(balanceSuggestions(red, [], []).suggestions, []);
  assert.deepEqual(balanceSuggestions(red, [ps[10].id], [ps[10].id]).suggestions, []); // diff 0
});

test('one side empty ("what is this player worth?"): value matches for the empty side', () => {
  const ps = players(red);
  const target = ps[5];
  const s = balanceSuggestions(red, [], [target.id]);
  assert.equal(s.side, 'a');
  assert.equal(s.oneSided, true);
  assert.ok(s.suggestions.length > 0);
  assert.ok(!s.suggestions.some((x) => x.id === target.id));
  for (const x of s.suggestions) assert.ok(Math.abs(analyzeTrade(red, [x.id], [target.id]).diff - x.diffAfter) < 1e-6);
  assert.ok(Math.abs(s.suggestions[0].diffAfter) < target.value * 0.1, 'the best single match is within 10% of the target');
  assert.equal(balanceSuggestions(red, [target.id], []).side, 'b');
});

test('dynasty: only generic picks (no exact slots or custom ranges) can be suggested', () => {
  const ps = players(dyn);
  const s = balanceSuggestions(dyn, [ps[40].id], [ps[2].id], { limit: 20, pool: 200 });
  assert.ok(s.suggestions.length > 0);
  for (const x of s.suggestions.filter((y) => y.kind === 'pick')) {
    const d = dyn.getAsset(x.id).descriptor;
    assert.equal(d.slot, null);
    assert.ok(!d.range);
  }
});

test('read-only: computing suggestions changes no asset value', () => {
  const before = new Map([...red.assets.values()].map((a) => [a.id, a.value]));
  const ps = players(red);
  balanceSuggestions(red, [ps[25].id, ps[60].id], [ps[1].id]);
  for (const [id, v] of before) assert.equal(red.assets.get(id).value, v);
});

test('only: suggestions restricted to a given list (my roster), exact picks allowed, nothing else', () => {
  const ps = players(dyn);
  const up = dyn.picks.upcoming;
  const mine = [ps[50].id, ps[60].id, ps[70].id, `pick:${up}:2:early`, `pick:${up}:1`];
  const s = balanceSuggestions(dyn, [ps[3].id], [ps[40].id], { only: mine, limit: 10 }); // A receives more → top up B
  assert.equal(s.side, 'b');
  assert.ok(s.suggestions.length > 0);
  for (const x of s.suggestions) assert.ok(mine.includes(x.id));
});
