// PLAYER DATABASE — search, filters, sortable/customisable columns, CSV export.

import { h, clear, fmtValue, fmtSigned, fmt1, fmtAge, posBadge, confBadge, injuryBadge, download, debounce, timeAgo } from '../dom.js';
import { app, getValuations, load, save, playerData, isPlainObject, isStringArray } from '../state.js';
import { openPlayer } from './player-modal.js';
import { toCSV } from '../../core/util/csv.js';
import { TEAMS } from '../../core/util/teams.js';
import { nameKey } from '../../core/util/names.js';

const COLUMNS = [
  { key: 'rank', label: 'Rank', num: true, get: (r) => r.cur?.rank, always: true },
  { key: 'player', label: 'Player', get: (r) => r.name, always: true },
  { key: 'pos', label: 'Pos', get: (r) => r.position },
  { key: 'team', label: 'Team', get: (r) => r.team },
  { key: 'age', label: 'Age', num: true, get: (r) => r.age, fmt: fmtAge },
  { key: 'red', label: 'Redraft Value', num: true, get: (r) => r.red?.value, fmt: fmtValue, cls: 'model-v' },
  { key: 'red_rank', label: 'Redraft Rank', num: true, get: (r) => r.red?.rank },
  { key: 'proj', label: 'Proj. Pts (ROS)', num: true, get: (r) => r.red?.details?.projection?.points, fmt: fmt1 },
  { key: 'ppg', label: 'PPG', num: true, get: (r) => r.red?.details?.production?.ppg, fmt: fmt1 },
  { key: 'dyn', label: 'Dynasty Value', num: true, get: (r) => r.dyn?.value, fmt: fmtValue, cls: 'model-v' },
  { key: 'dyn_rank', label: 'Dynasty Rank', num: true, get: (r) => r.dyn?.rank },
  { key: 'future', label: 'Future Value', num: true, get: (r) => r.dyn ? (r.dyn.components.longevity || 0) + (r.dyn.components.prospect || 0) : null, fmt: fmtValue, title: 'Dynasty value attributable to seasons 2+ and draft capital' },
  { key: 'market', label: 'Market Value', num: true, get: (r) => r.cur?.groupValues?.market, fmt: fmtValue, cls: 'market-v', title: 'Market signal on this app\'s scale (mode-specific)' },
  { key: 'edge', label: 'Model − Market', num: true, get: (r) => (Number.isFinite(r.cur?.groupValues?.market) ? r.cur.value - r.cur.groupValues.market : null), fmt: (v) => (v === null || v === undefined ? '—' : fmtSigned(v)), title: 'This app\'s value minus the market value (same scale). Positive: the model rates the player above what managers trade for (a possible buy). Negative: the market pays more than the model (a possible sell). A difference, not a recommendation.' },
  { key: 'adp', label: 'ADP', num: true, get: (r) => r.adp, fmt: fmt1 },
  { key: 'trend', label: 'Trend', num: true, get: (r) => r.trend, fmt: (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`), title: 'Market source 30-day trend (source-reported)' },
  { key: 'conf', label: 'Confidence', get: (r) => r.cur?.confidence?.score },
  { key: 'updated', label: 'Last Updated', get: (r) => r.updated },
];

const DEFAULT_VISIBLE = { redraft: ['rank', 'player', 'pos', 'team', 'age', 'red', 'red_rank', 'proj', 'ppg', 'market', 'edge', 'adp', 'trend', 'conf'], dynasty: ['rank', 'player', 'pos', 'team', 'age', 'dyn', 'dyn_rank', 'future', 'market', 'edge', 'red', 'trend', 'conf'] };

export function renderPlayers(root) {
  const red = getValuations('redraft');
  const dyn = getValuations('dynasty');
  const cur = app.mode === 'dynasty' ? dyn : red;
  const defaults = { q: '', pos: [], team: '', ageMin: '', ageMax: '', valMin: '', inj: 'all', exp: 'all', sort: app.mode === 'dynasty' ? 'dyn' : 'red', dir: 'desc', limit: 150 };
  const f = { ...defaults, ...load(`players.filters.${app.mode}`, {}, isPlainObject) };
  if (!isStringArray(f.pos)) f.pos = [];
  let visible = load(`players.cols.${app.mode}`, DEFAULT_VISIBLE[app.mode], isStringArray);

  const rows = [];
  for (const a of cur.assets.values()) {
    if (a.kind !== 'player') continue;
    const p = playerData(a.id) || {};
    const adpRec = (p.adp || []).find((x) => x.format === (app.mode === 'dynasty' ? (cur.league.qb_format === '1qb' ? 'dynasty' : 'dynasty_sf') : (cur.league.qb_format === '1qb' ? 'redraft_ppr' : 'redraft_sf')));
    const r = {
      id: a.id, name: a.name, key: nameKey(a.name), position: a.position, team: a.team, age: a.age,
      red: red.assets.get(a.id), dyn: dyn.assets.get(a.id), cur: a,
      adp: adpRec ? adpRec.adp : null, trend: a.details?.trendRel ?? null,
      injury: p.injury ? (p.injury.status || p.injury.official_status) : null,
      rookie: Boolean(p.draft && Number(p.draft.year) === Number(app.dataset.state.season)) || p.years_exp === 0,
      updated: Math.max(0, ...[...(p.market || []), ...(p.rankings || [])].map((x) => new Date(x.as_of || 0).getTime()).filter(Number.isFinite)),
    };
    rows.push(r);
  }

  const controls = h('div.panel');
  const tableHost = h('div.mt');
  root.append(controls, tableHost);

  const q = h('input', { type: 'search', placeholder: 'Search name, team or position…', 'aria-label': 'Search players', value: f.q, style: { minWidth: '220px', flex: '1 1 220px' } });
  const posChips = h('div.chips', {}, ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => h('button.chip', { class: f.pos.includes(p) ? 'on' : '', onclick: (e) => { f.pos = f.pos.includes(p) ? f.pos.filter((x) => x !== p) : [...f.pos, p]; e.target.classList.toggle('on'); draw(); } }, p)));
  const team = h('select', { 'aria-label': 'Team', onchange: (e) => { f.team = e.target.value; draw(); } }, h('option', { value: '' }, 'All teams'), h('option', { value: 'FA' }, 'Free agents'), TEAMS.map((t) => h('option', { value: t, selected: f.team === t ? true : null }, t)));
  const num = (key, ph, label) => h('input.compact', { type: 'number', placeholder: ph, 'aria-label': label, value: f[key], oninput: debounce((e) => { f[key] = e.target.value; draw(); }, 250) });
  const sel = (key, opts, label) => h('select', { 'aria-label': label, onchange: (e) => { f[key] = e.target.value; draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v ? true : null }, l)));
  controls.append(
    h('div.flex', {}, q, posChips, team),
    h('div.flex.mt-s', {},
      h('span.small.muted', {}, 'Age'), num('ageMin', 'min', 'Minimum age'), num('ageMax', 'max', 'Maximum age'),
      h('span.small.muted', {}, 'Value ≥'), num('valMin', '0', 'Minimum value'),
      sel('inj', [['all', 'Any health'], ['healthy', 'Not injured'], ['injured', 'Injured / designated']], 'Health'),
      sel('exp', [['all', 'All players'], ['rookies', 'Rookies'], ['veterans', 'Veterans']], 'Experience'),
      h('span.grow'),
      h('details', { style: { position: 'relative' } }, h('summary.btn.btn-sm', {}, 'Columns'),
        h('div.panel', { style: { position: 'absolute', right: 0, zIndex: 20, minWidth: '220px' } }, COLUMNS.filter((c) => !c.always).map((c) => h('label.check', { style: { display: 'flex' } }, h('input', { type: 'checkbox', checked: visible.includes(c.key) ? true : null, onchange: (e) => { visible = e.target.checked ? [...visible, c.key] : visible.filter((k) => k !== c.key); save(`players.cols.${app.mode}`, visible); draw(); } }), c.label)),
          h('button.btn.btn-xs.mt-s', { onclick: () => { visible = DEFAULT_VISIBLE[app.mode]; save(`players.cols.${app.mode}`, visible); renderAgain(); } }, 'Reset'))),
      h('button.btn.btn-sm', { onclick: () => exportCSV('filtered') }, '⤓ CSV (filtered)'),
      h('details', { style: { position: 'relative' } }, h('summary.btn.btn-sm', {}, 'More exports'),
        h('div.panel', { style: { position: 'absolute', right: 0, zIndex: 20, minWidth: '220px' } },
          h('button.btn.btn-sm', { style: { width: '100%' }, onclick: () => exportCSV('all') }, 'All player values'), h('div.mt-s'),
          h('button.btn.btn-sm', { style: { width: '100%' }, onclick: () => exportCSV('redraft') }, 'Redraft values'), h('div.mt-s'),
          h('button.btn.btn-sm', { style: { width: '100%' }, onclick: () => exportCSV('dynasty') }, 'Dynasty values')))));
  q.addEventListener('input', debounce(() => { f.q = q.value; draw(); }, 120));

  function renderAgain() { clear(root); renderPlayers(root); }

  function filtered() {
    const terms = f.q.trim().split(/\s+/).filter(Boolean);
    const posT = terms.filter((t) => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(t.toUpperCase())).map((t) => t.toUpperCase());
    const teamT = terms.filter((t) => TEAMS.includes(t.toUpperCase())).map((t) => t.toUpperCase());
    const text = terms.filter((t) => !posT.includes(t.toUpperCase()) && !teamT.includes(t.toUpperCase())).map(nameKey);
    let out = rows.filter((r) => {
      if (f.pos.length && !f.pos.includes(r.position)) return false;
      if (posT.length && !posT.includes(r.position)) return false;
      if (f.team && r.team !== f.team) return false;
      if (teamT.length && !teamT.includes(r.team)) return false;
      if (text.length && !text.every((t) => r.key.includes(t))) return false;
      if (f.ageMin !== '' && !(r.age >= Number(f.ageMin))) return false;
      if (f.ageMax !== '' && !(r.age <= Number(f.ageMax))) return false;
      if (f.valMin !== '' && !(r.cur.value >= Number(f.valMin))) return false;
      if (f.inj === 'healthy' && r.injury) return false;
      if (f.inj === 'injured' && !r.injury) return false;
      if (f.exp === 'rookies' && !r.rookie) return false;
      if (f.exp === 'veterans' && r.rookie) return false;
      return true;
    });
    const col = COLUMNS.find((c) => c.key === f.sort) || COLUMNS[0];
    const dir = f.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
    return out;
  }

  function cell(c, r) {
    if (c.key === 'player') return h('td.player-cell', {}, h('div.player-name', {}, r.name, ' ', injuryBadge(r.injury ? { status: r.injury } : null), r.rookie ? h('span.badge.info', { style: { marginLeft: '.3rem' } }, 'R') : null));
    if (c.key === 'pos') return h('td', {}, posBadge(r.position));
    if (c.key === 'conf') return h('td', {}, confBadge(r.cur.confidence));
    if (c.key === 'updated') return h('td.small.muted.nowrap', {}, r.updated ? timeAgo(new Date(r.updated).toISOString()) : '—');
    if (c.key === 'rank') return h('td.num.muted', {}, r.cur.rank ?? '—');
    const v = c.get(r);
    return h('td', { class: `${c.num ? 'num' : ''} ${c.cls || ''}`.trim() }, c.fmt ? c.fmt(v) : v ?? '—');
  }

  function draw() {
    save(`players.filters.${app.mode}`, f);
    clear(tableHost);
    const list = filtered();
    const cols = COLUMNS.filter((c) => c.always || visible.includes(c.key));
    const shown = list.slice(0, f.limit);
    const sortBy = (c) => { if (f.sort === c.key) f.dir = f.dir === 'desc' ? 'asc' : 'desc'; else { f.sort = c.key; f.dir = c.num && c.key !== 'rank' && !c.key.endsWith('_rank') && c.key !== 'adp' && c.key !== 'age' ? 'desc' : 'asc'; } draw(); };
    // Keyboard: headers sort with Enter/Space, rows open with Enter (they were mouse-only).
    const activate = (fn) => (e) => { if (e.key === 'Enter' || (e.key === ' ' && e.currentTarget.tagName === 'TH')) { e.preventDefault(); fn(); } };
    const thead = h('thead', {}, h('tr', {}, cols.map((c) => h('th', {
      class: `sortable ${c.num ? 'num' : ''} ${f.sort === c.key ? `sorted ${f.dir}` : ''}`, title: c.title || '', tabindex: 0,
      'aria-sort': f.sort === c.key ? (f.dir === 'asc' ? 'ascending' : 'descending') : null,
      onclick: () => sortBy(c), onkeydown: activate(() => sortBy(c)),
    }, c.label))));
    const tbody = h('tbody', {}, shown.map((r) => h('tr.clickable', { tabindex: 0, title: 'Open details (Enter)', onclick: () => openPlayer(r.id), onkeydown: activate(() => openPlayer(r.id)) }, cols.map((c) => cell(c, r)))));
    tableHost.append(
      h('div.flex-between.small.muted.mb', {}, h('span', {}, `${list.length} players · showing ${shown.length} · values in ${cur.league.name}`), h('span', {}, 'Click a player for details and "Why this value?"')),
      h('div.table-wrap.desktop-table', {}, h('table.data', {}, thead, tbody)),
      h('div.mobile-cards', {}, shown.map((r) => h('div.pcard', { role: 'button', tabindex: 0, onclick: () => openPlayer(r.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(r.id); } } }, posBadge(r.position),
        h('div', {}, h('div.player-name', {}, r.name, ' ', injuryBadge(r.injury ? { status: r.injury } : null)), h('div.player-sub', {}, `${r.team || 'FA'} · ${fmtAge(r.age)} · market ${fmtValue(r.cur.groupValues?.market)}`)),
        h('div.num', {}, h('div.bold', {}, fmtValue(r.cur.value)), confBadge(r.cur.confidence))))),
      list.length > shown.length ? h('div.center.mt', {}, h('button.btn', { onclick: () => { f.limit += 200; draw(); } }, `Show more (${list.length - shown.length} remaining)`)) : null);
  }

  function exportCSV(kind) {
    const src = kind === 'filtered' ? filtered() : rows;
    const base = [{ key: 'name', label: 'player' }, { key: 'position', label: 'pos' }, { key: 'team', label: 'team' }, { key: 'age', label: 'age', get: (r) => (r.age ? r.age.toFixed(1) : '') }];
    const redCols = [{ key: 'rv', label: 'redraft_value', get: (r) => r.red ? Math.round(r.red.value) : '' }, { key: 'rr', label: 'redraft_rank', get: (r) => r.red?.rank ?? '' }, { key: 'rlo', label: 'redraft_range_low', get: (r) => r.red ? Math.round(r.red.range[0]) : '' }, { key: 'rhi', label: 'redraft_range_high', get: (r) => r.red ? Math.round(r.red.range[1]) : '' }, { key: 'proj', label: 'ros_projected_points', get: (r) => r.red?.details?.projection?.points?.toFixed(1) ?? '' }, { key: 'rmk', label: 'redraft_market_value', get: (r) => r.red?.groupValues?.market ? Math.round(r.red.groupValues.market) : '' }, { key: 'rc', label: 'redraft_confidence', get: (r) => r.red?.confidence?.label ?? '' }];
    const dynCols = [{ key: 'dv', label: 'dynasty_value', get: (r) => r.dyn ? Math.round(r.dyn.value) : '' }, { key: 'dr', label: 'dynasty_rank', get: (r) => r.dyn?.rank ?? '' }, { key: 'dlo', label: 'dynasty_range_low', get: (r) => r.dyn ? Math.round(r.dyn.range[0]) : '' }, { key: 'dhi', label: 'dynasty_range_high', get: (r) => r.dyn ? Math.round(r.dyn.range[1]) : '' }, { key: 'dmk', label: 'dynasty_market_value', get: (r) => r.dyn?.groupValues?.market ? Math.round(r.dyn.groupValues.market) : '' }, { key: 'dc', label: 'dynasty_confidence', get: (r) => r.dyn?.confidence?.label ?? '' }];
    const cols = kind === 'redraft' ? [...base, ...redCols] : kind === 'dynasty' ? [...base, ...dynCols] : [...base, ...redCols, ...dynCols];
    cols.push({ key: 'mv', label: 'model_version', get: () => cur.meta.model_version }, { key: 'dv2', label: 'data_version', get: () => cur.meta.data_version }, { key: 'lg', label: 'league', get: () => cur.league.name });
    download(`player-values-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(src, cols), 'text/csv');
  }

  draw();
}
