// Application state: config, dataset, mode, league profiles, valuation cache, persisted UI preferences.

import { computeValuations } from '../core/valuation/engine.js';
import { buildLeague } from '../core/settings.js';
import { stableHash, deepClone } from '../core/util/objects.js';
import { api, hasServer } from './api.js';

export const app = {
  config: null,
  dataset: null,
  status: null,
  mode: 'redraft',
  profileId: null,
  userProfiles: [],
  listeners: new Set(),
  cache: new Map(),
};

// ---------- persistence (browser storage is a convenience only; always guarded) ----------
/**
 * Read a persisted UI value. `valid(v)` (optional) checks its shape: stored state can be malformed (older versions,
 * manual edits, another tab) and used to crash views permanently — a non-array trade side broke the Trade page on every
 * visit until site data was cleared. Invalid values fall back.
 */
export function load(key, fallback, valid) {
  try {
    const raw = localStorage.getItem(`ffta.${key}`);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return valid && !valid(v) ? fallback : v;
  } catch { return fallback; }
}
export const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
export const isProfile = (p) => Boolean(p) && typeof p === 'object' && !Array.isArray(p) && typeof p.id === 'string';
export const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export function save(key, value) {
  try { localStorage.setItem(`ffta.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function on(fn) { app.listeners.add(fn); return () => app.listeners.delete(fn); }
export function emit(evt, detail) { for (const fn of app.listeners) { try { fn(evt, detail); } catch (e) { console.error(e); } } }

// ---------- profiles ----------
export function builtinProfiles() { return app.config.profiles.presets.map((p) => ({ ...p, builtin: true })); }
export function allProfiles() { return [...app.userProfiles, ...builtinProfiles()]; }
export function activeProfile() {
  const preferred = app.mode === 'dynasty' ? 'preset_dyn_12_1qb' : 'preset_12_1qb_ppr';
  return allProfiles().find((p) => p.id === app.profileId) || builtinProfiles().find((p) => p.id === preferred) || builtinProfiles().find((p) => p.mode === app.mode) || builtinProfiles()[0];
}
export function activeLeague() { return buildLeague(activeProfile(), app.config.leagueDefaults); }

export async function initProfiles() {
  app.userProfiles = load('profiles', [], Array.isArray).filter(isProfile);
  if (hasServer()) {
    try {
      const remote = ((await api.get('/api/profiles')).profiles || []).filter(isProfile);
      const byId = new Map(app.userProfiles.map((p) => [p.id, p]));
      for (const r of remote) {
        const l = byId.get(r.id);
        if (!l || (r.updated_at || '') > (l.updated_at || '')) byId.set(r.id, r);
      }
      app.userProfiles = [...byId.values()];
    } catch { /* offline */ }
  }
  app.mode = load('mode', 'redraft', (m) => m === 'redraft' || m === 'dynasty');
  app.profileId = load(`profile.${app.mode}`, null, (v) => typeof v === 'string');
}

export async function persistProfiles() {
  save('profiles', app.userProfiles);
  if (hasServer()) { try { await api.put('/api/profiles', { profiles: app.userProfiles }); } catch { /* keep local */ } }
}

export function upsertUserProfile(p) {
  const copy = deepClone(p);
  delete copy.builtin;
  copy.updated_at = new Date().toISOString();
  const i = app.userProfiles.findIndex((x) => x.id === copy.id);
  if (i >= 0) app.userProfiles[i] = copy; else app.userProfiles.unshift(copy);
  persistProfiles();
  app.cache.clear();
  return copy;
}

export function deleteUserProfile(id) {
  app.userProfiles = app.userProfiles.filter((p) => p.id !== id);
  persistProfiles();
  if (app.profileId === id) setProfile(null);
}

export function setMode(mode) {
  if (mode === app.mode) return;
  // "How does this trade look in the other mode?" used to mean re-typing it: carry the trade over when the other
  // mode's trade is empty (players only — picks are valued in dynasty only). An existing trade there is never touched.
  const okTrade = (t) => isPlainObject(t) && isStringArray(t.a) && isStringArray(t.b);
  const from = load(`trade.${app.mode}`, { a: [], b: [] }, okTrade), to = load(`trade.${mode}`, { a: [], b: [] }, okTrade);
  app.carriedTrade = null;
  if (!to.a.length && !to.b.length && (from.a.length || from.b.length)) {
    const keep = (ids) => (mode === 'dynasty' ? ids : ids.filter((id) => !String(id).startsWith('pick:')));
    const t = { a: keep(from.a), b: keep(from.b) };
    if (t.a.length || t.b.length) {
      save(`trade.${mode}`, t);
      app.carriedTrade = { from: app.mode, droppedPicks: from.a.length + from.b.length - t.a.length - t.b.length };
    }
  }
  app.mode = mode;
  save('mode', mode);
  const remembered = load(`profile.${mode}`, null, (v) => typeof v === 'string');
  if (remembered && allProfiles().some((p) => p.id === remembered)) app.profileId = remembered;
  else {
    const cur = activeProfile();
    if (cur.mode && cur.mode !== mode && cur.builtin) app.profileId = null; // fall back to the mode's default preset
  }
  emit('mode');
}

export function setProfile(id) {
  app.profileId = id;
  save(`profile.${app.mode}`, id);
  emit('profile');
}

// ---------- valuations ----------
export function valuationConfig() {
  const c = app.config;
  return { model: c.model, leagueDefaults: c.leagueDefaults, sources: c.sources, calibration: c.calibration };
}

export function getValuations(mode = app.mode, profile = activeProfile(), dataset = app.dataset) {
  if (!dataset) return null;
  const key = `${mode}|${dataset.data_version}|${stableHash(profile)}`;
  if (app.cache.has(key)) return app.cache.get(key);
  const r = computeValuations({ dataset, league: profile, mode, config: valuationConfig() });
  if (app.cache.size > 12) app.cache.delete(app.cache.keys().next().value);
  app.cache.set(key, r);
  return r;
}

export function setDataset(ds) {
  app.dataset = ds;
  app.cache.clear();
  app.playerById = new Map((ds?.players || []).map((p) => [p.cid, p]));
  emit('dataset');
}

export function playerData(cid) { return app.playerById ? app.playerById.get(cid) : null; }

// ---------- My Team: saved teams, each linked to a league profile (browser storage + server copy; optional everywhere) ----------
// Several teams can be saved, like league profiles: one per league you play in, or several in leagues with the same
// settings. Each league remembers which of its teams is active; the Trade page uses that one. Before teams existed,
// every league profile had exactly one roster under `ffta.myteam.<profileId>`; those are migrated once (and kept).
const isTeam = (t) => isPlainObject(t) && typeof t.id === 'string' && isStringArray(t.ids) && typeof t.name === 'string';
const now = () => new Date().toISOString();
const newTeamId = () => `team_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
app.teams = [];

/** One team per legacy `ffta.myteam.<profileId>` roster (non-empty only). */
export function legacyTeams() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('ffta.myteam.')) continue;
      const profileId = key.slice('ffta.myteam.'.length);
      const r = load(`myteam.${profileId}`, null, (v) => isPlainObject(v) && isStringArray(v.ids));
      if (!r || !r.ids.length) continue;
      const { ids, source, sleeper_league, team_name, updated_at } = r;
      out.push({ id: `team_${profileId}`, name: typeof team_name === 'string' && team_name ? team_name : 'My team', profileId, ids, source: source ?? null, sleeper_league, team_name, updated_at: updated_at || now() });
    }
  } catch { /* storage unavailable */ }
  return out;
}

export async function initTeams() {
  let local = load('teams', null, Array.isArray);
  if (local === null) { local = legacyTeams(); save('teams', local); }
  const byId = new Map(local.filter(isTeam).map((t) => [t.id, t]));
  if (hasServer()) {
    try {
      for (const r of ((await api.get('/api/teams')).teams || []).filter(isTeam)) {
        const l = byId.get(r.id);
        if (!l || (r.updated_at || '') > (l.updated_at || '')) byId.set(r.id, r);
      }
    } catch { /* offline */ }
  }
  app.teams = [...byId.values()];
}

export async function persistTeams() {
  save('teams', app.teams);
  if (hasServer()) { try { await api.put('/api/teams', { teams: app.teams }); } catch { /* keep local */ } }
}

export function allTeams() { return app.teams; }
export function teamsFor(profile = activeProfile()) { return app.teams.filter((t) => t.profileId === profile.id); }
/** The league's active team: the one chosen last, else its first team, else none. */
export function activeTeam(profile = activeProfile()) {
  const list = teamsFor(profile);
  const id = load(`team.active.${profile.id}`, null, (v) => typeof v === 'string');
  return list.find((t) => t.id === id) || list[0] || null;
}
export function setActiveTeam(id, profile = activeProfile()) { save(`team.active.${profile.id}`, id); emit('team'); }

export function createTeam({ name = 'My team', ids = [], ...meta } = {}, profile = activeProfile()) {
  const t = { ...meta, id: newTeamId(), name: String(name).slice(0, 80) || 'My team', profileId: profile.id, ids: [...ids], updated_at: now() };
  app.teams.unshift(t);
  persistTeams();
  save(`team.active.${profile.id}`, t.id);
  emit('team');
  return t;
}
export function updateTeam(id, patch) {
  const t = app.teams.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch, { updated_at: now() });
  if (patch.ids) t.ids = [...patch.ids];
  persistTeams();
  return t; // no 'team' event: the view that edits a roster redraws itself (a full re-render would drop search focus)
}
export function deleteTeam(id) {
  app.teams = app.teams.filter((t) => t.id !== id);
  persistTeams();
  emit('team');
}
/** Move every team of one league profile to another (a built-in preset copied on its first edit takes its teams along). */
export function relinkTeams(fromProfileId, toProfileId) {
  let moved = 0;
  for (const t of app.teams) if (t.profileId === fromProfileId) { t.profileId = toProfileId; t.updated_at = now(); moved++; }
  if (!moved) return;
  const active = load(`team.active.${fromProfileId}`, null, (v) => typeof v === 'string');
  if (active) save(`team.active.${toProfileId}`, active);
  persistTeams();
}

/** The active team's roster for a league ({ids: []} when the league has no team) — what lineup impact uses. */
export function myRoster(profile = activeProfile()) { const t = activeTeam(profile); return t ? { ...t, ids: [...t.ids] } : { ids: [] }; }
/** Save the active team's roster; creates the league's first team when it has none. */
export function saveMyRoster(ids, meta = {}, profile = activeProfile()) {
  const t = activeTeam(profile);
  if (t) updateTeam(t.id, { ...meta, ids });
  else createTeam({ name: meta.team_name || 'My team', ...meta, ids }, profile);
}
