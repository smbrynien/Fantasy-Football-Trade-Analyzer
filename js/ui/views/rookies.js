// ROOKIE MODE (dynasty): rookie PROSPECT values and rookie DRAFT PICK values, kept explicitly separate.

import { h, clear, fmtValue, fmt1, fmtAge, posBadge, confBadge, download } from '../dom.js';
import { getValuations, playerData } from '../state.js';
import { openPlayer, openPickDetail } from './player-modal.js';
import { pickAssetId } from '../../core/pick-labels.js';
import { lineChart } from '../charts.js';
import { toCSV } from '../../core/util/csv.js';
import { mean } from '../../core/util/stats.js';

export function renderRookies(root) {
  const res = getValuations('dynasty');
  const T = res.league.teams;
  const pk = res.picks;
  const tabs = h('div.subtabs');
  const body = h('div');
  const views = { prospects: 'Rookie prospect values', picks: 'Rookie draft pick values', method: 'How picks are valued' };
  let cur = 'prospects';
  for (const [k, l] of Object.entries(views)) tabs.append(h('button', { class: k === cur ? 'active' : '', onclick: (e) => { cur = k; for (const b of tabs.children) b.classList.remove('active'); e.target.classList.add('active'); draw(); } }, l));
  root.append(h('div.panel', {},
    h('div.panel-head', {}, h('h2', {}, 'Rookies & Picks'), h('span.small.muted', {}, `Rookie prospect value = a specific drafted player. Rookie pick value = whoever a pick will select. They are different assets.`)),
    tabs, body));

  function draw() {
    clear(body);
    if (cur === 'prospects') body.append(prospects());
    else if (cur === 'picks') body.append(picks());
    else body.append(method());
  }

  function prospects() {
    const list = [];
    for (const a of res.assets.values()) {
      if (a.kind !== 'player') continue;
      const p = playerData(a.id);
      if (!p) continue;
      const rr = (p.rankings || []).filter((r) => r.kind === 'rookie');
      const isClass = p.draft && Number(p.draft.year) === Number(pk.classYear);
      if (!rr.length && !isClass) continue;
      const ecrs = rr.map((r) => r.ecr);
      const adp = (p.adp || []).find((x) => x.format === 'rookie');
      list.push({ a, p, ecr: ecrs.length ? mean(ecrs) : null, ecrSd: rr[0]?.sd ?? null, best: rr[0]?.best ?? null, worst: rr[0]?.worst ?? null, adp: adp?.adp ?? null });
    }
    list.sort((x, y) => (x.ecr ?? 999) - (y.ecr ?? 999) || y.a.value - x.a.value);
    // Columns are defined once (header + cell) so optional ones can be dropped: the table must fit a desktop window.
    const hasAdp = list.some((r) => r.adp !== null);
    const cols = [
      ['Rk', 'num', (r, i) => h('td.num.muted', {}, i + 1)],
      ['Player', 'sticky-col', (r) => h('td.player-cell.sticky-col', {}, h('span.player-name', {}, r.a.name))],
      ['Pos', '', (r) => h('td', {}, posBadge(r.a.position))],
      ['Team', '', (r) => h('td', { title: 'Landing spot' }, r.a.team || 'FA')],
      ['Age', 'num', (r) => h('td.num', {}, fmtAge(r.a.age))],
      ['College', '', (r) => h('td.small', {}, r.p.college || '—')],
      ['NFL draft', 'num', (r) => h('td.num.nowrap', {}, r.p.draft?.round ? `${r.p.draft.year} R${r.p.draft.round}${r.p.draft.pick ? ` #${r.p.draft.pick}` : ''}` : r.p.draft?.year ? `${r.p.draft.year} UDFA` : '—')],
      ['Rookie ECR', 'num', (r) => h('td.num.bold', {}, fmt1(r.ecr))],
      ['Range', 'num', (r) => h('td.num.small.nowrap', { title: r.best ? `Best–worst expert rank; standard deviation ${fmt1(r.ecrSd)}` : '' }, r.best ? `${r.best}–${r.worst}` : '—')],
      ...(hasAdp ? [['Rookie ADP', 'num', (r) => h('td.num', {}, fmt1(r.adp))]] : []),
      ['Prospect value', 'num', (r) => h('td.num.model-v.bold', {}, fmtValue(r.a.value))],
      ['Market', 'num', (r) => h('td.num.market-v', {}, fmtValue(r.a.groupValues?.market))],
      ['Conf.', '', (r) => h('td', {}, confBadge(r.a.confidence))],
    ];
    const tbl = h('table.data', {}, h('thead', {}, h('tr', {}, cols.map(([c, cls]) => h('th', { class: cls }, c)))),
      h('tbody', {}, list.map((r, i) => h('tr.clickable', { onclick: () => openPlayer(r.a.id) }, cols.map(([, , cell]) => cell(r, i))))));
    return h('div', {}, h('p.small.muted', {}, `Rookie class ${pk.classYear || '—'}: individual drafted players valued by the dynasty model (draft-capital prior, early production, market, consensus). College production metrics are not available from the free sources used, so they are not modelled — see docs/DATA_SOURCES.md.`), h('div.table-wrap', {}, tbl),
      h('div.mt', {}, h('button.btn.btn-sm', { onclick: () => download('rookie-prospects.csv', toCSV(list.map((r) => ({ player: r.a.name, pos: r.a.position, team: r.a.team, age: r.a.age?.toFixed(1), draft: r.p.draft?.round ? `${r.p.draft.year}-${r.p.draft.round}-${r.p.draft.pick}` : '', rookie_ecr: r.ecr, prospect_value: Math.round(r.a.value), market_value: r.a.groupValues?.market ? Math.round(r.a.groupValues.market) : '' }))), 'text/csv') }, '⤓ Export rookie prospects CSV')));
  }

  function picks() {
    const wrap = h('div');
    for (const season of pk.seasons) {
      const tbl = h('table.data', {});
      const head = h('tr', {}, h('th', {}, `${season}`), h('th.num', {}, 'Unknown slot'), h('th.num', {}, 'Early'), h('th.num', {}, 'Mid'), h('th.num', {}, 'Late'));
      for (let k = 1; k <= T; k++) head.append(h('th.num.hide-mobile', {}, `.${String(k).padStart(2, '0')}`));
      tbl.append(h('thead', {}, head));
      const tb = h('tbody');
      for (let r = 1; r <= pk.rounds; r++) {
        const cellFor = (d) => { const a = res.getAsset(pickAssetId(d)); return h('td.num', { class: 'clickable', style: { cursor: 'pointer' }, title: a ? `≈ ${fmtValue(a.range[0])}–${fmtValue(a.range[1])}` : '', onclick: () => a && openPickDetail(a.id) }, a ? fmtValue(a.value) : '—'); };
        const row = h('tr', {}, h('td.bold', {}, `Round ${r}`), cellFor({ season, round: r }), cellFor({ season, round: r, bucket: 'early' }), cellFor({ season, round: r, bucket: 'mid' }), cellFor({ season, round: r, bucket: 'late' }));
        for (let k = 1; k <= T; k++) { const c = cellFor({ season, round: r, slot: k }); c.classList.add('hide-mobile'); row.append(c); }
        tb.append(row);
      }
      tbl.append(tb);
      wrap.append(h('h3.mt', {}, `${season} rookie draft${season === pk.upcoming ? ' (upcoming)' : ''}`), h('div.table-wrap', {}, tbl));
    }
    const diag = pk.diagnostics;
    const chart = lineChart([
      { label: 'Blended slot value', color: 'var(--accent)', points: diag.slotTable.map((s) => [s.p, s.value ? s.value * res.factor : null]) },
      { label: 'Market', color: 'var(--market)', dashed: true, points: diag.slotTable.map((s) => [s.p, s.market ? s.market * res.factor : null]) },
      { label: 'Historical shape', color: 'var(--good)', dashed: true, points: diag.slotTable.map((s) => [s.p, s.historical ? s.historical * res.factor : null]) },
      { label: 'Current class', color: 'var(--team-b)', dashed: true, points: diag.slotTable.map((s) => [s.p, s.current_class ? s.current_class * res.factor : null]) },
    ], { xLabel: `Pick number in the ${pk.upcoming} rookie draft (overall)`, height: 240 });
    const rows = [];
    for (const season of pk.seasons) for (let r = 1; r <= pk.rounds; r++) {
      for (const b of [null, 'early', 'mid', 'late']) { const a = res.getAsset(pickAssetId({ season, round: r, bucket: b })); if (a) rows.push({ pick: a.name, value: Math.round(a.value), low: Math.round(a.range[0]), high: Math.round(a.range[1]) }); }
      for (let k = 1; k <= T; k++) { const a = res.getAsset(pickAssetId({ season, round: r, slot: k })); if (a) rows.push({ pick: a.name, value: Math.round(a.value), low: Math.round(a.range[0]), high: Math.round(a.range[1]) }); }
    }
    wrap.prepend(h('div', {}, h('h3', {}, 'Value by pick number'), chart, h('div.flex', {}, h('button.btn.btn-sm', { onclick: () => download('rookie-pick-values.csv', toCSV(rows), 'text/csv') }, '⤓ Export rookie pick values CSV'), h('span.small.muted', {}, `${T}-team league, ${pk.rounds} rounds. Click a value for its breakdown. Add picks to trades from the Trade tab.`))));
    return wrap;
  }

  function method() {
    const d = pk.diagnostics;
    const m = res.model.picks;
    return h('div.stack', {},
      h('p', {}, 'A pick\'s value is the expected value of the player it will select. It is estimated from three independent inputs, blended with configurable weights:'),
      h('ol', {},
        h('li', {}, h('strong', {}, `Market pick values (${Math.round(m.weights.market * 100)}%)`), ` — ${d.marketSources.join(', ') || 'none available'}. Each source's pick values are mapped onto this app's scale through that same source's player values (so a pick the market prices like its 40th player is worth what our 40th player is worth).`),
        h('li', {}, h('strong', {}, `Historical slot curve (${Math.round(m.weights.historical * 100)}%)`), ` — realised 3-season fantasy surplus by consensus rookie rank for the 2020–2023 classes (FantasyPros rookie ECR via DynastyProcess, nflverse stats), smoothed and scaled to the current class. ${d.hasShape ? '' : 'NOT AVAILABLE — run `npm run calibrate`.'}`),
        h('li', {}, h('strong', {}, `Current rookie class (${Math.round(m.weights.current_class * 100)}%)`), ` — model values of the ${pk.classYear} rookies (n=${d.classSize}) ordered by consensus rookie rank. ${pk.classYear !== pk.upcoming ? `Because this class is already drafted, its values are multiplied by ${m.prior_class_adjustment} to remove hindsight (today's ranks favour players who already hit).` : ''}`)),
      h('p', {}, `League size is handled by class position: pick r.k = rookie #${'('}r−1${')'}×${T}+k. Future classes are discounted ${Math.round((1 - m.future_year_discount) * 100)}% per year. Unknown slots average over all slots in the round; Early/Mid/Late average over the first/middle/last third; custom ranges average the chosen slots. The spread over slots is part of the uncertainty.`),
      h('p.small.muted', {}, `Estimate uncertainty (shown as ±) is different from outcome risk: historically, top-3 rookie picks became top-24 positional finishers within three seasons far more often than picks 13+, and outcome spread grows quickly with pick number. See Model → Calibration for hit rates.`),
      h('h3', {}, 'Current class (top 36 by consensus rookie rank)'),
      h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th.num', {}, 'Rookie ECR'), h('th.num', {}, 'Model value'), h('th.num', {}, 'Smoothed curve'))),
        h('tbody', {}, d.classTop.map((r) => h('tr', {}, h('td', {}, r.p), h('td', {}, r.name), h('td.num', {}, fmt1(r.rank)), h('td.num', {}, fmtValue(r.score * res.factor)), h('td.num', {}, fmtValue(r.smoothed * res.factor)))))));
  }
  draw();
}
