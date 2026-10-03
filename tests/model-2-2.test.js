// Model 2.2.0 (second model audit, docs/MODEL_AUDIT.md): calibration shape constraints, the dynasty current season
// counted only for its remaining games, injuries as expected games lost, schedule strength off, redraft option value
// reduced, and the calibrated trade-outcome frequency. SYNTHETIC fixture + the shipped calibration files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeValuations } from '../js/core/valuation/engine.js';
import { analyzeTrade } from '../js/core/valuation/trade.js';
import { outcomeText } from '../js/ui/trade-helpers.js';
import { isotonicIncreasing, monotoneHazard, unimodalAgeCurve } from '../scripts/lib/calibration-shape.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';
import { deepClone } from '../js/core/util/objects.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const preset = (id) => presets.find((p) => p.id === id);
const run = (dataset, id, mode, cfg = config) => computeValuations({ dataset, league: preset(id), mode, config: cfg });
const ds = makeDataset(); // 2026 week 6: 11 team games left
const players = (r) => [...r.assets.values()].filter((a) => a.kind === 'player' && a.team).sort((x, y) => y.value - x.value);
const cal = (f) => JSON.parse(fs.readFileSync(new URL(`../config/calibration/${f}`, import.meta.url), 'utf8'));

test('calibration shape helpers: weighted isotonic fit, monotone hazard, declining age tail', () => {
  const near = (xs, ys) => xs.length === ys.length && xs.every((x, i) => Math.abs(x - ys[i]) < 1e-9);
  assert.ok(near(isotonicIncreasing([0.2, 0.1, 0.3]), [0.15, 0.15, 0.3]));
  assert.ok(near(isotonicIncreasing([0.3, 0.1], [3, 1]), [0.25, 0.25]), 'weights respected');
  // A noisy young cell (9 exits of 36 at 22) must not give young players a higher hazard than 24-year-olds.
  const raw = { 21: { exits: 0, n: 8 }, 22: { exits: 9, n: 36 }, 23: { exits: 2, n: 52 }, 24: { exits: 2, n: 71 }, 25: { exits: 5, n: 77 }, 26: { exits: 1, n: 76 }, 30: { exits: 6, n: 30 }, 31: { exits: 5, n: 20 } };
  const hz = monotoneHazard(raw);
  for (let a = 22; a <= 42; a++) assert.ok(hz[a] >= hz[a - 1] - 1e-9, `hazard non-decreasing at ${a}`);
  assert.ok(hz[21] <= hz[24] + 1e-9 && hz[21] > 0, 'young hazard ≤ age-24 hazard and not zero from a tiny cell');
  assert.ok(hz[42] > hz[33] && hz[42] <= 0.9);
  // Flat default tail beyond the data must keep declining, and never decline more slowly than the year before.
  const curve = { 26: 1, 28: 0.98, 30: 0.92, 32: 0.83, 34: 0.72, 36: 0.58, 37: 0.5, 38: 0.5, 39: 0.5, 40: 0.5 };
  const out = unimodalAgeCurve(curve, 32);
  assert.ok(out[38] < out[37] && out[40] < out[39], 'still declining after the data');
  for (const a of [38, 39, 40]) assert.ok(out[a] / out[a - 1] <= out[a - 1] / (out[a - 2] ?? out[a - 1] * 1.2) + 3e-3, `decline does not slow at ${a}`); // values rounded to 3 decimals
  assert.equal(out[30], 0.92, 'supported range untouched');
});

test('shipped calibration: aging curves unimodal with an accelerating-or-steady tail; exit hazard non-decreasing', () => {
  const aging = cal('aging-curves.json').curves, hazard = cal('attrition.json').hazard;
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const ages = Object.keys(aging[pos]).map(Number).sort((a, b) => a - b);
    const v = ages.map((a) => aging[pos][a]);
    const peak = v.indexOf(Math.max(...v));
    for (let i = peak + 1; i < v.length; i++) assert.ok(v[i] <= v[i - 1] + 1e-9, `${pos} non-increasing after the peak at ${ages[i]}`);
    assert.ok(v[v.length - 1] < v[v.length - 4], `${pos} still declining at the end of the curve`);
    const hs = Object.keys(hazard[pos]).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < hs.length; i++) assert.ok(hazard[pos][hs[i]] >= hazard[pos][hs[i - 1]] - 1e-9, `${pos} hazard non-decreasing at ${hs[i]}`);
  }
});

test('dynasty in season: the current year counts only its remaining games; a partial final year keeps the horizon', () => {
  const dyn = run(ds, 'preset_dyn_12_1qb', 'dynasty');
  const a = players(dyn)[3];
  const ys = a.details.years;
  const f = 11 / 17;
  assert.ok(Math.abs(ys[0].share - f) < 1e-9, 'year 1 share = remaining games / season games');
  assert.equal(ys.length, dyn.model.dynasty.horizon_years + 1);
  assert.ok(ys[ys.length - 1].tail && Math.abs(ys[ys.length - 1].share - (1 - f)) < 1e-9, 'final partial year = 1 − f');
  assert.ok(Math.abs(ys.reduce((s, y) => s + y.share, 0) - dyn.model.dynasty.horizon_years) < 1e-9, 'horizon = H full seasons');
  assert.ok(Math.abs(ys[1].discount - dyn.model.dynasty.strategy_discount.balanced ** f) < 1e-9, 'next season discounted from now');
  // Offseason: full seasons, no tail, unchanged discounting.
  const off = deepClone(ds); off.state.season_type = 'off';
  const b = run(off, 'preset_dyn_12_1qb', 'dynasty').assets.get(a.id);
  assert.equal(b.details.years.length, dyn.model.dynasty.horizon_years);
  assert.ok(b.details.years.every((y) => y.share === 1 && !y.tail));
  assert.equal(b.details.years[1].discount, dyn.model.dynasty.strategy_discount.balanced);
});

test('dynasty injuries: expected games lost as a share of the games left; out for the season loses the rest of it', () => {
  const base = run(ds, 'preset_dyn_12_1qb', 'dynasty');
  const target = players(base)[5];
  const withInjury = (status, dropProjection) => {
    const d = deepClone(ds); const p = d.players.find((x) => x.cid === target.id);
    p.injury = { status };
    if (dropProjection) p.projections = [];
    return run(d, 'preset_dyn_12_1qb', 'dynasty').assets.get(target.id);
  };
  const q = withInjury('Questionable', false);
  const y1 = q.details.years[0].contribution;
  assert.ok(Math.abs(q.details.injuryLoss - y1 * (0.25 / 11)) < 1e-6, 'Questionable = 0.25 of 11 remaining games');
  const ir = withInjury('IR', true);
  assert.ok(Math.abs(ir.details.injuryLoss - ir.details.years[0].contribution) < 1e-6, 'IR without a ROS projection loses the whole remaining season');
  assert.ok(ir.value < q.value && q.value <= target.value + 1e-6);
});

test('schedule strength is off by default (2.2.0): production is not scaled by opponents', () => {
  const red = run(ds, 'preset_12_1qb_ppr', 'redraft');
  for (const a of players(red).slice(0, 40)) if (a.details.production.rate !== null) assert.equal(a.details.production.sos, 1);
  const cfg = deepClone(config); cfg.model.redraft.production.sos_strength = 0.5;
  const withSos = run(ds, 'preset_12_1qb_ppr', 'redraft', cfg);
  assert.ok(players(withSos).some((a) => a.details.production.sos !== 1), 'still configurable');
});

test('redraft option value: below-replacement players keep a small, monotone value; stars are unaffected by σ', () => {
  const red = run(ds, 'preset_12_1qb_ppr', 'redraft');
  const cfg = deepClone(config);
  for (const ph of ['preseason', 'in_season']) for (const k of Object.keys(cfg.model.redraft.uncertainty.sd_per_game[ph])) cfg.model.redraft.uncertainty.sd_per_game[ph][k] *= 2.5;
  const wide = run(ds, 'preset_12_1qb_ppr', 'redraft', cfg);
  const ps = players(red);
  const top = ps.slice(0, 5), deep = ps.slice(80, 120);
  const rel = (r, xs) => xs.reduce((s, a) => s + r.assets.get(a.id).value, 0);
  // Wider σ (the 2.1.x table) gives deep players relatively MORE value than stars — the over-valuation E5/E6 measured.
  assert.ok(rel(wide, deep) / rel(wide, top) > rel(red, deep) / rel(red, top));
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i].value <= ps[i - 1].value);
});

test('trade outcome frequency: redraft only, > 50% for the favoured side, rising with the margin', () => {
  const red = run(ds, 'preset_12_1qb_ppr', 'redraft');
  const ps = players(red);
  const small = analyzeTrade(red, [ps[10].id], [ps[11].id]);
  const big = analyzeTrade(red, [ps[2].id], [ps[40].id]);
  assert.ok(small.outcome.probability > 0.5 && big.outcome.probability > small.outcome.probability);
  assert.equal(big.outcome.favoured, big.diff > 0 ? 'A' : 'B');
  assert.ok(big.outcome.probability < 1);
  assert.equal(analyzeTrade(red, [ps[2].id], []).outcome, null, 'incomplete trade');
  const dyn = run(ds, 'preset_dyn_12_1qb', 'dynasty');
  const dp = players(dyn);
  assert.equal(analyzeTrade(dyn, [dp[2].id], [dp[40].id]).outcome, null, 'dynasty: not validated, not shown');
  assert.match(outcomeText(big), /about \d+% of the time/);
  assert.equal(outcomeText({ outcome: null }), null);
});
