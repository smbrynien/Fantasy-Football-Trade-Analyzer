// Trade-comparison invariants and structural relationships (docs/TRADE_VALUE_DEEP_AUDIT.md, model 2.5.0 audit).
// SYNTHETIC fixture. Mathematical invariants are asserted exactly; economic relationships only by direction — no
// hard-coded values, so the tests survive recalibration but catch formula regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { analyzeTrade } from '../js/core/valuation/trade.js';
import { tradeHash, tradeFromHash } from '../js/ui/trade-helpers.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';
import { deepClone } from '../js/core/util/objects.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const P = (id) => presets.find((p) => p.id === id);
const ds = makeDataset();
const red = computeValuations({ dataset: ds, league: P('preset_12_1qb_ppr'), mode: 'redraft', config });
const dyn = computeValuations({ dataset: ds, league: P('preset_dyn_12_1qb'), mode: 'dynasty', config });
const up = dyn.picks.upcoming;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const players = (r, pos) => [...r.assets.values()].filter((a) => a.kind === 'player' && a.value > 0 && (!pos || a.position === pos)).sort((a, b) => b.value - a.value);

test('A ↔ A is exactly even; A + B ↔ A + B too, in any order', () => {
  for (const r of [red, dyn]) {
    const [a, b] = players(r);
    const t = analyzeTrade(r, [a.id], [a.id]);
    assert.equal(t.diff, 0);
    assert.equal(t.assessment.level, 'even');
    const t2 = analyzeTrade(r, [a.id, b.id], [b.id, a.id]);
    assert.equal(t2.diff, 0);
  }
});

test('order inside a side never changes anything; swapping the sides negates the result', () => {
  const pl = players(red);
  const A = [pl[3].id, pl[20].id, pl[41].id], B = [pl[5].id, pl[30].id];
  const base = analyzeTrade(red, A, B);
  for (const perm of [[A[2], A[0], A[1]], [A[1], A[2], A[0]]]) {
    const t = analyzeTrade(red, perm, [...B].reverse());
    assert.ok(close(t.diff, base.diff) && close(t.pct, base.pct) && t.assessment.level === base.assessment.level);
    assert.ok(close(t.sides[0].adjusted, base.sides[0].adjusted) && close(t.sides[1].adjusted, base.sides[1].adjusted));
  }
  const sw = analyzeTrade(red, B, A);
  assert.ok(close(sw.diff, -base.diff) && close(sw.pct, -base.pct));
  assert.equal(sw.assessment.level, base.assessment.level);
});

test('adding an asset never lowers the adjusted total of the side receiving it; A + small asset beats A', () => {
  for (const r of [red, dyn]) {
    const pl = players(r);
    const a = pl[2], small = pl[60];
    const one = analyzeTrade(r, [a.id], [pl[4].id]);
    const two = analyzeTrade(r, [a.id, small.id], [pl[4].id]);
    assert.ok(two.sides[0].adjusted > one.sides[0].adjusted, `${r.mode}: ${two.sides[0].adjusted} vs ${one.sides[0].adjusted}`);
    const vsSelf = analyzeTrade(r, [a.id, small.id], [a.id]);
    assert.ok(vsSelf.diff > 0, 'A + small asset is worth more than A alone (package adjustment keeps part of the extra)');
  }
});

test('a share link round trip gives the identical analysis (serialization)', () => {
  const pl = players(red);
  const A = [pl[1].id, pl[33].id], B = [pl[2].id];
  const back = tradeFromHash(tradeHash('redraft', A, B));
  assert.deepEqual(back, { a: A, b: B });
  const t0 = analyzeTrade(red, A, B), t1 = analyzeTrade(red, back.a, back.b);
  assert.ok(close(t0.diff, t1.diff));
});

test('duplicates: two identical generic picks are two assets; the same player twice is not a legitimate trade', () => {
  const g = `pick:${up}:1`;
  const one = dyn.getAsset(g).value;
  const t = analyzeTrade(dyn, [g, g], [players(dyn)[0].id]);
  assert.ok(close(t.sides[0].raw, 2 * one), 'two 1sts count twice (picks carry no package charge)');
  // The engine counts whatever it is given; the trade builder refuses a second copy of a player (search "taken",
  // tests/search.test.js). Documented here so a change of either side is deliberate.
  const p = players(dyn)[3].id;
  const dup = analyzeTrade(dyn, [p, p], [players(dyn)[1].id]);
  assert.equal(dup.sides[0].assets.length, 2);
});

test('representative trades keep their structural relationships', () => {
  const rb = players(red, 'RB'), wr = players(red, 'WR');
  // Balanced 1-for-1 between neighbours is close; a slightly unequal one favours the better player.
  const bal = analyzeTrade(red, [rb[10].id], [rb[11].id]);
  assert.equal(bal.assessment.level, 'even');
  assert.ok(bal.diff >= 0);
  // Elite for a package of two mid players: the package side carries a package charge.
  const pkg = analyzeTrade(red, [rb[0].id], [wr[20].id, wr[21].id]);
  assert.ok(pkg.sides[1].package.total > 0 && pkg.sides[0].package.total === 0);
  // Player for a 1st, player for multiple picks (dynasty): picks are never charged.
  const d = players(dyn);
  const pp = analyzeTrade(dyn, [d[8].id], [`pick:${up}:1`, `pick:${up + 1}:1`]);
  assert.equal(pp.sides[1].package.total, 0);
  // Later picks of the same draft never exceed earlier ones; later years never exceed the upcoming year.
  assert.ok(dyn.getAsset(`pick:${up}:1:12`).value >= dyn.getAsset(`pick:${up}:2:1`).value);
  assert.ok(dyn.getAsset(`pick:${up}:1`).value >= dyn.getAsset(`pick:${up + 1}:1`).value);
});

test('league context: Superflex raises QBs relative to WRs; TE premium raises TEs; deeper leagues raise mid-tier players', () => {
  const run = (league, mode = 'redraft') => computeValuations({ dataset: ds, league, mode, config });
  const base = P('preset_12_1qb_ppr');
  const sf = run({ ...base, roster: { ...base.roster, SUPERFLEX: 1 } });
  const ratio = (r) => players(r, 'QB')[5].value / players(r, 'WR')[5].value;
  assert.ok(ratio(sf) > ratio(red), 'QB6 / WR6 higher in Superflex');
  const tep = run({ ...base, scoring: { bonus_rec_te: 1 } });
  assert.ok(players(tep, 'TE')[3].value > players(red, 'TE')[3].value, 'TE4 worth more with TE premium');
  const deep = run({ ...base, teams: 14 }), shallow = run({ ...base, teams: 8 });
  assert.ok(players(deep, 'WR')[23].value > players(shallow, 'WR')[23].value, 'WR24 worth more in 14 teams than in 8');
});

test('values are reproducible and every calculation is labelled', () => {
  const again = computeValuations({ dataset: deepClone(ds), league: P('preset_12_1qb_ppr'), mode: 'redraft', config });
  for (const a of players(red).slice(0, 50)) assert.equal(again.assets.get(a.id).value, a.value);
  assert.equal(again.meta.settings_hash, red.meta.settings_hash);
  assert.ok(red.meta.model_version && red.meta.data_version && red.meta.calculated_at);
  // A different league or model setting gives a different settings hash (the UI cache key includes the profile).
  const other = computeValuations({ dataset: ds, league: { ...P('preset_12_1qb_ppr'), scoring_preset: 'standard' }, mode: 'redraft', config });
  assert.notEqual(other.meta.settings_hash, red.meta.settings_hash);
});

test('player values reconcile: components sum to the value; trade totals = Σ values − package charges', () => {
  for (const r of [red, dyn]) {
    for (const a of players(r).slice(0, 80)) {
      const s = Object.values(a.components).reduce((x, y) => x + y, 0);
      assert.ok(Math.abs(s - a.value) <= 1e-6 * Math.max(1, a.value), `${r.mode} ${a.name}: ${s} vs ${a.value}`);
    }
    const pl = players(r);
    const t = analyzeTrade(r, [pl[0].id], [pl[9].id, pl[12].id, pl[30].id]);
    for (const side of t.sides) {
      assert.ok(close(side.raw, side.assets.reduce((x, y) => x + y.value, 0)));
      assert.ok(close(side.adjusted, side.raw - side.package.total));
      assert.ok(close(side.package.total, side.package.items.reduce((x, y) => x + y.charge, 0)));
    }
    assert.ok(close(t.diff, t.sides[0].adjusted - t.sides[1].adjusted));
  }
});
