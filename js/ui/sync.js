// Sync controller shared by the header button and the Data dashboard.

import { api, hasServer, loadDataset } from './api.js';
import { app, emit, setDataset } from './state.js';
import { toast } from './dom.js';
import { activeLeague } from './state.js';

let polling = null;

export async function refreshStatus() {
  if (!hasServer()) { app.status = null; emit('status'); return null; }
  try { app.status = await api.get('/api/status'); } catch { app.status = null; }
  emit('status');
  return app.status;
}

function formatsForSync() {
  // Ask the market adapter for the active league's format as well as the defaults.
  const l = activeLeague();
  const ppr = (app.config.leagueDefaults.scoring_presets[l.scoring_preset] || {}).rec ?? 1;
  return [true, false].map((dynasty) => ({ dynasty, qb_format: l.qb_format, ppr: l.scoring?.rec ?? ppr, teams: l.teams }));
}

export async function startSync(opts = {}) {
  if (!hasServer()) {
    toast('The sync server is not running. Start it with "npm start" (the app is in read-only mode).', 'bad', 7000);
    return;
  }
  if (!navigator.onLine) toast('Your browser reports no internet connection — sources will likely fail; cached data stays in use.', 'warn', 6000);
  try {
    const r = await api.post('/api/sync', { ...opts, formats: formatsForSync() });
    if (r.already_running) toast('A sync is already running.', 'warn');
  } catch (e) {
    toast(`Could not start sync: ${e.message}`, 'bad');
    return;
  }
  app.syncing = true;
  emit('sync-progress', { running: true, phase: 'starting', sources: {} });
  pollProgress();
}

function pollProgress() {
  clearTimeout(polling);
  polling = setTimeout(async () => {
    let p;
    try { p = await api.get('/api/sync/progress'); } catch (e) { p = { running: false, error: e.message }; }
    emit('sync-progress', p);
    if (p.running) return pollProgress();
    app.syncing = false;
    await refreshStatus();
    try {
      const ds = await loadDataset();
      if (ds) setDataset(ds);
    } catch (e) { toast(`Dataset reload failed: ${e.message}`, 'bad'); }
    if (p.phase === 'failed' || (p.error && !p.summary)) { toast(`Sync failed: ${p.error || 'unknown error'}. Previous data is still in use.`, 'bad', 8000); return; }
    const s = p.summary;
    if (s) {
      const msg = `Sync finished: ${s.succeeded} ok${s.partial ? `, ${s.partial} partial` : ''}${s.failed ? `, ${s.failed} failed` : ''}${s.skipped ? `, ${s.skipped} fresh/skipped` : ''}.`;
      toast(s.build_error ? `${msg} Build error: ${s.build_error}` : msg, s.failed || s.build_error ? 'warn' : 'ok', 6000);
    }
  }, 700);
}

/** Resume polling if a sync was already running when the page loaded. */
export function resumeIfRunning() {
  if (app.status && app.status.sync_running) { app.syncing = true; pollProgress(); }
}
