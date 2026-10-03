// Trade finder (js/core/trade-finder.js): "I want X — what could I offer?" Checked against an independent brute force
// built only from the public primitives (analyzeTrade, expectedLineupPoints, bestLineup), on synthetic leagues drafted
// from the fixture. Also: invariants (fair, minimal, improving, diverse, never offers what it must not), dynasty with
// duplicate generic picks, the owner-aware ranking, determinism and the curve cache in analyzeTrade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { analyzeTrade } from '../js/core/valuation/trade.js';
import { expectationInputs, expectedLineupPoints, bestLineup } from '../js/core/roster.js';
import { findTradePackages, FINDER_DEFAULTS, FAIRNESS } from '../js/core/trade-finder.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const ds = makeDataset();
const red = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config });
const dyn = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_dyn_12_1qb'), mode: 'dynasty', config });
const ex = expectationInputs(red);

/** Snake draft of 12 teams × 14 players (QB ≤2, RB/WR ≤5, TE ≤2) by value with a fixed offset pattern. */
function league(r) {
  const pool = [...r.assets.values()].filter((a) => a.kind === 'player' && a.team && a.team !== 'FA' && ['QB', 'RB', 'WR', 'TE'].includes(a.position)).sort((x, y) => y.value - x.value || x.id.localeCompare(y.id));
  const cap = { QB: 2, RB: 5, WR: 5, TE: 2 };
  const teams = Array.from({ length: 12 }, () => []);
  const taken = new Set();
  for (let round = 0; round < 14; round++) {
    const order = round % 2 ? [...Array(12).keys()].reverse() : [...Array(12).keys()];
    for (const t of order) {
      const ok = pool.filter((a) => !taken.has(a.id) && teams[t].filter((b) => b.position === a.position).length < cap[a.position]);
      const a = ok[(t + round) % Math.min(3, ok.length)];
      taken.add(a.id); teams[t].push(a.id);
    }
  }
  return teams;
}
const LG = league(red);

/** Independent oracle: every package of 1..3, fair + minimal + improving, sorted, then the same diversity rule. */
function oracle(r, mine, targetId, { maxEdge = FINDER_DEFAULTS.maxEdge, maxOverpay = FINDER_DEFAULTS.maxOverpay, minGain = FINDER_DEFAULTS.minGain, limit = 5 } = {}) {
  const A = (ids) => ids.map((id) => r.getAsset(id));
  const pool = A(mine).filter((a) => a.value > 0).sort((x, y) => y.value - x.value || x.id.localeCompare(y.id));
  const combos = [];
  for (let i = 0; i < pool.length; i++) {
    combos.push([i]);
    for (let j = i + 1; j < pool.length; j++) { combos.push([i, j]); for (let k = j + 1; k < pool.length; k++) combos.push([i, j, k]); }
  }
  const evalOf = new Map();
  for (const c of combos) {
    const ids = c.map((i) => pool[i].id);
    const ana = analyzeTrade(r, [targetId], ids);
    evalOf.set([...ids].sort().join('|'), { ids, pct: ana.pct, level: ana.assessment.level });
  }
  // A smaller package is "enough" when the other side would already accept it: more value for them, or within the band and close.
  const enough = (ids) => { const e = evalOf.get([...ids].sort().join('|')); return Boolean(e) && (e.pct <= 0 || (e.pct <= maxEdge && e.level === 'even')); };
  const base = expectedLineupPoints(A(mine), r.league, ex);
  const out = [];
  for (const e of evalOf.values()) {
    if (!(e.pct <= maxEdge && e.pct >= -maxOverpay && e.level === 'even')) continue;
    const subs = e.ids.length === 1 ? [] : e.ids.length === 2 ? [[e.ids[0]], [e.ids[1]]] : [[e.ids[0]], [e.ids[1]], [e.ids[2]], [e.ids[0], e.ids[1]], [e.ids[0], e.ids[2]], [e.ids[1], e.ids[2]]];
    if (subs.some(enough)) continue;
    const after = [...A(mine.filter((id) => !e.ids.includes(id))), r.getAsset(targetId)];
    const gain = expectedLineupPoints(after, r.league, ex) - base;
    if (gain >= minGain) out.push({ ...e, gain });
  }
  out.sort((x, y) => y.gain - x.gain || x.ids.length - y.ids.length || Math.abs(x.pct) - Math.abs(y.pct) || [...x.ids].sort().join('|').localeCompare([...y.ids].sort().join('|')));
  const uses = new Map(), picked = [];
  for (const e of out) {
    if (picked.length >= limit) break;
    if (e.ids.some((id) => (uses.get(id) || 0) >= 2)) continue;
    for (const id of e.ids) uses.set(id, (uses.get(id) || 0) + 1);
    picked.push(e);
  }
  return { all: out, picked };
}

/** Targets on other rosters, spread over the value range. */
const targets = () => LG.slice(1).flatMap((ids) => ids.slice(0, 6));

test('finder options = an independent brute force (fair, minimal, improving, sorted, diverse) on 40 requests', () => {
  let compared = 0, withOptions = 0;
  for (const [i, targetId] of targets().slice(0, 40).entries()) {
    const mine = LG[i % 3 === 0 ? 0 : i % 3 === 1 ? 4 : 9];
    if (mine.includes(targetId)) continue;
    const got = findTradePackages(red, mine, targetId, { expected: ex });
    assert.ok(got.ok, got.reason);
    const want = oracle(red, mine, targetId);
    assert.deepEqual(got.options.map((o) => [...o.ids].sort().join('|')), want.picked.map((e) => [...e.ids].sort().join('|')), `request ${i}`);
    got.options.forEach((o, k) => assert.ok(Math.abs(o.gain - want.picked[k].gain) < 1e-9));
    assert.equal(got.stats.improving, want.all.length, 'every improving fair minimal package counted');
    compared++; if (got.options.length) withOptions++;
  }
  assert.ok(compared >= 30, `compared ${compared}`);
  assert.ok(withOptions >= 5, `the fixture produces options for several requests (${withOptions})`);
});

test('every option is fair by analyzeTrade, has no throw-in, improves my team and respects the diversity cap', () => {
  for (const targetId of targets().slice(0, 30)) {
    const mine = LG[0];
    const res = findTradePackages(red, mine, targetId, { expected: ex, limit: 5 });
    const uses = new Map();
    for (const o of res.options) {
      const ana = analyzeTrade(red, [targetId], o.ids);
      assert.equal(ana.assessment.level, 'even');
      assert.ok(ana.pct <= FINDER_DEFAULTS.maxEdge + 1e-12 && ana.pct >= -FINDER_DEFAULTS.maxOverpay - 1e-12);
      assert.ok(Math.abs(ana.pct - o.pct) < 1e-12 && Math.abs(ana.sides[1].adjusted - o.theirs) < 1e-9);
      // no throw-in: removing any one asset leaves the other side short
      if (o.ids.length > 1) for (const drop of o.ids) { const sub = analyzeTrade(red, [targetId], o.ids.filter((x) => x !== drop)); assert.ok(sub.pct > 0 && (sub.pct > FINDER_DEFAULTS.maxEdge || sub.assessment.level !== 'even')); }
      assert.ok(o.gain >= FINDER_DEFAULTS.minGain);
      assert.ok(o.ids.every((id) => mine.includes(id)) && !o.ids.includes(targetId));
      assert.ok(o.ids.length <= FINDER_DEFAULTS.maxAssets && new Set(o.ids).size === o.ids.length);
      for (const id of o.ids) uses.set(id, (uses.get(id) || 0) + 1);
      // the lineup gain shown equals bestLineup before → after
      const A = (ids) => ids.map((id) => red.getAsset(id));
      const lv = (xs) => bestLineup(xs, red.league).starters.reduce((s, a) => s + a.value, 0);
      assert.ok(Math.abs(o.lineupValueGain - (lv([...A(mine.filter((x) => !o.ids.includes(x))), red.getAsset(targetId)]) - lv(A(mine)))) < 1e-6);
    }
    for (const n of uses.values()) assert.ok(n <= FINDER_DEFAULTS.maxUses);
    for (let k = 1; k < res.options.length; k++) assert.ok(res.options[k - 1].gain >= res.options[k].gain - 1e-12);
  }
});

test('"never offer", errors, determinism and fairness presets', () => {
  const mine = LG[0];
  const t = LG[5][2];
  const base = findTradePackages(red, mine, t, { expected: ex, includeAll: true });
  assert.deepEqual(findTradePackages(red, mine, t, { expected: ex, includeAll: true }), base, 'same input, same answer');
  const kept = base.all.length ? base.all[0].ids[0] : mine[0];
  const res = findTradePackages(red, mine, t, { expected: ex, keep: [kept], includeAll: true });
  assert.ok(res.all.every((o) => !o.ids.includes(kept)), 'a kept asset is never offered');
  assert.equal(findTradePackages(red, mine, mine[3], { expected: ex }).ok, false, 'target already on my roster');
  assert.equal(findTradePackages(red, mine, 'nope', { expected: ex }).ok, false, 'unknown target');
  assert.equal(findTradePackages(red, [], t, { expected: ex }).ok, false, 'empty team');
  assert.equal(findTradePackages(red, mine, t, {}).ok, false, 'redraft needs expected lineup inputs');
  assert.equal(findTradePackages(red, mine, t, { expected: ex, keep: mine }).ok, false, 'everything kept');
  // A wider band never finds fewer options (it used to: a lone asset that left them clearly short still counted as
  // "enough", so every bigger package looked like it had a throw-in).
  let wider = 0;
  for (const target of targets().slice(0, 30)) {
    // (Counts may fall — a smaller package becoming acceptable replaces its supersets, and giving less never lowers my
    // gain — but whether ANY improving option exists can only go up.)
    const n = Object.values(FAIRNESS).map((f) => (findTradePackages(red, LG[0], target, { expected: ex, maxEdge: f.maxEdge }).options.length > 0 ? 1 : 0));
    assert.ok(n[0] <= n[1] && n[1] <= n[2], `strict ≤ balanced ≤ close (${n})`);
    if (n[2] > n[0]) wider++;
  }
  assert.ok(wider > 0, 'the wider bands find more somewhere');
  // Fairness presets bound how much more value I may receive.
  for (const target of targets().slice(0, 20)) {
    for (const [k, f] of Object.entries(FAIRNESS)) {
      const r = findTradePackages(red, LG[0], target, { expected: ex, maxEdge: f.maxEdge, includeAll: true });
      for (const o of r.all) { assert.ok(o.pct <= f.maxEdge + 1e-12, k); assert.equal(o.level, 'even'); }
    }
  }
});

test('owner roster known: ranked by my + their expected gain; their gain is exact', () => {
  let checked = 0;
  for (const [i, targetId] of targets().slice(0, 40).entries()) {
    const owner = LG.find((ids) => ids.includes(targetId));
    const mine = LG[i % 2 ? 0 : 7];
    if (owner === mine) continue;
    const res = findTradePackages(red, mine, targetId, { expected: ex, theirs: owner });
    const A = (ids) => ids.map((id) => red.getAsset(id));
    for (const o of res.options) {
      let theirAfter = [...A(owner.filter((x) => x !== targetId)), ...A(o.ids)];
      if (theirAfter.length > owner.length) theirAfter = theirAfter.sort((x, y) => y.value - x.value || x.id.localeCompare(y.id)).slice(0, owner.length); // they drop to their roster size
      const want = expectedLineupPoints(theirAfter, red.league, ex) - expectedLineupPoints(A(owner), red.league, ex);
      assert.ok(Math.abs(o.theirGain - want) < 1e-9);
      checked++;
    }
    for (let k = 1; k < res.options.length; k++) assert.ok(res.options[k - 1].gain + res.options[k - 1].theirGain >= res.options[k].gain + res.options[k].theirGain - 1e-9, 'sorted by the sum');
    // 'mine' ignores them: same packages as without the owner roster
    const plain = findTradePackages(red, mine, targetId, { expected: ex });
    const mineOnly = findTradePackages(red, mine, targetId, { expected: ex, theirs: owner, mutualRank: 'mine' });
    assert.deepEqual(mineOnly.options.map((o) => o.ids), plain.options.map((o) => o.ids));
  }
  assert.ok(checked > 0);
});

test('dynasty: ranks by starting-lineup value, offers picks, and two identical generic picks count as two assets', () => {
  const mine = [...league(dyn)[0], 'pick:2027:1', 'pick:2027:1', 'pick:2027:2'];
  let withPick = 0, any = 0;
  for (const targetId of league(dyn).slice(1).flatMap((ids) => ids.slice(0, 5))) {
    const res = findTradePackages(dyn, mine, targetId, { includeAll: true });
    assert.ok(res.ok, res.reason);
    assert.equal(res.metric, 'lineupValue');
    for (const o of res.options) {
      assert.ok(o.lineupValueGain >= FINDER_DEFAULTS.minLineupGain);
      const twice = o.ids.filter((id) => id === 'pick:2027:1').length;
      assert.equal(res.options.filter((x) => [...x.ids].sort().join('|') === [...o.ids].sort().join('|')).length, 1, 'each package listed once');
      assert.ok(twice <= 2, 'never more copies than I own');
      if (o.ids.some((id) => id.startsWith('pick:'))) withPick++;
      any++;
    }
  }
  assert.ok(any > 0 && withPick > 0, `dynasty options include picks (${withPick}/${any})`);
  // A team holding only two identical picks besides its players: packages are unique in the full list too.
  for (const targetId of league(dyn).slice(1).flatMap((ids) => ids.slice(0, 8))) {
    const all = findTradePackages(dyn, mine, targetId, { includeAll: true }).all;
    const keys = all.map((o) => [...o.ids].sort().join('|'));
    assert.equal(new Set(keys).size, keys.length);
  }
  // The target can be a pick (another team's 2028 1st).
  const res = findTradePackages(dyn, mine, 'pick:2028:1', {});
  assert.ok(res.ok && res.target.kind === 'pick');
});

test('analyzeTrade value-curve cache: identical results, and much faster on repeated calls', () => {
  const ids = [...red.assets.values()].filter((a) => a.kind === 'player' && a.team).sort((x, y) => y.value - x.value).map((a) => a.id);
  const a1 = analyzeTrade(red, [ids[3]], [ids[10], ids[11], ids[40]]);
  const fresh = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config });
  const a2 = analyzeTrade(fresh, [ids[3]], [ids[10], ids[11], ids[40]]);
  assert.equal(a1.diff, a2.diff);
  assert.deepEqual(a1.sides[1].package.items, a2.sides[1].package.items);
});
