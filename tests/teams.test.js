// My Team saved teams (js/ui/state.js): several teams per league, active team per league, migration of the old one-
// roster-per-league storage, relinking when a preset is copied. Browser storage is faked; no server (offline path).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const S = await import('../js/ui/state.js');
const league = (id) => ({ id, name: id });

beforeEach(async () => { store.clear(); S.app.teams = []; });

test('legacy per-league rosters migrate once into named teams; the old keys stay', async () => {
  store.set('ffta.myteam.lgA', JSON.stringify({ ids: ['P1', 'P2'], source: 'sleeper', team_name: 'Gridiron Gang' }));
  store.set('ffta.myteam.lgB', JSON.stringify({ ids: ['P3'] }));
  store.set('ffta.myteam.lgC', JSON.stringify({ ids: [] })); // empty: nothing to migrate
  store.set('ffta.myteam.bad', '{not json');
  await S.initTeams();
  const names = S.allTeams().map((t) => [t.profileId, t.name, t.ids.join()]).sort();
  assert.deepEqual(names, [['lgA', 'Gridiron Gang', 'P1,P2'], ['lgB', 'My team', 'P3']]);
  assert.ok(store.has('ffta.myteam.lgA'), 'legacy data kept');
  assert.deepEqual(S.myRoster(league('lgA')).ids, ['P1', 'P2']);
  // A second start does not migrate again (a deleted team must not come back).
  S.deleteTeam(S.teamsFor(league('lgB'))[0].id);
  await S.initTeams();
  assert.equal(S.teamsFor(league('lgB')).length, 0);
});

test('several teams per league: create, switch, update the active one, delete', async () => {
  await S.initTeams();
  const L = league('lg1');
  assert.deepEqual(S.myRoster(L), { ids: [] });
  S.saveMyRoster(['A', 'B'], { source: 'manual' }, L); // first save creates the league's first team
  const first = S.activeTeam(L);
  assert.equal(first.name, 'My team');
  const second = S.createTeam({ name: 'Dynasty squad', ids: ['C'] }, L);
  assert.equal(S.activeTeam(L).id, second.id, 'a new team becomes active');
  assert.deepEqual(S.myRoster(L).ids, ['C']);
  S.saveMyRoster(['C', 'D'], {}, L);
  assert.deepEqual(S.teamsFor(L).find((t) => t.id === second.id).ids, ['C', 'D']);
  assert.deepEqual(S.teamsFor(L).find((t) => t.id === first.id).ids, ['A', 'B'], 'the other team is untouched');
  S.setActiveTeam(first.id, L);
  assert.deepEqual(S.myRoster(L).ids, ['A', 'B']);
  assert.equal(S.teamsFor(league('other')).length, 0, 'teams belong to their league');
  S.deleteTeam(first.id);
  assert.equal(S.activeTeam(L).id, second.id, 'falls back to the remaining team');
  assert.deepEqual(JSON.parse(store.get('ffta.teams')).map((t) => t.name), ['Dynasty squad'], 'persisted');
});

test('relinkTeams moves a preset\'s teams (and its active choice) to the copied profile', async () => {
  await S.initTeams();
  const P = league('preset_x');
  const a = S.createTeam({ name: 'One' }, P);
  S.createTeam({ name: 'Two' }, P);
  S.setActiveTeam(a.id, P);
  S.relinkTeams('preset_x', 'user_copy');
  assert.equal(S.teamsFor(P).length, 0);
  assert.deepEqual(S.teamsFor(league('user_copy')).map((t) => t.name).sort(), ['One', 'Two']);
  assert.equal(S.activeTeam(league('user_copy')).id, a.id);
});

test('stored teams with a bad shape are ignored', async () => {
  store.set('ffta.teams', JSON.stringify([{ id: 't1', name: 'ok', profileId: 'p', ids: ['X'] }, { id: 't2', ids: 'nope' }, null, 'x']));
  await S.initTeams();
  assert.deepEqual(S.allTeams().map((t) => t.id), ['t1']);
});
