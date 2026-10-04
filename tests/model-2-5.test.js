// Model 2.5.0 (docs/TRADE_VALUE_DEEP_AUDIT.md): dynasty survival after the first year uses the attrition hazard × a
// per-position multiplier fitted on observed multi-year survival (audit E19). SYNTHETIC fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { buildModel } from '../js/core/settings.js';
import { hazard } from '../js/core/valuation/dynasty.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const config = loadTestConfig();
const league = readConfig('profiles.json').presets.find((p) => p.id === 'preset_dyn_12_1qb');
const ds = makeDataset();

test('2.5.0: calibrated later-year hazard multipliers reach the model (QB < 1 < RB, WR, TE)', () => {
  const m = buildModel(config.model, config.calibration, null);
  const k = m.dynasty.attrition_later_multiplier;
  assert.ok(k.QB > 0 && k.QB < 1, `QB ${k.QB}`);
  for (const p of ['RB', 'WR', 'TE']) assert.ok(k[p] > 1 && k[p] < 2.5, `${p} ${k[p]}`);
});

test('2.5.0: survival compounds the first-year hazard, later years use hazard × multiplier', () => {
  const r = computeValuations({ dataset: ds, league, mode: 'dynasty', config });
  const m = r.model;
  for (const id of ['TWR3', 'TRB5', 'TQB4', 'TTE2']) {
    const a = r.assets.get(id);
    const ys = a.details.years.filter((y) => !y.tail);
    const pos = a.position, age0 = ys[0].age;
    let s = 1;
    for (let t = 2; t <= ys.length; t++) {
      s *= 1 - Math.min(0.95, hazard(m, pos, age0 + t - 2) * (t > 2 ? m.dynasty.attrition_later_multiplier[pos] : 1));
      assert.ok(Math.abs(ys[t - 1].survival - s) < 0.02, `${id} year ${t}: ${ys[t - 1].survival} vs ${s}`);
    }
  }
});

test('2.5.0: multipliers of 1 restore plain compounding (QBs lose, WRs gain relative value)', () => {
  const plain = computeValuations({ dataset: ds, league: { ...league, overrides: { dynasty: { attrition_later_multiplier: { QB: 1, RB: 1, WR: 1, TE: 1 } } } }, mode: 'dynasty', config });
  const now = computeValuations({ dataset: ds, league, mode: 'dynasty', config });
  const ratio = (r) => r.assets.get('TQB4').details.fundamental / r.assets.get('TWR4').details.fundamental;
  assert.ok(ratio(now) > ratio(plain), 'QB / WR fundamental higher with the calibrated multipliers');
});

test('2.5.0: the draft-capital prior weighs 10 games for WRs (20 elsewhere)', () => {
  const r = computeValuations({ dataset: ds, league, mode: 'dynasty', config });
  const r20 = computeValuations({ dataset: ds, league: { ...league, overrides: { dynasty: { rate_evidence: { prior_pseudo_games_by_position: { WR: 20 } } } } }, mode: 'dynasty', config });
  const priorW = (res, id) => { const ev = res.assets.get(id).details.evidence; const w = ev.find((e) => e.kind === 'prior')?.w ?? 0; return w / ev.reduce((s, e) => s + e.w, 0); };
  const wr = [...r.assets.values()].find((a) => a.position === 'WR' && a.details?.evidence?.some((e) => e.kind === 'prior') && a.details.evidence.length > 1);
  const rb = [...r.assets.values()].find((a) => a.position === 'RB' && a.details?.evidence?.some((e) => e.kind === 'prior') && a.details.evidence.length > 1);
  assert.ok(wr && rb, 'fixture has WRs and RBs with prior evidence');
  assert.ok(priorW(r, wr.id) < priorW(r20, wr.id), 'WR prior share smaller at 10 games than at 20');
  assert.ok(Math.abs(priorW(r, rb.id) - priorW(r20, rb.id)) < 1e-12, 'RB prior unchanged');
});

test('2.5.0: after the peak the yearly decline never slows with age (deep audit W8); growth before it is kept', async () => {
  const { unimodalAgeCurve } = await import('../scripts/lib/calibration-shape.js');
  // A zig-zag decline (as the sampled WR curve was: 30 −6.7%, 31 −8.6%, 32 −5.9%) becomes non-increasing yearly
  // ratios with the same overall fall; the uneven growth before the peak stays as fitted.
  const zig = { 22: 0.8, 23: 0.82, 24: 0.95, 25: 1, 26: 0.95, 27: 0.87, 28: 0.83, 29: 0.74, 30: 0.71 };
  const c = unimodalAgeCurve(zig, 30, { concave: 'decline' });
  const r = [26, 27, 28, 29, 30].map((a) => c[a] / c[a - 1]);
  for (let i = 1; i < r.length; i++) assert.ok(r[i] <= r[i - 1] + 0.003, `ratio ${i}: ${r[i]} after ${r[i - 1]}`);
  assert.ok(Math.abs(c[30] - 0.71) < 0.005 && c[25] === 1, 'overall fall kept');
  assert.deepEqual([c[22], c[23], c[24]], [0.8, 0.82, 0.95], 'growth before the peak unchanged');
  // The shipped calibration has this shape for every position (rounding tolerance).
  for (const [pos, curve] of Object.entries(config.calibration.aging_curves.curves)) {
    const ages = Object.keys(curve).map(Number).sort((a, b) => a - b);
    const peak = ages.reduce((p, a) => (curve[a] > curve[p] ? a : p), ages[0]);
    const after = ages.filter((a) => a >= peak);
    const q = after.slice(1).map((a, i) => curve[a] / curve[after[i]]);
    for (let i = 1; i < q.length; i++) assert.ok(q[i] <= q[i - 1] + 0.006, `${pos} ${after[i + 1]}: ${q[i]} after ${q[i - 1]}`);
  }
});
