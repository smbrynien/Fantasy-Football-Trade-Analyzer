// COMPARISON TOOL — side-by-side players (and picks in dynasty).

import { h, clear, fmtValue, fmt1, fmtAge, fmtPctPlain, posBadge, confBadge, fmtRange } from '../dom.js';
import { app, getValuations, load, save, playerData, isStringArray, activeProfile } from '../state.js';

const activeName = () => activeProfile().name;
import { assetSearchBox } from '../search.js';
import { openPlayer, openPickDetail } from './player-modal.js';
import { lineChart } from '../charts.js';
import { compareSummary } from '../trade-helpers.js';

const COLORS = ['#2563eb', '#ea580c', '#059669', '#7c3aed', '#dc2626', '#0891b2', '#ca8a04', '#db2777'];

export function renderCompare(root) {
  const res = getValuations();
  const red = getValuations('redraft');
  const dyn = app.mode === 'dynasty' ? res : null;
  let ids = load(`compare.${app.mode}`, [], isStringArray).filter((id) => res.getAsset(id));
  const host = h('div');
  root.append(h('div.panel', {},
    h('div.panel-head', {}, h('h2', {}, 'Compare'), h('span.small.muted', {}, app.mode === 'dynasty' ? 'Players and picks — player vs player, player vs pick, pick vs pick.' : 'Up to 8 players side by side.')),
    assetSearchBox({ getResult: () => res, includePicks: app.mode === 'dynasty', taken: () => new Map(ids.map((id) => [id, 'the comparison'])), onPick: (a) => { if (ids.length >= 8) return; ids.push(a.id); draw(); } })), host);

  function draw() {
    save(`compare.${app.mode}`, ids);
    clear(host);
    const assets = ids.map((id) => res.getAsset(id)).filter(Boolean);
    if (!assets.length) {
      // Most comparisons start from a trade being considered: offer its assets in one click.
      const t = load(`trade.${app.mode}`, { a: [], b: [] }, (x) => x && isStringArray(x.a) && isStringArray(x.b));
      const fromTrade = [...new Set([...t.a, ...t.b])].filter((id) => res.getAsset(id)).slice(0, 8);
      host.append(h('div.panel.muted.center.mt', {}, h('p', {}, 'Search above to add up to 8 players', app.mode === 'dynasty' ? ' or picks' : '', '.'),
        fromTrade.length ? h('button.btn.btn-sm', { onclick: () => { ids = fromTrade; draw(); } }, `Compare the ${fromTrade.length} asset${fromTrade.length === 1 ? '' : 's'} in your current trade`) : null));
      return;
    }
    const metric = (label, fn, cls = '') => h('tr', {}, h('td.muted', {}, label), assets.map((a) => h('td.num', { class: cls }, fn(a) ?? '—')));
    const rd = (a) => (a.kind === 'player' ? red.assets.get(a.id) : null);
    const rows = [
      metric(`${app.mode === 'dynasty' ? 'Dynasty' : 'Redraft'} value`, (a) => h('strong', {}, fmtValue(a.value)), 'model-v'),
      metric('Fair-value range', (a) => fmtRange(a.range)),
      metric('Confidence', (a) => confBadge(a.confidence)),
      metric('Market value', (a) => fmtValue(a.groupValues?.market), 'market-v'),
      metric('Consensus value', (a) => fmtValue(a.groupValues?.consensus)),
      metric('Overall / positional rank', (a) => (a.rank ? `${a.rank} / ${a.position}${a.posRank}` : '—')),
      metric('Age', (a) => fmtAge(a.age)),
      metric('Team', (a) => a.team || '—'),
      metric('Projected pts (ROS)', (a) => fmt1(rd(a)?.details?.projection?.points)),
      metric('Points per game', (a) => fmt1(rd(a)?.details?.production?.ppg)),
      metric('Expected PPG (opportunity)', (a) => fmt1(rd(a)?.details?.production?.xppg)),
    ];
    if (app.mode === 'dynasty') {
      rows.push(
        metric('Redraft value', (a) => fmtValue(rd(a)?.value)),
        metric('Future value (yrs 2+ & prospect)', (a) => (a.kind === 'player' ? fmtValue((a.components.longevity || 0) + (a.components.prospect || 0)) : fmtValue(a.value))),
        metric('Career horizon', (a) => (a.details?.careerHorizon !== undefined && a.details?.careerHorizon !== null ? `${a.details.careerHorizon} yrs` : '—')),
        metric('Startable next season', (a) => fmtPctPlain(a.details?.breakoutProb)),
        metric('Decline risk', (a) => fmtPctPlain(a.details?.declineProb)),
        metric('Volatility (±range / value)', (a) => (a.value ? fmtPctPlain(a.sigma / a.value) : '—')),
        metric('Draft capital', (a) => { const p = playerData(a.id); return p?.draft?.year ? `${p.draft.year}${p.draft.round ? ` R${p.draft.round}${p.draft.pick ? `.${p.draft.pick}` : ''}` : ''}` : a.kind === 'pick' ? 'pick' : '—'; }),
      );
    }
    const table = h('div.table-wrap', {}, h('table.data', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), assets.map((a, i) => h('th.num', { style: { borderTop: `3px solid ${COLORS[i % COLORS.length]}` } },
        h('div.flex', { style: { justifyContent: 'flex-end' } }, posBadge(a.position), h('a', { href: 'javascript:void 0', onclick: () => (a.kind === 'player' ? openPlayer(a.id) : openPickDetail(a.id)) }, a.name),
          h('button.btn.btn-xs.btn-ghost', { onclick: () => { ids = ids.filter((x) => x !== a.id); draw(); }, title: 'Remove', 'aria-label': `Remove ${a.name}` }, '×')))))),
      h('tbody', {}, rows)));
    // The answer first ("who has more value, and is the gap bigger than the uncertainty?"), then the evidence.
    const sum = compareSummary(assets);
    const head = sum ? h('div.compare-summary', { role: 'status' },
      h('div', {}, h('strong', {}, sum.leader.name), ` has the highest ${app.mode} value (${fmtValue(sum.leader.value)}) in ${activeName()}.`),
      h('ul.compare-gaps', {}, sum.rows.map((r) => h('li', {}, h('span.bold', {}, r.name), `: ${fmtValue(r.gap)} less (−${Math.round(r.pct * 100)}%) — `,
        r.close ? h('span', {}, 'about the same: the gap is within their combined ± range') : h('span', {}, 'a real gap: bigger than their combined ± range'))))) : null;
    host.append(h('div.panel.mt', {}, head, table));
    if (dyn) {
      const series = assets.filter((a) => a.details?.years).map((a) => ({ label: a.name, color: COLORS[ids.indexOf(a.id) % COLORS.length], points: a.details.years.map((y) => [y.season, y.ppg]) }));
      if (series.length) host.append(h('div.panel.mt', {}, h('h3', {}, 'Projected points per game by season (aging curve)'), lineChart(series, { yMin: 0, yFormat: (v) => v.toFixed(0), height: 240 }), h('p.small.muted', {}, 'Multi-year projections are uncertain; see each player\'s Dynasty tab for ranges.')));
    }
  }
  draw();
}
