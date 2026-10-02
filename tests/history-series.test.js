// Trends tab: model values from different model versions must not be compared (handoff bug #3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelBoundaries, modelMarkers, windowDelta, currentModelStart } from '../js/ui/history-series.js';

const DAY = 864e5;
const t0 = Date.UTC(2026, 8, 1);
const entries = [
  { t: new Date(t0).toISOString(), model_version: '2.0.0' },
  { t: new Date(t0 + 10 * DAY).toISOString(), model_version: '2.0.0' },
  { t: new Date(t0 + 20 * DAY).toISOString(), model_version: '2.1.0' },
  { t: new Date(t0 + 25 * DAY).toISOString(), model_version: '2.1.0' },
];
const xs = entries.map((e) => Date.parse(e.t));

test('history: model boundaries and markers sit at the first entry of each new model version', () => {
  assert.deepEqual(modelBoundaries(entries), [2]);
  assert.deepEqual(modelMarkers(entries, xs), [{ x: xs[2], label: 'model 2.1.0' }]);
  assert.deepEqual(modelBoundaries(entries.slice(0, 2)), []);
  assert.deepEqual(modelBoundaries([{ t: 'a' }, { t: 'b', model_version: '1.0.0' }]), [1], 'entries without a version are their own segment');
  assert.deepEqual(currentModelStart(entries), { index: 2, t: entries[2].t, version: '2.1.0' });
  assert.equal(currentModelStart([]), null);
});

test('history: value change is measured within the current model version only', () => {
  const model = [1000, 1100, 600, 650]; // 1100 → 600 is the model upgrade, not a value move
  assert.equal(windowDelta(model, xs, entries, 30), 50, '30-day change starts at the first 2.1.0 point');
  assert.equal(windowDelta(model, xs, entries, 7), 50);
  assert.equal(windowDelta(model, xs, entries, 2), null, 'no earlier point inside the window');
  // A player who lost his value with the new model has no comparable earlier point.
  assert.equal(windowDelta([400, 410, null, null], xs, entries, 30), null);
  assert.equal(windowDelta([400, 410, 0, 0], xs, entries, 30), 0);
});

test('history: raw source series (market) are compared across model versions', () => {
  const market = [5000, 5100, 5200, 5300];
  assert.equal(windowDelta(market, xs, entries, 30, { sameModelOnly: false }), 300);
  assert.equal(windowDelta(market, xs, entries, 30), 100);
});
