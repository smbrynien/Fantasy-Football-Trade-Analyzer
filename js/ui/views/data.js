// DATA: sync dashboard, source health, manual import, data quality, snapshots.

import { h, clear, fmtTime, timeAgo, fmtInt, statusIcon, toast, openModal, download, posBadge } from '../dom.js';
import { app, on, setDataset } from '../state.js';
import { api, hasServer, loadDataset } from '../api.js';
import { startSync, refreshStatus } from '../sync.js';
import { toCSV } from '../../core/util/csv.js';

const SUBVIEWS = { sync: 'Sync dashboard', sources: 'Data sources / health', import: 'Manual import', quality: 'Data quality', snapshots: 'Snapshots' };

export function renderData(root, args) {
  const sub = SUBVIEWS[args[0]] ? args[0] : 'sync';
  root.append(h('div.subtabs', {}, Object.entries(SUBVIEWS).map(([k, l]) => h('button', { class: k === sub ? 'active' : '', onclick: () => { location.hash = `#/data/${k}`; } }, l))));
  const body = h('div');
  root.append(body);
  if (!hasServer() && sub !== 'sources') {
    body.append(h('div.panel', {}, h('h2', {}, 'Sync server not running'), h('p', {}, 'Data refresh, manual import and quality reports need the local server. Start it with ', h('code', {}, 'npm start'), ' and reload. The trade calculator keeps working from the cached dataset.')));
    if (sub !== 'sync') return null;
  }
  const fn = { sync: syncView, sources: sourcesView, import: importView, quality: qualityView, snapshots: snapshotsView }[sub];
  return fn(body);
}

// ------------------------------------------------------------------ sync dashboard
function syncView(body) {
  const st = app.status;
  const progressBox = h('div');
  const tableHost = h('div');
  const draw = (progress) => {
    clear(tableHost);
    const s = app.status;
    if (!s) { tableHost.append(h('p.muted', {}, 'No status available.')); return; }
    const auto = s.sources.filter((x) => x.adapter !== 'manual' && x.enabled);
    const ok = auto.filter((x) => ['ok', 'warning'].includes(x.state)).length;
    const failed = auto.filter((x) => ['error', 'quarantined'].includes(x.state)).length;
    const partial = auto.filter((x) => x.state === 'partial').length;
    const stale = auto.filter((x) => x.stale).length;
    const ls = s.last_sync;
    if (s.recovered_files?.length) tableHost.append(h('div.banner', { style: { margin: '0 0 .75rem' } }, h('strong', {}, 'Recovered from unreadable files: '),
      s.recovered_files.map((r) => `${r.file} (kept as ${r.moved_to})`).join('; '), '. The app rebuilt what it could; re-sync if values look incomplete.'));
    tableHost.append(h('div.sync-summary', {},
      kpi('Successful sources', `${ok}/${auto.length}`, partial ? `${partial} partial` : 'automated sources'),
      kpi('Failed sources', String(failed), failed ? 'see errors below' : 'none', failed ? 'st-error' : 'st-ok'),
      kpi('Stale sources', String(stale), stale ? 'older than 2× freshness target' : 'all within target', stale ? 'st-warning' : 'st-ok'),
      kpi('Last full sync', ls ? timeAgo(ls.finished_at) : 'never', ls ? fmtTime(ls.finished_at) : ''),
      kpi('Dataset', s.dataset ? `${fmtInt(s.dataset.players)} players` : '—', s.dataset ? `${s.dataset.data_version} · built ${timeAgo(s.dataset.built_at)}` : 'not built'),
      kpi('NFL state', s.nfl_state ? `${s.nfl_state.season} wk ${s.nfl_state.week}` : '—', s.nfl_state ? `${s.nfl_state.season_type} (${s.nfl_state.source || '?'})` : '')));
    const rows = s.sources.map((x) => {
      const pr = progress && progress.sources && progress.sources[x.id];
      const recs = x.records ? Object.entries(x.records).map(([t, n]) => `${t} ${fmtInt(n)}`).join(' · ') : '—';
      const live = pr && pr.phase === 'fetching' ? h('span.badge.info', {}, 'fetching…') : pr && pr.phase === 'queued' ? h('span.badge', {}, 'queued') : null;
      return h('tr', {},
        h('td', {}, h('div.bold', {}, x.name), h('div.tiny.muted', {}, `${x.priority} · ${x.method}`)),
        h('td', {}, live || h('span', {}, statusIcon(x.state), ' ', x.state), x.stale ? h('span.badge.warn', { style: { marginLeft: '.3rem' } }, 'stale') : null),
        h('td.nowrap', {}, x.last_success ? h('span', { title: x.last_success }, fmtTime(x.last_success)) : h('span.faint', {}, '—'), h('div.tiny.muted', {}, x.age_hours !== null ? `${timeAgo(x.last_success)} · target ≤${x.freshness_hours}h` : '')),
        h('td.small', {}, recs),
        h('td.small', {}, x.error ? h('span.err', {}, x.error) : pr && pr.message ? h('span.muted', {}, pr.message) : ''),
        h('td.nowrap', {}, x.adapter === 'manual'
          ? h('a.btn.btn-xs', { href: `#/data/import?spec=${x.manual_spec}` }, 'Import')
          : h('button.btn.btn-xs', { disabled: app.syncing ? true : null, onclick: () => startSync({ sources: [x.id], force: true }) }, x.state === 'error' || x.state === 'partial' || x.state === 'quarantined' ? 'Retry' : 'Refresh')));
    });
    tableHost.append(h('div.table-wrap', {}, h('table.data', {}, h('thead', {}, h('tr', {}, ['Source', 'Status', 'Last updated', 'Records', 'Message', ''].map((c) => h('th', {}, c)))), h('tbody', {}, rows))));
    if (s.dataset?.substitutions?.length) tableHost.append(h('div.banner.mt', {}, 'Failover in use: ', s.dataset.substitutions.map((x) => `${x.type}: using ${x.used}${x.preferred ? ` instead of ${x.preferred}` : ''}${x.reason ? ` (${x.reason})` : ''}${x.note ? ` — ${x.note}` : ''}`).join('; ')));
    if (ls && ls.results) {
      tableHost.append(h('details.mt', {}, h('summary', {}, `Last sync details (${fmtTime(ls.finished_at)}, ${(ls.duration_ms / 1000).toFixed(1)}s, ${(ls.http?.bytes / 1e6 || 0).toFixed(1)} MB)`),
        h('ul.small', {}, Object.entries(ls.results).map(([id, r]) => h('li', {}, statusIcon(r.status), ` ${id}: ${r.status}${r.error ? ` — ${r.error}` : ''}`))),
        ls.build_error ? h('p.err', {}, `Build error: ${ls.build_error}`) : null,
        ls.build ? h('p.small', {}, `Built ${ls.build.data_version}: ${ls.build.players} players, ${ls.build.picks} pick values, ${ls.build.unresolved} unresolved and ${ls.build.ambiguous} ambiguous identity records (see Data quality).`) : null));
    }
  };
  const drawProgress = (p) => {
    clear(progressBox);
    if (!p || !p.running) return;
    const all = Object.values(p.sources || {});
    const done = all.filter((x) => !['queued', 'fetching'].includes(x.phase)).length;
    progressBox.append(h('div.banner.info', {}, `Sync in progress — ${p.phase === 'building' ? 'rebuilding dataset…' : `${done}/${all.length} sources done`}`, h('div.progress-line', {}, h('span', { style: { width: `${all.length ? (done / all.length) * 100 : 5}%` } }))));
  };
  body.append(h('div.panel', {},
    h('div.panel-head', {}, h('h2', {}, 'Sync dashboard'),
      h('div.flex', {},
        h('button.btn.btn-primary', { disabled: !hasServer() || app.syncing ? true : null, onclick: () => startSync({}) }, '⟳ Sync All'),
        h('button.btn', { disabled: !hasServer() || app.syncing ? true : null, onclick: () => startSync({ failedOnly: true }) }, 'Sync failed sources'),
        h('button.btn', { disabled: !hasServer() || app.syncing ? true : null, onclick: () => startSync({ force: true }) }, 'Force full refresh'))),
    h('p.small.muted', {}, '"Sync All" fetches every enabled source (sources fetched in the last 30 minutes are skipped). "Force full refresh" re-downloads everything. A failing source never blocks the others; its last good data stays in use and is marked stale.'),
    progressBox, tableHost));
  draw(null);
  if (!st) refreshStatus();
  return on((evt, detail) => { if (evt === 'sync-progress') { drawProgress(detail); draw(detail); } });
}

function kpi(k, v, s, cls = '') { return h('div.kpi', {}, h('div.k', {}, k), h('div.v', { class: cls }, v), h('div.s', {}, s)); }

// ------------------------------------------------------------------ sources / health
function sourcesView(body) {
  const sources = app.status ? app.status.sources : app.config.sources.sources.map((s) => ({ ...s, state: 'unknown' }));
  body.append(h('div.panel', {},
    h('div.panel-head', {}, h('h2', {}, 'Data sources / system health'), hasServer() ? h('a.btn.btn-sm', { href: '/api/export/health.csv' }, '⤓ Health report CSV') : null),
    h('p.small.muted', {}, 'Click a source for details: URLs, adapter, schema, refresh frequency, manual fallback and terms. Enable/disable and priorities live in config/sources.json.'),
    h('div.table-wrap', {}, h('table.data', {},
      h('thead', {}, h('tr', {}, ['Source', 'Data', 'Status', 'Last update', 'Method', 'Priority', 'Fallback'].map((c) => h('th', {}, c)))),
      h('tbody', {}, sources.map((s) => h('tr.clickable', { onclick: () => sourceDetail(s) },
        h('td.bold', {}, s.name, s.enabled ? null : h('span.badge', { style: { marginLeft: '.3rem' } }, 'disabled')),
        h('td.small', {}, s.data_types.join(', ')),
        h('td.nowrap', {}, statusIcon(s.state), ' ', s.state, s.stale ? h('span.badge.warn', { style: { marginLeft: '.3rem' } }, 'stale') : null),
        h('td.small.nowrap', {}, s.last_success ? timeAgo(s.last_success) : '—'),
        h('td.small', {}, s.method), h('td.small', {}, s.priority),
        h('td.small.muted', {}, s.fallback || '—'))))))));
  return null;
}

function sourceDetail(s) {
  const spec = s.manual_spec ? app.config.importSpecs.specs.find((x) => x.id === s.manual_spec) : null;
  let close;
  close = openModal(h('div', {},
    h('div.modal-head', {}, h('div', {}, h('h2', {}, s.name), h('div.small.muted', {}, `${s.id} · adapter "${s.adapter}" · ${s.priority}`)), h('button.modal-close', { onclick: () => close() }, '×')),
    h('div.modal-body', {},
      h('dl.kv', {},
        h('dt', {}, 'Status'), h('dd', {}, statusIcon(s.state), ' ', s.state, s.error ? h('div.err', {}, s.error) : null),
        h('dt', {}, 'Source URL'), h('dd', {}, s.url ? h('a', { href: s.url.includes('{') ? s.url.split('{')[0] : s.url, target: '_blank', rel: 'noopener' }, s.url) : '—'),
        h('dt', {}, 'Documentation'), h('dd', {}, s.docs_url ? h('a', { href: s.docs_url, target: '_blank', rel: 'noopener' }, s.docs_url) : '—'),
        h('dt', {}, 'Data types'), h('dd', {}, s.data_types.join(', ')),
        h('dt', {}, 'Method'), h('dd', {}, s.method),
        h('dt', {}, 'Authentication'), h('dd', {}, s.auth || 'none required'),
        h('dt', {}, 'Refresh frequency'), h('dd', {}, `every ${s.update_frequency_hours} h (stale after ${s.freshness_hours ? s.freshness_hours * 2 : '?'} h)`),
        h('dt', {}, 'Last success'), h('dd', {}, s.last_success ? `${fmtTime(s.last_success)} (${timeAgo(s.last_success)})` : 'never'),
        h('dt', {}, 'Last failure'), h('dd', {}, s.last_failure ? fmtTime(s.last_failure) : '—'),
        h('dt', {}, 'Records'), h('dd', {}, s.records ? Object.entries(s.records).map(([t, n]) => `${t}: ${fmtInt(n)}`).join(' · ') : '—'),
        h('dt', {}, 'Current cache'), h('dd', {}, app.dataset?.sources?.[s.id]?.has_data ? `in dataset ${app.dataset.data_version}` : 'not in current dataset'),
        h('dt', {}, 'Independence group'), h('dd', {}, s.independence_group),
        h('dt', {}, 'Terms / notes'), h('dd', {}, s.terms || '—'),
        h('dt', {}, 'Fallback'), h('dd', {}, s.fallback || '—')),
      s.types ? h('div.mt', {}, h('h3', {}, 'Last run by data type'), h('div.table-wrap', {}, h('table.data', {}, h('tbody', {}, Object.entries(s.types).map(([t, v]) => h('tr', {}, h('td', {}, t), h('td', {}, statusIcon(v.status), ' ', v.status), h('td.num', {}, v.records ?? '—'), h('td.small', {}, v.error || (v.issues || []).map((i) => i.message).join(' ')))))))) : null,
      spec ? h('div.mt', {}, h('h3', {}, 'Manual fallback'), h('ol.steps', {}, spec.instructions.map((i) => h('li', {}, i))), h('a.btn.btn-sm', { href: `#/data/import?spec=${spec.id}`, onclick: () => close() }, 'Open manual import')) : h('p.small.muted.mt', {}, 'Manual fallback: any of the generic import templates (Data → Manual Import) can stand in for this source\'s data type.'))));
}

// ------------------------------------------------------------------ manual import
function importView(body) {
  const specs = app.config.importSpecs.specs;
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  let spec = specs.find((s) => s.id === qs.get('spec')) || specs[0];
  let fileText = null, fileName = null, preview = null, mapping = null;
  const options = {};
  const left = h('div.panel');
  const right = h('div.panel');
  body.append(h('div.grid-2', {}, left, right));

  const drawLeft = () => {
    clear(left);
    const sel = h('select', { 'aria-label': 'What are you importing?', onchange: (e) => { spec = specs.find((s) => s.id === e.target.value); fileText = null; preview = null; mapping = null; for (const k of Object.keys(options)) delete options[k]; drawLeft(); drawRight(); } }, specs.map((s) => h('option', { value: s.id, selected: s.id === spec.id ? true : null }, s.name)));
    const src = app.config.sources.sources.find((x) => x.id === spec.source_id);
    const optEls = Object.entries(spec.format_options || {}).map(([k, o]) => h('label.field', {}, o.label, h('select', { onchange: (e) => { const ch = o.choices[e.target.selectedIndex]; options[k] = ch.value; if (fileText) runPreview(); } }, o.choices.map((c) => h('option', { selected: (options[k] ?? o.default) === c.value ? true : null }, c.label)))));
    const fileInput = h('input', { type: 'file', 'aria-label': 'CSV or JSON file to import', accept: '.csv,.json,.txt,.tsv', onchange: (e) => readFile(e.target.files[0]) });
    const drop = h('div.drop', {}, h('div', {}, 'Drop a CSV/JSON file here or '), fileInput, fileName ? h('div.small.mt-s', {}, `Loaded: ${fileName}`) : null);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });
    const paste = h('textarea', { placeholder: '…or paste CSV text here', 'aria-label': 'Paste CSV text', oninput: () => { fileText = paste.value; fileName = 'pasted.csv'; } });
    left.append(
      h('div.panel-head', {}, h('h2', {}, 'Manual import'), sel),
      h('h3', {}, `MANUAL IMPORT — ${spec.name.toUpperCase()}`),
      h('p.small.muted', {}, `Stored as source "${src?.name || spec.source_id}" (${spec.record_type}). ${src?.terms || ''}`),
      h('ol.steps', {}, spec.instructions.map((i) => h('li', {}, i))),
      h('h4.mt', {}, 'Expected columns'),
      h('div.table-wrap', {}, h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Column'), h('th', {}, 'Required'), h('th', {}, 'Accepted names'))),
        h('tbody', {}, spec.columns.map((c) => h('tr', {}, h('td.mono', {}, c.key), h('td', {}, c.required ? h('span.badge.bad', {}, 'required') : h('span.faint', {}, 'optional')), h('td.small', {}, [...new Set([...(c.aliases || []), ...(app.config.importSpecs.common_aliases[c.key] || [])])].join(', ') || c.key, c.description ? h('div.tiny.muted', {}, c.description) : null)))))),
      h('div.flex.mt-s', {}, h('button.btn.btn-sm', { onclick: () => download(`${spec.id}-example.csv`, spec.example_csv, 'text/csv') }, '⤓ Example CSV'), h('code.small', {}, spec.example_csv.split('\n')[0])),
      optEls.length ? h('div.fields.mt', {}, optEls) : null,
      h('div.mt', {}, drop), h('div.mt-s', {}, paste),
      h('div.flex.mt-s', {}, h('button.btn.btn-accent', { onclick: () => { if (paste.value.trim()) { fileText = paste.value; fileName = 'pasted.csv'; } if (!fileText) return toast('Choose a file or paste data first.', 'warn'); mapping = null; runPreview(); } }, 'Preview'),
        h('button.btn.btn-sm.btn-danger', { onclick: async () => { if (!confirm(`Remove ALL imported data for "${src?.name}"?`)) return; try { await api.del(`/api/import/${spec.source_id}`); toast('Imported data removed.'); await reload(); } catch (e) { toast(e.message, 'bad'); } } }, 'Clear imported data')));
  };

  function readFile(f) {
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { fileText = String(rd.result); fileName = f.name; mapping = null; drawLeft(); runPreview(); };
    rd.readAsText(f);
  }

  async function runPreview() {
    clear(right).append(h('p.muted', {}, 'Validating…'));
    try {
      preview = await api.post('/api/import/preview', { spec_id: spec.id, text: fileText, filename: fileName, options, mapping });
      mapping = preview.mapping;
    } catch (e) { preview = { ok: false, fatal: e.message }; }
    drawRight();
  }

  async function commit(confirmOverwrite = false) {
    // Ask before sending when the preview already shows records being replaced; the server's 409 stays as a
    // safeguard (asking only after a refused request logged a failed request in the console on every overwrite).
    const replaced = preview?.existing?.replaced || 0;
    if (!confirmOverwrite && replaced > 0) {
      if (!confirm(`This import replaces ${replaced} existing records with the same format. Overwrite them?`)) return;
      confirmOverwrite = true;
    }
    try {
      const r = await api.post('/api/import/commit', { spec_id: spec.id, text: fileText, filename: fileName, options, mapping, confirmOverwrite });
      toast(`Imported ${r.imported.players} matched players${r.imported.picks ? ` and ${r.imported.picks} picks` : ''}. ${r.unmatched} unmatched and ${r.ambiguous} ambiguous rows are kept on file but not used until resolved (Data quality).`);
      await reload();
    } catch (e) {
      if (e.status === 409) { if (confirm(`${e.message}`)) return commit(true); return; }
      toast(`Import failed: ${e.message}`, 'bad', 8000);
    }
  }

  async function reload() {
    try { setDataset(await loadDataset()); } catch { /* ignore */ }
    await refreshStatus();
  }

  function drawRight() {
    clear(right);
    right.append(h('h2', {}, 'Preview & validation'));
    if (!preview) { right.append(h('p.muted', {}, 'Load a file to see the detected columns, a preview, validation results and the unmatched-player report before anything is saved.')); return; }
    if (preview.headers) {
      // (native append() writes null as the text "null": keep the optional line out instead)
      right.append(...[h('h3', {}, 'Column mapping'), h('p.small.muted', {}, 'Detected automatically (exact or alias match). Adjust if needed, then re-validate.'),
        h('div.table-wrap', {}, h('table.data', {}, h('tbody', {}, spec.columns.map((c) => h('tr', {}, h('td.mono', {}, c.key, c.required ? ' *' : ''),
          h('td', {}, h('select', { 'aria-label': `File column for ${c.key}`, onchange: (e) => { mapping = { ...mapping, [c.key]: e.target.value || undefined }; if (!e.target.value) delete mapping[c.key]; } }, h('option', { value: '' }, '— not mapped —'), preview.headers.map((hd) => h('option', { value: hd, selected: mapping && mapping[c.key] === hd ? true : null }, hd)))),
          h('td.tiny.muted', {}, preview.auto?.method?.[c.key] ? `${preview.auto.method[c.key]} match` : '')))))),
        preview.auto?.unmapped?.length ? h('p.tiny.muted', {}, `Ignored columns: ${preview.auto.unmapped.join(', ')}`) : null,
        h('button.btn.btn-sm.mt-s', { onclick: runPreview }, 'Re-validate with this mapping')].filter(Boolean));
    }
    if (!preview.ok) { right.append(h('div.banner.bad.mt', {}, preview.fatal || 'Invalid file.')); return; }
    const id = preview.identity;
    right.append(h('div.kpis.mt', {},
      kpi('Rows', fmtInt(preview.parse.rows), preview.parse.format.toUpperCase()),
      kpi('Matched players', fmtInt(id.matched), id.fuzzy.length ? `${id.fuzzy.length} fuzzy (review)` : 'by ID or name'),
      kpi('Unmatched', fmtInt(id.unmatched.length), 'will be skipped', id.unmatched.length ? 'st-warning' : 'st-ok'),
      kpi('Ambiguous', fmtInt(id.ambiguous.length), 'never auto-merged', id.ambiguous.length ? 'st-warning' : 'st-ok'),
      kpi('Picks', fmtInt(preview.counts.picks), 'pick labels recognised')));
    if (preview.existing) right.append(h('div.banner.mt', {}, `Existing data for this source: ${preview.existing.records} records from ${fmtTime(preview.existing.fetched_at)}. ${preview.existing.replaced} records with the same format will be REPLACED (you will be asked to confirm).`));
    const errs = [...(preview.rowErrors || []).map((e) => ({ level: 'error', row: e.row, message: e.message })), ...preview.issues];
    if (errs.length) right.append(h('details.mt', { open: true }, h('summary', {}, `Validation messages (${errs.length})`), h('ul.small', {}, errs.slice(0, 60).map((e) => h('li', { class: e.level === 'error' ? 'err' : '' }, e.row ? `Row ${e.row}: ` : '', e.message)))));
    if (Object.keys(preview.missing || {}).length) right.append(h('p.small.muted', {}, 'Missing optional data: ', Object.entries(preview.missing).map(([k, n]) => `${k} (${n} rows)`).join(', ')));
    if (preview.quality?.issues?.length) right.append(h('ul.small', {}, preview.quality.issues.map((i) => h('li', { class: i.level === 'error' ? 'err' : '' }, i.message))));
    if (id.unmatched.length) right.append(h('details.mt', {}, h('summary', {}, `Unmatched players (${id.unmatched.length})`), h('ul.small', {}, id.unmatched.slice(0, 100).map((u) => h('li', {}, `Row ${u.row}: ${u.name} ${u.position || ''} ${u.team || ''}`)))));
    if (id.ambiguous.length) right.append(h('details.mt', {}, h('summary', {}, `Ambiguous players (${id.ambiguous.length}) — resolve under Data quality after import`), h('ul.small', {}, id.ambiguous.map((u) => h('li', {}, `Row ${u.row}: ${u.name} → ${u.candidates.map((c) => `${c.name} (${c.team}, ${c.birth_date || 'dob ?'})`).join(' / ')}`)))));
    if (id.fuzzy.length) right.append(h('details.mt', {}, h('summary', {}, `Fuzzy matches to review (${id.fuzzy.length})`), h('ul.small', {}, id.fuzzy.map((u) => h('li', {}, `Row ${u.row}: "${u.name}" → ${u.matched} (${u.team})`)))));
    right.append(h('h3.mt', {}, 'Preview (first rows, normalized)'), h('div.table-wrap', {}, h('table.data', {},
      h('thead', {}, h('tr', {}, ['row', 'name', 'position', 'team', 'value / rank / adp', 'format'].map((c) => h('th', {}, c)))),
      h('tbody', {}, preview.preview.map((r) => h('tr', {}, h('td', {}, r._row), h('td', {}, r.name || r.label), h('td', {}, r.position ? posBadge(r.position) : r.type === 'pick_market' ? posBadge('PICK') : '—'), h('td', {}, r.team || '—'), h('td.num', {}, r.value ?? r.rank ?? r.adp ?? (r.stats ? Object.keys(r.stats).length + ' stats' : '—')), h('td.small', {}, [r.kind, r.scope, r.qb, r.format, r.dynasty === true ? 'dynasty' : r.dynasty === false ? 'redraft' : null].filter(Boolean).join(' · '))))))));
    right.append(h('div.flex.mt', {}, h('button.btn.btn-primary', { onclick: () => commit(false) }, `Import ${preview.counts.players - id.unmatched.length - id.ambiguous.length} players${preview.counts.picks ? ` + ${preview.counts.picks} picks` : ''}`), h('span.small.muted', {}, 'Unmatched and ambiguous rows are skipped. The dataset is rebuilt immediately.')));
  }

  drawLeft();
  drawRight();
  return null;
}

// ------------------------------------------------------------------ quality
function qualityView(body) {
  const host = h('div', {}, h('p.muted', {}, 'Loading quality report…'));
  body.append(host);
  (async () => {
    let q;
    try { q = await api.get('/api/quality'); } catch (e) { clear(host).append(h('p.err', {}, e.message)); return; }
    clear(host);
    // Summary first: what (if anything) needs attention. The all-"ok" batch table used to fill the first 6,000 px and
    // pushed the one actionable part — ambiguous players to resolve — far below the fold.
    const batches = q.sources.flatMap((s) => Object.values(s.types || {}));
    const bad = batches.filter((v) => v.quarantined || v.error).length, warn = batches.filter((v) => !v.quarantined && !v.error && v.verdict === 'warning').length;
    const idq = q.identity || {};
    const nAmb = (idq.ambiguous || []).length, nUnres = Object.values(idq.unresolved || {}).reduce((a, l) => a + l.length, 0);
    host.append(h('div.panel', {}, h('div.panel-head', {}, h('h2', {}, 'Data quality'), h('span.small.muted', {}, `Generated ${fmtTime(q.generated_at)} for ${q.data_version || '—'}`)),
      h('ul.quality-summary', {},
        h('li', { class: bad ? 'err' : '' }, bad ? `⛔ ${bad} of ${batches.length} data batches failed validation — the previous good data is in use (details below).` : `✓ All ${batches.length} data batches passed validation${warn ? ` (${warn} with warnings)` : ''}.`),
        h('li', { class: nAmb ? 'warn-text' : '' }, nAmb ? `⚠ ${nAmb} player record${nAmb === 1 ? '' : 's'} could match more than one player — choose the right one below (never merged automatically).` : '✓ No ambiguous player matches to review.'),
        h('li.muted', {}, `${nUnres} source record${nUnres === 1 ? '' : 's'} not in the player database (usually prospects or retired players) — listed below, nothing to do unless a name you care about is there.`))));
    const batchPanel = h('details.panel', { open: bad + warn > 0 ? true : null }, h('summary', {}, h('strong', {}, `Validation by source and data type (${batches.length} batches)`)),
      h('p.small.muted', {}, 'Every batch is validated before use (schema drift, duplicates, invalid teams/positions/ages, duplicated ranks, record-count drops, sudden extreme value changes). Batches with errors are quarantined and the previous good data is kept.'),
      h('div.table-wrap', {}, h('table.data', {}, h('thead', {}, h('tr', {}, ['Source', 'Type', 'Records', 'Verdict', 'Issues'].map((c) => h('th', {}, c)))),
        h('tbody', {}, q.sources.flatMap((s) => Object.entries(s.types || {}).map(([t, v]) => h('tr', {},
          h('td.bold', {}, s.name), h('td', {}, t), h('td.num', {}, fmtInt(v.records)),
          h('td', {}, v.quarantined ? h('span.badge.bad', {}, 'quarantined') : v.error ? h('span.badge.bad', {}, 'error') : v.verdict === 'warning' ? h('span.badge.warn', {}, 'warning') : h('span.badge.good', {}, v.verdict || 'ok')),
          h('td.small', {}, [...(v.issues || []), ...(v.quarantine_issues || [])].map((i) => h('div', { class: i.level === 'error' ? 'err' : '' }, i.message, i.expected ? h('div.tiny.muted', {}, `Expected: ${i.expected.join(', ')} · Received: ${(i.received || []).slice(0, 15).join(', ')}`) : null)), v.error ? h('div.err', {}, v.error) : null))))))));

    // identity
    const id = q.identity || {};
    const unresolved = Object.entries(id.unresolved || {}).flatMap(([src, l]) => l.map((x) => ({ src, ...x })));
    host.append(h('div.panel', {}, h('h2', {}, 'Player identity resolution'),
      h('p.small.muted', {}, 'Records are matched by external IDs first, then normalized name + position, then team/birth date/age/draft year. Ambiguous players are never merged automatically — resolve them here (stored in data/players/overrides.json).'),
      h('div.table-wrap', {}, h('table.data', {}, h('thead', {}, h('tr', {}, ['Source', 'Matched', 'Unresolved', 'Ambiguous', 'Fuzzy'].map((c) => h('th', {}, c)))),
        h('tbody', {}, Object.entries(id.matched || {}).map(([src, m]) => h('tr', {}, h('td', {}, src), h('td.num', {}, fmtInt(m.matched)), h('td.num', {}, fmtInt(m.unresolved)), h('td.num', {}, fmtInt(m.ambiguous)), h('td.num', {}, fmtInt(m.fuzzy))))))),
      (id.ambiguous || []).length ? h('div.mt', {}, h('h3', {}, `Ambiguous (${id.ambiguous.length})`), h('div.table-wrap', {}, h('table.data', {}, h('tbody', {}, id.ambiguous.slice(0, 100).map((a) => h('tr', {},
        h('td', {}, `${a.source}: `, h('strong', {}, a.name), ` ${a.position || ''} ${a.team || ''}`),
        h('td', {}, h('div.flex', {}, a.candidates.map((c) => h('button.btn.btn-xs', { title: `Map to ${c.name} (${c.cid})`, onclick: () => resolve(a, c.cid) }, `${c.name} · ${c.team} · ${c.birth_date || 'dob ?'}`)), h('button.btn.btn-xs.btn-ghost', { onclick: () => resolve(a, null) }, 'Ignore'))))))))) : null,
      unresolved.length ? h('details.mt', {}, h('summary', {}, `Unmatched records (${unresolved.length}) — usually prospects or players not in the player database`), h('ul.small', {}, unresolved.slice(0, 300).map((u) => h('li', {}, `${u.src}: ${u.name} ${u.position || ''} ${u.team || ''}`)))) : null,
      Object.keys(id.fuzzy || {}).length ? h('details.mt', {}, h('summary', {}, 'Fuzzy matches (review)'), h('ul.small', {}, Object.entries(id.fuzzy).flatMap(([src, l]) => l.map((x) => h('li', {}, `${src}: ${x.name} → ${x.matched_to}`))))) : null));
    host.append(batchPanel);

    host.append(h('div.panel', {}, h('h2', {}, 'Player database events'),
      h('p.small.muted', {}, 'Team changes, name variants, multi-position players and ID conflicts detected while merging authoritative player sources.'),
      (q.player_events || []).length ? h('div.table-wrap', {}, h('table.data', {}, h('tbody', {}, q.player_events.slice(-150).reverse().map((e) => h('tr', {}, h('td.small.nowrap', {}, fmtTime(e.at)), h('td', {}, h('span.badge', {}, e.type)), h('td.small', {}, eventText(e)))))))
        : h('p.muted.small', {}, 'No events yet (team changes etc. appear after subsequent syncs).'),
      (q.duplicates || []).length ? h('div.mt', {}, h('h3', {}, 'Possible duplicate canonical players'), h('ul.small', {}, q.duplicates.map((d) => h('li', {}, `${d.name} ${d.position} ${d.team}: ${d.cids.join(', ')}`)))) : null));
  })();

  async function resolve(a, cid) {
    const key = a.source_player_id !== null && a.source_player_id !== undefined ? `${a.source}|id:${a.source_player_id}` : null;
    const { nameKey } = await import('../../core/util/names.js');
    const k = key || `${a.source}|name:${nameKey(a.name)}|${a.position || ''}`;
    try {
      await api.post('/api/overrides', cid ? { key: k, cid } : { key: k, ignore: true });
      toast(cid ? `Mapped ${a.name} → ${cid}. Dataset rebuilt.` : `Ignoring ${a.name} from ${a.source}.`);
      setDataset(await loadDataset());
      location.hash = '#/data/quality';
    } catch (e) { toast(e.message, 'bad'); }
  }
  return null;
}

function eventText(e) {
  const d = e.detail || {};
  switch (e.type) {
    case 'team_change': return `${d.name}: ${d.from} → ${d.to} (${d.source})`;
    case 'name_variant': return `${d.name} also appears as "${d.incoming}" (${d.source})`;
    case 'multi_position': return `${d.name}: ${d.positions.join('/')}`;
    case 'id_conflict': return `${d.name} (${d.source}): IDs point to different players ${d.candidates.join(', ')}`;
    case 'id_mismatch': return `${e.cid}: ${d.type} ${d.existing} vs ${d.incoming} (${d.source})`;
    case 'created': return `${d.name} ${d.position} ${d.team} added (${d.source})`;
    default: return JSON.stringify(d);
  }
}

// ------------------------------------------------------------------ snapshots
function snapshotsView(body) {
  const host = h('div.panel', {}, h('h2', {}, 'Data snapshots'), h('p.small.muted', {}, 'A compressed snapshot of the merged dataset is kept for every build (last 90). Player detail → Trends → "Why did this value change?" re-runs today\'s model on any snapshot.'));
  body.append(host);
  api.get('/api/snapshots').then((list) => {
    host.append(list.length ? h('div.table-wrap', {}, h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Built'), h('th', {}, 'Data version'), h('th', {}, ''))),
      h('tbody', {}, list.map((s) => h('tr', {}, h('td', {}, fmtTime(s.built_at)), h('td.mono', {}, s.data_version), h('td', {}, h('a.btn.btn-xs', { href: `/api/snapshots/${encodeURIComponent(s.file)}`, target: '_blank' }, 'JSON'))))))) : h('p.muted', {}, 'No snapshots yet.'));
  }).catch((e) => host.append(h('p.err', {}, e.message)));
  host.append(h('div.mt', {}, h('button.btn.btn-sm', { onclick: () => {
    if (!app.status) return;
    download('data-source-health.csv', toCSV(app.status.sources.map((x) => ({ source: x.name, status: x.state, last_success: x.last_success, stale: x.stale, error: x.error || '' }))), 'text/csv');
  } }, '⤓ Export source health CSV')));
  return null;
}
