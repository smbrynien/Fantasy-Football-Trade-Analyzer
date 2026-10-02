// Adapter normalization tests with stubbed HTTP responses (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EspnAdapter, ESPN_UNDRAFTED_ADP } from '../adapters/espn.js';

const espnPlayer = (id, name, adp) => ({ player: { id, fullName: name, defaultPositionId: 3, proTeamId: 0, ownership: { averageDraftPosition: adp, percentOwned: 50 }, stats: [] } });

test('ESPN ADP: values at the undrafted default (≈170) are collapsed to one tie, real ADP is kept', async () => {
  const players = [
    espnPlayer(1, 'Early Pick', 12.4), espnPlayer(2, 'Late Pick', 165.1), espnPlayer(3, 'Rarely Drafted', 168.8),
    espnPlayer(4, 'Near Default', 169.2), espnPlayer(5, 'Undrafted', 169.98), espnPlayer(6, 'Over Default', 170.24),
    espnPlayer(7, 'No ADP', 0),
  ];
  const adapter = new EspnAdapter({ id: 'espn' }, { http: { json: async () => ({ players }) }, state: { season: 2026, week: 4, season_type: 'regular' } });
  const { records } = await adapter.fetchADP();
  const by = Object.fromEntries(records.map((r) => [r.name, r]));
  assert.equal(records.length, 6);
  assert.deepEqual([by['Early Pick'].adp, by['Late Pick'].adp, by['Rarely Drafted'].adp], [12.4, 165.1, 168.8]);
  for (const n of ['Near Default', 'Undrafted', 'Over Default']) {
    assert.equal(by[n].adp, ESPN_UNDRAFTED_ADP);
    assert.equal(by[n].undrafted, true);
  }
  assert.equal(by['Late Pick'].undrafted, false);
});
