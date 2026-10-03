// Trade-page wording and share-link helpers (usability audit). Pure functions over analyzeTrade() output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadText, verdictHeadline, marketCheck, tradeFromHash, tradeHash } from '../js/ui/trade-helpers.js';

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
