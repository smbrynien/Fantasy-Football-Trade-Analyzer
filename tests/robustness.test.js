// Second bug audit (docs/BUG_AUDIT.md, audit 2): settings/profile inputs that reach the engine without the form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { buildModel, sanitizeOverrides, sanitizeLeague, buildLeague } from '../js/core/settings.js';
import { expectationInputs, bestLineup, expectedLineupPoints } from '../js/core/roster.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const ds = makeDataset();
const base = presets.find((p) => p.id === 'preset_12_1qb_ppr');
const vals = (league, mode = 'redraft') => computeValuations({ dataset: ds, league, mode, config });
const sane = (r) => [...r.assets.values()].every((a) => Number.isFinite(a.value) && a.value >= 0 && Number.isFinite(a.sigma));
const set = (path, val) => { const o = {}; let x = o; const ks = path.split('.'); ks.slice(0, -1).forEach((k) => { x = x[k] = {}; }); x[ks[ks.length - 1]] = val; return o; };

test('E1: FLEX/SUPERFLEX eligibility that is not a list of positions never crashes valuations or lineups', () => {
  for (const fe of [{ FLEX: 5 }, { FLEX: 'RB' }, null, { FLEX: [], SUPERFLEX: ['QB'] }, { FLEX: ['K', 'XX'] }, 'x', { SUPERFLEX: { a: 1 } }]) {
    for (const mode of ['redraft', 'dynasty']) {
      const lg = { ...base, flex_eligibility: fe, roster: { ...base.roster, SUPERFLEX: 1 } };
      const r = vals(lg, mode);
      assert.ok(sane(r), JSON.stringify(fe));
      for (const slot of ['FLEX', 'SUPERFLEX']) assert.ok(Array.isArray(r.league.flex_eligibility[slot]) && r.league.flex_eligibility[slot].length > 0);
      const mine = [...r.assets.values()].filter((a) => a.kind === 'player').slice(0, 14);
      assert.ok(Array.isArray(bestLineup(mine, r.league).slots));
      const e = expectedLineupPoints(mine, r.league, expectationInputs(mode === 'redraft' ? r : vals(lg)));
      assert.ok(e === null || Number.isFinite(e));
    }
  }
  // A valid custom eligibility is kept as is.
  const keep = sanitizeLeague(buildLeague({ ...base, flex_eligibility: { FLEX: ['WR', 'TE'], SUPERFLEX: ['QB'] } }, config.leagueDefaults), config.leagueDefaults);
  assert.deepEqual(keep.flex_eligibility, { FLEX: ['WR', 'TE'], SUPERFLEX: ['QB'] });
});

test('E2: a null/garbage override means "default" — it is never read as 0 and never crashes', () => {
  const def = vals(base);
  for (const [path, v] of [['redraft.bench_value_fraction', null], ['redraft.weights', null], ['phase.regular_season_weeks', null], ['scale.top_value', null], ['redraft.production.regression_games', 'x'], ['redraft.weights.preseason', [1, 2]], ['dynasty.horizon_years', true]]) {
    const r = vals({ ...base, overrides: set(path, v) });
    assert.ok(sane(r), path);
    for (const [id, a] of def.assets) assert.equal(r.assets.get(id)?.value, a.value, `${path}=${JSON.stringify(v)} changed ${a.name}`);
  }
  assert.deepEqual(sanitizeOverrides({ a: 1, b: { c: 2 } }, { a: null, b: { c: 'x', d: 3 }, e: -1, __proto__: { x: 1 } }), { b: { d: 3 } });
  assert.deepEqual(buildModel(config.model, config.calibration, { overrides: 'x' }).redraft, buildModel(config.model, config.calibration, null).redraft);
  // A real override still applies.
  const changed = vals({ ...base, overrides: { redraft: { bench_value_fraction: 0.7 } } });
  assert.ok([...changed.assets.values()].some((a) => a.value !== def.assets.get(a.id)?.value));
});

test('E3: extreme model parameters from a stored profile stay inside engine-safe ranges (no hang, crash or negative values)', () => {
  for (const path of ['dynasty.horizon_years', 'dynasty.strategy_discount.balanced', 'picks.future_year_discount', 'picks.class_strength', 'scale.top_value', 'scale.anchor_top_n', 'phase.full_in_season_week', 'phase.regular_season_weeks']) {
    for (const v of [-5, 0, 1e9]) {
      const t0 = Date.now();
      const r = vals({ ...presets.find((p) => p.id === 'preset_dyn_12_1qb'), overrides: set(path, v) }, 'dynasty');
      assert.ok(sane(r) && [...r.assets.values()].some((a) => a.value > 0), `${path}=${v}`);
      assert.ok(Date.now() - t0 < 5000, `${path}=${v} took ${Date.now() - t0} ms`);
    }
  }
  const m = buildModel(config.model, config.calibration, { overrides: { dynasty: { horizon_years: 1e9 }, scale: { top_value: -5 } } });
  assert.equal(m.dynasty.horizon_years, 15);
  assert.equal(m.scale.top_value, config.model.scale.top_value, 'negative override dropped → default');
});

test('D2: a malformed dataset date never yields null pick seasons or broken ages', () => {
  for (const state of [{ ...ds.state, as_of: 'garbage' }, { ...ds.state, as_of: null }]) {
    const r = computeValuations({ dataset: { ...ds, state, built_at: 'also garbage' }, league: presets.find((p) => p.id === 'preset_dyn_12_1qb'), mode: 'dynasty', config });
    assert.ok(r.picks.seasons.every((y) => Number.isInteger(y) && y > 2000), JSON.stringify(r.picks.seasons));
    assert.ok(sane(r));
  }
});
