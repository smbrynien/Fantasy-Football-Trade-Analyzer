// Sanity, monotonicity and regression tests added by the model audit (docs/MODEL_AUDIT.md). SYNTHETIC fixture only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { computeLeagueStructure, surplusPoints } from '../js/core/valuation/replacement.js';
import { fitExpDecay } from '../js/core/util/stats.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';
import { deepClone } from '../js/core/util/objects.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const preset = (id) => presets.find((p) => p.id === id);
const ds = makeDataset();
const run = (dataset, id, mode, cfg = config) => computeValuations({ dataset, league: preset(id), mode, config: cfg });
const red = run(ds, 'preset_12_1qb_ppr', 'redraft');
const dyn = run(ds, 'preset_dyn_12_1qb', 'dynasty');
const scaleStats = (p, f) => { for (const pr of p.projections) for (const k of Object.keys(pr.stats)) pr.stats[k] *= f; };

test('monotonicity: a higher projection never lowers redraft value (incl. the top asset)', () => {
  for (const cid of ['TRB1', 'TWR1', 'TRB20', 'TWR40', 'TQB12', 'TTE8']) {
    const d2 = deepClone(ds);
    scaleStats(d2.players.find((p) => p.cid === cid), 1.15);
    const after = run(d2, 'preset_12_1qb_ppr', 'redraft').assets.get(cid).value;
    assert.ok(after >= red.assets.get(cid).value - 1e-6, `${cid}: ${red.assets.get(cid).value} → ${after}`);
  }
});

test('monotonicity: two years younger never lowers dynasty value (incl. the top asset)', () => {
  const top = [...dyn.assets.values()].filter((a) => a.kind === 'player').sort((a, b) => b.value - a.value)[0].id;
  for (const cid of [top, 'TRB5', 'TWR10', 'TTE3']) {
    const d2 = deepClone(ds);
    const p = d2.players.find((x) => x.cid === cid);
    p.birth_date = `${Number(p.birth_date.slice(0, 4)) + 2}${p.birth_date.slice(4)}`;
    const after = run(d2, 'preset_dyn_12_1qb', 'dynasty').assets.get(cid).value;
    assert.ok(after >= dyn.assets.get(cid).value - 1e-6, `${cid}: ${dyn.assets.get(cid).value} → ${after}`);
  }
});

test('expected surplus: continuous, ≥ deterministic surplus, equal to it far above replacement', () => {
  const pool = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) for (let i = 0; i < 60; i++) pool.push({ cid: `${pos}${i}`, position: pos, points: 300 - i * 4 });
  const st = computeLeagueStructure(pool, { teams: 12, roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BENCH: 6 } });
  const r = st.replacement.RB;
  let prev = -1;
  for (let pts = r - 120; pts <= r + 120; pts += 5) {
    const e = surplusPoints(pts, 'RB', st, 0.35, 50), d = surplusPoints(pts, 'RB', st, 0.35, 0);
    assert.ok(e >= d - 1e-9, `${pts}: ${e} < ${d}`);
    assert.ok(e >= prev, 'monotone in points');
    prev = e;
  }
  assert.ok(Math.abs(surplusPoints(r + 300, 'RB', st, 0.35, 50) - surplusPoints(r + 300, 'RB', st, 0.35, 0)) < 0.5);
  assert.equal(surplusPoints(0, 'RB', st, 0.35, 50), 0, 'a zero projection (ruled out) has no option value');
});

test('no value from the draft prior alone for veterans without current evidence (retired / out of league)', () => {
  const d2 = deepClone(ds);
  d2.players.push({ cid: 'GONE', name: 'Retired Vet', position: 'WR', positions: ['WR'], team: 'FA', birth_date: '1995-01-01', draft: { year: 2017, round: 1, pick: 5 }, status: 'Active', years_exp: 9, ids: {}, aliases: [], rankings: [], projections: [], market: [], adp: [], weekly: [], last_season: null, injury: null });
  const r = run(d2, 'preset_dyn_12_1qb', 'dynasty');
  assert.equal(r.assets.get('GONE'), undefined);
  // …but an incoming rookie with draft capital and no NFL stats still gets a (prior-based) value
  assert.ok(r.assets.get('TR1').groups.fundamental > 0);
});

test('one-game backups without history get no production signal (no starter-level prior)', () => {
  const d2 = deepClone(ds);
  const base = d2.players.find((p) => p.cid === 'TQB1');
  d2.players.push({ ...deepClone(base), cid: 'BACKUP', name: 'Backup QB', rankings: [], projections: [], market: [], adp: [], last_season: null, weekly: [{ s: 2026, w: 5, team: base.team, opp: 'KC', st: { pass_att: 15, pass_cmp: 8, pass_yd: 59, pass_int: 1 } }] });
  const r = run(d2, 'preset_12_sf_ppr', 'redraft');
  assert.equal(r.assets.get('BACKUP'), undefined, 'no signal → N/A, not an invented value');
});

test('zero-weight sources (DynastyProcess player values = transform of ECR) do not move values', () => {
  assert.equal(config.model.source_weights.market.dynastyprocess_values, 0);
  const d2 = deepClone(ds);
  for (const p of d2.players) if (p.market.length) p.market.push({ src: 'dynastyprocess_values', dynasty: true, qb: '1qb', ppr: null, teams: null, value: 1 });
  const r = run(d2, 'preset_dyn_12_1qb', 'dynasty');
  for (const cid of ['TRB1', 'TWR30', 'TTE5']) assert.ok(Math.abs(r.assets.get(cid).value - dyn.assets.get(cid).value) < 1e-6);
});

test('market trend is display-only in v2', () => {
  const d2 = deepClone(ds);
  for (const p of d2.players) for (const m of p.market) m.trend30 = m.value * 0.5;
  const r = run(d2, 'preset_12_1qb_ppr', 'redraft');
  assert.equal(r.assets.get('TWR3').value, red.assets.get('TWR3').value);
  assert.ok(r.assets.get('TWR3').details.trendRel > 0, 'trend still reported');
});

test('pick values are monotone in slot and decline into later years', () => {
  const up = dyn.picks.upcoming;
  let prev = Infinity;
  for (let r = 1; r <= 3; r++) for (let k = 1; k <= 12; k++) {
    const v = dyn.getAsset(`pick:${up}:${r}:${k}`).value;
    assert.ok(v <= prev + 1e-6, `${r}.${k}`);
    prev = v;
  }
  assert.ok(dyn.getAsset(`pick:${up + 1}:1:1`).value < dyn.getAsset(`pick:${up}:1:1`).value);
});

test('historical rookie slot curve is the least-squares exponential fit', () => {
  const f = fitExpDecay(Array.from({ length: 40 }, (_, i) => 200 * Math.exp(-0.12 * i)));
  assert.ok(Math.abs(f.a - 200) < 2 && Math.abs(f.b - 0.12) < 0.005);
  const shape = config.calibration.rookie_slot_curve.shape;
  for (let i = 1; i < shape.length; i++) assert.ok(shape[i] <= shape[i - 1]);
  const top12 = shape.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  assert.ok(Math.abs(top12 - 1) < 0.01);
});

test('league effects: superflex raises QBs, TE premium raises TEs, 10 → 16 teams changes scarcity sensibly', () => {
  const sf = run(ds, 'preset_12_sf_ppr', 'redraft');
  assert.ok(sf.assets.get('TQB10').value > red.assets.get('TQB10').value);
  const tep = computeValuations({ dataset: ds, league: { ...preset('preset_12_1qb_ppr'), scoring: { bonus_rec_te: 0.5 } }, mode: 'redraft', config });
  assert.ok(tep.assets.get('TTE5').value > red.assets.get('TTE5').value);
  const deep = computeValuations({ dataset: ds, league: { ...preset('preset_12_1qb_ppr'), teams: 16 }, mode: 'redraft', config });
  assert.ok(deep.assets.get('TRB30').value > red.assets.get('TRB30').value, 'deeper league → more players above replacement');
});

test('every valued player has a finite value, sigma and confidence; ranges are sane', () => {
  for (const r of [red, dyn]) for (const a of r.assets.values()) {
    assert.ok(Number.isFinite(a.value) && a.value >= 0, a.name);
    if (a.kind === 'player') {
      assert.ok(Number.isFinite(a.sigma), a.name);
      assert.ok(a.confidence && a.confidence.label, a.name);
    }
  }
});

test('sanity: no absurd dynasty age cliffs (one extra year never removes more than 40% of value)', () => {
  for (const cid of ['TRB3', 'TWR5', 'TQB2', 'TTE2']) {
    let prev = null;
    for (let age = 22; age <= 33; age++) {
      const d2 = deepClone(ds);
      d2.players.find((p) => p.cid === cid).birth_date = `${2026 - age}-03-15`;
      const v = run(d2, 'preset_dyn_12_1qb', 'dynasty').assets.get(cid).value;
      if (prev !== null && prev > 500) assert.ok(v >= prev * 0.6, `${cid} age ${age}: ${prev} → ${v}`);
      prev = v;
    }
  }
});

test('sanity: elite players are well above replacement in every mode', () => {
  for (const r of [red, dyn]) for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const a = r.assets.get(`T${pos}1`);
    assert.ok(a.value > 1000, `${r.mode} ${pos}1 = ${a.value}`);
  }
});
