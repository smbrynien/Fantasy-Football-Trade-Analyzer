// Model 2.3.0 (research batch, docs/MODEL_AUDIT.md §21): availability by positional rank (E11), redraft verdict levels
// from the calibrated outcome frequency and the outcome range (E10), expected lineup points for My Team (E12), and the
// daily signal archive with its backtest (E9/E13). SYNTHETIC fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeValuations } from '../js/core/valuation/engine.js';
import { analyzeTrade } from '../js/core/valuation/trade.js';
import { applyAvailabilityShape } from '../js/core/valuation/redraft.js';
import { outcomeRange } from '../js/core/valuation/confidence.js';
import { expectedLineupPoints, expectationInputs, rosterImpact } from '../js/core/roster.js';
import { verdictHeadline } from '../js/ui/trade-helpers.js';
import { compactSignals, archiveSignals, listArchive, loadArchiveDay } from '../server/archive.js';
import { archiveBacktest, checkpointsOf } from '../scripts/audit/archive-backtest.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';
import { deepClone } from '../js/core/util/objects.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const preset = (id) => presets.find((p) => p.id === id);
const ds = makeDataset();
const red = computeValuations({ dataset: ds, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config });
const dyn = computeValuations({ dataset: ds, league: preset('preset_dyn_12_1qb'), mode: 'dynasty', config });
const byPos = (r, pos) => [...r.assets.values()].filter((a) => a.kind === 'player' && a.position === pos).sort((x, y) => y.value - x.value);
const withConfig = (mut) => { const c = deepClone(config); mut(c.model); return c; };

test('availability shape: non-increasing by rank, order kept, flat past the last knot, components still sum to value', () => {
  const knots = { RB: [[1, 1.05], [12, 1.03], [48, 0.91]] };
  const assets = new Map(Array.from({ length: 60 }, (_, i) => [`r${i}`, { id: `r${i}`, position: 'RB', score: 1000 - i * 10, contributions: { consensus: 1000 - i * 10 }, details: {}, confidence: { sigma: 50 } }]));
  applyAvailabilityShape(assets, { enabled: true, knots });
  const xs = [...assets.values()];
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i].details.availability.factor <= xs[i - 1].details.availability.factor + 1e-12, 'factor non-increasing');
    assert.ok(xs[i].score < xs[i - 1].score, 'order within the position unchanged');
  }
  assert.equal(xs[0].details.availability.factor, 1.05);
  assert.equal(xs[59].details.availability.factor, 0.91, 'flat beyond the last knot (backups: role, not injury)');
  for (const a of xs) assert.ok(Math.abs(a.contributions.consensus + (a.contributions.availability || 0) - a.score) < 1e-9);
  assert.ok(Math.abs(xs[0].confidence.sigma - 50 * 1.05) < 1e-9, '± scales with the value');
  const off = new Map([['x', { id: 'x', position: 'RB', score: 100, contributions: { consensus: 100 }, details: {} }]]);
  applyAvailabilityShape(off, { enabled: false, knots });
  assert.equal(off.get('x').score, 100);
});

test('availability shape in the engine: redraft depth falls relative to stars, dynasty untouched, components sum', () => {
  const noShape = computeValuations({ dataset: ds, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config: withConfig((m) => { m.redraft.availability_shape.enabled = false; }) });
  const rb = byPos(red, 'RB'), rb0 = byPos(noShape, 'RB');
  const ratio = (r, i) => r[i].value / r[0].value;
  assert.ok(ratio(rb, 40) < ratio(rb0, 40), 'RB41 is worth less relative to RB1 than without the shape');
  for (const a of [...red.assets.values()].filter((x) => x.kind === 'player' && x.value > 0)) {
    const sum = Object.values(a.components).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - a.value) < 1e-6 * Math.max(1, a.value), `${a.name}: components sum to the value`);
  }
  const dyn0 = computeValuations({ dataset: ds, league: preset('preset_dyn_12_1qb'), mode: 'dynasty', config: withConfig((m) => { m.redraft.availability_shape.enabled = false; }) });
  for (const a of dyn.assets.values()) assert.equal(a.value, dyn0.getAsset(a.id)?.value, 'dynasty values unchanged');
});

test('verdict levels follow the calibrated outcome frequency (redraft 2.3.0, dynasty 2.4.0); z without a slope', () => {
  const rb = byPos(red, 'RB');
  // find pairs of single players at chosen margins
  const pairAt = (lo, hi) => { for (const a of rb) for (const b of rb) { const p = (a.value - b.value) / a.value; if (p >= lo && p < hi) return [a, b]; } return null; };
  const cases = [[0.05, 0.2, 'even'], [0.3, 0.5, 'lean'], [0.6, 0.9, 'clear']];
  for (const [lo, hi, want] of cases) {
    const [a, b] = pairAt(lo, hi);
    const t = analyzeTrade(red, [a.id], [b.id]);
    const p = t.outcome.probability;
    assert.equal(t.assessment.level, want, `margin ${(t.pct * 100).toFixed(0)}% (outcome ${(p * 100).toFixed(0)}%)`);
    assert.equal(t.assessment.basis, 'outcome');
    const shown = Math.round(p * 20) / 20; // outcomeText rounds to 5%
    const level = shown < 0.6 ? 'even' : shown < 0.7 ? 'lean' : 'clear';
    assert.equal(t.assessment.level, level, 'level and the frequency shown under it agree');
    assert.ok(!/uncertainty/.test(verdictHeadline(t).sub), 'redraft wording does not cite the ± range');
  }
  const [a, b] = pairAt(0.05, 0.2);
  const zOnly = computeValuations({ dataset: ds, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config: withConfig((m) => { delete m.trade_outcome.levels; }) });
  const tz = analyzeTrade(zOnly, [a.id], [b.id]);
  assert.equal(tz.assessment.basis, undefined, 'without levels the z-score decides (2.2.0 behaviour)');
  // Dynasty (2.4.0, audit E15): the same levels on the dynasty frequency; removing its slope restores the z levels.
  const d = byPos(dyn, 'WR');
  const dpair = (lo, hi) => { for (const x of d) for (const y of d) { const q = (x.value - y.value) / x.value; if (q >= lo && q < hi) return [x, y]; } return null; };
  for (const [lo, hi, want] of [[0.03, 0.12, 'even'], [0.22, 0.35, 'lean'], [0.5, 0.9, 'clear']]) {
    const [x, y] = dpair(lo, hi);
    const td = analyzeTrade(dyn, [x.id], [y.id]);
    assert.equal(td.assessment.basis, 'outcome');
    assert.equal(td.assessment.level, want, `dynasty margin ${(td.pct * 100).toFixed(0)}% (outcome ${(td.outcome.probability * 100).toFixed(0)}%)`);
    const shown = Math.round(td.outcome.probability * 20) / 20;
    assert.equal(td.assessment.level, shown < 0.6 ? 'even' : shown < 0.7 ? 'lean' : 'clear');
  }
  const dynZ = computeValuations({ dataset: ds, league: preset('preset_dyn_12_1qb'), mode: 'dynasty', config: withConfig((m) => { delete m.trade_outcome.dynasty_logit_slope; }) });
  const dz = analyzeTrade(dynZ, [d[0].id], [d[5].id]);
  assert.equal(dz.assessment.basis, undefined, 'dynasty without its slope: z-score levels');
  assert.equal(dz.outcome, null);
});

test('outcome range: by projected points per game, wider for low projections; attached to redraft players', () => {
  const table = config.model.redraft.outcome_range.by_points_per_game;
  const lo = outcomeRange(100, 17, table), hi = outcomeRange(300, 17, table);
  assert.ok(lo.p80[0] < lo.p50[0] && lo.p50[1] < lo.p80[1]);
  assert.ok(lo.p80[1] / lo.p80[0] > hi.p80[1] / hi.p80[0], 'relative spread shrinks for stars');
  assert.equal(outcomeRange(null, 17, table), null);
  assert.equal(outcomeRange(100, 0, table), null);
  const star = byPos(red, 'WR')[0];
  assert.ok(star.details.outcomeRange && star.details.outcomeRange.p80[0] < star.details.projection.points);
});

test('expected lineup points: deterministic, bench cover counts, waiver fills empty slots, availability matters', () => {
  const league = { roster: { QB: 1, RB: 2, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DEF: 0 } };
  const P = (id, position, r) => ({ id, kind: 'player', position, r });
  const rate = (a) => a.r, waiver = { QB: 10, RB: 5 };
  const base = [P('q', 'QB', 20), P('r1', 'RB', 15), P('r2', 'RB', 12)];
  const e = (xs, avail) => expectedLineupPoints(xs, league, { rate, avail, waiver, draws: 2000 });
  assert.equal(e(base, () => 1), 47, 'everyone available: the starters\' sum');
  assert.equal(e(base, () => 0.8), e(base, () => 0.8), 'deterministic');
  const withBench = e([...base, P('r3', 'RB', 9)], () => 0.8);
  assert.ok(withBench > e(base, () => 0.8), 'a bench RB covers missed games');
  assert.ok(Math.abs(e([], () => 1) - 20) < 1e-9, 'empty roster: waiver level in every slot');
  assert.ok(e(base, (a) => (a.id === 'r1' ? 0.5 : 1)) < e(base, () => 1));
});

test('2.4.0: expected lineup points count bye weeks — shared byes cost more, a bench with another bye covers', () => {
  const league = { roster: { QB: 1, RB: 2, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DEF: 0 } };
  const P = (id, position, r, b) => ({ id, kind: 'player', position, r, b });
  const opt = { rate: (a) => a.r, avail: () => 1, waiver: { QB: 10, RB: 5 }, bye: (a) => a.b, weeks: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14] };
  const e = (xs, o = opt) => expectedLineupPoints(xs, league, o);
  const q = P('q', 'QB', 20, 7);
  // All available: each starter misses 1 of 10 weeks → his week goes to the waiver level.
  assert.ok(Math.abs(e([q, P('a', 'RB', 15, 8), P('b', 'RB', 12, 9)]) - (47 - (20 - 10) / 10 - (15 - 5) / 10 - (12 - 5) / 10)) < 1e-9);
  // Same bye for both RBs = the same expected loss here (both slots fall to the waiver in one week) …
  const sameBye = e([q, P('a', 'RB', 15, 8), P('b', 'RB', 12, 8)]);
  // … but a bench RB covers only a week that is not his own bye.
  const cover = e([q, P('a', 'RB', 15, 8), P('b', 'RB', 12, 9), P('c', 'RB', 9, 10)]);
  const coverSame = e([q, P('a', 'RB', 15, 8), P('b', 'RB', 12, 9), P('c', 'RB', 9, 8)]);
  assert.ok(cover > coverSame, `a bench RB with a different bye covers more (${cover} vs ${coverSame})`);
  assert.ok(Math.abs(sameBye - (47 - 1 - 1 - 0.7)) < 1e-9);
  // A bye already played (not among the remaining weeks) costs nothing; without weeks byes are ignored (2.3.0 form).
  assert.equal(e([q, P('a', 'RB', 15, 2), P('b', 'RB', 12, 3)], { ...opt, bye: (a) => (a.id === 'q' ? null : a.b) }), 47);
  assert.equal(e([q, P('a', 'RB', 15, 8), P('b', 'RB', 12, 9)], { ...opt, weeks: null }), 47);
  // From the valuations: in-season weeks run from the current week to the last regular-season week, byes from the data.
  const ex = expectationInputs(red);
  assert.deepEqual(ex.weeks, Array.from({ length: 18 - red.phase.week + 1 }, (_, i) => red.phase.week + i));
  assert.ok([...red.assets.values()].some((a) => a.kind === 'player' && Number.isFinite(ex.bye(a))) || ds.players.every((p) => !Number.isFinite(p.bye_week)));
});

test('rosterImpact reports the change in expected lineup points with its historical frequency', () => {
  const ex = expectationInputs(red);
  const rbs = byPos(red, 'RB'), wrs = byPos(red, 'WR'), qbs = byPos(red, 'QB'), tes = byPos(red, 'TE');
  const roster = [qbs[8], rbs[12], rbs[14], rbs[20], wrs[12], wrs[16], wrs[30], tes[8]].map((a) => a.id);
  const r = rosterImpact(red, roster, [rbs[20].id], [rbs[2].id], { expected: ex });
  assert.ok(r.after.expected > r.before.expected, 'an RB upgrade raises the expected lineup');
  assert.ok(r.expectedOutcome.better && r.expectedOutcome.probability > 0.5 && r.expectedOutcome.probability < 1);
  const none = rosterImpact(red, roster, [rbs[20].id], [rbs[2].id]);
  assert.equal(none.before.expected, null, 'without inputs nothing is computed');
  assert.ok(ex.waiver.RB > 0 && ex.waiver.RB < rbs[20].details.projection.rate + 1e-9, 'waiver level is below a rostered RB');
});

test('daily signal archive: compact record, one file per day (replaced the same day), round trip, opt-out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffta-archive-'));
  try {
    const d = { ...ds, built_at: '2026-10-03T09:00:00.000Z', data_version: 'x1' };
    const rec = compactSignals(d);
    assert.equal(rec.date, '2026-10-03');
    assert.ok(rec.players.length > 100 && rec.players.every((p) => p.rank.length || p.mkt.length || p.proj.length));
    await archiveSignals(d, { dir });
    await archiveSignals({ ...d, built_at: '2026-10-03T21:00:00.000Z', data_version: 'x2' }, { dir });
    await archiveSignals({ ...d, built_at: '2026-10-04T08:00:00.000Z', data_version: 'x3' }, { dir });
    const days = await listArchive({ dir });
    assert.deepEqual(days.map((x) => x.date), ['2026-10-03', '2026-10-04']);
    assert.equal((await loadArchiveDay(days[0].file)).data_version, 'x2', 'a later build the same day replaces the file');
    process.env.FFTA_ARCHIVE = '0';
    assert.equal(await archiveSignals(d, { dir }), null);
  } finally {
    delete process.env.FFTA_ARCHIVE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('archive backtest: skips until a season is archived, then scores every group (market included)', () => {
  // Synthetic season: 6 archived weeks; consensus rank is perfect, market is noise, projections are close.
  const N = 40, positions = ['QB', 'RB', 'WR', 'TE'];
  const truth = new Map();
  const day = (w, date) => ({
    date, state: { season: 2026, week: w, season_type: 'regular' },
    players: Array.from({ length: N * 4 }, (_, i) => {
      const pos = positions[i % 4], k = Math.floor(i / 4), g = `g${i}`;
      truth.set(g, (N - k) * 10);
      return { gsis: g, pos, rank: [['fp', 'ros', 'position', '1qb', pos, k + 1, 1]], mkt: [['m', 0, '1qb', 1, 12, null, 1000 + ((i * 7919) % 97), null]], adp: [], proj: [['s', 'ros', 2026, 10, { rec: (N - k) * 10 + ((i * 31) % 7) }]] };
    }),
  });
  const outcomes = (g, y, from) => (truth.has(g) ? truth.get(g) * (18 - from) / 10 : null);
  const few = [day(3, '2026-09-25'), day(4, '2026-10-02')];
  assert.equal(archiveBacktest(few, outcomes).skipped, true);
  const days = [3, 4, 5, 6, 7, 8].map((w, i) => day(w, `2026-10-${String(1 + i * 7).padStart(2, '0')}`));
  assert.equal(checkpointsOf(days).length, 6);
  const res = archiveBacktest(days, outcomes, { completedSeasons: [2026] });
  assert.equal(res.skipped, false);
  assert.equal(res.checkpoints, 6);
  assert.ok(res.summary.consensus.rho > 0.99, 'perfect ranking recovered');
  assert.ok(res.summary.market.rho < 0.5, 'noise market scores low');
  assert.ok(Number.isFinite(res.summary.app.mae) && Number.isFinite(res.summary.fit.mae));
  assert.match(res.results[0].method, /leave-one-checkpoint-out/);
});
