// TRADE CALCULATOR — the central experience.

import { h, clear, fmtValue, fmtSigned, fmtPct, fmtRange, fmtAge, posBadge, confBadge, injuryBadge, toast, download, fmtTime } from '../dom.js';
import { app, getValuations, load, save, activeProfile, playerData } from '../state.js';
import { analyzeTrade } from '../../core/valuation/trade.js';
import { COMPONENT_LABELS } from '../../core/valuation/engine.js';
import { pickAssetId } from '../../core/pick-labels.js';
import { assetSearchBox } from '../search.js';
import { openPlayer, openPickDetail } from './player-modal.js';
import { welcomeCard } from './help.js';
import { api, hasServer } from '../api.js';
import { toCSV } from '../../core/util/csv.js';
import { describeScoring } from '../../core/scoring.js';
import { starterSlotsSummary } from '../../core/settings.js';

const SIGNAL_LABELS = { market: 'Market value', consensus: 'Expert consensus', projection: 'Projection', production: 'Production', adp: 'ADP', fundamental: 'Fundamental (multi-year model)' };

function tradeKey() { return `trade.${app.mode}`; }
function getTrade() { return load(tradeKey(), { a: [], b: [] }); }
function setTrade(t) { save(tradeKey(), t); }

export function renderTrade(root) {
  const result = getValuations();
  if (!result) return;
  const trade = getTrade();
  // Drop assets that no longer exist (e.g. data changed) but keep custom pick ids (valued on demand).
  for (const side of ['a', 'b']) trade[side] = trade[side].filter((id) => result.getAsset(id));

  const sides = h('div.trade-layout');
  const summary = h('div.trade-summary');
  const history = h('div.panel.mt.no-print');
  if (!load('welcomeDismissed', false)) {
    const card = welcomeCard(() => { save('welcomeDismissed', true); card.remove(); });
    card.classList.add('no-print');
    root.append(card);
  }
  root.append(
    h('div.print-only', {}, h('h2', {}, `Trade analysis — ${app.mode.toUpperCase()} — ${activeProfile().name}`)),
    sides, summary, history,
  );

  const rerender = () => {
    setTrade(trade);
    clear(sides);
    sides.append(sidePanel('a'), sidePanel('b'));
    drawSummary();
  };

  function addAsset(side, a) {
    if (trade.a.includes(a.id) || trade.b.includes(a.id)) { toast(`${a.name} is already in this trade.`, 'warn'); return; }
    trade[side].push(a.id);
    rerender();
  }

  function sidePanel(side) {
    const ids = trade[side];
    const assets = ids.map((id) => result.getAsset(id)).filter(Boolean);
    const total = assets.reduce((s, a) => s + a.value, 0);
    const panel = h('section.panel.trade-side', { class: side === 'b' ? 'b' : '', 'aria-label': `Team ${side.toUpperCase()} receives` });
    panel.append(h('h2', {}, h('span', {}, `Team ${side.toUpperCase()} receives`), h('span.side-total', {}, fmtValue(total), h('small', {}, ` (${assets.length} asset${assets.length === 1 ? '' : 's'})`))));
    panel.append(assetSearchBox({
      getResult: () => result,
      onPick: (a) => addAsset(side, a),
      includePicks: app.mode === 'dynasty',
      exclude: () => new Set([...trade.a, ...trade.b]),
      placeholder: app.mode === 'dynasty' ? 'Add player or pick (e.g. "jefferson", "det rb", "2027 1st", "1.04")' : 'Add player (name, team or position)',
    }));
    if (app.mode === 'dynasty' && result.picks) panel.append(pickAdder((a) => addAsset(side, a)));
    if (!assets.length) panel.append(h('div.empty-side', {}, 'No assets yet — search above to add players', app.mode === 'dynasty' ? ' or picks' : '', '.'));
    else {
      const ul = h('ul.asset-list');
      for (const a of assets) ul.append(assetRow(a, () => { trade[side] = trade[side].filter((x) => x !== a.id); rerender(); }));
      panel.append(ul);
    }
    return panel;
  }

  function assetRow(a, remove) {
    const p = a.kind === 'player' ? playerData(a.id) : null;
    const inj = p && p.injury ? injuryBadge({ status: p.injury.status || p.injury.official_status, source: p.injury.official_status ? 'official' : 'reported' }) : null;
    const meta = a.kind === 'player'
      ? [a.team || 'FA', a.age ? `age ${fmtAge(a.age)}` : null, `${a.position}${a.posRank || ''}`].filter(Boolean).join(' · ')
      : a.details?.slots?.length > 1 ? `slot range ${a.details.slots[0]}–${a.details.slots[a.details.slots.length - 1]}` : 'rookie draft pick';
    return h('li.asset', {},
      posBadge(a.position),
      h('div', { style: { minWidth: 0 } },
        h('div.name', { onclick: () => (a.kind === 'player' ? openPlayer(a.id) : openPickDetail(a.id)), title: 'Open details' }, a.name, ' ', inj),
        h('div.meta', {}, meta, ' · ', confBadge(a.confidence))),
      h('div.val', { title: `Approximate fair-value range ${fmtRange(a.range)}` }, fmtValue(a.value), h('small', {}, `±${fmtValue(a.sigma)}`)),
      h('button.x', { onclick: remove, title: 'Remove', 'aria-label': `Remove ${a.name}` }, '×'));
  }

  function pickAdder(onAdd) {
    const p = result.picks;
    const year = h('select', { 'aria-label': 'Pick year' }, p.seasons.map((s) => h('option', { value: s }, s)));
    const round = h('select', { 'aria-label': 'Round' }, Array.from({ length: p.rounds }, (_, i) => h('option', { value: i + 1 }, `Round ${i + 1}`)));
    const slot = h('select', { 'aria-label': 'Slot' });
    const fillSlots = () => {
      clear(slot);
      const r = Number(round.value);
      slot.append(h('option', { value: 'unknown' }, 'Slot unknown'), h('option', { value: 'early' }, 'Early (projected)'), h('option', { value: 'mid' }, 'Mid (projected)'), h('option', { value: 'late' }, 'Late (projected)'), h('option', { value: 'range' }, 'Custom range…'));
      for (let k = 1; k <= result.league.teams; k++) slot.append(h('option', { value: k }, `${r}.${String(k).padStart(2, '0')}`));
    };
    round.addEventListener('change', fillSlots);
    fillSlots();
    const add = () => {
      const d = { season: Number(year.value), round: Number(round.value), slot: null, bucket: null, range: null };
      const v = slot.value;
      if (v === 'early' || v === 'mid' || v === 'late') d.bucket = v;
      else if (v === 'range') {
        const txt = prompt(`Projected slot range for ${d.season} round ${d.round}, e.g. "3-7" (1–${result.league.teams})`, '4-8');
        const m = txt && txt.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (!m) return;
        d.range = [Math.max(1, Math.min(+m[1], +m[2])), Math.min(result.league.teams, Math.max(+m[1], +m[2]))];
      } else if (v !== 'unknown') d.slot = Number(v);
      const a = result.getAsset(pickAssetId(d));
      if (a) onAdd(a); else toast('No value available for that pick.', 'warn');
    };
    return h('div.pick-adder', {}, h('span.muted', {}, 'Add pick:'), year, round, slot, h('button.btn.btn-sm', { onclick: add }, '+ Add'));
  }

  function drawSummary() {
    clear(summary);
    const ana = analyzeTrade(result, trade.a, trade.b, { dataSources: Object.fromEntries(Object.entries(app.dataset.sources).map(([k, v]) => [k, v.last_success])) });
    const [A, B] = ana.sides;
    if (!A.assets.length && !B.assets.length) {
      summary.append(h('div.panel.muted.center', {}, 'Add assets to both sides to see the analysis.'));
      return;
    }
    const max = Math.max(A.adjusted, B.adjusted, A.raw, B.raw, 1);
    const bar = (label, side, cls) => h('div.bar-row', {},
      h('span.bold', {}, label),
      h('div.bar-track', {},
        h('div.bar-fill', { class: cls, style: { width: `${(side.adjusted / max) * 100}%` } }),
        side.sigma > 0 ? h('div.bar-range', { style: { left: `${(Math.max(0, side.adjusted - side.sigma) / max) * 100}%`, width: `${((Math.min(max, side.adjusted + side.sigma) - Math.max(0, side.adjusted - side.sigma)) / max) * 100}%` }, title: `±${fmtValue(side.sigma)} uncertainty` }) : null),
      h('span.num.bold', {}, fmtValue(side.adjusted)));
    const leader = ana.diff > 0 ? 'Team A' : ana.diff < 0 ? 'Team B' : '—';
    const market = ana.signalDiffs.find((s) => s.key === 'market');
    const proj = ana.signalDiffs.find((s) => s.key === 'projection') || ana.signalDiffs.find((s) => s.key === 'fundamental');

    const panel = h('section.panel', {},
      h('div.panel-head', {}, h('h2', {}, 'Trade analysis'),
        h('div.flex.no-print', {},
          h('button.btn.btn-sm', { onclick: () => { [trade.a, trade.b] = [trade.b, trade.a]; rerender(); } }, '⇄ Swap'),
          h('button.btn.btn-sm', { onclick: () => saveTrade(ana) }, '★ Save'),
          h('button.btn.btn-sm', { onclick: () => exportTrade(ana) }, '⤓ Export'),
          h('button.btn.btn-sm', { onclick: () => window.print() }, '⎙ Print'),
          h('button.btn.btn-sm.btn-danger', { onclick: () => { trade.a = []; trade.b = []; rerender(); } }, 'Clear'))),
      h('div.bars', {}, bar('Team A', A, 'a'), bar('Team B', B, 'b')),
      h('div.kpis.mt', {},
        kpi('Difference', `${fmtSigned(ana.diff)}`, `${leader === '—' ? 'even' : `${leader} receives more`}`),
        kpi('Percent', fmtPct(ana.pct), 'of the larger side'),
        kpi('Model uncertainty', `±${fmtValue(ana.sigmaDiff)}`, ana.z < 1 ? 'difference within range' : `difference = ${ana.z.toFixed(1)}× range`),
        market ? kpi('Market difference', fmtSigned(market.diff), 'market signal only', 'market-v') : null,
        proj ? kpi(proj.key === 'fundamental' ? 'Fundamental difference' : 'Projection difference', fmtSigned(proj.diff), proj.key === 'fundamental' ? 'multi-year model only' : 'projection signal only', 'model-v') : null),
      h('div.verdict.mt', { class: ana.assessment.level }, h('strong', {}, 'Interpretation: '), ana.assessment.text),
      ana.notes.length ? h('ul.small.mt-s', {}, ana.notes.map((n) => h('li', {}, n))) : null,
    );

    // component differences
    const compRows = ana.componentDiffs.filter((c) => Math.abs(c.a) + Math.abs(c.b) > 0.5);
    const maxAbs = Math.max(1, ...compRows.map((c) => Math.abs(c.diff)));
    panel.append(h('div.grid-2.mt', {},
      h('div', {},
        h('h3', {}, 'What drives the difference'),
        h('p.small.muted', {}, 'Each side\'s total split into the model\'s components (sums to the raw totals). Positive = favours Team A.'),
        h('table.data.comp-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Component'), h('th.num', {}, 'Team A'), h('th.num', {}, 'Team B'), h('th.num', {}, 'A − B'), h('th.hide-mobile', {}, ''))),
          h('tbody', {}, compRows.map((c) => h('tr', {},
            h('td', {}, COMPONENT_LABELS[c.key] || c.key),
            h('td.num', {}, fmtValue(c.a)), h('td.num', {}, fmtValue(c.b)),
            h('td.num.bold', { class: c.diff > 0 ? 'trend-up' : c.diff < 0 ? 'trend-down' : '' }, fmtSigned(c.diff)),
            h('td.bar-cell.hide-mobile', {}, h('div', { style: { display: 'flex', justifyContent: c.diff >= 0 ? 'flex-start' : 'flex-end' } }, h('div.hbar', { class: c.diff < 0 ? 'neg' : '', style: { width: `${(Math.abs(c.diff) / maxAbs) * 100}%` } })))))),
          h('tfoot', {}, h('tr', {}, h('td', {}, 'Raw total'), h('td.num', {}, fmtValue(A.raw)), h('td.num', {}, fmtValue(B.raw)), h('td.num', {}, fmtSigned(A.raw - B.raw)), h('td.hide-mobile', {}, ''))))),
      h('div', {},
        h('h3', {}, 'Signals compared separately'),
        h('p.small.muted', {}, 'Each independent signal on the same scale. Market (what managers trade for) and model signals are deliberately kept apart.'),
        h('table.data', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Signal'), h('th.num', {}, 'Team A'), h('th.num', {}, 'Team B'), h('th.num', {}, 'A − B'))),
          h('tbody', {}, ana.signalDiffs.map((s) => h('tr', {}, h('td', { class: s.key === 'market' ? 'market-v bold' : '' }, SIGNAL_LABELS[s.key] || s.key), h('td.num', {}, fmtValue(s.a)), h('td.num', {}, fmtValue(s.b)), h('td.num.bold', {}, fmtSigned(s.diff)))))),
        h('p.tiny.muted', {}, 'Signals are only summed over assets that have that signal; picks have no market/projection split here.'))));

    // package adjustments
    const pk = [A.package, B.package].map((p, i) => ({ ...p, team: i ? 'B' : 'A' })).filter((p) => p.items.length);
    panel.append(h('details.mt', { open: pk.length ? true : null },
      h('summary', {}, `Package / consolidation adjustment ${pk.length ? `(${pk.map((p) => `Team ${p.team} −${fmtValue(p.total)}`).join(', ')})` : '(none — equal player counts)'}`),
      h('p.small.muted', {}, 'A 3-for-1 is not worth the sum of three independent values: extra players compete for limited lineup spots and need roster spots. Settings → Trade Package Adjustments controls this.'),
      pk.length ? pk.map((p) => h('div.math.mt-s', {}, `Team ${p.team} receives ${p.nExtra} more player(s) than it sends:\n${p.explanation.join('\n')}\nTotal: ${fmtValue(p.items.reduce((s, x) => s + x.value, 0))} raw → −${fmtValue(p.total)} adjustment`)) : null,
      h('div.math.mt-s', {}, `Team A: ${fmtValue(A.raw)} raw − ${fmtValue(A.package.total)} package = ${fmtValue(A.adjusted)}\nTeam B: ${fmtValue(B.raw)} raw − ${fmtValue(B.package.total)} package = ${fmtValue(B.adjusted)}\nDifference: ${fmtSigned(ana.diff)} (${fmtPct(ana.pct)}), uncertainty ±${fmtValue(ana.sigmaDiff)} = √(${fmtValue(A.sigma)}² + ${fmtValue(B.sigma)}²)`)));

    // dynasty: now vs future, age
    if (app.mode === 'dynasty') {
      const tot = (s) => Math.max(1, (s.now || 0) + (s.future || 0));
      const split = (s, cls) => h('div', {}, h('div.flex-between.small', {}, h('span', {}, `Now (current season) ${fmtValue(s.now)}`), h('span', {}, `Future ${fmtValue(s.future)}`)),
        h('div.split-bar', {}, h('span', { style: { width: `${(Math.max(0, s.now) / tot(s)) * 100}%`, background: cls === 'a' ? 'var(--team-a)' : 'var(--team-b)' } }), h('span', { style: { width: `${(Math.max(0, s.future) / tot(s)) * 100}%`, background: 'var(--border-strong)' } })));
      panel.append(h('div.grid-2.mt', {},
        h('div', {}, h('h3', {}, 'Win-now vs future value'), h('p.small.muted', {}, 'Year-1 model value vs future seasons (age curve, longevity, prospect value, picks); market/consensus split in the same proportion.'),
          h('div.stack', {}, h('div', {}, h('div.bold.small', {}, 'Team A'), split(A, 'a')), h('div', {}, h('div.bold.small', {}, 'Team B'), split(B, 'b')))),
        h('div', {}, h('h3', {}, 'Age & positions'),
          h('table.data', {}, h('tbody', {},
            h('tr', {}, h('td', {}, 'Value-weighted age'), h('td.num', {}, fmtAge(A.valueWeightedAge)), h('td.num', {}, fmtAge(B.valueWeightedAge))),
            h('tr', {}, h('td', {}, 'Positions received'), h('td.num.small', {}, Object.entries(A.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—'), h('td.num.small', {}, Object.entries(B.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—')))))));
    } else {
      panel.append(h('div.mt.small.muted', {}, 'Positions received — Team A: ', Object.entries(A.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—', ' · Team B: ', Object.entries(B.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—'));
    }

    // reproducibility
    const l = result.league;
    panel.append(h('details.mt', {},
      h('summary', {}, 'Calculation details (reproducibility)'),
      h('dl.kv.mt-s', {},
        h('dt', {}, 'Calculated'), h('dd', {}, new Date(ana.audit.calculated_at).toLocaleString()),
        h('dt', {}, 'Model version'), h('dd', {}, ana.audit.model_version),
        h('dt', {}, 'Data snapshot'), h('dd', {}, `${ana.audit.data_version} (built ${fmtTime(ana.audit.dataset_built_at)})`),
        h('dt', {}, 'Settings hash'), h('dd', {}, ana.audit.settings_hash),
        h('dt', {}, 'League'), h('dd', {}, `${l.name} · ${l.teams} teams · ${l.qb_format.toUpperCase()} · ${starterSlotsSummary(l)} · bench ${l.roster.BENCH} · ${describeScoring(result.scoring)}`),
        h('dt', {}, 'Season phase'), h('dd', {}, `${result.phase.season} week ${result.phase.week} (${result.phase.phase}, in-season weight ${Math.round(result.phase.alpha * 100)}%)`),
        h('dt', {}, 'Reference league'), h('dd', {}, result.meta.reference_league))));
    summary.append(panel);
  }

  function kpi(k, v, s, cls) { return h('div.kpi', {}, h('div.k', {}, k), h('div.v', { class: cls || '' }, v), h('div.s', {}, s)); }

  async function saveTrade(ana) {
    const entry = {
      mode: app.mode, profile: activeProfile().name, a: trade.a, b: trade.b,
      names: { a: ana.sides[0].assets.map((x) => x.name), b: ana.sides[1].assets.map((x) => x.name) },
      totals: { a: ana.sides[0].adjusted, b: ana.sides[1].adjusted, diff: ana.diff, pct: ana.pct, sigma: ana.sigmaDiff },
      values: Object.fromEntries([...ana.sides[0].assets, ...ana.sides[1].assets].map((x) => [x.id, { value: x.value, components: x.components }])),
      audit: ana.audit,
    };
    if (hasServer()) {
      try { await api.post('/api/trades', entry); toast('Trade saved to history.'); drawHistory(); return; } catch (e) { toast(`Server save failed (${e.message}); saved locally.`, 'warn'); }
    }
    const local = load('trades', []);
    local.unshift({ id: `l_${Date.now().toString(36)}`, saved_at: new Date().toISOString(), ...entry });
    save('trades', local.slice(0, 200));
    toast('Trade saved locally.');
    drawHistory();
  }

  function exportTrade(ana) {
    const rows = [];
    for (const [i, s] of ana.sides.entries()) for (const a of s.assets) rows.push({ side: i ? 'B receives' : 'A receives', asset: a.name, position: a.position, team: a.team || '', age: a.age ? a.age.toFixed(1) : '', value: Math.round(a.value), range_low: Math.round(a.range[0]), range_high: Math.round(a.range[1]), confidence: a.confidence || '', ...Object.fromEntries(Object.entries(a.components).map(([k, v]) => [`c_${k}`, Math.round(v)])) });
    rows.push({ side: 'TOTAL A (adjusted)', value: Math.round(ana.sides[0].adjusted) }, { side: 'TOTAL B (adjusted)', value: Math.round(ana.sides[1].adjusted) }, { side: 'DIFFERENCE', value: Math.round(ana.diff), asset: fmtPct(ana.pct) });
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    download(`trade-${app.mode}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows, cols), 'text/csv');
    download(`trade-${app.mode}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(ana, null, 2), 'application/json');
  }

  async function drawHistory() {
    clear(history);
    history.append(h('div.panel-head', {}, h('h3', {}, 'Saved trades'), h('span.small.muted', {}, 'Every saved trade stores model version, data snapshot, league settings and per-asset values so it can be re-checked later.')));
    let trades = [];
    if (hasServer()) { try { trades = (await api.get('/api/trades')).trades || []; } catch { /* ignore */ } }
    trades = [...trades, ...load('trades', [])].filter((t) => t.mode === app.mode).sort((x, y) => (y.saved_at || '').localeCompare(x.saved_at || ''));
    if (!trades.length) { history.append(h('p.muted.small', {}, 'No saved trades in this mode yet.')); return; }
    const tbl = h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Saved'), h('th', {}, 'Team A receives'), h('th', {}, 'Team B receives'), h('th.num', {}, 'Then'), h('th.num', {}, 'Now'), h('th', {}, ''))));
    const tb = h('tbody');
    for (const t of trades.slice(0, 30)) {
      let now = null;
      try { const ana = analyzeTrade(result, t.a, t.b); now = ana.diff; } catch { /* ignore */ }
      tb.append(h('tr', {},
        h('td.small.nowrap', {}, fmtTime(t.saved_at), h('div.tiny.muted', {}, `model ${t.audit?.model_version} · ${t.audit?.data_version}`)),
        h('td.small', {}, (t.names?.a || []).join(', ')), h('td.small', {}, (t.names?.b || []).join(', ')),
        h('td.num', {}, fmtSigned(t.totals?.diff)), h('td.num.bold', {}, now === null ? '—' : fmtSigned(now)),
        h('td.nowrap', {}, h('button.btn.btn-xs', { onclick: () => { trade.a = [...t.a]; trade.b = [...t.b]; rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Load'), ' ',
          h('button.btn.btn-xs', { onclick: () => explainChange(t) }, 'Why changed?'), ' ',
          h('button.btn.btn-xs.btn-danger', { onclick: async () => {
            if (String(t.id).startsWith('l_')) save('trades', load('trades', []).filter((x) => x.id !== t.id));
            else if (hasServer()) await api.del(`/api/trades/${t.id}`).catch(() => {});
            drawHistory();
          } }, '✕'))));
    }
    tbl.append(tb);
    history.append(h('div.table-wrap', {}, tbl));
  }

  function explainChange(t) {
    const lines = [];
    for (const id of [...t.a, ...t.b]) {
      const then = t.values?.[id];
      const now = result.getAsset(id);
      if (!then || !now) continue;
      const d = now.value - then.value;
      if (Math.abs(d) < 25) continue;
      const keys = new Set([...Object.keys(then.components || {}), ...Object.keys(now.components || {})]);
      const drivers = [...keys].map((k) => ({ k, d: (now.components[k] || 0) - (then.components?.[k] || 0) })).filter((x) => Math.abs(x.d) >= 10).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 4);
      lines.push(`${now.name}: ${fmtValue(then.value)} → ${fmtValue(now.value)} (${fmtSigned(d)})${drivers.length ? ` — ${drivers.map((x) => `${fmtSigned(x.d)} ${COMPONENT_LABELS[x.k] || x.k}`).join(', ')}` : ''}`);
    }
    const sameModel = t.audit?.model_version === result.meta.model_version;
    const sameSettings = t.audit?.settings_hash === result.meta.settings_hash;
    const head = [`Saved with model ${t.audit?.model_version}, data ${t.audit?.data_version}.`, sameModel ? '' : `Model changed to ${result.meta.model_version}.`, sameSettings ? '' : 'League/model settings differ from the saved calculation.'].filter(Boolean).join(' ');
    toast(`${head}\n${lines.length ? lines.join('\n') : 'No asset moved more than 25 points.'}`, 'ok', 12000);
  }

  rerender();
  drawHistory();
}
