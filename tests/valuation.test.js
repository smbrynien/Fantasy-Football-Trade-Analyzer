// Valuation engine: normalization, weighting, scarcity, dynasty aging, rookie picks, missing data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations } from '../js/core/valuation/engine.js';
import { computeLeagueStructure, surplusPoints } from '../js/core/valuation/replacement.js';
import { buildCurves, mapByPositionRank, fitValueFunction } from '../js/core/valuation/mapping.js';
import { blendGroups } from '../js/core/valuation/blend.js';
import { expectedSurplus, isotonicDecreasing, valueAtRank, spearman } from '../js/core/util/stats.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';
import { deepClone } from '../js/core/util/objects.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const preset = (id) => presets.find((p) => p.id === id);
const ds = makeDataset();
const red = computeValuations({ dataset: ds, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config });
const dyn = computeValuations({ dataset: ds, league: preset('preset_dyn_12_1qb'), mode: 'dynasty', config });

test('normalization: rank mapping onto league value curve, never averaging raw scales', () => {
  const curves = buildCurves([{ cid: 'a', position: 'RB', score: 100 }, { cid: 'b', position: 'RB', score: 60 }, { cid: 'c', position: 'RB', score: 20 }]);
  const m = mapByPositionRank([{ cid: 'x', position: 'RB', key: 9999 }, { cid: 'y', position: 'RB', key: 5 }], curves, { higherIsBetter: true, minPlayers: 1 });
  assert.equal(m.get('x').mapped, 100);
  assert.equal(m.get('y').mapped, 60);
  assert.equal(valueAtRank([100, 60, 20], 1.5), 80);
  const f = fitValueFunction([10, 8, 6, 4], [1000, 500, 250, 100], 4);
  assert.equal(f(10), 1000);
  assert.equal(f(7), 375);
  assert.ok(f(2) < 100 && f(2) > 0);
});

test('weighted blend renormalises over available signals and reports contributions that sum', () => {
  const b = blendGroups({ market: 100, consensus: null, projection: 50 }, { market: 0.3, consensus: 0.3, projection: 0.4 });
  assert.ok(Math.abs(b.score - (100 * 0.3 + 50 * 0.4) / 0.7) < 1e-9);
  assert.ok(Math.abs(Object.values(b.contributions).reduce((a, x) => a + x, 0) - b.score) < 1e-9);
  assert.equal(b.effWeights.consensus, undefined);
});

test('expected surplus / isotonic / spearman helpers', () => {
  assert.ok(expectedSurplus(100, 0, 120) === 0);
  assert.ok(expectedSurplus(100, 30, 120) > 0); // uncertainty → upside
  assert.deepEqual(isotonicDecreasing([5, 6, 3, 4, 1]), [5.5, 5.5, 3.5, 3.5, 1]);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
});

test('components sum to the final value for every asset', () => {
  for (const r of [red, dyn]) for (const a of r.assets.values()) {
    const sum = Object.values(a.components).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - a.value) < 1e-6 * Math.max(1, a.value) || a.value === 0, `${a.name}: ${sum} vs ${a.value}`);
  }
});

test('scale: mean of the top-12 reference-league assets = 7,000 (top asset ≈ 10,000) and ranks are ordered', () => {
  const top = [...red.assets.values()].filter((a) => a.kind === 'player').sort((a, b) => b.value - a.value);
  const n = config.model.scale.anchor_top_n;
  assert.ok(Math.abs(top.slice(0, n).reduce((s, a) => s + a.value, 0) / n - 7000) < 1);
  assert.ok(top[0].value > 7000 && top[0].value < 15000);
  assert.equal(top[0].rank, 1);
  assert.ok(top[5].value <= top[4].value);
});

test('positional scarcity: replacement levels follow starters incl. FLEX', () => {
  const pool = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE']) for (let i = 0; i < 60; i++) pool.push({ cid: `${pos}${i}`, position: pos, points: 300 - i * 4 - (pos === 'TE' ? 80 : 0) });
  const league = { teams: 10, roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BENCH: 5 }, flex_eligibility: { FLEX: ['RB', 'WR', 'TE'] } };
  const st = computeLeagueStructure(pool, league);
  assert.equal(st.starters.QB, 10);
  assert.equal(st.starters.RB + st.starters.WR + st.starters.TE, 10 * 6);
  assert.ok(st.replacement.QB > st.replacement.RB);
  assert.ok(surplusPoints(st.replacement.RB + 10, 'RB', st, 0.35) >= 10);
  assert.equal(surplusPoints(st.waiver.RB - 5, 'RB', st, 0.35), 0);
});

test('superflex raises QB value relative to 1QB; deeper leagues change values', () => {
  const sf = computeValuations({ dataset: ds, league: preset('preset_12_sf_ppr'), mode: 'redraft', config });
  const qbShare = (r) => { const qb = r.assets.get('TQB1').value; const rb = r.assets.get('TRB1').value; return qb / rb; };
  assert.ok(qbShare(sf) > qbShare(red) * 1.3, `${qbShare(sf)} vs ${qbShare(red)}`);
  const ten = computeValuations({ dataset: ds, league: preset('preset_10_1qb_half'), mode: 'redraft', config });
  assert.notEqual(Math.round(ten.assets.get('TWR10').value), Math.round(red.assets.get('TWR10').value));
  assert.ok(red.assets.get('TWR10').leagueEffect !== undefined);
});

test('TE premium raises tight-end values', () => {
  const tep = deepClone(preset('preset_12_1qb_ppr'));
  tep.scoring = { bonus_rec_te: 0.75 };
  const r = computeValuations({ dataset: ds, league: tep, mode: 'redraft', config });
  assert.ok(r.assets.get('TTE1').value > red.assets.get('TTE1').value);
});

test('dynasty is not redraft × age: younger player with identical production is worth more; years decline for old RBs', () => {
  const d2 = deepClone(ds);
  const a = d2.players.find((p) => p.cid === 'TRB3'), b = d2.players.find((p) => p.cid === 'TRB4');
  for (const k of ['projections', 'weekly', 'last_season', 'rankings', 'market', 'adp']) b[k] = deepClone(a[k]);
  b.draft = deepClone(a.draft); b.team = a.team; b.years_exp = 2; a.years_exp = 8;
  a.birth_date = '1997-01-01'; b.birth_date = '2003-01-01';
  const r = computeValuations({ dataset: d2, league: preset('preset_dyn_12_1qb'), mode: 'dynasty', config });
  const old = r.assets.get('TRB3'), young = r.assets.get('TRB4');
  assert.ok(young.value > old.value, `${young.value} vs ${old.value}`);
  assert.ok(young.components.longevity > old.components.longevity);
  const yrs = old.details.years;
  assert.ok(yrs[4].ppg < yrs[0].ppg);
  assert.ok(yrs[4].survival < 1);
  // redraft values for the identical lines are (nearly) the same — dynasty differs because of age
  const rr = computeValuations({ dataset: d2, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config });
  assert.ok(Math.abs(rr.assets.get('TRB3').value - rr.assets.get('TRB4').value) < 1);
});

test('dynasty strategy: rebuilding values the future more than contending', () => {
  const p = deepClone(preset('preset_dyn_12_1qb'));
  const c = computeValuations({ dataset: ds, league: { ...p, dynasty: { strategy: 'contending' } }, mode: 'dynasty', config });
  const rb = computeValuations({ dataset: ds, league: { ...p, dynasty: { strategy: 'rebuilding' } }, mode: 'dynasty', config });
  const young = 'TR1';
  assert.ok(rb.assets.get(young).components.longevity / rb.assets.get(young).value > c.assets.get(young).components.longevity / c.assets.get(young).value);
});

test('rookie picks: slot ordering, buckets, future discount, league size, custom ranges', () => {
  const v = (id) => dyn.getAsset(id).value;
  const up = dyn.picks.upcoming;
  assert.ok(v(`pick:${up}:1:1`) > v(`pick:${up}:1:12`));
  assert.ok(v(`pick:${up}:1:12`) > v(`pick:${up}:2:1`));
  assert.ok(v(`pick:${up}:1:early`) > v(`pick:${up}:1:mid`) && v(`pick:${up}:1:mid`) > v(`pick:${up}:1:late`));
  assert.ok(v(`pick:${up}:1`) > v(`pick:${up + 1}:1`));
  const unk = v(`pick:${up}:1`);
  assert.ok(unk < v(`pick:${up}:1:1`) && unk > v(`pick:${up}:1:12`));
  const range = dyn.getAsset(`pick:${up}:1:r3-5`);
  assert.ok(range && range.value < v(`pick:${up}:1:2`) && range.value > v(`pick:${up}:1:7`));
  assert.ok(dyn.getAsset(`pick:${up}:1`).sigma > 0);
  const big = computeValuations({ dataset: ds, league: { ...preset('preset_dyn_12_1qb'), teams: 14 }, mode: 'dynasty', config });
  // 2.01 in a 14-team league is rookie #15 — worth less than 2.01 in a 12-team league (#13)
  assert.ok(big.getAsset(`pick:${up}:2:1`).value < dyn.getAsset(`pick:${up}:2:1`).value);
});

test('missing data: player with only one signal still valued, with low confidence; no fabricated signals', () => {
  const d2 = deepClone(ds);
  d2.players.push({ cid: 'ONLY_MKT', name: 'Market Only', position: 'WR', positions: ['WR'], team: 'DAL', birth_date: '2001-01-01', draft: {}, ids: {}, aliases: [], rankings: [], projections: [], adp: [], weekly: [], last_season: null, injury: null, market: [{ src: 'fantasycalc', dynasty: false, qb: '1qb', ppr: 1, teams: 12, value: 5000 }] });
  const r = computeValuations({ dataset: d2, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config });
  const a = r.assets.get('ONLY_MKT');
  assert.ok(a && a.value > 0);
  assert.equal(a.confidence.label, 'Low');
  assert.deepEqual(Object.keys(a.weights), ['market']);
  assert.equal(a.groups.projection, null);
});

test('confidence: well-covered starters are High and ranges are wider for low confidence', () => {
  const a = red.assets.get('TWR1');
  assert.equal(a.confidence.label, 'High');
  assert.ok(a.range[0] < a.value && a.range[1] > a.value);
});

test('season phase: preseason weights differ from in-season weights', () => {
  const pre = deepClone(ds); pre.state.season_type = 'pre'; pre.state.week = 0;
  for (const p of pre.players) for (const pr of p.projections) pr.scope = 'season';
  const r = computeValuations({ dataset: pre, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config });
  assert.equal(r.phase.phase, 'preseason');
  assert.equal(r.weights.production, 0);
  assert.ok(r.weights.adp > red.weights.adp);
});

test('IR players absent from in-season projections get zero projection, not missing', () => {
  const d2 = deepClone(ds);
  const p = d2.players.find((x) => x.cid === 'TRB2');
  p.projections = [];
  p.injury = { status: 'IR' };
  const r = computeValuations({ dataset: d2, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config });
  const a = r.assets.get('TRB2');
  assert.equal(a.groups.projection, 0);
  assert.ok(a.value < red.assets.get('TRB2').value * 0.6);
});

// Handoff bugs #4/#5: market list format selection.
import { collectMarket } from '../js/core/valuation/signals.js';

const withExtraMarket = (base, make) => {
  const d2 = deepClone(base);
  for (const p of d2.players) if (p.market?.length) p.market.push(...make(p));
  return d2;
};

test('market lists: a source with only wrong-QB-format lists is excluded and reported, not used silently', () => {
  // Reversed values make any use of this list obvious.
  const d2 = withExtraMarket(ds, (p) => [{ src: 'manual_market', dynasty: false, qb: '1qb', ppr: 1, teams: 12, value: 10000 - (p.market[0]?.value || 0) }]);
  const sf = computeValuations({ dataset: d2, league: preset('preset_12_sf_ppr'), mode: 'redraft', config });
  assert.deepEqual(sf.meta.excluded_market_lists.map((x) => [x.src, x.reason, x.meta.qb]), [['manual_market', 'qb_format', '1qb']]);
  for (const a of sf.assets.values()) assert.ok(!(a.details?.market || []).some((s) => s.src === 'manual_market'), `${a.name} used a 1QB list in SF`);
  const one = computeValuations({ dataset: d2, league: preset('preset_12_1qb_ppr'), mode: 'redraft', config });
  assert.deepEqual(one.meta.excluded_market_lists, []);
  assert.ok([...one.assets.values()].some((a) => (a.details?.market || []).some((s) => s.src === 'manual_market')), 'the 1QB list is used in a 1QB league');
});

test('market lists: TE-premium lists are preferred in TE-premium leagues and avoided otherwise', () => {
  const d2 = withExtraMarket(ds, (p) => [0, 0.5, 1].map((tep) => ({ src: 'ktc', dynasty: true, qb: '1qb', ppr: 1, teams: 12, tep, value: (p.market[0]?.value || 0) + tep * (p.position === 'TE' ? 1000 : 0) })));
  const chosenTep = (scoring) => collectMarket(d2, { dynasty: true, league: { qb_format: '1qb', teams: 12 }, scoring: { rec: 1, ...scoring } }).get('ktc').meta.tep;
  assert.equal(chosenTep({}), 0);
  assert.equal(chosenTep({ bonus_rec_te: 0.5 }), 0.5);
  assert.equal(chosenTep({ bonus_rec_te: 1 }), 1);
  const league = { ...preset('preset_dyn_12_1qb'), scoring: { bonus_rec_te: 1 } };
  const r = computeValuations({ dataset: d2, league, mode: 'dynasty', config });
  const te = r.assets.get('TTE1');
  assert.equal(te.details.market.find((s) => s.src === 'ktc').raw.tep, 1);
});
