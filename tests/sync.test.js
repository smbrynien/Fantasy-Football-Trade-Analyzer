// Sync engine with fake adapters in an isolated data directory.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTestConfig } from './fixtures/make-dataset.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffta-sync-'));
process.env.FFTA_DATA_DIR = tmp;
const { runSync, rebuild } = await import('../server/sync-engine.js');
const { P } = await import('../server/lib/paths.js');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const PLAYERS = Array.from({ length: 40 }, (_, i) => ({ name: `Fake Player ${i + 1}`, position: ['QB', 'RB', 'WR', 'TE'][i % 4], team: 'DET', birth_date: '2000-01-01', ids: { sleeper: `s${i}` } }));
const behaviour = { schemaBroken: false, flakyFails: true };

function adapterFactory(source) {
  const market = () => ({ records: PLAYERS.map((p, i) => ({ name: p.name, position: p.position, team: p.team, ids: p.ids, dynasty: true, qb: '1qb', ppr: 1, teams: 12, value: 5000 - i * 100 })), schema: { expected: { required: ['value'] }, received: behaviour.schemaBroken ? ['val'] : ['value'] }, minRecords: 10 });
  const impl = {
    fake_players: { fetchPlayers: async () => ({ records: PLAYERS, minRecords: 10 }) },
    good: { fetchTradeValues: async () => market() },
    bad: { fetchTradeValues: async () => { throw new Error('HTTP 503 Service Unavailable'); } },
    partial: { fetchTradeValues: async () => market(), fetchRankings: async () => { throw new Error('rankings page moved'); } },
    flaky: { fetchTradeValues: async () => { if (behaviour.flakyFails) throw new Error('timeout'); return market(); } },
    backup_stats: { fetchStats: async () => ({ records: PLAYERS.slice(0, 5).map((p) => ({ name: p.name, position: p.position, team: p.team, ids: p.ids, season: 2026, week: 1, stats: { rec: 5, rec_yd: 50 }, usage: {} })) }) },
  }[source.id];
  return impl || null;
}

function makeConfig() {
  const c = loadTestConfig({ calibration: false });
  const src = (id, types, extra = {}) => ({ id, name: id, adapter: id, enabled: true, priority: 'primary', method: 'api', data_types: types, update_frequency_hours: 24, independence_group: id, ...extra });
  c.sources = {
    ...c.sources,
    exclusive_data_types: { stat_week: ['primary_stats', 'backup_stats'], schedule: [], state: [], injury_official: [], injury_reported: [] },
    authoritative_player_sources: { order: ['fake_players'], team_authority: null },
    sources: [src('fake_players', ['player']), src('good', ['market_value']), src('bad', ['market_value']), src('partial', ['market_value', 'ranking']), src('flaky', ['market_value']), src('backup_stats', ['stat_week']), src('primary_stats', ['stat_week'])],
  };
  return c;
}
const state = { season: 2026, week: 2, season_type: 'regular' };
let first;

before(async () => {
  first = await runSync({ config: makeConfig(), state, adapterFactory, force: true });
});

test('successful + failed + partial sources: one failure never blocks the rest', () => {
  assert.equal(first.results.good.status, 'ok');
  assert.equal(first.results.bad.status, 'error');
  assert.match(first.results.bad.error, /503/);
  assert.equal(first.results.partial.status, 'partial');
  assert.equal(first.results.primary_stats.status, 'error'); // no adapter registered
  assert.ok(first.build && first.build.players > 0, 'dataset still built');
  const status = read(P.sourceStatus);
  assert.equal(status.bad.status, 'error');
  assert.ok(status.good.last_success);
  assert.equal(status.bad.last_success, null);
});

test('exclusive data type fails over to the secondary source and records the substitution', () => {
  const ds = read(P.dataset);
  assert.equal(ds.meta.stats_source, 'backup_stats');
  assert.ok(ds.meta.substitutions.some((s) => s.type === 'stat_week' && s.used === 'backup_stats'));
  assert.ok(ds.players.some((p) => p.weekly.length));
});

test('retry failed sources only re-runs failing sources', async () => {
  behaviour.flakyFails = false;
  const s = await runSync({ config: makeConfig(), state, adapterFactory, failedOnly: true });
  assert.ok(!('good' in s.results));
  assert.equal(s.results.flaky.status, 'ok');
  assert.equal(s.results.bad.status, 'error');
});

test('fresh sources are skipped unless forced', async () => {
  const s = await runSync({ config: makeConfig(), state, adapterFactory });
  assert.equal(s.results.good.status, 'skipped');
  const f = await runSync({ config: makeConfig(), state, adapterFactory, force: true, sources: ['good'] });
  assert.equal(f.results.good.status, 'ok');
});

test('schema change → batch quarantined, previous good data retained', async () => {
  const before = read(P.normalizedFile('good', 'market_value'));
  behaviour.schemaBroken = true;
  const s = await runSync({ config: makeConfig(), state, adapterFactory, force: true, sources: ['good'] });
  behaviour.schemaBroken = false;
  assert.equal(s.results.good.status, 'quarantined');
  const after = read(P.normalizedFile('good', 'market_value'));
  assert.equal(after.fetched_at, before.fetched_at);
  const q = read(P.quality);
  const good = q.sources.find((x) => x.id === 'good');
  assert.ok(good.types.market_value.quarantined);
});

test('stale data is flagged when last success is old', async () => {
  const status = read(P.sourceStatus);
  status.good.last_success = new Date(Date.now() - 10 * 864e5).toISOString();
  fs.writeFileSync(P.sourceStatus, JSON.stringify(status));
  await rebuild(makeConfig(), status, state);
  const ds = read(P.dataset);
  assert.equal(ds.sources.good.stale, true);
  assert.equal(ds.sources.fake_players.stale, false);
});

test('snapshots and history are written for every build', () => {
  const snaps = fs.readdirSync(P.snapshots).filter((f) => f.endsWith('.json.gz'));
  assert.ok(snaps.length >= 2);
  const h = read(P.history);
  assert.ok(h.entries.length >= 1);
});
