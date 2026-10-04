// Trade-page wording and share-link helpers (usability audit). Pure functions over analyzeTrade() output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadText, verdictHeadline, marketCheck, tradeFromHash, tradeHash, compareSummary } from '../js/ui/trade-helpers.js';

const ana = (diff, level, { sigma = 1000, pct = 0.2, z = 2.5, market } = {}) => ({
  diff, pct: diff > 0 ? pct : -pct, sigmaDiff: sigma, z, assessment: { level },
  signalDiffs: market === undefined ? [] : [{ key: 'market', a: 5000, b: 5000 - market, diff: market }],
});

test('leadText: who receives more, rounded like every other value; tiny gaps are "even"', () => {
  assert.equal(leadText(6163), 'A +6,160');
  assert.equal(leadText(-6163), 'B +6,160');
  assert.equal(leadText(4), 'even');
  assert.equal(leadText(-4), 'even');
});

test('verdictHeadline mirrors the model level and names the team', () => {
  assert.equal(verdictHeadline(ana(300, 'even')).label, 'Close — roughly fair');
  assert.equal(verdictHeadline(ana(-1500, 'lean')).label, 'Leans Team B');
  assert.equal(verdictHeadline(ana(4000, 'clear')).label, 'Team A clearly ahead');
  assert.match(verdictHeadline(ana(4000, 'clear')).sub, /Team A receives 4,000 more \(20%\)/);
  assert.equal(verdictHeadline(ana(0, 'incomplete')).label, 'Add assets to both sides');
});

test('marketCheck: agree, disagree, close, and no market data', () => {
  assert.equal(marketCheck(ana(3000, 'clear')), null);
  assert.equal(marketCheck(ana(3000, 'clear', { market: 2500 })).cls, 'agree');
  assert.equal(marketCheck(ana(3000, 'clear', { market: -2500 })).cls, 'disagree');
  assert.match(marketCheck(ana(3000, 'clear', { market: -2500 })).text, /favour Team B/);
  assert.equal(marketCheck(ana(300, 'even', { market: 200 })).cls, 'agree');
  assert.equal(marketCheck(ana(300, 'even', { market: 2500 })).cls, 'differ');
  assert.equal(marketCheck(ana(3000, 'clear', { market: 200 })).cls, 'differ');
});

test('share links round-trip ids (players and picks) and ignore junk', () => {
  const a = ['P1da8ad52', 'pick:2027:1:early'], b = ['pick:2028:2', 'Pbb2ff217'];
  const h = tradeHash('dynasty', a, b);
  assert.match(h, /^#\/trade\?m=dynasty&a=/);
  assert.deepEqual(tradeFromHash(h), { a, b });
  assert.equal(tradeFromHash('#/trade'), null);
  assert.deepEqual(tradeFromHash('#/trade?a=,,%E0%A4%A,x&b='), { a: ['x'], b: [] }); // malformed escape dropped
  assert.equal(tradeFromHash(`#/trade?a=${'x,'.repeat(100)}`).a.length, 25);
  assert.deepEqual(tradeFromHash(`#/trade?a=${'y'.repeat(200)}`).a, []);
});

test('compareSummary: leader, gaps in value order, and "about the same" when the gap is inside the combined ±', () => {
  assert.equal(compareSummary([{ name: 'A', value: 100, sigma: 10 }]), null, 'needs two assets');
  const s = compareSummary([{ name: 'Pick', value: 3170, sigma: 1330 }, { name: 'Chase', value: 10200, sigma: 2010 }, { name: 'Nabers', value: 6680, sigma: 450 }]);
  assert.equal(s.leader.name, 'Chase');
  assert.deepEqual(s.rows.map((r) => r.name), ['Nabers', 'Pick']);
  assert.equal(s.rows[0].gap, 3520);
  assert.ok(Math.abs(s.rows[0].pct - 3520 / 10200) < 1e-9);
  assert.equal(s.rows[0].close, false, '3,520 > √(2,010² + 450²) ≈ 2,060');
  const near = compareSummary([{ name: 'X', value: 5000, sigma: 400 }, { name: 'Y', value: 4700, sigma: 300 }]);
  assert.equal(near.rows[0].close, true, '300 ≤ 500');
});

test('deep audit: source-disagreement note and alternative-assumption variants', async () => {
  const { disagreementNote, assumptionVariants } = await import('../js/ui/trade-helpers.js');
  assert.equal(disagreementNote({ confidence: { cv: 0.2 }, groupValues: { market: 8000, consensus: 6000 } }), null);
  const n = disagreementNote({ confidence: { cv: 0.4 }, groupValues: { market: 8000, consensus: 6000, projection: null } }, { market: 'Market' });
  assert.match(n.title, /Market 8000 · consensus 6000/);
  for (const mode of ['redraft', 'dynasty']) {
    const vs = assumptionVariants(mode);
    assert.equal(vs.length, 3);
    for (const v of vs) assert.ok(v.overrides[mode].weights);
  }
});
