// Application bootstrap: load config + cached dataset, wire header controls, hash routing.

import { h, clear, timeAgo, toast } from './ui/dom.js';
import { detectServer, hasServer, loadConfig, loadDataset } from './ui/api.js';
import { app, on, initProfiles, setMode, setProfile, allProfiles, activeProfile, setDataset } from './ui/state.js';
import { refreshStatus, startSync, resumeIfRunning } from './ui/sync.js';
import { renderTrade } from './ui/views/trade.js';
import { renderPlayers } from './ui/views/players.js';
import { renderCompare } from './ui/views/compare.js';
import { renderRookies } from './ui/views/rookies.js';
import { renderData } from './ui/views/data.js';
import { renderSettings } from './ui/views/settings.js';
import { renderModel } from './ui/views/model.js';
import { openPlayer } from './ui/views/player-modal.js';
import { renderHelp } from './ui/views/help.js';

const VIEWS = { trade: renderTrade, players: renderPlayers, compare: renderCompare, rookies: renderRookies, data: renderData, settings: renderSettings, model: renderModel, help: renderHelp };
const viewEl = document.getElementById('view');
let current = null;
let cleanup = null;

function route() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0] || 'trade';
  const [name, ...rest] = hash.split('/');
  let view = VIEWS[name] ? name : 'trade';
  if (view === 'rookies' && app.mode !== 'dynasty') view = 'trade';
  if (name === 'player' && rest[0]) { openPlayer(decodeURIComponent(rest[0])); }
  current = { view, args: rest };
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  render();
}

function render() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  clear(viewEl);
  if (!app.config) return;
  if (!app.dataset && !['data', 'settings', 'model', 'help'].includes(current.view)) {
    viewEl.append(emptyState());
    return;
  }
  try {
    cleanup = VIEWS[current.view](viewEl, current.args) || null;
  } catch (e) {
    console.error(e);
    viewEl.append(h('div.panel', {}, h('h2', {}, 'Something went wrong rendering this view'), h('pre.math', {}, e.stack || e.message)));
  }
}

let lastProgress = null;
function emptyState() {
  if (app.syncing) {
    const all = Object.values(lastProgress?.sources || {});
    const done = all.filter((x) => !['queued', 'fetching'].includes(x.phase)).length;
    const pct = lastProgress?.phase === 'building' ? 95 : all.length ? Math.max(5, (done / all.length) * 90) : 5;
    return h('div.panel.center', { style: { padding: '2.5rem 1rem' } },
      h('h2', {}, 'Getting your data ready…'),
      h('p.muted', {}, 'Downloading rankings, projections, statistics and trade values. This takes about 30 seconds the first time.'),
      h('div.progress-line', { style: { maxWidth: '420px', margin: '1rem auto' } }, h('span', { style: { width: `${pct}%` } })),
      h('p.small.muted', {}, lastProgress?.phase === 'building' ? 'Almost done — calculating values…' : `${done} of ${all.length || '…'} sources done`));
  }
  return h('div.panel.center', { style: { padding: '2.5rem 1rem' } },
    h('h2', {}, 'No data yet'),
    h('p.muted', {}, 'Press the button to download rankings, projections, statistics and trade values (about 30 seconds).'),
    hasServer()
      ? h('button.btn.btn-primary', { style: { fontSize: '1.05rem', padding: '.75rem 1.4rem' }, onclick: () => startSync({ force: true }) }, '⟳ Download data')
      : h('p', {}, 'The app\'s engine is not running. Close this tab and double-click ', h('strong', {}, '"Start Trade Analyzer"'), ' in the app folder.'),
    h('p.small.muted.mt', {}, 'No internet right now? You can also import a file under ', h('a', { href: '#/data/import' }, 'Data → Manual Import'), '. Need help? See the ', h('a', { href: '#/help' }, 'Help page'), '.'));
}

function renderHeader() {
  document.body.classList.toggle('mode-dynasty', app.mode === 'dynasty');
  document.body.classList.toggle('mode-redraft', app.mode === 'redraft');
  for (const b of document.querySelectorAll('.mode-toggle button')) b.setAttribute('aria-selected', String(b.dataset.mode === app.mode));
  const sel = document.getElementById('profile-select');
  clear(sel);
  const user = allProfiles().filter((p) => !p.builtin);
  const builtin = allProfiles().filter((p) => p.builtin);
  if (user.length) sel.append(h('optgroup', { label: 'My leagues' }, user.map((p) => h('option', { value: p.id }, p.name))));
  sel.append(h('optgroup', { label: 'Presets' }, builtin.map((p) => h('option', { value: p.id }, p.name))));
  sel.value = activeProfile().id;
  renderDataPill();
}

function renderDataPill() {
  const pill = document.getElementById('data-pill');
  const txt = pill.querySelector('.txt');
  pill.classList.remove('ok', 'warn', 'bad');
  const ds = app.dataset;
  if (!ds) { txt.textContent = 'No data'; pill.classList.add('bad'); return; }
  const stale = Object.values(ds.sources || {}).filter((s) => s.stale).length;
  const failing = app.status ? app.status.sources.filter((s) => ['error', 'quarantined', 'partial'].includes(s.state)).length : 0;
  const auto = Object.values(ds.sources || {}).filter((s) => !s.manual && s.enabled);
  const okCount = auto.filter((s) => s.has_data && !s.stale).length;
  txt.textContent = `Data ${timeAgo(ds.built_at)} · ${okCount}/${auto.length} sources`;
  pill.classList.add(stale || failing ? 'warn' : 'ok');
  if (!hasServer()) txt.textContent += ' · read-only';
  pill.title = `Dataset ${ds.data_version}\nBuilt ${new Date(ds.built_at).toLocaleString()}\n${stale} stale source(s), ${failing} failing.\nClick for the sync dashboard.`;
}

function renderBanner() {
  const b = document.getElementById('banner');
  const msgs = [];
  let cls = '';
  if (!hasServer()) { msgs.push('Read-only mode: the app\'s engine is not running, so data cannot be refreshed (values use the saved data). To refresh, double-click "Start Trade Analyzer" in the app folder.'); cls = 'info'; }
  if (app.dataset) {
    const ageH = (Date.now() - new Date(app.dataset.built_at).getTime()) / 36e5;
    if (ageH > 72) { msgs.push(`Data is ${Math.round(ageH / 24)} days old — click Sync All to refresh.`); cls = ''; }
    const stale = Object.entries(app.dataset.sources || {}).filter(([, s]) => s.stale).map(([, s]) => s.name);
    if (stale.length) msgs.push(`Stale sources (using last good data): ${stale.join(', ')}.`);
    for (const sub of app.dataset.meta?.substitutions || []) if (sub.used) msgs.push(`Using ${sub.used} for ${sub.type} because ${sub.preferred || 'the preferred source'} is unavailable.`);
  }
  b.hidden = !msgs.length;
  b.className = `banner ${cls}`;
  b.textContent = msgs.join(' ');
}

async function boot() {
  if (location.protocol === 'file:') return; // index.html shows how to start the app properly
  await detectServer();
  try {
    app.config = await loadConfig();
  } catch (e) {
    clear(viewEl).append(h('div.panel', {}, h('h2', {}, 'Could not load configuration'), h('p', {}, e.message), h('p.muted', {}, 'Run the app with `npm start` and open the URL it prints.')));
    return;
  }
  await initProfiles();
  try { setDataset(await loadDataset()); } catch (e) { toast(`Could not load cached dataset: ${e.message}`, 'bad'); }
  await refreshStatus();

  document.querySelectorAll('.mode-toggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.getElementById('profile-select').addEventListener('change', (e) => setProfile(e.target.value));
  document.getElementById('sync-btn').addEventListener('click', () => startSync({}));
  document.getElementById('data-pill').addEventListener('click', () => { location.hash = '#/data'; });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => toast('Back online.', 'ok'));
  window.addEventListener('offline', () => toast('You are offline — cached values remain available.', 'warn'));

  on((evt, detail) => {
    if (evt === 'sync-progress') {
      const btn = document.getElementById('sync-btn');
      btn.classList.toggle('spinning', Boolean(detail && detail.running));
      btn.disabled = Boolean(detail && detail.running);
      btn.querySelector('.lbl').textContent = detail && detail.running ? 'Syncing…' : 'Sync All';
      lastProgress = detail;
      if (!app.dataset && current && !['data', 'settings', 'model', 'help'].includes(current.view)) render();
      return;
    }
    if (evt === 'status') { renderDataPill(); renderBanner(); if (current && current.view === 'data') render(); return; }
    if (['mode', 'profile', 'dataset', 'profiles'].includes(evt)) {
      renderHeader();
      renderBanner();
      if (evt === 'mode' && current.view === 'rookies' && app.mode !== 'dynasty') { location.hash = '#/trade'; return; }
      render();
    }
  });
  renderHeader();
  renderBanner();
  route();
  resumeIfRunning();
  setInterval(renderDataPill, 60000);
}

boot();
