// Player identity resolution and canonical player DB maintenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerIndex, PlayerStore, canonicalIdFor } from '../js/core/identity.js';
import { nameKey } from '../js/core/util/names.js';
import { normalizeTeam } from '../js/core/util/teams.js';
import { normalizePosition } from '../js/core/util/positions.js';

const base = [
  { cid: 'P1', name: 'Kenneth Walker III', position: 'RB', positions: ['RB'], team: 'KC', birth_date: '2000-10-20', ids: { sleeper: '8151', gsis: '00-1' }, aliases: [] },
  { cid: 'P2', name: 'Mike Williams', position: 'WR', positions: ['WR'], team: 'NYJ', birth_date: '1994-10-04', ids: { sleeper: '4068' }, aliases: [] },
  { cid: 'P3', name: 'Mike Williams', position: 'WR', positions: ['WR'], team: 'PIT', birth_date: '1999-01-01', ids: { sleeper: '9999' }, aliases: [] },
  { cid: 'P4', name: 'Gabriel Davis', position: 'WR', positions: ['WR'], team: 'BUF', ids: { espn: '4241' }, aliases: [] },
  { cid: 'P5', name: 'D.K. Metcalf', position: 'WR', positions: ['WR'], team: 'PIT', ids: {}, aliases: [] },
  { cid: 'DEF_DET', name: 'DET Defense', position: 'DEF', positions: ['DEF'], team: 'DET', ids: {}, aliases: [] },
];

test('normalizers', () => {
  assert.equal(nameKey('Kenneth Walker III'), 'kenneth walker');
  assert.equal(nameKey("Amon-Ra St. Brown"), 'amonra st brown');
  assert.equal(normalizeTeam('JAC'), 'JAX');
  assert.equal(normalizeTeam('LVR'), 'LV');
  assert.equal(normalizeTeam(null), 'FA');
  assert.equal(normalizeTeam('XYZ'), null);
  assert.equal(normalizePosition('D/ST'), 'DEF');
  assert.equal(normalizePosition('WR12'), 'WR');
});

test('exact match by external ID beats a different name', () => {
  const idx = new PlayerIndex(base);
  const r = idx.resolve({ name: 'Ken Walker', position: 'RB', ids: { sleeper: '8151' } });
  assert.equal(r.status, 'matched');
  assert.equal(r.cid, 'P1');
  assert.match(r.method, /^id:/);
  assert.ok(r.flags.includes('name_differs'));
});

test('name match handles suffixes, punctuation and nicknames', () => {
  const idx = new PlayerIndex(base);
  assert.equal(idx.resolve({ name: 'Kenneth Walker', position: 'RB' }).cid, 'P1');
  assert.equal(idx.resolve({ name: 'DK Metcalf', position: 'WR' }).cid, 'P5');
  assert.equal(idx.resolve({ name: 'Gabe Davis', position: 'WR' }).cid, 'P4');
});

test('team change is flagged, not rejected', () => {
  const idx = new PlayerIndex(base);
  const r = idx.resolve({ name: 'Kenneth Walker III', position: 'RB', team: 'SEA' });
  assert.equal(r.cid, 'P1');
  assert.ok(r.flags.includes('team_differs'));
});

test('ambiguous duplicate names are never merged; team disambiguates', () => {
  const idx = new PlayerIndex(base);
  const amb = idx.resolve({ name: 'Mike Williams', position: 'WR' });
  assert.equal(amb.status, 'ambiguous');
  assert.equal(amb.cid, null);
  assert.deepEqual(amb.candidates.sort(), ['P2', 'P3']);
  const r = idx.resolve({ name: 'Mike Williams', position: 'WR', team: 'PIT' });
  assert.equal(r.cid, 'P3');
});

test('conflicting IDs are reported as conflict', () => {
  const idx = new PlayerIndex(base);
  const r = idx.resolve({ name: 'X', ids: { sleeper: '8151', espn: '4241' } });
  assert.equal(r.status, 'conflict');
});

test('unknown players are unmatched; overrides map or ignore records', () => {
  const idx = new PlayerIndex(base, { overrides: { 'ktc|name:mike williams|WR': 'P2', 'ktc|name:nobody special|WR': 'IGNORE' } });
  assert.equal(idx.resolve({ name: 'Totally Unknown', position: 'QB' }).status, 'unmatched');
  assert.equal(idx.resolve({ name: 'Mike Williams', position: 'WR' }, { source: 'ktc' }).cid, 'P2');
  assert.equal(idx.resolve({ name: 'Nobody Special', position: 'WR' }, { source: 'ktc' }).status, 'ignored');
});

test('team defenses resolve by team', () => {
  const idx = new PlayerIndex(base);
  assert.equal(idx.resolve({ name: 'Detroit Lions', position: 'DST', team: 'DET' }).cid, 'DEF_DET');
});

test('PlayerStore: rookie creation, ID enrichment, team change event, multi-position, no ambiguous merge', () => {
  const store = new PlayerStore([], { teamAuthority: 'sleeper' });
  const a = store.upsert({ name: 'New Rookie', position: 'WR', team: 'DAL', birth_date: '2004-01-01', draft: { year: 2026, round: 1, pick: 10 }, ids: { gsis: '00-9' } }, 'nflverse');
  assert.equal(a.action, 'created');
  assert.equal(a.cid, canonicalIdFor({ gsis: '00-9' }, 'WR', 'DAL'));
  const b = store.upsert({ name: 'New Rookie', position: 'WR', team: 'NYG', ids: { gsis: '00-9', sleeper: '123' }, positions: ['WR', 'RB'] }, 'sleeper');
  assert.equal(b.cid, a.cid);
  const p = store.index.get(a.cid);
  assert.equal(p.ids.sleeper, '123');
  assert.equal(p.team, 'NYG');
  assert.ok(store.events.some((e) => e.type === 'team_change'));
  assert.ok(store.events.some((e) => e.type === 'multi_position'));
  // same name, different birth date, no shared IDs → separate player (never silently merged)
  const c = store.upsert({ name: 'New Rookie', position: 'WR', team: 'NYG', birth_date: '1999-02-02', ids: { espn: '777' } }, 'dynastyprocess_ids');
  assert.equal(c.action, 'created');
  assert.notEqual(c.cid, a.cid);
});

// BUG_AUDIT ID1/ID2: a name match must never override contradicting identity evidence in the record itself.
test('identity: a unique name match that contradicts birth date / age / draft year stays unmatched (BUG_AUDIT ID1)', () => {
  const ix = new PlayerIndex([{ cid: 'P_OLD', name: 'Mike Williams', position: 'WR', team: 'FA', birth_date: '1994-10-04', draft: { year: 2017 }, ids: {}, aliases: [] }]);
  for (const rec of [{ birth_date: '2003-05-01' }, { age: 22 }, { draft_year: 2025 }]) {
    const r = ix.resolve({ name: 'Mike Williams', position: 'WR', team: 'NYJ', ...rec });
    assert.equal(r.status, 'unmatched', JSON.stringify(rec));
    assert.ok(r.flags.includes('identity_conflict'));
    assert.deepEqual(r.candidates, ['P_OLD'], 'candidate offered for manual review');
  }
  // consistent evidence (incl. date formats and a 1-day source discrepancy) still matches
  for (const rec of [{}, { birth_date: '1994-10-04T00:00:00Z' }, { birth_date: '1994-10-05' }, { age: 31.5 }, { draft_year: 2017 }]) {
    assert.equal(ix.resolve({ name: 'Mike Williams', position: 'WR', ...rec }).cid, 'P_OLD', JSON.stringify(rec));
  }
});

test('identity: birth date outranks team when disambiguating same-name players (BUG_AUDIT ID2)', () => {
  const ix = new PlayerIndex([
    { cid: 'P_A', name: 'Chris Jones', position: 'RB', team: 'DEN', birth_date: '1995-01-01', ids: {}, aliases: [] },
    { cid: 'P_B', name: 'Chris Jones', position: 'RB', team: 'NYG', birth_date: '2001-01-01', ids: {}, aliases: [] },
  ]);
  assert.equal(ix.resolve({ name: 'Chris Jones', position: 'RB', team: 'DEN', birth_date: '2001-01-01' }).cid, 'P_B', 'traded player found by birth date');
  assert.equal(ix.resolve({ name: 'Chris Jones', position: 'RB', team: 'DEN' }).cid, 'P_A');
  assert.equal(ix.resolve({ name: 'Chris Jones', position: 'RB', team: 'KC' }).status, 'ambiguous', 'no evidence → never guessed');
  assert.equal(ix.resolve({ name: 'Chris Jones', position: 'RB', team: 'DEN', birth_date: '1999-09-09' }).status, 'unmatched', 'contradicts both');
});

test('identity: fuzzy matching also refuses contradicting birth dates (BUG_AUDIT ID1)', () => {
  const ix = new PlayerIndex([{ cid: 'P1', name: 'Marquise Brown', position: 'WR', team: 'KC', birth_date: '1997-06-04', ids: {}, aliases: [] }]);
  assert.equal(ix.resolve({ name: 'Marquis Brown', position: 'WR', team: 'KC' }).cid, 'P1');
  assert.notEqual(ix.resolve({ name: 'Marquis Brown', position: 'WR', team: 'KC', birth_date: '2004-01-01' }).status, 'matched');
});
