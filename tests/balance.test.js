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

// Two-asset combinations (usability audit F4).
import { comboSuggestions } from '../js/core/valuation/balance.js';

test('combinations: two assets for the short side, scored exactly, each asset used once, sorted', () => {
  for (const r of [red, dyn]) {
    const ps = players(r);
    const A = [ps[30].id], B = [ps[0].id];
    const base = analyzeTrade(r, A, B);
    const c = comboSuggestions(r, A, B);
    assert.equal(c.side, 'a');
    assert.ok(c.combos.length > 0 && c.combos.length <= 4);
    const seen = new Set();
    for (const x of c.combos) {
      assert.equal(x.ids.length, 2);
      const exact = analyzeTrade(r, [...A, ...x.ids], B);
      assert.ok(Math.abs(exact.diff - x.diffAfter) < 1e-6, 'diffAfter is the real analyzeTrade result');
      assert.equal(x.level, exact.assessment.level);
      for (const id of new Set(x.ids)) { assert.ok(!seen.has(id), 'an asset appears in one combination only'); seen.add(id); }
      for (const id of x.ids) {
        assert.ok(!A.includes(id) && !B.includes(id));
        const a = r.getAsset(id);
        if (a.kind === 'player') assert.ok(a.team, 'no free agents');
        else assert.ok(a.descriptor.slot === null && !a.descriptor.range, 'generic picks only');
        assert.ok(a.value >= c.gap * 0.15, 'no token fillers');
      }
    }
    for (let i = 1; i < c.combos.length; i++) assert.ok(Math.abs(c.combos[i - 1].diffAfter) <= Math.abs(c.combos[i].diffAfter) + 1e-9);
    assert.ok(Math.abs(c.combos[0].diffAfter) < Math.abs(base.diff), 'the best combination improves the balance');
  }
});

test('combinations in dynasty: player + pick offered when one evens the trade; the same generic pick may appear twice', () => {
  const ps = players(dyn);
  const c = comboSuggestions(dyn, [], [ps[2].id], { limit: 6 });
  assert.equal(c.side, 'a');
  assert.equal(c.oneSided, true);
  const kinds = new Set(c.combos.map((x) => x.players));
  const pool = comboSuggestions(dyn, [], [ps[2].id], { limit: 200, pool: 2000 });
  if (pool.combos.some((x) => x.players === 1 && x.level === 'even')) assert.ok(kinds.has(1), 'a player + pick combination is shown');
  // Doubling a generic pick is allowed ("two 2027 1sts"); a player never pairs with himself.
  const up = dyn.picks.upcoming;
  const pick = dyn.getAsset(`pick:${up}:1`);
  const two = comboSuggestions(dyn, [], [ps[2].id], { only: [pick.id, pick.id, ps[10].id], minShare: 0, limit: 10 });
  assert.ok(two.combos.some((x) => x.ids[0] === pick.id && x.ids[1] === pick.id), 'two copies in the list → can pair with itself');
  const one = comboSuggestions(dyn, [], [ps[2].id], { only: [pick.id, ps[10].id], minShare: 0, limit: 10 });
  assert.ok(!one.combos.some((x) => x.ids[0] === x.ids[1]), 'one copy → never doubled');
  assert.ok(!comboSuggestions(dyn, [], [ps[2].id], { only: [ps[10].id], minShare: 0 }).combos.length, 'a single player cannot form a pair');
});

test('combinations: close or empty trades get none; read-only', () => {
  const ps = players(red);
  assert.deepEqual(comboSuggestions(red, [], []).combos, []);
  assert.deepEqual(comboSuggestions(red, [ps[10].id], [ps[10].id]).combos, []);
  const before = new Map([...red.assets.values()].map((a) => [a.id, a.value]));
  comboSuggestions(red, [ps[25].id], [ps[1].id]);
  for (const [id, v] of before) assert.equal(red.assets.get(id).value, v);
});
