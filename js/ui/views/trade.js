// TRADE CALCULATOR — the central experience.

import { h, clear, fmtValue, fmtSigned, fmtPct, fmtRange, fmtAge, posBadge, confBadge, injuryBadge, toast, download, fmtTime, copyText, openModal } from '../dom.js';
import { app, getValuations, load, save, activeProfile, playerData, isPlainObject, isStringArray, myRoster } from '../state.js';
import { analyzeTrade } from '../../core/valuation/trade.js';
import { balanceSuggestions, comboSuggestions } from '../../core/valuation/balance.js';
import { compareCounteroffers, addVariant, sameTrade, variantLabel, MAX_VARIANTS } from '../../core/counteroffers.js';
import { leadText, verdictHeadline, marketCheck, outcomeText, tradeFromHash, tradeHash, sideNames, relabel, mid } from '../trade-helpers.js';
import { rosterImpact } from '../../core/roster.js';
import { pointsPerGame, rosterExpectation } from './team.js';
import { COMPONENT_LABELS } from '../../core/valuation/engine.js';
import { pickAssetId, parsePickAssetId, pickDisplayName } from '../../core/pick-labels.js';
import { assetSearchBox } from '../search.js';
import { openPlayer, openPickDetail } from './player-modal.js';
import { welcomeCard } from './help.js';
import { api, hasServer } from '../api.js';
import { toCSV } from '../../core/util/csv.js';
import { describeScoring } from '../../core/scoring.js';
import { starterSlotsSummary } from '../../core/settings.js';

const SIGNAL_LABELS = { market: 'Market value', consensus: 'Expert consensus', projection: 'Projection', production: 'Production', adp: 'ADP', fundamental: 'Fundamental (multi-year model)' };

function tradeKey() { return `trade.${app.mode}`; }
function getTrade() { return load(tradeKey(), { a: [], b: [] }, (t) => isPlainObject(t) && isStringArray(t.a) && isStringArray(t.b)); }
const isSavedTrade = (t) => isPlainObject(t) && isStringArray(t.a) && isStringArray(t.b);
const localTrades = () => load('trades', [], Array.isArray).filter(isSavedTrade);
function setTrade(t) { save(tradeKey(), t); }
// Counteroffer table: the original offer and its variants, per mode (asset ids only; re-analyzed on every render).
const countersKey = () => `counters.${app.mode}`;
const getVariants = () => load(countersKey(), [], Array.isArray).filter(isSavedTrade).slice(0, MAX_VARIANTS)
  .map((v) => ({ a: v.a, b: v.b, ...(typeof v.label === 'string' && v.label ? { label: v.label.slice(0, 40) } : {}) }));
const setVariants = (list) => save(countersKey(), list);
const assetName = (id) => playerData(id)?.name || (String(id).startsWith('pick:') && parsePickAssetId(id) ? pickDisplayName(parsePickAssetId(id)) : id);
// Generic picks (slot unknown, early/mid/late, projected range) can legitimately appear more than once — e.g. two
// 2027 1sts owned from different teams. Players and exact slots (2027 1.04) are unique.
const repeatable = (id) => /^pick:\d{4}:\d+(?::(?:early|mid|late|r\d+-\d+))?$/.test(id);

export function renderTrade(root) {
  const result = getValuations();
  if (!result) return;
  let trade = getTrade();
  const shared = tradeFromHash(location.hash);
  const differs = shared && (shared.a.join() !== trade.a.join() || shared.b.join() !== trade.b.join());
  // Don't silently throw away a trade in progress: ask before a link replaces it.
  if (differs && (trade.a.length || trade.b.length) && !confirm('Replace the trade you are building with the trade from this link?')) {
    history.replaceState(null, '', '#/trade');
  } else if (shared) {
    trade = shared;
    history.replaceState(null, '', '#/trade'); // the link was consumed; later edits must not fight the URL
    toast('Loaded the trade from the link.');
  }
  // Drop assets that no longer exist (e.g. data changed) but keep custom pick ids (valued on demand) — and say which.
  const dropped = [];
  for (const side of ['a', 'b']) trade[side] = trade[side].filter((id) => result.getAsset(id) || (dropped.push(id), false));
  if (dropped.length) {
    setTrade(trade);
    toast(`Removed from the trade (no value in this mode with current data): ${dropped.map(assetName).join(', ')}.`, 'warn');
  }

  // My Team (optional): which side is "me", detected from the roster when not chosen yet.
  const roster = myRoster();
  const onRoster = (id) => roster.ids.includes(id);
  const N = () => sideNames(trade.me);

  const sides = h('div.trade-layout');
  const summary = h('div.trade-summary');
  const historyEl = h('div.panel.mt.no-print');
  const countersEl = h('section.panel.mt.no-print.counters', { 'aria-label': 'Compare counteroffers', hidden: true });
  const sticky = h('div.trade-sticky.no-print', { hidden: true, role: 'status' });
  if (!load('welcomeDismissed', false)) {
    const card = welcomeCard(() => { save('welcomeDismissed', true); card.remove(); });
    card.classList.add('no-print');
    root.append(card);
  }
  // Always say which engine and league the numbers are for — the most common source of "why is this different?".
  const MODE_TEXT = { redraft: 'rest-of-season value: projections, this season\'s production, experts and the trade market, measured against your league\'s starting lineup.', dynasty: 'multi-year value: current production plus age, future seasons and draft capital, discounted to today.' };
  const contextEl = h('div');
  const drawContext = () => clear(contextEl).append(
    h('div.trade-context.no-print', {}, h('span.mode-badge', { class: app.mode }, app.mode === 'dynasty' ? 'Dynasty' : 'Redraft'), ' ',
      h('strong', {}, activeProfile().name), h('span.muted', {}, ` — ${MODE_TEXT[app.mode]} `), h('a', { href: '#/settings' }, 'Change league'),
      h('div.side-picker', {},
        h('label', {}, 'Which side is you? ', h('select', { 'aria-label': 'Which side is your team', onchange: (e) => { trade.me = e.target.value || undefined; rerender(); } },
          h('option', { value: '' }, 'Neither (neutral)'), h('option', { value: 'a', selected: trade.me === 'a' ? true : null }, 'Team A'), h('option', { value: 'b', selected: trade.me === 'b' ? true : null }, 'Team B'))),
        roster.ids.length
          ? h('span.muted', {}, ` · My Team: ${roster.ids.length} assets — `, h('a', { href: '#/team' }, 'edit'))
          : h('span.muted', {}, ' · ', h('a', { href: '#/team' }, 'Add your roster'), ' to see how a trade changes your starting lineup (optional).'))));
  root.append(
    contextEl,
    h('div.print-only', {}, h('h2', {}, `Trade analysis — ${app.mode.toUpperCase()} — ${activeProfile().name}`)),
    sides, summary, countersEl, historyEl, sticky,
  );

  const detectMe = () => {
    if (trade.me === 'a' || trade.me === 'b' || !roster.ids.length) return;
    // My assets are what the OTHER side receives.
    if (trade.b.some(onRoster) && !trade.a.some(onRoster)) trade.me = 'a';
    else if (trade.a.some(onRoster) && !trade.b.some(onRoster)) trade.me = 'b';
  };
  const rerender = () => {
    detectMe();
    setTrade(trade);
    drawContext();
    clear(sides);
    sides.append(sidePanel('a'), sidePanel('b'));
    drawSummary();
    drawCounters();
  };

  function addAsset(side, a) { addAssets(side, [a]); }
  function addAssets(side, list) {
    for (const a of list) {
      if (!repeatable(a.id) && (trade.a.includes(a.id) || trade.b.includes(a.id))) { toast(`${a.name} is already in this trade.`, 'warn'); return; }
    }
    trade[side].push(...list.map((a) => a.id));
    rerender();
  }

  function sidePanel(side) {
    const ids = trade[side];
    const assets = ids.map((id) => result.getAsset(id)).filter(Boolean);
    // Same number as the bars and the verdict: after the package adjustment (the raw sum used to be shown here).
    const sideAna = currentAnalysis().sides[side === 'a' ? 0 : 1];
    const label = `${N()[side.toUpperCase()]} receives`;
    const panel = h('section.panel.trade-side', { class: side === 'b' ? 'b' : '', 'aria-label': label });
    panel.append(h('h2', {}, h('span', {}, label),
      h('span.side-total', { title: sideAna.package.total ? `${fmtValue(sideAna.raw)} raw − ${fmtValue(sideAna.package.total)} package adjustment` : 'Sum of the asset values' },
        fmtValue(sideAna.adjusted), h('small', {}, ` (${assets.length} asset${assets.length === 1 ? '' : 's'})`),
        sideAna.package.total ? h('small.block.muted', {}, `${fmtValue(sideAna.raw)} before package adj.`) : null)));
    panel.append(assetSearchBox({
      getResult: () => result,
      onPick: (a) => addAsset(side, a),
      includePicks: app.mode === 'dynasty',
      exclude: () => new Set([...trade.a, ...trade.b].filter((id) => !repeatable(id))),
      placeholder: app.mode === 'dynasty' ? 'Add player or pick (e.g. "jefferson", "det rb", "2027 1st", "1.04")' : 'Add player (name, team or position)',
    }));
    if (app.mode === 'dynasty' && result.picks) panel.append(pickAdder((a) => addAsset(side, a)));
    // The other side receives what I give: offer my roster as a list instead of making me search for my own players.
    if (roster.ids.length && trade.me && side !== trade.me) {
      const inTrade = new Set([...trade.a, ...trade.b]);
      const mine = [...new Set(roster.ids)].filter((id) => !inTrade.has(id) || repeatable(id)).map((id) => result.getAsset(id)).filter(Boolean).sort((x, y) => y.value - x.value);
      if (mine.length) {
        panel.append(h('div.pick-adder', {}, h('span.muted', {}, 'From my roster:'),
          h('select', { 'aria-label': 'Add an asset from my roster', onchange: (e) => { const a = result.getAsset(e.target.value); if (a) addAsset(side, a); } },
            h('option', { value: '' }, `Choose one of your ${mine.length} assets…`), mine.map((a) => h('option', { value: a.id }, `${a.name} · ${a.position}${a.posRank || ''} · ${fmtValue(a.value)}`)))));
      }
    }
    if (!assets.length) panel.append(h('div.empty-side', {}, 'No assets yet — search above to add players', app.mode === 'dynasty' ? ' or picks' : '', '.'));
    else {
      const ul = h('ul.asset-list');
      // Remove by position, not by id: removing one of two identical picks must leave the other.
      ids.forEach((id, i) => { const a = result.getAsset(id); if (a) ul.append(assetRow(a, () => { trade[side].splice(i, 1); rerender(); })); });
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
        h('div.name', {}, h('button.linklike', { type: 'button', onclick: () => (a.kind === 'player' ? openPlayer(a.id) : openPickDetail(a.id)), title: 'Open details' }, a.name), ' ', inj),
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
    const ana = currentAnalysis();
    const [A, B] = ana.sides;
    drawSticky(ana);
    if (!A.assets.length && !B.assets.length) {
      summary.append(h('div.panel.muted.center', {}, 'Add assets to both sides to see the analysis.'));
      return;
    }
    const n = N();
    const max = Math.max(A.adjusted, B.adjusted, A.raw, B.raw, 1);
    const bar = (label, side, cls) => h('div.bar-row', {},
      h('span.bold', {}, label),
      h('div.bar-track', {},
        h('div.bar-fill', { class: cls, style: { width: `${(side.adjusted / max) * 100}%` } }),
        side.sigma > 0 ? h('div.bar-range', { style: { left: `${(Math.max(0, side.adjusted - side.sigma) / max) * 100}%`, width: `${((Math.min(max, side.adjusted + side.sigma) - Math.max(0, side.adjusted - side.sigma)) / max) * 100}%` }, title: `±${fmtValue(side.sigma)} uncertainty` }) : null),
      h('span.num.bold', {}, fmtValue(side.adjusted)));
    const leader = ana.diff > 0 ? n.A : ana.diff < 0 ? n.B : '—';
    const market = ana.signalDiffs.find((s) => s.key === 'market');
    const proj = ana.signalDiffs.find((s) => s.key === 'projection') || ana.signalDiffs.find((s) => s.key === 'fundamental');
    const head = verdictHeadline(ana, n);
    const mkt = marketCheck(ana, n);

    // 1. The answer first: verdict, adjusted totals, market cross-check, notes, and how to even it out.
    const panel = h('section.panel.trade-result', { id: 'trade-result', 'aria-label': 'Trade analysis' },
      h('div.panel-head', {}, h('h2', {}, 'Trade analysis'),
        h('div.flex.no-print', {},
          h('button.btn.btn-sm', { onclick: () => { [trade.a, trade.b] = [trade.b, trade.a]; rerender(); }, title: 'Swap the two sides' }, '⇄ Swap'),
          h('button.btn.btn-sm', { onclick: () => saveTrade(ana) }, '★ Save'),
          h('button.btn.btn-sm', { onclick: addToComparison, title: 'Keep this version in the counteroffer table below and compare it with others' }, '＋ Compare'),
          h('details.menu', {}, h('summary.btn.btn-sm', {}, 'Share ▾'),
            h('div.menu-panel', { onclick: (e) => { if (e.target.closest('button')) e.currentTarget.parentElement.open = false; } },
              h('button.btn.btn-sm', { onclick: () => copyText(tradeText(ana), 'Trade summary copied — paste it into your league chat.') }, 'Copy summary (text)'),
              h('button.btn.btn-sm', { onclick: () => copyText(tradeLink(), 'Link copied — opens this trade in the app.') }, 'Copy link to this trade'),
              h('button.btn.btn-sm', { onclick: () => exportTrade(ana) }, 'Download CSV + JSON'),
              h('button.btn.btn-sm', { onclick: () => window.print() }, 'Print'))),
          h('button.btn.btn-sm.btn-danger', { onclick: () => { trade.a = []; trade.b = []; rerender(); } }, 'Clear'))),
      h('div.verdict-head', { class: ana.assessment.level },
        h('div.verdict-label', {}, head.label),
        h('div.verdict-sub', {}, head.sub),
        outcomeText(ana, n) ? h('div.verdict-odds', {}, outcomeText(ana, n)) : null),
      h('div.bars.mt', {}, bar(n.a === 'A' ? 'Team A' : n.a, A, 'a'), bar(n.b === 'B' ? 'Team B' : n.b, B, 'b')),
      (A.package.total || B.package.total) ? h('p.tiny.muted', {}, 'Totals include the package adjustment (see below).') : null,
      mkt ? h('p.small.market-check', { class: mkt.cls }, h('strong', {}, 'Market check: '), mkt.text) : null,
      ana.notes.length ? h('ul.small.mt-s', {}, ana.notes.map((x) => h('li', {}, relabel(x, n)))) : null,
      lineupBlock(),
      balanceBlock(ana),
    );

    // package adjustments: explains why the totals are not plain sums
    const pk = [A.package, B.package].map((p, i) => ({ ...p, team: i ? 'B' : 'A' })).filter((p) => p.items.length);
    panel.append(h('details.mt', {},
      h('summary', {}, `Package / consolidation adjustment ${pk.length ? `(${pk.map((p) => `${n[p.team]} −${fmtValue(p.total)}`).join(', ')})` : '(none)'}`),
      h('p.small.muted', {}, 'A 3-for-1 is not worth the sum of three independent values: extra players compete for limited lineup spots and need roster spots. Draft picks are not charged. Settings → Trade Package Adjustments controls this.'),
      pk.length ? pk.map((p) => h('div.math.mt-s', {}, `${n[p.team]} receives ${p.nExtra} more player(s) than it sends:\n${p.explanation.join('\n')}\nTotal: ${fmtValue(p.items.reduce((s, x) => s + x.value, 0))} raw → −${fmtValue(p.total)} adjustment`)) : null,
      h('div.math.mt-s', {}, `Team A: ${fmtValue(A.raw)} raw − ${fmtValue(A.package.total)} package = ${fmtValue(A.adjusted)}\nTeam B: ${fmtValue(B.raw)} raw − ${fmtValue(B.package.total)} package = ${fmtValue(B.adjusted)}\nDifference: ${fmtSigned(ana.diff)} (${fmtPct(ana.pct)}), uncertainty ±${fmtValue(ana.sigmaDiff)} = √(${fmtValue(A.sigma)}² + ${fmtValue(B.sigma)}²)`)));

    // dynasty: now vs future, age — the main dynasty trade question, kept visible
    if (app.mode === 'dynasty') {
      const tot = (s) => Math.max(1, (s.now || 0) + (s.future || 0));
      const split = (s, cls) => h('div', {}, h('div.flex-between.small', {}, h('span', {}, `Now (current season) ${fmtValue(s.now)}`), h('span', {}, `Future ${fmtValue(s.future)}`)),
        h('div.split-bar', {}, h('span', { style: { width: `${(Math.max(0, s.now) / tot(s)) * 100}%`, background: cls === 'a' ? 'var(--team-a)' : 'var(--team-b)' } }), h('span', { style: { width: `${(Math.max(0, s.future) / tot(s)) * 100}%`, background: 'var(--border-strong)' } })));
      panel.append(h('div.grid-2.mt', {},
        h('div', {}, h('h3', {}, 'Win-now vs future value'), h('p.small.muted', {}, 'Year-1 model value vs future seasons (age curve, longevity, prospect value, picks); market/consensus split in the same proportion.'),
          h('div.stack', {}, h('div', {}, h('div.bold.small', {}, n.A), split(A, 'a')), h('div', {}, h('div.bold.small', {}, n.B), split(B, 'b')))),
        h('div', {}, h('h3', {}, 'Age & positions'),
          h('table.data', {}, h('tbody', {},
            h('tr', {}, h('td', {}, 'Value-weighted age'), h('td.num', {}, fmtAge(A.valueWeightedAge)), h('td.num', {}, fmtAge(B.valueWeightedAge))),
            h('tr', {}, h('td', {}, 'Positions received'), h('td.num.small', {}, Object.entries(A.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—'), h('td.num.small', {}, Object.entries(B.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—')))))));
    } else {
      panel.append(h('div.mt.small.muted', {}, `Positions received — ${n.A}: `, Object.entries(A.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—', ` · ${n.B}: `, Object.entries(B.byPosition).map(([p, v]) => `${p} ${fmtValue(v)}`).join(' · ') || '—'));
    }

    // 2. Full breakdown, on demand (open state remembered): KPIs, component and signal tables, reproducibility.
    const compRows = ana.componentDiffs.filter((c) => Math.abs(c.a) + Math.abs(c.b) > 0.5);
    const maxAbs = Math.max(1, ...compRows.map((c) => Math.abs(c.diff)));
    const l = result.league;
    const breakdown = h('details.mt.breakdown', { open: load('trade.breakdownOpen', false) ? true : null, ontoggle: (e) => save('trade.breakdownOpen', e.target.open) },
      h('summary', {}, 'Full breakdown — components, separate signals, uncertainty, calculation details'),
      h('div.kpis.mt', {},
        kpi('Difference', `${fmtSigned(ana.diff)}`, `${leader === '—' ? 'even' : `${leader} receives more`}`),
        kpi('Percent', fmtPct(ana.pct), 'of the larger side'),
        kpi('Model uncertainty', `±${fmtValue(ana.sigmaDiff)}`, ana.z < 1 ? 'difference within range' : `difference = ${ana.z.toFixed(1)}× range`),
        market ? kpi('Market difference', fmtSigned(market.diff), 'market signal only', 'market-v') : null,
        proj ? kpi(proj.key === 'fundamental' ? 'Fundamental difference' : 'Projection difference', fmtSigned(proj.diff), proj.key === 'fundamental' ? 'multi-year model only' : 'projection signal only', 'model-v') : null),
      h('div.verdict.mt', { class: ana.assessment.level }, h('strong', {}, 'Interpretation: '), relabel(ana.assessment.text, n)),
      h('div.grid-2.mt', {},
        h('div', {},
          h('h3', {}, 'What drives the difference'),
          h('p.small.muted', {}, `Each side's total split into the model's components (sums to the raw totals). Positive = favours ${n.A === 'Team A' ? 'Team A' : n.A.toLowerCase()}.`),
          h('div.table-wrap', {}, h('table.data.comp-table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Component'), h('th.num', {}, n.A), h('th.num', {}, n.B), h('th.num', {}, `${n.a} − ${n.b}`), h('th.hide-mobile', {}, ''))),
            h('tbody', {}, compRows.map((c) => h('tr', {},
              h('td', {}, COMPONENT_LABELS[c.key] || c.key),
              h('td.num', {}, fmtValue(c.a)), h('td.num', {}, fmtValue(c.b)),
              h('td.num.bold', { class: c.diff > 0 ? 'trend-up' : c.diff < 0 ? 'trend-down' : '' }, fmtSigned(c.diff)),
              h('td.bar-cell.hide-mobile', {}, h('div', { style: { display: 'flex', justifyContent: c.diff >= 0 ? 'flex-start' : 'flex-end' } }, h('div.hbar', { class: c.diff < 0 ? 'neg' : '', style: { width: `${(Math.abs(c.diff) / maxAbs) * 100}%` } })))))),
            h('tfoot', {}, h('tr', {}, h('td', {}, 'Raw total'), h('td.num', {}, fmtValue(A.raw)), h('td.num', {}, fmtValue(B.raw)), h('td.num', {}, fmtSigned(A.raw - B.raw)), h('td.hide-mobile', {}, '')))))),
        h('div', {},
          h('h3', {}, 'Signals compared separately'),
          h('p.small.muted', {}, 'What each signal ON ITS OWN would say, before blending and before the package adjustment — so these totals are not on the same footing as the trade totals. Market (what managers trade for) and model signals are deliberately kept apart.'),
          h('div.table-wrap', {}, h('table.data', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Signal'), h('th.num', {}, n.A), h('th.num', {}, n.B), h('th.num', {}, `${n.a} − ${n.b}`))),
            h('tbody', {}, ana.signalDiffs.map((s) => h('tr', {}, h('td', { class: s.key === 'market' ? 'market-v bold' : '' }, SIGNAL_LABELS[s.key] || s.key), h('td.num', {}, fmtValue(s.a)), h('td.num', {}, fmtValue(s.b)), h('td.num.bold', {}, fmtSigned(s.diff))))))),
          h('p.tiny.muted', {}, 'Signals are only summed over assets that have that signal; draft picks have no market/projection split here.'))),
      h('h3.mt', {}, 'Calculation details (reproducibility)'),
      h('dl.kv.mt-s', {},
        h('dt', {}, 'Calculated'), h('dd', {}, new Date(ana.audit.calculated_at).toLocaleString()),
        h('dt', {}, 'Model version'), h('dd', {}, ana.audit.model_version),
        h('dt', {}, 'Data snapshot'), h('dd', {}, `${ana.audit.data_version} (built ${fmtTime(ana.audit.dataset_built_at)})`),
        h('dt', {}, 'Settings hash'), h('dd', {}, ana.audit.settings_hash),
        h('dt', {}, 'League'), h('dd', {}, `${l.name} · ${l.teams} teams · ${l.qb_format.toUpperCase()} · ${starterSlotsSummary(l)} · bench ${l.roster.BENCH} · ${describeScoring(result.scoring)}`),
        h('dt', {}, 'Season phase'), h('dd', {}, `${result.phase.season} week ${result.phase.week} (${result.phase.phase}, in-season weight ${Math.round(result.phase.alpha * 100)}%)`),
        h('dt', {}, 'Reference league'), h('dd', {}, result.meta.reference_league)));
    panel.append(breakdown);
    summary.append(panel);
  }

  function currentAnalysis() {
    return analyzeTrade(result, trade.a, trade.b, { names: assetName, dataSources: Object.fromEntries(Object.entries(app.dataset.sources).map(([k, v]) => [k, v.last_success])) });
  }

  /** My Team: how the trade changes my best starting lineup (objective; only with a roster and "which side is you"). */
  function lineupBlock() {
    if (!roster.ids.length || !trade.me || !trade.a.length || !trade.b.length) return null;
    const get = trade[trade.me], give = trade[trade.me === 'a' ? 'b' : 'a'];
    const r = rosterImpact(result, roster.ids, give, get, { points: pointsPerGame, expected: rosterExpectation() });
    const dv = r.after.starterValue - r.before.starterValue;
    const ex = r.expectedDelta;
    const eo = r.expectedOutcome;
    const who = (xs) => xs.map((a) => `${a.name} (${a.position})`).join(', ');
    const depth = r.depth.filter((d) => d.before !== d.after || d.startersBefore !== d.startersAfter);
    return h('div.lineup-impact.mt', {},
      h('div.small.bold', {}, 'Your starting lineup'),
      h('div.lineup-kpis', {},
        h('div', {}, h('span.muted.small', {}, 'Lineup value '), h('strong', {}, `${fmtValue(r.before.starterValue)} → ${fmtValue(r.after.starterValue)}`), ' ', h('span.bold', { class: dv > 0 ? 'trend-up' : dv < 0 ? 'trend-down' : '' }, `(${fmtSigned(dv)})`)),
        ex !== null ? h('div', { title: 'Expected points per week of your best AVAILABLE lineup: each player counts with how often players like him play (injuries, current designation), bench players fill in, empty spots come from waivers. This-season projections.' }, h('span.muted.small', {}, 'Expected lineup points / week '), h('strong', {}, `${r.before.expected.toFixed(1)} → ${r.after.expected.toFixed(1)}`), ' ', h('span.bold', { class: ex > 0.05 ? 'trend-up' : ex < -0.05 ? 'trend-down' : '' }, `(${ex > 0 ? '+' : ''}${ex.toFixed(1)})`)) : null),
      eo ? h('div.small.muted', {}, `In historical league simulations, teams whose expected lineup ${eo.better ? 'rose' : 'fell'} this much ${eo.better ? 'gained' : 'lost'} points over the season about ${Math.round((eo.probability * 100) / 5) * 5}% of the time.`) : null,
      h('div.small', {}, r.startersIn.length || r.startersOut.length
        ? [r.startersIn.length ? h('span', {}, h('strong', {}, 'Into your lineup: '), who(r.startersIn), '. ') : null, r.startersOut.length ? h('span', {}, h('strong', {}, 'Out of your lineup: '), who(r.startersOut), '.') : null]
        : 'No change to your starters — the trade only changes your bench and depth.'),
      depth.length ? h('div.small.muted', {}, 'Depth: ', depth.map((d) => `${d.position} ${d.before}→${d.after}${d.startersBefore !== d.startersAfter ? ` (starting ${d.startersBefore}→${d.startersAfter})` : ''}`).join(' · ')) : null,
      r.notOnRoster.length ? h('div.small.warn-text', {}, `⚠ Not on your saved roster: ${r.notOnRoster.map(assetName).join(', ')} — check which side is you, or update `, h('a', { href: '#/team' }, 'My Team'), '.') : null,
      r.overLimit ? h('div.small.warn-text', {}, `⚠ You would have ${r.overLimit} more player${r.overLimit === 1 ? '' : 's'} than roster spots — someone would have to be dropped (not counted above).`) : null,
      h('div.tiny.muted', {}, 'Best lineup from your saved roster using these values; expected points use this season\'s projections, how often players miss games, and your bench as cover. Facts about your lineup, not a recommendation.'));
  }

  /** "What would even it out?" — one-click additions for the side that receives less. */
  function balanceBlock(ana) {
    if (ana.assessment.level === 'even') return null;
    let bal = balanceSuggestions(result, trade.a, trade.b, { limit: 4 });
    // The side to top up receives MY assets: suggest from my roster (what I could actually add), if it has any.
    let fromRoster = false;
    const myIds = roster.ids.filter((id) => !(trade.a.includes(id) || trade.b.includes(id)) || repeatable(id));
    if (bal.side && roster.ids.length && trade.me && bal.side !== trade.me) {
      const mine = balanceSuggestions(result, trade.a, trade.b, { limit: 4, only: myIds });
      if (mine.suggestions.length) { bal = mine; fromRoster = true; }
    }
    if (!bal.suggestions.length) return null;
    const n = N();
    const team = n[bal.side.toUpperCase()];
    const src = fromRoster ? ' from your roster' : '';
    return h('div.balance.mt.no-print', {},
      bal.oneSided
        ? h('div.small', {}, h('strong', {}, 'Value matches: '), `single assets${src} ${mid(team)} could receive for a roughly even trade — a value comparison, not a prediction of what anyone will accept:`)
        : h('div.small', {}, h('strong', {}, 'Even it out: '), `${team} could also receive one of these${src} (after any package adjustment) — value math, not a prediction of what anyone will accept:`),
      h('div.chips.mt-s', {}, bal.suggestions.map((s) => h('button.chip.suggest', {
        type: 'button',
        title: `Adds ${s.name} to the side "${team} receives". Afterwards: ${leadText(s.diffAfter, n)}.`,
        onclick: () => addAsset(bal.side, result.getAsset(s.id)),
      }, posBadge(s.position), ' ', s.name, s.team ? h('span.muted', {}, ` ${s.team}`) : null, ' ', h('span.muted', {}, `${fmtValue(s.value)} · after: ${leadText(s.diffAfter, n)}`)))),
      comboBlock(bal.side, team, fromRoster ? myIds : null, n));
  }

  /** Two-asset combinations (player + pick, two picks, two players) — computed only when opened (≈50–90 ms). */
  function comboBlock(side, team, only, n) {
    const body = h('div.chips.mt-s');
    const fill = () => {
      if (body.dataset.filled) return;
      body.dataset.filled = '1';
      const c = comboSuggestions(result, trade.a, trade.b, { limit: 4, only });
      if (!c.combos.length) { body.append(h('span.small.muted', {}, 'No two-asset combination comes closer — try the single assets above.')); return; }
      body.append(...c.combos.map((x) => h('button.chip.suggest.combo', {
        type: 'button',
        title: `Adds ${x.assets.map((a) => a.name).join(' and ')} to the side "${team} receives". Afterwards: ${leadText(x.diffAfter, n)}.`,
        onclick: () => addAssets(side, x.ids.map((id) => result.getAsset(id))),
      }, x.assets.flatMap((a, i) => [i ? h('span.muted', {}, ' + ') : null, posBadge(a.position), ' ', a.name]), ' ',
        h('span.muted', {}, `${fmtValue(x.value)} · after: ${leadText(x.diffAfter, n)}`))));
    };
    const box = h('details.combos.mt-s', { ontoggle: (e) => { save('trade.combosOpen', e.target.open); if (e.target.open) fill(); } },
      h('summary.small', {}, h('strong', {}, 'Two assets together'), app.mode === 'dynasty' ? ' — e.g. a player plus a pick, or two picks' : ' — two players instead of one'),
      body);
    if (load('trade.combosOpen', false)) { box.open = true; fill(); }
    return box;
  }

  function addToComparison() {
    const r = addVariant(getVariants(), trade);
    if (r.added) {
      setVariants(r.list);
      toast(r.index === 0 ? 'Kept as the original offer. Change the trade, then ＋ Compare again to add a counteroffer.' : `Added as ${variantLabel(r.list[r.index], r.index)} to the comparison.`);
      drawCounters();
      return;
    }
    toast({ incomplete: 'Add assets to both sides first.', duplicate: `This trade is already in the comparison (${r.index >= 0 ? variantLabel(getVariants()[r.index], r.index) : ''}).`, full: `The comparison holds up to ${MAX_VARIANTS} trades — remove one first.` }[r.reason], 'warn');
  }

  /** Counteroffer table: original + variants side by side, re-analyzed with today's values and settings. */
  function drawCounters() {
    clear(countersEl);
    const list = getVariants();
    const complete = trade.a.length > 0 && trade.b.length > 0;
    countersEl.hidden = !list.length && !complete;
    if (countersEl.hidden) return;
    const n = N();
    countersEl.append(h('div.panel-head', {}, h('h3', {}, 'Compare counteroffers'),
      h('span.small.muted', {}, 'The original offer and your variants side by side, re-checked with today\'s values and league settings.')));
    if (!list.length) {
      countersEl.append(h('p.small', {}, 'Negotiating? Keep this trade as the original, then change it (or use Even it out) and add each counteroffer — every version stays on screen with its verdict', roster.ids.length && trade.me ? ' and its effect on your lineup' : '', '.'),
        h('button.btn.btn-sm', { onclick: addToComparison }, '＋ Add this trade as the original'));
      return;
    }
    const at = list.findIndex((v) => sameTrade(v, trade));
    const live = complete && at < 0;
    const rows = compareCounteroffers(result, live ? [...list, { a: trade.a, b: trade.b, label: 'Current (not added)' }] : list, { me: trade.me, rosterIds: roster.ids, points: pointsPerGame, expected: rosterExpectation(), names: assetName });
    const showLineup = rows.some((r) => r.lineup);
    const cell = (ids, ch, label) => {
      const added = [...(ch ? ch.added : [])];
      const items = ids.map((id) => {
        const k = added.indexOf(id);
        if (k >= 0) { added.splice(k, 1); return h('li.added', { title: 'Added compared with the original' }, '+ ', assetName(id)); }
        return h('li', {}, assetName(id));
      });
      const gone = (ch ? ch.removed : []).map((id) => h('li.removed', { title: 'In the original, not in this version' }, h('del', {}, assetName(id))));
      return h('td.small', { 'data-label': label }, h('ul.variant-assets', {}, items, gone));
    };
    const rename = (i) => {
      const cur = getVariants();
      const name = prompt('Name this version (e.g. "Their counter")', variantLabel(cur[i], i));
      if (name === null) return;
      cur[i] = { ...cur[i], label: name.trim().slice(0, 40) || undefined };
      if (!cur[i].label) delete cur[i].label;
      setVariants(cur); drawCounters();
    };
    const load1 = (r) => {
      if (live && !confirm('The trade you are building is not in the comparison yet. Replace it anyway?')) return;
      trade.a = [...r.a]; trade.b = [...r.b];
      rerender();
      document.getElementById('trade-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const remove = (i) => { const cur = getVariants(); cur.splice(i, 1); setVariants(cur); drawCounters(); };
    const tbody = h('tbody', {}, rows.map((r) => {
      const isLive = live && r.index === rows.length - 1;
      const editing = !live ? r.index === at : isLive;
      const head = verdictHeadline(r.analysis, n);
      return h('tr', { class: [editing ? 'editing' : '', isLive ? 'live' : ''].filter(Boolean).join(' ') || null },
        h('td.nowrap', {}, isLive ? h('span.bold', {}, r.label) : h('button.linklike.bold', { type: 'button', title: 'Rename', onclick: () => rename(r.index) }, r.label),
          editing ? h('div.tiny.muted', {}, isLive ? 'being edited above' : '● shown above') : null),
        cell(r.a, r.changes?.a, `${n.A} receives`), cell(r.b, r.changes?.b, `${n.B} receives`),
        h('td', { 'data-label': 'Verdict' }, h('span.verdict-pill', { class: r.level, title: relabel(head.sub, n) }, head.label)),
        h('td.num.nowrap', { 'data-label': 'Who gets more' }, h('span.bold', {}, leadText(r.diff, n)), h('div.tiny.muted', {}, `${n.a} ${fmtValue(r.totals[0])} · ${n.b} ${fmtValue(r.totals[1])}`)),
        showLineup ? h('td.num.nowrap', { 'data-label': 'Your lineup' }, r.lineup
          ? [h('span.bold', { class: r.lineup.valueDelta > 0 ? 'trend-up' : r.lineup.valueDelta < 0 ? 'trend-down' : '' }, fmtSigned(r.lineup.valueDelta)),
            r.lineup.expectedDelta !== null ? h('div.tiny.muted', {}, `${r.lineup.expectedDelta > 0 ? '+' : ''}${r.lineup.expectedDelta.toFixed(1)} exp. pts/week`) : null]
          : '—') : null,
        h('td.nowrap', {}, isLive
          ? h('button.btn.btn-xs', { onclick: addToComparison, disabled: list.length >= MAX_VARIANTS ? true : null }, '＋ Add')
          : [editing ? null : h('button.btn.btn-xs', { onclick: () => load1(r) }, 'Load'), ' ',
            h('button.btn.btn-xs.btn-danger', { onclick: () => remove(r.index), title: `Remove ${r.label}`, 'aria-label': `Remove ${r.label} from the comparison` }, '✕')]));
    }));
    countersEl.append(
      h('div.table-wrap', {}, h('table.data.counter-table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Version'), h('th', {}, `${n.A} receives`), h('th', {}, `${n.B} receives`), h('th', {}, 'Verdict'), h('th.num', {}, 'Who gets more'),
          showLineup ? h('th.num', { title: 'Change in your best starting lineup (value) and in your expected lineup points per week (injuries and bench cover included)' }, 'Your lineup') : null, h('th', {}, ''))),
        tbody)),
      h('div.flex.mt-s', {},
        h('span.tiny.muted', {}, `+ added / struck through = removed, compared with ${variantLabel(list[0], 0).toLowerCase() === 'original' ? 'the original' : `"${variantLabel(list[0], 0)}"`}. Click a name to rename it. Up to ${MAX_VARIANTS} versions per mode, kept in this browser.`),
        h('button.btn.btn-xs.btn-danger', { onclick: () => { if (confirm('Remove every version from the comparison?')) { setVariants([]); drawCounters(); } } }, 'Clear comparison')));
  }

  // Phone: the verdict sits far below the two lists, so keep a one-line verdict pinned to the bottom of the screen.
  let stickyObs = null;
  function drawSticky(ana) {
    clear(sticky);
    if (stickyObs) { stickyObs.disconnect(); stickyObs = null; }
    if (!trade.a.length || !trade.b.length) { sticky.hidden = true; return; }
    const head = verdictHeadline(ana, N());
    sticky.hidden = false;
    sticky.className = `trade-sticky no-print ${ana.assessment.level}`;
    sticky.append(h('button', { type: 'button', onclick: () => document.getElementById('trade-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      h('span.bold', {}, head.label), h('span.small', {}, ` · ${leadText(ana.diff, N())}`), h('span.small.muted', {}, ' — details ↓')));
    if (typeof IntersectionObserver === 'function') {
      queueMicrotask(() => {
        const target = summary.querySelector('.verdict-head');
        if (!target) return;
        stickyObs = new IntersectionObserver(([e]) => sticky.classList.toggle('offscreen', e.isIntersecting));
        stickyObs.observe(target);
      });
    }
  }

  function tradeLink() { return `${location.origin}${location.pathname}${tradeHash(app.mode, trade.a, trade.b)}`; }

  function tradeText(ana) {
    const [A, B] = ana.sides;
    const list = (s) => s.assets.map((x) => `${x.name} (${fmtValue(x.value)})`).join(', ') || '—';
    const head = verdictHeadline(ana);
    const mkt = marketCheck(ana);
    return [
      `Trade — ${app.mode === 'dynasty' ? 'Dynasty' : 'Redraft'} · ${activeProfile().name}`,
      `Team A receives: ${list(A)}`,
      `Team B receives: ${list(B)}`,
      `Totals${A.package.total || B.package.total ? ' (after package adjustment)' : ''}: A ${fmtValue(A.adjusted)} · B ${fmtValue(B.adjusted)}`,
      `Verdict: ${head.label} — ${head.sub}`,
      mkt ? `Market check: ${mkt.text}` : null,
      outcomeText(ana),
      `(FF Trade Analyzer · model ${ana.audit.model_version} · data ${ana.audit.data_version})`,
    ].filter(Boolean).join('\n');
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
    const local = localTrades();
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
    clear(historyEl);
    historyEl.append(h('div.panel-head', {}, h('h3', {}, 'Saved trades'), h('span.small.muted', {}, 'Every saved trade stores model version, data snapshot, league settings and per-asset values so it can be re-checked later.')));
    let trades = [];
    if (hasServer()) { try { trades = (await api.get('/api/trades')).trades || []; } catch { /* ignore */ } }
    trades = [...trades.filter(isSavedTrade), ...localTrades()].filter((t) => t.mode === app.mode).sort((x, y) => (y.saved_at || '').localeCompare(x.saved_at || ''));
    if (!trades.length) { historyEl.append(h('p.muted.small', {}, 'No saved trades in this mode yet.')); return; }
    const tbl = h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Saved'), h('th', {}, 'Team A receives'), h('th', {}, 'Team B receives'), h('th.num', { title: 'Who received more when saved' }, 'Then'), h('th.num', { title: 'Who receives more with today\'s data and settings' }, 'Now'), h('th', {}, ''))));
    const tb = h('tbody');
    for (const t of trades.slice(0, 30)) {
      let now = null;
      try { const ana = analyzeTrade(result, t.a, t.b, { names: assetName }); now = ana.diff; } catch { /* ignore */ }
      tb.append(h('tr', {},
        h('td.small.nowrap', {}, fmtTime(t.saved_at), h('div.tiny.muted', {}, `model ${t.audit?.model_version} · ${t.audit?.data_version}`)),
        h('td.small', {}, (t.names?.a || []).join(', ')), h('td.small', {}, (t.names?.b || []).join(', ')),
        h('td.num.nowrap', {}, Number.isFinite(t.totals?.diff) ? leadText(t.totals.diff) : '—'), h('td.num.bold.nowrap', {}, now === null ? '—' : leadText(now)),
        h('td.nowrap', {}, h('button.btn.btn-xs', { onclick: () => { trade.a = [...t.a]; trade.b = [...t.b]; rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Load'), ' ',
          h('button.btn.btn-xs', { onclick: () => explainChange(t) }, 'Why changed?'), ' ',
          h('button.btn.btn-xs.btn-danger', { onclick: async () => {
            if (String(t.id).startsWith('l_')) save('trades', localTrades().filter((x) => x.id !== t.id));
            else if (hasServer()) await api.del(`/api/trades/${t.id}`).catch(() => {});
            drawHistory();
          } }, '✕'))));
    }
    tbl.append(tb);
    historyEl.append(h('div.table-wrap', {}, tbl));
  }

  function explainChange(t) {
    const rows = [];
    for (const id of [...t.a, ...t.b]) {
      const then = t.values?.[id];
      const now = result.getAsset(id);
      if (!then || !now) { rows.push({ name: t.names?.a?.[t.a.indexOf(id)] || t.names?.b?.[t.b.indexOf(id)] || assetName(id), then: then?.value, now: now?.value, drivers: now ? 'not stored with this saved trade' : 'no value with current data' }); continue; }
      const keys = new Set([...Object.keys(then.components || {}), ...Object.keys(now.components || {})]);
      const drivers = [...keys].map((k) => ({ k, d: (now.components[k] || 0) - (then.components?.[k] || 0) })).filter((x) => Math.abs(x.d) >= 10).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 3);
      rows.push({ name: now.name, then: then.value, now: now.value, drivers: Math.abs(now.value - then.value) < 25 ? 'essentially unchanged' : drivers.map((x) => `${fmtSigned(x.d)} ${COMPONENT_LABELS[x.k] || x.k}`).join(', ') || '—' });
    }
    const sameModel = t.audit?.model_version === result.meta.model_version;
    const sameSettings = t.audit?.settings_hash === result.meta.settings_hash;
    let nowDiff = null;
    try { nowDiff = analyzeTrade(result, t.a, t.b, { names: assetName }).diff; } catch { /* ignore */ }
    // A dialog, not a 12-second toast: this is something to read, compare and close when done.
    openModal((close) => h('div.modal-body', {},
      h('div.flex-between', {}, h('h3', { style: { margin: 0 } }, 'Why did this trade\'s value change?'), h('button.btn.btn-sm', { onclick: close, 'aria-label': 'Close' }, '×')),
      h('p.small.muted', {}, `Saved ${fmtTime(t.saved_at)} with model ${t.audit?.model_version || '?'} and data ${t.audit?.data_version || '?'}. Now: model ${result.meta.model_version}, data ${result.meta.data_version}.`),
      h('p', {}, h('strong', {}, 'Then: '), Number.isFinite(t.totals?.diff) ? leadText(t.totals.diff) : '—', h('span.muted', {}, '  →  '), h('strong', {}, 'Now: '), nowDiff === null ? '—' : leadText(nowDiff)),
      !sameModel ? h('p.small', {}, '⚠ The model version changed since this trade was saved — part of the difference comes from the model, not from new information.') : null,
      !sameSettings ? h('p.small', {}, '⚠ League or model settings differ from the saved calculation.') : null,
      h('div.table-wrap', {}, h('table.data', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Asset'), h('th.num', {}, 'Then'), h('th.num', {}, 'Now'), h('th.num', {}, 'Change'), h('th', {}, 'Main drivers'))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td.num', {}, fmtValue(r.then)), h('td.num', {}, fmtValue(r.now)),
          h('td.num.bold', {}, Number.isFinite(r.then) && Number.isFinite(r.now) ? fmtSigned(r.now - r.then) : '—'), h('td.small', {}, r.drivers)))))),
      h('p.tiny.muted', {}, 'Values move with new data (projections, stats, market, injuries) and the time of season. A later change does not show whether the original decision was right: the values were uncertain then too.')));
  }

  // Print everything: the collapsed breakdown would otherwise be missing from the printout.
  const openForPrint = () => { for (const d of summary.querySelectorAll('details:not(.menu)')) if (!d.open) { d.dataset.printOpened = '1'; d.open = true; } };
  const restoreAfterPrint = () => { for (const d of summary.querySelectorAll('details[data-print-opened]')) { d.open = false; delete d.dataset.printOpened; } };
  window.addEventListener('beforeprint', openForPrint);
  window.addEventListener('afterprint', restoreAfterPrint);

  rerender();
  drawHistory();
  return () => {
    window.removeEventListener('beforeprint', openForPrint);
    window.removeEventListener('afterprint', restoreAfterPrint);
    if (stickyObs) stickyObs.disconnect();
  };
}
