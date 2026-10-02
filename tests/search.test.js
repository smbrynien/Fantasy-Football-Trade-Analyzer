// Asset search (BUG_AUDIT SR1–SR3). The UI module is DOM-free at import time, so it runs in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValuations, getAsset } from '../js/core/valuation/engine.js';
import { buildSearchIndex, searchAssets } from '../js/ui/search.js';
import { makeDataset, loadTestConfig, readConfig } from './fixtures/make-dataset.js';

const config = loadTestConfig();
const presets = readConfig('profiles.json').presets;
const ds = makeDataset();
const twin = JSON.parse(JSON.stringify(ds.players.find((p) => p.cid === 'TRB2')));
Object.assign(twin, { cid: 'KW3', name: 'Kenneth Walker III', team: 'MIN', ids: {} });
const mins = JSON.parse(JSON.stringify(ds.players.find((p) => p.cid === 'TQB20')));
Object.assign(mins, { cid: 'GM1', name: 'Gardner Minshew', team: 'ARI', ids: {} });
ds.players.push(twin, mins);
const r = computeValuations({ dataset: ds, league: presets.find((p) => p.id === 'preset_dyn_12_1qb'), mode: 'dynasty', config });
r.getAsset = (id) => getAsset(r, id);
const idx = buildSearchIndex(r);
const names = (q, o = {}) => searchAssets(idx, q, { result: r, limit: 40, ...o }).map((a) => a.name);

test('search: a parsed pick and its index entry appear once (BUG_AUDIT SR1)', () => {
  for (const q of ['1.04', `${r.picks.upcoming} 1st`, `${r.picks.upcoming} 1.04`]) {
    const ids = searchAssets(idx, q, { result: r }).map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, q);
  }
});

test('search: name suffixes in the query are ignored (BUG_AUDIT SR2)', () => {
  for (const q of ['walker iii', 'Kenneth Walker III', 'walker iii.', 'kenneth walker']) assert.ok(names(q).includes('Kenneth Walker III'), q);
});

test('search: a team code also matches names while typing; positions stay strict (BUG_AUDIT SR3)', () => {
  assert.ok(names('min').includes('Gardner Minshew'), 'name prefix');
  assert.ok(names('min').includes('Kenneth Walker III'), 'team MIN');
  assert.ok(names('qb').every((n) => r.assets.get(searchAssets(idx, 'qb', { result: r, limit: 40 }).find((a) => a.name === n).id).position === 'QB'));
  assert.deepEqual(names(''), []);
  assert.deepEqual(names('zzzz'), []);
  assert.deepEqual(names('<script>'), []);
});
