// Counteroffer table (usability audit F7): variants are compared with today's analysis, never re-valued.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { analyzeTrade } from '../js/core/valuation/trade.js';
import { compareCounteroffers, addVariant, sameTrade, tradeChanges, variantLabel, MAX_VARIANTS } from '../js/core/counteroffers.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const red = computeValuations({ dataset: makeDataset(), league: presets.find((p) => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config });
const ps = [...red.assets.values()].filter((a) => a.kind === 'player' && a.team).sort((x, y) => y.value - x.value).map((a) => a.id);

test('sameTrade ignores order and counts duplicate generic picks', () => {
  assert.ok(sameTrade({ a: ['x', 'y'], b: ['z'] }, { a: ['y', 'x'], b: ['z'] }));
  assert.ok(!sameTrade({ a: ['x'], b: ['z'] }, { a: ['z'], b: ['x'] }), 'sides matter');
  assert.ok(!sameTrade({ a: ['p', 'p'], b: ['z'] }, { a: ['p'], b: ['z'] }), 'two copies ≠ one');
  assert.ok(!sameTrade({ a: ['p', 'q'], b: ['z'] }, { a: ['p', 'p'], b: ['z'] }));
});

test('tradeChanges lists added and removed assets per side (multiset)', () => {
  const c = tradeChanges({ a: ['x', 'p'], b: ['z'] }, { a: ['p', 'p', 'w'], b: ['z'] });
  assert.deepEqual(c.a, { added: ['p', 'w'], removed: ['x'] });
  assert.deepEqual(c.b, { added: [], removed: [] });
  assert.equal(c.none, false);
  assert.equal(tradeChanges({ a: ['x'], b: ['y'] }, { a: ['x'], b: ['y'] }).none, true);
});

test('addVariant: incomplete, duplicate and full lists are refused; labels', () => {
  assert.equal(addVariant([], { a: ['x'], b: [] }).reason, 'incomplete');
  let r = addVariant([], { a: ['x'], b: ['y'], me: 'a' });
  assert.ok(r.added && r.index === 0);
  assert.deepEqual(r.list[0], { a: ['x'], b: ['y'] }, 'stores asset ids only');
  const dup = addVariant(r.list, { a: ['x'], b: ['y'] });
  assert.equal(dup.reason, 'duplicate'); assert.equal(dup.index, 0);
  let list = r.list;
  for (let i = 1; i < MAX_VARIANTS; i++) list = addVariant(list, { a: ['x', `v${i}`], b: ['y'] }).list;
  assert.equal(list.length, MAX_VARIANTS);
  assert.equal(addVariant(list, { a: ['new'], b: ['y'] }).reason, 'full');
  assert.equal(variantLabel(list[0], 0), 'Original');
  assert.equal(variantLabel(list[2], 2), 'Counter 2');
  assert.equal(variantLabel({ ...list[2], label: 'Their counter' }, 2), 'Their counter');
  assert.equal(addVariant([], { a: ['x'], b: ['y'] }, { label: 'z'.repeat(99) }).list[0].label.length, 40);
});

test('compareCounteroffers: each row is the exact analyzeTrade result, with changes against the original', () => {
  const variants = [{ a: [ps[30]], b: [ps[0]] }, { a: [ps[30], ps[12]], b: [ps[0]] }, { a: [ps[8]], b: [ps[0]], label: 'Their counter' }];
  const rows = compareCounteroffers(red, variants);
  assert.equal(rows.length, 3);
  rows.forEach((r, i) => {
    const ana = analyzeTrade(red, variants[i].a, variants[i].b);
    assert.ok(Math.abs(r.diff - ana.diff) < 1e-9);
    assert.equal(r.level, ana.assessment.level);
    assert.deepEqual(r.totals, [ana.sides[0].adjusted, ana.sides[1].adjusted]);
    assert.equal(r.lineup, null, 'no roster → no lineup impact');
  });
  assert.deepEqual(rows.map((r) => r.label), ['Original', 'Counter 1', 'Their counter']);
  assert.equal(rows[0].changes, null);
  assert.deepEqual(rows[1].changes.a, { added: [ps[12]], removed: [] });
  assert.deepEqual(rows[2].changes.a, { added: [ps[8]], removed: [ps[30]] });
  assert.ok(Math.abs(rows[1].diff) < Math.abs(rows[0].diff), 'adding a player to the short side narrows the gap');
});

test('compareCounteroffers: lineup impact per variant with a roster and "which side is you"', () => {
  const roster = [ps[40], ps[45], ps[50], ps[55], ps[60]];
  const variants = [{ a: [ps[3]], b: [ps[40]] }, { a: [ps[3], ps[20]], b: [ps[40], ps[45]] }];
  const rows = compareCounteroffers(red, variants, { me: 'a', rosterIds: roster });
  for (const r of rows) {
    assert.ok(r.lineup, 'lineup computed');
    assert.ok(Number.isFinite(r.lineup.valueDelta));
    assert.ok(r.lineup.startersIn.includes(red.getAsset(ps[3]).name), 'the star I receive starts');
  }
  assert.ok(compareCounteroffers(red, variants, { rosterIds: roster }).every((r) => r.lineup === null), 'neutral → no lineup');
});
