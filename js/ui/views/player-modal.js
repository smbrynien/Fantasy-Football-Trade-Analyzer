// Player & pick detail views: overview, "Why this value?", dynasty outlook, sources, stats, trends,
// and "Why did this value change?" (re-runs the model on an older data snapshot with today's settings).

import { h, clear, openModal, fmtValue, fmtSigned, fmt1, fmtAge, fmtPctPlain, fmtRange, fmtTime, posBadge, confBadge, injuryBadge, timeAgo } from '../dom.js';
import { app, getValuations, activeProfile, playerData } from '../state.js';
import { COMPONENT_LABELS, COMPONENT_ORDER } from '../../core/valuation/engine.js';
import { diffAsset } from '../../core/valuation/explain.js';
import { lineChart } from '../charts.js';
import { modelMarkers, windowDelta, currentModelStart } from '../history-series.js';
import { api, hasServer } from '../api.js';
import { mean, median, sd } from '../../core/util/stats.js';
import { scoreStats } from '../../core/scoring.js';

const SRC_NAME = (id) => app.config.sources.sources.find((s) => s.id === id)?.name || id;

const COMPONENT_HELP = {
  market: 'Trade-market values (FantasyCalc, DynastyProcess, KTC import…) mapped onto this league\'s value curve by positional rank.',
  consensus: 'Expert consensus rankings (FantasyPros ECR…) mapped onto this league\'s value curve by positional rank.',
  projection: 'League-scored projections (rest of season in redraft; current scoring rate in dynasty) minus positional replacement level.',
  production: 'Actual league-scored production this season blended with opportunity-based expected points, regressed toward a prior.',
  adp: 'Average draft position mapped onto the overall value curve.',
  prospect: 'Draft-capital prior: historical production of players drafted in this range at this career stage.',
  longevity: 'Seasons 2+ of the multi-year projection: aging curve, attrition risk, uncertainty and the dynasty discount rate.',
  injury: 'Expected games lost from the current injury designation.',
  trend: 'Capped share of the market\'s own 30-day value trend (weight 0 by default since model 2.0: shown for information only).',
  historical: 'Historical rookie slot value (2020-2023 classes) scaled to the current class.',
  current_class: 'Current rookie class values at this slot (consensus rookie order, smoothed).',
};

function breakdownTable(a) {
  const rows = COMPONENT_ORDER.filter((k) => a.components[k] !== undefined && Math.abs(a.components[k]) >= 0.5);
  const max = Math.max(1, ...rows.map((k) => Math.abs(a.components[k])));
  return h('table.breakdown', {},
    h('tbody', {},
      rows.map((k) => h('tr', {},
        h('td.lbl', { title: COMPONENT_HELP[k] || '' }, COMPONENT_LABELS[k] || k, a.weights && a.weights[k] !== undefined ? h('span.tiny.muted', {}, ` · weight ${Math.round(a.weights[k] * 100)}%`) : null),
        h('td.barc', {}, h('div.hbar', { class: a.components[k] < 0 ? 'neg' : k === 'market' ? 'market' : '', style: { width: `${(Math.abs(a.components[k]) / max) * 100}%` } })),
        h('td.num', {}, fmtSigned(a.components[k]).replace('+', '')))),
      h('tr.total', {}, h('td', {}, 'Final value'), h('td', {}, h('span.small.muted', {}, `fair-value range ≈ ${fmtRange(a.range)}`)), h('td.num', {}, fmtValue(a.value)))));
}

function dispersion(list) {
  const r = list.filter((x) => typeof x === 'number');
  if (!r.length) return null;
  return { n: r.length, median: median(r), mean: mean(r), best: Math.min(...r), worst: Math.max(...r), sd: r.length > 1 ? sd(r) : 0 };
}

export function openPlayer(cid) {
  const red = getValuations('redraft');
  const dyn = getValuations('dynasty');
  const p = playerData(cid);
  const ar = red?.assets.get(cid), ad = dyn?.assets.get(cid);
  if (!p && !ar && !ad) return;
  const cur = app.mode === 'dynasty' ? ad : ar;
  const tabsEl = h('div.subtabs');
  const body = h('div');
  const tabs = [['overview', 'Overview'], ['why', 'Why this value?'], ['dynasty', 'Dynasty outlook'], ['sources', 'Market & sources'], ['stats', 'Statistics'], ['trends', 'Trends']];
  const show = (t) => { for (const b of tabsEl.children) b.classList.toggle('active', b.dataset.t === t); clear(body); body.append(TAB[t]()); };
  for (const [t, label] of tabs) tabsEl.append(h('button', { dataset: { t }, onclick: () => show(t) }, label));

  const inj = p?.injury;
  const injStatus = inj ? (inj.status || inj.official_status) : null;
  const head = h('div.modal-head', {},
    h('div', {},
      h('div.flex', {}, posBadge(p?.position || cur?.position), h('h2', {}, p?.name || cur?.name), injStatus ? injuryBadge({ status: injStatus, source: inj.official_status ? 'official' : 'reported' }) : null),
      h('div.muted.small', {}, [p?.team || 'FA', p?.birth_date ? `age ${fmtAge(cur?.age ?? ar?.age)}` : null, p?.college, p?.draft?.year ? `${p.draft.year} draft${p.draft.round ? ` · R${p.draft.round}${p.draft.pick ? ` P${p.draft.pick}` : ''}` : ''}` : null, p?.bye_week ? `bye wk ${p.bye_week}` : null, p?.depth_chart_order ? `depth #${p.depth_chart_order}` : null].filter(Boolean).join(' · '))),
    h('button.modal-close', { 'aria-label': 'Close', onclick: () => close() }, '×'));

  const TAB = {
    overview() {
      const cards = h('div.value-cards', {},
        ar ? h('div.value-card.model', {}, h('div.k', {}, 'Redraft value'), h('div.v', {}, fmtValue(ar.value)), h('div.s', {}, `#${ar.rank} overall · ${ar.position}${ar.posRank} · ±${fmtValue(ar.sigma)}`)) : h('div.value-card', {}, h('div.k', {}, 'Redraft value'), h('div.v.faint', {}, 'N/A'), h('div.s', {}, 'insufficient data')),
        ad ? h('div.value-card.model', {}, h('div.k', {}, 'Dynasty value'), h('div.v', {}, fmtValue(ad.value)), h('div.s', {}, `#${ad.rank} overall · ${ad.position}${ad.posRank} · ±${fmtValue(ad.sigma)}`)) : h('div.value-card', {}, h('div.k', {}, 'Dynasty value'), h('div.v.faint', {}, 'N/A')),
        h('div.value-card.market', {}, h('div.k', {}, `Market value (${app.mode})`), h('div.v.market-v', {}, fmtValue(cur?.groupValues?.market)), h('div.s', {}, 'on this app\'s scale; raw source values under "Market & sources"')),
        h('div.value-card', {}, h('div.k', {}, 'Confidence'), h('div.v', {}, confBadge(cur?.confidence)), h('div.s', {}, (cur?.confidence?.reasons || []).join('; ') || 'good source coverage and agreement')));
      const d = ar?.details;
      const rows = [];
      if (d) {
        rows.push(['Projected points (ROS)', d.projection.points !== null ? `${fmt1(d.projection.points)} in ${d.projection.games ?? '?'} games${d.projection.zeroedForInjury ? ' (no projection while on IR → 0)' : ''}` : 'Unavailable']);
        if (d.production.gp) rows.push(['Points per game (this season)', `${fmt1(d.production.ppg)} actual · ${fmt1(d.production.xppg)} expected (opportunity) · ${d.production.gp} games`]);
        if (d.weeklyRange) rows.push(['Weekly floor / median / ceiling', `${fmt1(d.weeklyRange.floor)} / ${fmt1(d.weeklyRange.median)} / ${fmt1(d.weeklyRange.ceiling)} (10th/50th/90th pct of ${d.weeklyRange.n} games)`]);
        if (d.lastSeason) rows.push([`Last season (${d.lastSeason.season})`, `${fmt1(d.lastSeason.ppg)} PPG in ${d.lastSeason.gp} games`]);
        rows.push(['Remaining games', d.production.remGames ?? '—']);
        if (d.production.sosDetail) rows.push(['Remaining schedule', `${d.production.sos > 1 ? 'easier' : 'harder'} than average (×${d.production.sos.toFixed(3)} applied to production)`]);
        rows.push(['Replacement level', `${fmt1(d.replacement)} pts (starter) · ${fmt1(d.waiver)} pts (waiver)`]);
      }
      if (inj && (inj.status || inj.official_status)) {
        rows.push(['Official status', inj.official_status ? `${inj.official_status}${inj.official_practice ? ` · practice: ${inj.official_practice}` : ''} (NFL injury report, week ${inj.official_week ?? '?'}, via ${SRC_NAME(inj.official_source)})` : 'none on latest official report']);
        rows.push(['Reported status', inj.status ? `${inj.status}${inj.body_part ? ` · ${inj.body_part}` : ''}${inj.notes ? ` · ${inj.notes}` : ''} (${SRC_NAME(inj.source)}${inj.as_of ? `, ${fmtTime(inj.as_of)}` : ''})` : '—']);
      }
      if (ad?.details) {
        const dd = ad.details;
        rows.push(['Dynasty: current scoring rate', `${fmt1(dd.mu1)} PPG (blend of ${dd.evidence.map((e) => e.kind.replace('_', ' ')).join(', ') || 'no evidence'})`]);
        rows.push(['Dynasty: career horizon', dd.careerHorizon !== null ? `${dd.careerHorizon} of ${dd.years?.length || 0} projected seasons likely startable (≥25%)` : '—']);
      }
      const u = ar?.details?.usage;
      if (u) rows.push(['Usage (season avg)', [u.snap_pct !== null ? `snaps ${fmtPctPlain(u.snap_pct)}` : null, u.target_share !== null ? `target share ${fmtPctPlain(u.target_share)}` : null, u.carries_pg ? `${fmt1(u.carries_pg)} car/g` : null, u.targets_pg ? `${fmt1(u.targets_pg)} tgt/g` : null, u.rz_targets ? `${u.rz_targets} RZ tgt` : null, u.rz_carries ? `${u.rz_carries} RZ car` : null].filter(Boolean).join(' · ') || '—']);
      return h('div', {}, cards, h('table.data', {}, h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('td.muted', { style: { width: '34%' } }, k), h('td', {}, v))))));
    },
    why() {
      const a = cur;
      if (!a) return h('p.muted', {}, 'No value in this mode (insufficient data).');
      const res = app.mode === 'dynasty' ? dyn : red;
      const sig = Object.entries(a.groupValues || {});
      return h('div', {},
        h('p', {}, `${a.name} — ${app.mode === 'dynasty' ? 'Dynasty' : 'Redraft'} value `, h('strong', {}, fmtValue(a.value)), ` in ${activeProfile().name}.`),
        breakdownTable(a),
        h('h3.mt', {}, 'Signals before weighting'),
        h('p.small.muted', {}, 'Each signal converted to this league\'s value scale. Weights are renormalised over the signals that exist for this player; missing signals are not imputed.'),
        h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Signal'), h('th.num', {}, 'Value'), h('th.num', {}, 'Weight'), h('th', {}, 'Sources'))),
          h('tbody', {}, sig.map(([g, v]) => h('tr', {}, h('td', {}, COMPONENT_LABELS[g] || g), h('td.num', {}, v === null ? h('span.faint', {}, 'unavailable') : fmtValue(v)), h('td.num', {}, a.weights[g] !== undefined ? `${Math.round(a.weights[g] * 100)}%` : '—'), h('td.small', {}, sourceList(a, g)))))),
        a.leagueEffect !== null ? h('p.mt', {}, h('strong', {}, 'League-specific adjustment: '), `in the reference league (${res.meta.reference_league}) this player would be ${fmtValue(a.refValue)}; your settings change that by ${fmtSigned(a.leagueEffect)}.`) : null,
        h('p.small.muted', {}, `Scale: top-12 reference-league assets average 7,000 (the best asset ≈ 10,000). Model ${res.meta.model_version} · data ${res.meta.data_version}. Values are approximate — differences under ~${fmtValue(a.sigma)} are within this asset's uncertainty.`),
        h('h3.mt', {}, 'Confidence'), h('p', {}, confBadge(a.confidence), ' ', h('span.small.muted', {}, `score ${a.confidence?.score ?? '—'}/100 (heuristic: coverage, agreement, sample size, freshness, independence)`)),
        h('ul.small', {}, (a.confidence?.reasons || []).map((r) => h('li', {}, r))));
    },
    dynasty() {
      if (!ad || !ad.details.years) return h('p.muted', {}, 'Insufficient data for a multi-year projection (no projection, production or draft-capital evidence).');
      const d = ad.details;
      const chart = lineChart([{ label: 'Projected PPG', color: 'var(--accent)', points: d.years.map((y) => [y.season, y.ppg]) }], { band: { label: '80% range', color: 'var(--accent)', points: d.years.map((y) => [y.season, y.ppgLow, y.ppgHigh]) }, yFormat: (v) => v.toFixed(0), yMin: 0, height: 200 });
      return h('div', {},
        h('div.kpis', {},
          h('div.kpi', {}, h('div.k', {}, 'Startable next season'), h('div.v', {}, fmtPctPlain(d.breakoutProb)), h('div.s', {}, 'P(above starter level in year 2)')),
          h('div.kpi', {}, h('div.k', {}, 'Decline risk'), h('div.v', {}, fmtPctPlain(d.declineProb)), h('div.s', {}, 'P(year-2 PPG < 85% of now), approx.')),
          h('div.kpi', {}, h('div.k', {}, 'Career horizon'), h('div.v', {}, `${d.careerHorizon} yrs`), h('div.s', {}, 'seasons likely startable')),
          h('div.kpi', {}, h('div.k', {}, 'Draft capital'), h('div.v', {}, d.draftBucket), h('div.s', {}, `career year ${d.careerYear}`))),
        h('h3.mt', {}, 'Multi-year projection'), chart,
        h('p.small.muted', {}, 'Five-year projections are NOT precise. The band shows the model\'s ±1.28σ range; uncertainty grows each year. Surplus uses E[max(0, X − replacement)], which credits young, uncertain players with upside.'),
        h('table.data.mt-s', {}, h('thead', {}, h('tr', {}, ['Season', 'Age', 'PPG (80% range)', 'Still relevant', 'P(starter)', 'Exp. surplus', 'Discount', 'Contribution'].map((x) => h('th', { class: x === 'Season' || x === 'Age' ? '' : 'num' }, x)))),
          h('tbody', {}, d.years.map((y) => h('tr', {}, h('td', {}, y.season), h('td', {}, fmt1(y.age)), h('td.num', {}, `${fmt1(y.ppg)} (${fmt1(y.ppgLow)}–${fmt1(y.ppgHigh)})`), h('td.num', {}, fmtPctPlain(y.survival)), h('td.num', {}, fmtPctPlain(y.pStarter)), h('td.num', {}, fmt1(y.eSurplus)), h('td.num', {}, y.discount.toFixed(2)), h('td.num', {}, fmt1(y.contribution)))))),
        h('h3.mt', {}, 'Current scoring-rate evidence'),
        h('table.data', {}, h('tbody', {}, d.evidence.map((e) => h('tr', {}, h('td', {}, e.kind.replace('_', ' ')), h('td.num', {}, `${fmt1(e.v)} PPG`), h('td.num', {}, `weight ${e.w.toFixed(2)}`))))),
        h('p.small.muted', {}, `Strategy: ${d.strategy} (yearly discount ${d.discount}). Change under Settings → Dynasty Model.`));
    },
    sources() {
      const pd = p || {};
      const sections = [];
      const fmtMk = (m) => `${m.dynasty ? 'Dynasty' : 'Redraft'} ${m.qb?.toUpperCase()}${m.ppr !== null && m.ppr !== undefined ? ` · ${m.ppr} PPR` : ''}${m.teams ? ` · ${m.teams}T` : ''}`;
      sections.push(h('h3', {}, 'Market values (raw, each source\'s own scale)'));
      sections.push(pd.market?.length ? h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th', {}, 'Format'), h('th.num', {}, 'Value'), h('th.num', {}, 'Rank'), h('th.num', {}, '30-day trend'), h('th', {}, 'As of'))),
        h('tbody', {}, pd.market.map((m) => h('tr', {}, h('td', {}, SRC_NAME(m.src)), h('td.small', {}, fmtMk(m)), h('td.num.market-v', {}, fmtValue(m.value)), h('td.num', {}, m.rank ?? '—'), h('td.num', { class: m.trend30 > 0 ? 'trend-up' : m.trend30 < 0 ? 'trend-down' : '' }, m.trend30 === null ? '—' : fmtSigned(m.trend30)), h('td.small.muted', {}, timeAgo(m.as_of)))))) : h('p.muted', {}, 'No market values.'));
      const excluded = ((app.mode === 'dynasty' ? dyn : red).meta.excluded_market_lists || []).filter((x) => (pd.market || []).some((m) => m.src === x.src));
      if (excluded.length) sections.push(h('p.small.muted', {}, `Not used in this league: ${excluded.map((x) => `${SRC_NAME(x.src)} (only ${String(x.meta?.qb || '1qb').toUpperCase()} lists)`).join(', ')} — lists in the other QB format misprice quarterbacks.`));
      const ranks = pd.rankings || [];
      sections.push(h('h3.mt', {}, 'Rankings'));
      if (ranks.length) {
        const byKind = {};
        for (const r of ranks) (byKind[r.kind] ||= []).push(r);
        sections.push(h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th', {}, 'List'), h('th.num', {}, 'Rank'), h('th.num', {}, 'Best'), h('th.num', {}, 'Worst'), h('th.num', {}, 'Expert SD'), h('th', {}, 'As of'))),
          h('tbody', {}, ranks.map((r) => h('tr', {}, h('td', {}, SRC_NAME(r.src)), h('td.small', {}, `${r.kind} · ${r.scope === 'position' ? `${r.pos} only` : `overall ${r.qb?.toUpperCase()}`}`), h('td.num.bold', {}, fmt1(r.ecr)), h('td.num', {}, r.best ?? '—'), h('td.num', {}, r.worst ?? '—'), h('td.num', {}, r.sd !== null && r.sd !== undefined ? fmt1(r.sd) : '—'), h('td.small.muted', {}, r.as_of ? String(r.as_of).slice(0, 10) : '—'))))));
        const a = cur;
        const posRanks = (a?.details?.consensus || []).map((c) => c.posRank).concat((a?.details?.market || []).map((c) => c.posRank));
        const disp = dispersion(posRanks.filter(Boolean));
        if (disp) sections.push(h('p.small', {}, h('strong', {}, 'Cross-source positional rank dispersion: '), `median ${fmt1(disp.median)}, mean ${fmt1(disp.mean)}, best ${fmt1(disp.best)}, worst ${fmt1(disp.worst)}, SD ${fmt1(disp.sd)} across ${disp.n} signals (consensus + market).`));
      } else sections.push(h('p.muted', {}, 'No rankings.'));
      sections.push(h('h3.mt', {}, 'Projections (league-scored)'));
      const projs = ar?.details?.projection?.bySource || [];
      sections.push(projs.length ? h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th.num', {}, 'Points'), h('th.num', {}, 'Games'), h('th.num', {}, 'Per game'), h('th', {}, 'Notes'))),
        h('tbody', {}, projs.map((s) => h('tr', {}, h('td', {}, SRC_NAME(s.src)), h('td.num', {}, fmt1(s.points)), h('td.num', {}, s.games ?? '—'), h('td.num', {}, s.games ? fmt1(s.points / s.games) : '—'), h('td.small.muted', {}, (s.estimated || []).length ? `estimated: ${s.estimated.join(', ')}` : ''))))) : h('p.muted', {}, 'No projections for the current scope.'));
      sections.push(h('h3.mt', {}, 'ADP'));
      sections.push(pd.adp?.length ? h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th', {}, 'Format'), h('th.num', {}, 'ADP'), h('th.num', {}, 'Drafts'), h('th', {}, 'As of'))),
        h('tbody', {}, pd.adp.map((x) => h('tr', {}, h('td', {}, SRC_NAME(x.src)), h('td.small', {}, x.format), h('td.num', {}, fmt1(x.adp)), h('td.num', {}, x.n_drafts ?? '—'), h('td.small.muted', {}, x.as_of ? String(x.as_of).slice(0, 10) : '—'))))) : h('p.muted', {}, 'No ADP.'));
      sections.push(h('h3.mt', {}, 'Identity'));
      sections.push(h('dl.kv', {}, h('dt', {}, 'Canonical ID'), h('dd.mono', {}, cid), ...Object.entries(pd.ids || {}).flatMap(([k, v]) => [h('dt', {}, k), h('dd.mono', {}, v)]), pd.aliases?.length ? [h('dt', {}, 'Also known as'), h('dd', {}, pd.aliases.join(', '))] : null));
      return h('div', {}, sections);
    },
    stats() {
      const d = ar?.details;
      const weeks = (p?.weekly || []).slice().sort((a, b) => a.w - b.w);
      if (!weeks.length && !p?.last_season) return h('p.muted', {}, 'No statistics available.');
      const scoring = red.scoring;
      const cols = ['Wk', 'Opp', 'Pts', 'xPts', 'Snap%', 'Tgt%', 'Pass', 'Rush', 'Rec', 'RZ'];
      const xByWeek = new Map((d?.production?.weekly || []).map((w) => [w.w, w.xfp]));
      const tbl = h('table.data', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: ['Wk', 'Opp'].includes(c) ? '' : 'num' }, c)))),
        h('tbody', {}, weeks.map((w) => {
          const st = w.st || {}, u = w.u || {};
          const pts = scoreStats(st, p.position, scoring, { perGame: true }).points;
          return h('tr', {}, h('td', {}, w.w), h('td', {}, w.opp || '—'), h('td.num.bold', {}, fmt1(pts)), h('td.num', {}, fmt1(xByWeek.get(w.w))), h('td.num', {}, u.snap_pct !== undefined ? fmtPctPlain(u.snap_pct) : '—'), h('td.num', {}, u.target_share !== undefined ? fmtPctPlain(u.target_share) : '—'),
            h('td.num.small', {}, st.pass_att ? `${st.pass_cmp}/${st.pass_att}, ${st.pass_yd} yd, ${st.pass_td} TD, ${st.pass_int} INT` : '—'),
            h('td.num.small', {}, st.rush_att ? `${st.rush_att}-${st.rush_yd}, ${st.rush_td} TD` : '—'),
            h('td.num.small', {}, st.rec_tgt ? `${st.rec}/${st.rec_tgt}, ${st.rec_yd} yd, ${st.rec_td} TD` : '—'),
            h('td.num.small', {}, (u.rz_tgt || u.rz_att) ? `${u.rz_tgt || 0}T ${u.rz_att || 0}C` : '—'));
        })));
      const chart = lineChart([{ label: 'Fantasy points', color: 'var(--accent)', points: weeks.map((w) => [w.w, scoreStats(w.st || {}, p.position, scoring, { perGame: true }).points]) }, { label: 'Expected (opportunity)', color: 'var(--market)', dashed: true, points: (d?.production?.weekly || []).map((w) => [w.w, w.xfp]) }], { xFormat: (x) => `W${x}`, yFormat: (v) => v.toFixed(0), yMin: 0, height: 180 });
      const ls = p?.last_season;
      return h('div', {}, weeks.length ? chart : null, weeks.length ? h('div.table-wrap.mt-s', {}, tbl) : null,
        ls ? h('p.mt', {}, h('strong', {}, `${ls.season} season: `), `${ls.games} games · ${fmt1(scoreStats(ls.st, p.position, scoring, { games: ls.games }).points / ls.games)} PPG in your scoring (source: ${SRC_NAME(ls.src)})`) : null,
        h('p.small.muted', {}, `Statistics source: ${SRC_NAME(app.dataset.meta?.stats_source)}. Red-zone usage from Sleeper where available. Expected points = targets/carries/attempts × league-average points per opportunity at the position.`));
    },
    trends() {
      const wrap = h('div', {}, h('p.muted', {}, 'Loading history…'));
      (async () => {
        let hist = null;
        if (hasServer()) { try { hist = await api.get(`/api/history?cid=${encodeURIComponent(cid)}`); } catch { /* none */ } }
        clear(wrap);
        const s = hist?.series;
        if (!s || !hist.entries.length) wrap.append(h('p.muted', {}, 'No value history yet. History is recorded on every sync — it is never back-filled or invented.'));
        else {
          const xs = hist.entries.map((e) => new Date(e.t).getTime());
          const ser = (arr) => arr.map((v, i) => [xs[i], v]);
          // Model values are only comparable within one model version: changes are measured since the current
          // version started and the model line is broken at every model change (raw source series are not).
          const markers = modelMarkers(hist.entries, xs);
          const breaks = markers.map((m) => m.x);
          const delta = (arr, days) => windowDelta(arr, xs, hist.entries, days);
          const mdelta = (arr, days) => windowDelta(arr, xs, hist.entries, days, { sameModelOnly: false });
          const since = currentModelStart(hist.entries);
          const span = xs[xs.length - 1] - xs[0];
          const dateFmt = (x) => (span < 2 * 864e5 ? new Date(x).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
          const key = app.mode === 'dynasty' ? 'd' : 'r';
          const mk = app.mode === 'dynasty' ? 'md' : 'mr';
          wrap.append(h('div.kpis', {}, [[7, '7 day'], [30, '30 day'], [365, 'Season']].map(([d, l]) => h('div.kpi', {}, h('div.k', {}, `${l} change`), h('div.v', {}, fmtSigned(delta(s[key], d))), h('div.s', {}, `market ${fmtSigned(mdelta(s[mk], d))}`)))));
          wrap.append(h('h3.mt', {}, 'Model value vs raw market value (reference league)'));
          wrap.append(lineChart([{ label: 'Model value', color: 'var(--accent)', points: ser(s[key]), breaks }, { label: 'FantasyCalc value (raw)', color: 'var(--market)', points: ser(s[mk]), dashed: true }], { xFormat: dateFmt, height: 200, markers }));
          if (markers.length) wrap.append(h('p.small.muted', {}, `The valuation model changed (dashed line: ${markers.map((m) => `${m.label} from ${dateFmt(m.x)}`).join(', ')}). Model values from different versions aren't comparable, so the line is broken there and the change figures above only count values since ${since.version} (${fmtTime(since.t)}). "Why did this value change?" below re-runs today's model on older data.`));
          wrap.append(h('h3.mt', {}, 'Consensus rank & projection'));
          wrap.append(lineChart([{ label: app.mode === 'dynasty' ? 'Dynasty ECR' : 'ROS ECR', color: 'var(--team-b)', points: ser(app.mode === 'dynasty' ? s.ed : s.er) }], { xFormat: dateFmt, height: 160, yFormat: (v) => v.toFixed(0) }));
          wrap.append(lineChart([{ label: 'ROS projected points (PPR)', color: 'var(--good)', points: ser(s.proj) }], { xFormat: dateFmt, height: 160 }));
          wrap.append(h('p.small.muted', {}, `${hist.entries.length} snapshot(s). FantasyCalc's own 30-day trend is shown on the Market tab when history is short. Comparing model vs market vs rank movement helps separate real improvement from hype or temporary ranking moves.`));
        }
        wrap.append(whyChanged(cid));
      })();
      return wrap;
    },
  };

  const close = openModal(h('div', {}, head, h('div.modal-body', {}, tabsEl, body)));
  show('overview');
}

function sourceList(a, g) {
  const d = a.details || {};
  const list = g === 'consensus' ? d.consensus : g === 'market' ? d.market : g === 'adp' ? d.adp : null;
  if (list && list.length) return list.map((s) => `${SRC_NAME(s.src)}${s.posRank ? ` (#${fmt1(s.posRank)} ${a.position})` : s.overallRank ? ` (#${fmt1(s.overallRank)})` : ''}${s.list ? ` [${s.list}]` : ''}`).join('; ');
  if (g === 'projection') return (d.projection?.bySource || []).map((s) => SRC_NAME(s.src)).join(', ') || '—';
  if (g === 'production') return `${SRC_NAME(app.dataset.meta?.stats_source)}${d.production?.gp ? ` · ${d.production.gp} games` : ''}`;
  if (g === 'fundamental') return 'projections + production + last season + draft capital → aging curve, attrition, discount';
  return '—';
}

/** "Why did this value change?" — recompute with an older snapshot and today's settings, then diff components. */
function whyChanged(cid) {
  const box = h('div.mt', {}, h('h3', {}, 'Why did this value change?'));
  if (!hasServer()) { box.append(h('p.small.muted', {}, 'Requires the local server (snapshots are stored on disk).')); return box; }
  const sel = h('select', {}, h('option', { value: '' }, 'Choose an earlier data snapshot…'));
  const out = h('div.mt-s');
  box.append(h('div.flex', {}, sel), out);
  api.get('/api/snapshots').then((list) => {
    for (const s of list.slice(1, 60)) sel.append(h('option', { value: s.file }, `${fmtTime(s.built_at)} · ${s.data_version}`));
    if (list.length <= 1) out.append(h('p.small.muted', {}, 'Only one snapshot exists so far — sync again later to compare.'));
  }).catch(() => {});
  sel.addEventListener('change', async () => {
    clear(out);
    if (!sel.value) return;
    out.append(h('p.small.muted', {}, 'Recomputing with the older snapshot…'));
    try {
      const old = await api.get(`/api/snapshots/${encodeURIComponent(sel.value)}`);
      const oldRes = getValuations(app.mode, activeProfile(), old);
      const nowRes = getValuations(app.mode);
      const d = diffAsset(oldRes.assets.get(cid), nowRes.assets.get(cid));
      clear(out);
      if (!d) { out.append(h('p.muted', {}, 'The player had no value in that snapshot.')); return; }
      out.append(h('p', {}, `Value changed from ${fmtValue(d.from)} → `, h('strong', {}, fmtValue(d.to)), ` (${fmtSigned(d.delta)}) with identical settings and model.`),
        h('table.data', {}, h('tbody', {}, d.drivers.map((x) => h('tr', {}, h('td', {}, x.label), h('td.num', {}, fmtValue(x.from)), h('td.num', {}, '→'), h('td.num', {}, fmtValue(x.to)), h('td.num.bold', { class: x.delta > 0 ? 'trend-up' : 'trend-down' }, fmtSigned(x.delta)))))),
        d.notes.length ? h('ul.small', {}, d.notes.map((n) => h('li', {}, n))) : null);
    } catch (e) { clear(out); out.append(h('p.err', {}, e.message)); }
  });
  return box;
}

export function openPickDetail(id) {
  const res = getValuations('dynasty');
  const a = res.getAsset(id);
  if (!a) return;
  let close;
  const d = a.details;
  close = openModal(h('div', {},
    h('div.modal-head', {}, h('div', {}, h('div.flex', {}, posBadge('PICK'), h('h2', {}, a.name)), h('div.muted.small', {}, `Rookie draft pick · ${res.league.teams}-team league · class positions ${d.classPositions[0]}${d.classPositions.length > 1 ? `–${d.classPositions[d.classPositions.length - 1]}` : ''}`)), h('button.modal-close', { onclick: () => close() }, '×')),
    h('div.modal-body', {},
      h('div.value-cards', {},
        h('div.value-card.model', {}, h('div.k', {}, 'Pick value'), h('div.v', {}, fmtValue(a.value)), h('div.s', {}, `estimate range ≈ ${fmtRange(a.range)}`)),
        h('div.value-card', {}, h('div.k', {}, 'Outcome risk'), h('div.v', {}, `±${Math.round((d.outcomeRiskCv || 0) * 100)}%`), h('div.s', {}, 'spread of what the drafted player becomes')),
        h('div.value-card', {}, h('div.k', {}, 'Confidence'), h('div.v', {}, confBadge(a.confidence)), h('div.s', {}, (a.confidence.reasons || []).join('; ')))),
      h('h3', {}, 'Why this value?'), breakdownTable(a),
      h('p.small.muted.mt', {}, `This is ROOKIE DRAFT PICK value — the expected value of whoever is selected with this pick — not the value of any particular rookie prospect. Market inputs: ${a.sources.map(SRC_NAME).join(', ') || 'none'}. Future classes are discounted ${Math.round((1 - d.discount) * 100)}%. Weights and discounts: Settings → Rookie Pick Model.`))));
}
