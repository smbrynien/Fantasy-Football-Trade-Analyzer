// Sync engine with fake adapters in an isolated data directory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTestConfig } from './fixtures/make-dataset.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffta-sync-'));
process.env.FFTA_DATA_DIR = tmp;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
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

test('concurrent rebuilds are serialized and all succeed (BUG_AUDIT B1)', async () => {
  const before = read(P.history).entries.length;
  const results = await Promise.allSettled([rebuild(), rebuild(), rebuild()]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled'], results.map((r) => r.reason?.message).join(' | '));
  const h = read(P.history);
  const versions = h.entries.map((e) => e.data_version);
  assert.equal(new Set(versions).size, versions.length, 'no duplicate history entries');
  assert.ok(h.entries.length - before <= 1);
  for (const s of Object.values(h.series)) assert.equal(s.r.length, h.entries.length, 'every series aligned with entries');
});

test('atomic writes: concurrent writes to one file never fail and leave no temp files (BUG_AUDIT B1)', async () => {
  const { writeJSON } = await import('../server/lib/store.js');
  const f = path.join(tmp, 'race', 'x.json');
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeJSON(f, { i })));
  assert.ok(Number.isInteger(read(f).i));
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['x.json']);
});

test('corrupt state/normalized files are moved aside, not fatal; sync and status recover (BUG_AUDIT C2)', async () => {
  const { recoveredFiles } = await import('../server/lib/store.js');
  fs.writeFileSync(P.sourceStatus, '{corrupt');
  fs.writeFileSync(P.normalizedFile('good', 'market_value'), '{"records": [');
  const s = await runSync({ config: makeConfig(), state, adapterFactory, sources: ['good'] });
  assert.equal(s.results.good.status, 'ok', 'the source refetched and stored fresh data');
  assert.ok(s.build, 'dataset rebuilt');
  assert.ok(read(P.sourceStatus).good.last_success, 'status file rewritten');
  const moved = recoveredFiles.map((r) => path.basename(r.file));
  assert.ok(moved.includes('sources-status.json') && moved.includes('market_value.json'), moved.join(','));
  for (const r of recoveredFiles) assert.ok(fs.existsSync(r.moved_to), 'corrupt bytes kept, not deleted');
});

test('a sync that fails early reports failure instead of the previous run\'s success (BUG_AUDIT C1)', async () => {
  const { syncProgress } = await import('../server/sync-engine.js');
  const bad = makeConfig();
  bad.sources = null; // provoke an exception before any source runs
  await assert.rejects(runSync({ config: bad, state, adapterFactory }));
  const p = syncProgress();
  assert.equal(p.running, false);
  assert.equal(p.phase, 'failed');
  assert.ok(p.error);
  assert.equal(p.summary, null, 'no stale summary from the previous run');
});

test('season transitions: offseason state projects the upcoming season (BUG_AUDIT D1)', async () => {
  const { normalizeNflState, calendarNflState } = await import('../server/sync-engine.js');
  const { computePhase } = await import('../js/core/settings.js');
  const model = loadTestConfig().model;
  // Sleeper's documented offseason shape: season = completed season, league_season = upcoming.
  assert.equal(normalizeNflState({ season: '2026', league_season: '2027', week: 0, season_type: 'off' }).season, 2027);
  assert.equal(normalizeNflState({ season: '2027', league_season: '2027', week: 0, season_type: 'pre' }).season, 2027);
  assert.equal(normalizeNflState({ season: '2026', league_season: '2027', week: 5, season_type: 'regular' }).season, 2026, 'in season: untouched');
  assert.equal(normalizeNflState({ season: '2026', week: 0, season_type: 'off' }).season, 2026, 'no league_season: untouched');
  // Simulated year: end of 2026 season → 2027 offseason → 2027 preseason → 2027 regular season.
  const target = (st) => { const ph = computePhase(st, model); return ph.phase === 'postseason' || ph.phase === 'offseason' ? ph.season + 1 : ph.season; };
  const steps = [['2027-01-20', 2027], ['2027-02-20', 2027], ['2027-05-01', 2027], ['2027-08-20', 2027]];
  for (const [d, want] of steps) assert.equal(target(calendarNflState(new Date(`${d}T12:00:00Z`))), want, `calendar ${d}`);
  assert.equal(target(normalizeNflState({ season: '2026', league_season: '2027', week: 0, season_type: 'off' })), 2027);
  assert.equal(target({ season: 2027, week: 3, season_type: 'regular' }), 2027);
});

test('stored batches exclude invalid values, outliers and duplicates; empty responses are named (BUG_AUDIT SY1/SY2)', async () => {
  const { cleanBatch, assessBatch } = await import('../js/core/quality.js');
  const base = Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, position: 'WR', dynasty: true, qb: '1qb', value: 5000 - i * 100 }));
  const dirty = [...base, { name: 'X1', position: 'WR', dynasty: true, qb: '1qb', value: NaN }, { name: 'X2', position: 'WR', dynasty: true, qb: '1qb', value: 'abc' },
    { name: 'X3', position: 'WR', dynasty: true, qb: '1qb', value: -50 }, { name: 'X4', position: 'WR', dynasty: true, qb: '1qb', value: 1e300 }, { ...base[0], value: 1 }];
  const c = cleanBatch('market_value', dirty);
  assert.deepEqual(c.dropped, { invalid: 4, duplicates: 1 });
  assert.equal(c.records.find((r) => r.name === 'P0').value, 5000, 'first of a duplicate pair is kept');
  assert.ok(c.records.every((r) => Number.isFinite(r.value) && r.value >= 0 && r.value < 1e6));
  // the same rule decides the verdict and what is stored
  assert.equal(assessBatch({ type: 'market_value', records: dirty }).counts.invalid, 4);
  // rankings/ADP: non-positive or non-finite ranks are invalid
  assert.equal(cleanBatch('ranking', [{ name: 'a', rank: 0 }, { name: 'b', rank: Infinity }, { name: 'c', rank: 3 }]).records.length, 1);
  const empty = assessBatch({ type: 'market_value', records: [], schema: { expected: { required: ['value'] }, received: [] }, minRecords: 10 });
  assert.equal(empty.verdict, 'quarantine');
  assert.ok(empty.issues.some((i) => i.code === 'no_records') && !empty.issues.some((i) => i.code === 'schema_changed'));
});

test('rebuilding identical inputs never adds a duplicate snapshot of the same data version (BUG_AUDIT 2, SY5)', async () => {
  await rebuild();
  const count = () => fs.readdirSync(P.snapshots).filter((f) => f.endsWith('.json.gz'));
  const before = count();
  await rebuild(); await rebuild();
  const after = count();
  assert.equal(after.length, before.length, `${before.length} → ${after.length}`);
  const versions = after.map((f) => f.split('__')[1]);
  assert.equal(new Set(versions).size, versions.length, 'one snapshot per data version');
});

test('a status written while a sync runs (e.g. a manual import) survives the sync (BUG_AUDIT 2, SY6)', async () => {
  const { updateJSON } = await import('../server/lib/store.js');
  const slowFactory = (source) => {
    const impl = adapterFactory(source);
    if (source.id !== 'good' || !impl) return impl;
    return { fetchTradeValues: async () => { await new Promise((r) => setTimeout(r, 300)); return impl.fetchTradeValues(); } };
  };
  const run = runSync({ config: makeConfig(), state, adapterFactory: slowFactory, force: true, sources: ['good'] });
  await new Promise((r) => setTimeout(r, 100)); // the sync has read the status file and is fetching
  await updateJSON(P.sourceStatus, {}, (s) => ({ ...s, manual_test: { status: 'ok', method: 'manual', last_success: new Date().toISOString() } }), { pretty: true });
  await run;
  const status = read(P.sourceStatus);
  assert.equal(status.manual_test?.status, 'ok', 'the import status written mid-sync is kept');
  assert.equal(status.good.status, 'ok');
});
