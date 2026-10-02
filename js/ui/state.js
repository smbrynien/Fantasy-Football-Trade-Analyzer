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
export function load(key, fallback) {
  try { const v = localStorage.getItem(`ffta.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
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
  app.userProfiles = load('profiles', []);
  if (hasServer()) {
    try {
      const remote = (await api.get('/api/profiles')).profiles || [];
      const byId = new Map(app.userProfiles.map((p) => [p.id, p]));
      for (const r of remote) {
        const l = byId.get(r.id);
        if (!l || (r.updated_at || '') > (l.updated_at || '')) byId.set(r.id, r);
      }
      app.userProfiles = [...byId.values()];
    } catch { /* offline */ }
  }
  app.mode = load('mode', 'redraft');
  app.profileId = load(`profile.${app.mode}`, null);
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
  app.mode = mode;
  save('mode', mode);
  const remembered = load(`profile.${mode}`, null);
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
