// Trade analysis and package adjustments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { analyzeTrade } from '../js/core/valuation/trade.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';
import { deepClone } from '../js/core/util/objects.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const ds = makeDataset();
const red = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config });
const dyn = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_dyn_12_1qb'), mode: 'dynasty', config });
const v = (r, id) => r.getAsset(id).value;

test('1-for-1: no package adjustment, diff = value difference, audit metadata present', () => {
  const t = analyzeTrade(red, ['TWR1'], ['TRB2']);
  assert.equal(t.sides[0].package.total, 0);
  assert.equal(t.sides[1].package.total, 0);
  assert.ok(Math.abs(t.diff - (v(red, 'TWR1') - v(red, 'TRB2'))) < 1e-6);
  assert.equal(t.audit.model_version, config.model.model_version);
  assert.equal(t.audit.data_version, 'test-fixture');
  assert.ok(t.audit.settings_hash);
  assert.ok(['even', 'lean', 'clear'].includes(t.assessment.level));
});

test('2-for-1: the side receiving two players is charged; consolidation note shown', () => {
  const t = analyzeTrade(red, ['TRB1'], ['TWR8', 'TWR9']);
  const B = t.sides[1];
  assert.equal(B.package.nExtra, 1);
  assert.ok(B.package.total > 0);
  assert.ok(B.adjusted < B.raw);
  const extra = B.package.items[0];
  assert.equal(extra.id, v(red, 'TWR8') < v(red, 'TWR9') ? 'TWR8' : 'TWR9');
  assert.ok(extra.charge <= extra.value * (1 - config.model.package.redraft.min_retained_fraction) + 1e-9);
  assert.ok(t.notes.some((n) => /consolidates/.test(n)));
});

test('3-for-2: one extra piece charged; diff uses adjusted totals', () => {
  const t = analyzeTrade(red, ['TRB5', 'TWR6', 'TTE4'], ['TQB2', 'TWR3']);
  assert.equal(t.sides[0].package.nExtra, 1);
  assert.equal(t.sides[1].package.nExtra, 0);
  assert.ok(Math.abs(t.diff - (t.sides[0].adjusted - t.sides[1].adjusted)) < 1e-6);
});

test('package adjustment can be disabled in configuration', () => {
  const cfg = deepClone(config);
  cfg.model.package.enabled = false;
  const r = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config: cfg });
  const t = analyzeTrade(r, ['TRB1'], ['TWR8', 'TWR9']);
  assert.equal(t.sides[1].package.total, 0);
});

test('player vs pick and multiple picks (picks exempt from roster charges)', () => {
  const up = dyn.picks.upcoming;
  const t = analyzeTrade(dyn, ['TWR2'], [`pick:${up}:1:early`, `pick:${up}:1`, `pick:${up + 1}:2`]);
  assert.equal(t.sides[1].assets.length, 3);
  assert.equal(t.sides[1].package.total, 0);
  assert.ok(t.sides[1].raw > 0);
  assert.ok(t.sides[1].future >= t.sides[1].raw - 1e-6); // picks are entirely future value
  assert.ok(t.sigmaDiff > 0);
});

test('uncertainty: z-score drives the interpretation, not raw difference alone', () => {
  const near = analyzeTrade(red, ['TWR3'], ['TWR4']);
  assert.ok(near.z < 2);
  const far = analyzeTrade(red, ['TRB1'], ['TWR60']);
  assert.equal(far.assessment.level, 'clear');
});

test('missing data: unknown asset ids are reported, not crashing', () => {
  const t = analyzeTrade(red, ['TWR1', 'NOT_A_PLAYER'], []);
  assert.deepEqual(t.missing, ['NOT_A_PLAYER']);
  assert.equal(t.assessment.level, 'incomplete');
});

test('dynasty age implications are summarised', () => {
  const t = analyzeTrade(dyn, ['TR1'], ['TQB12']);
  assert.ok(t.sides[0].valueWeightedAge < t.sides[1].valueWeightedAge);
});

test('unavailable player (handoff bug #11): named in the note, counted as a player, no consolidation charge on the other side', () => {
  const t = analyzeTrade(red, ['GONE_PLAYER'], ['TWR5'], { names: { GONE_PLAYER: 'Retired Veteran' } });
  assert.deepEqual(t.missing, ['GONE_PLAYER']);
  assert.ok(t.notes.some((n) => n.includes('Retired Veteran') && !n.includes('GONE_PLAYER')), t.notes.join(' | '));
  assert.ok(!t.notes.some((n) => /consolidates/.test(n)), 'a 1-for-1 is not a consolidation');
  assert.equal(t.sides[1].package.total, 0);
  assert.equal(t.sides[1].adjusted, red.assets.get('TWR5').value);
  assert.notEqual(t.assessment.level, 'incomplete', 'a side with only unavailable assets is still a side (worth 0)');
  // Name lookup as a function; unknown ids fall back to the id.
  assert.ok(analyzeTrade(red, ['GONE_PLAYER'], ['TWR5'], { names: () => null }).notes.some((n) => n.includes('GONE_PLAYER')));
  // An unvalued pick id is exempt from player counting, like all picks.
  const p = analyzeTrade(red, ['pick:2099:1'], ['TWR5', 'TWR6']);
  assert.equal(p.sides[0].package.total, 0);
});

test('pick-for-player note names the side that is charged instead of calling the pick side a consolidator', () => {
  const up = dyn.picks.upcoming;
  const t = analyzeTrade(dyn, [`pick:${up}:1`], ['TWR2']);
  assert.equal(t.sides[1].package.nExtra, 1, 'B receives a player and sends none');
  assert.ok(!t.notes.some((n) => /Team A consolidates/.test(n)));
  assert.ok(t.notes.some((n) => /Team B receives more players than it sends \(draft picks don't count/.test(n)));
});

test('incomplete trade (one side empty): no package adjustment, totals are the plain sums', () => {
  const t = analyzeTrade(red, [], ['TWR1', 'TRB2']);
  assert.equal(t.assessment.level, 'incomplete');
  assert.equal(t.sides[1].package.total, 0);
  assert.ok(Math.abs(t.sides[1].adjusted - (v(red, 'TWR1') + v(red, 'TRB2'))) < 1e-6);
  assert.ok(!t.notes.some((n) => /consolidates|more players than it sends/.test(n)));
});
