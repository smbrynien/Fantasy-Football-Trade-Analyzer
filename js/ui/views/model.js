// MODEL — methodology summary, live league structure, calibration outputs and backtest diagnostics.

import { h, clear, fmt1, fmtPctPlain } from '../dom.js';
import { app, getValuations, activeLeague } from '../state.js';
import { buildModel } from '../../core/settings.js';
import { lineChart } from '../charts.js';

const POS_COLORS = { QB: '#dc2626', RB: '#059669', WR: '#2563eb', TE: '#d97706' };

export function renderModel(root) {
  const league = activeLeague();
  const model = buildModel(app.config.model, app.config.calibration, league);
  const cal = app.config.calibration || {};
  const res = app.dataset ? getValuations() : null;

  root.append(h('div.panel', {},
    h('h2', {}, 'How values are produced'),
    h('ol', {},
      h('li', {}, h('strong', {}, 'Normalize every source onto one currency: '), 'league-scored fantasy points above the positional replacement level of YOUR league (rest of season in redraft; discounted multi-year surplus in dynasty). Rankings and market values are mapped by positional rank onto that curve — raw numbers from unrelated scales are never averaged.'),
      h('li', {}, h('strong', {}, 'Blend independent signals '), 'with transparent, configurable weights (Settings). Weights are renormalised over the signals a player actually has; nothing is imputed.'),
      h('li', {}, h('strong', {}, 'Dynasty '), 'projects each season (default 5) with calibrated aging curves, attrition and draft-capital priors, values each season as E[max(0, X − replacement)] so uncertainty creates upside for young players, and discounts by team strategy.'),
      h('li', {}, h('strong', {}, 'Scale: '), 'the average of the 12 most valuable assets in the reference league (12-team 1QB PPR) = 7,000, which puts the top asset near 10,000. The same factor is used for your league, so values are comparable across settings, and the "League-specific adjustment" shows the difference.'),
      h('li', {}, h('strong', {}, 'Confidence '), 'is a heuristic from source coverage, agreement, sample size, freshness and independence — not a statistical interval.')),
    h('p.small.muted', {}, `Model version ${model.model_version}. Full documentation: docs/VALUATION_MODEL.md, docs/DYNASTY_MODEL.md, docs/ROOKIE_PICK_MODEL.md.`)));

  if (res) {
    const st = res.structure;
    root.append(h('div.panel', {},
      h('h2', {}, `Your league structure (${app.mode})`),
      h('p.small.muted', {}, `${league.name}: ${league.teams} teams. Phase: ${res.phase.phase}, week ${res.phase.week} (${Math.round(res.phase.alpha * 100)}% in-season weights). Points basis: ${app.mode === 'redraft' ? 'rest-of-season points' : 'expected next-season points'}.`),
      h('table.data', {}, h('thead', {}, h('tr', {}, ['Position', 'Starters', 'Replacement pts', 'Waiver pts', 'Rostered', 'Avg. worst starter pts'].map((c) => h('th', { class: c === 'Position' ? '' : 'num' }, c)))),
        h('tbody', {}, Object.keys(st.starters).map((p) => h('tr', {}, h('td', {}, p), h('td.num', {}, st.starters[p]), h('td.num', {}, fmt1(st.replacement[p])), h('td.num', {}, fmt1(st.waiver[p])), h('td.num', {}, st.rostered[p]), h('td.num', {}, fmt1(st.displacement[p])))))),
      h('h3.mt', {}, 'Current signal weights'),
      h('p', {}, Object.entries(res.weights).filter(([, w]) => w > 0).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(' · ')),
      h('p.small.muted', {}, `Points→value factor ${res.factor.toFixed(2)} · computed in ${res.meta.compute_ms} ms · data ${res.meta.data_version}.`)));
  }

  // Calibration
  const calPanel = h('div.panel', {}, h('h2', {}, 'Calibration (from historical data)'));
  root.append(calPanel);
  if (!cal.aging_curves) calPanel.append(h('p.muted', {}, 'No calibration files found — defaults are in use. Run `npm run calibrate`.'));
  else {
    const curves = model.dynasty.aging_curves;
    calPanel.append(h('h3', {}, 'Aging curves (relative PPG, peak = 1)'),
      lineChart(['QB', 'RB', 'WR', 'TE'].map((p) => ({ label: p, color: POS_COLORS[p], points: Object.entries(curves[p] || {}).filter(([a]) => !a.startsWith('_') && Number(a) >= 21 && Number(a) <= 38).map(([a, v]) => [Number(a), v]) })), { yMin: 0, yFormat: (v) => v.toFixed(1), xLabel: 'Age', height: 230 }),
      h('p.small.muted', {}, cal.aging_curves.method),
      h('h3.mt', {}, 'Attrition: P(drops out next season)'),
      lineChart(['QB', 'RB', 'WR', 'TE'].map((p) => ({ label: p, color: POS_COLORS[p], points: Object.entries(cal.attrition?.hazard?.[p] || {}).filter(([a]) => Number(a) <= 38).map(([a, v]) => [Number(a), v]) })), { yMin: 0, yFormat: (v) => `${Math.round(v * 100)}%`, xLabel: 'Age', height: 200 }),
      h('p.small.muted', {}, cal.attrition?.method || ''),
      h('p', {}, h('strong', {}, 'Availability (share of games played): '), Object.entries(model.dynasty.availability).map(([k, v]) => `${k} ${fmtPctPlain(v)}`).join(' · '), h('br'), h('strong', {}, 'Year-1 uncertainty (CV): '), Object.entries(model.dynasty.uncertainty.cv_year1).map(([k, v]) => `${k} ${v}`).join(' · ')));
    if (cal.draft_priors) {
      const pr = cal.draft_priors.priors;
      const buckets = ['R1a', 'R1b', 'R2', 'R3', 'R4-5', 'R6-7', 'UDFA'];
      calPanel.append(h('h3.mt', {}, 'Draft-capital priors (PPR points per game by career year)'),
        h('div.table-wrap', {}, h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Pos'), h('th', {}, 'Draft'), [1, 2, 3, 4, 5].map((k) => h('th.num', {}, `Yr ${k}`)))),
          h('tbody', {}, ['QB', 'RB', 'WR', 'TE'].flatMap((p) => buckets.filter((b) => pr[p]?.[b]).map((b) => h('tr', {}, h('td', {}, p), h('td', {}, b), pr[p][b].map((v) => h('td.num', {}, fmt1(v))))))))),
        h('p.small.muted', {}, cal.draft_priors.method));
    }
    if (cal.rookie_slot_curve) {
      const rc = cal.rookie_slot_curve;
      calPanel.append(h('h3.mt', {}, 'Rookie slot value curve'),
        lineChart([{ label: 'Smoothed shape (top-12 avg = 1)', color: 'var(--accent)', points: rc.shape.map((v, i) => [i + 1, v]) }, { label: 'Raw mean (scaled)', color: 'var(--faint)', dashed: true, points: (rc.raw_mean_by_rank || []).map((v, i) => [i + 1, v / (rc.raw_mean_by_rank.slice(0, 12).reduce((a, b) => a + b, 0) / 12 || 1)]) }], { yMin: 0, xLabel: 'Consensus rookie rank in class', yFormat: (v) => v.toFixed(1), height: 220 }),
        h('table.data.mt-s', {}, h('thead', {}, h('tr', {}, ['Rookie rank', 'n', 'Top-24 season within 3 yrs', 'Mean 3-yr surplus', 'Outcome CV'].map((c) => h('th', { class: c === 'Rookie rank' ? '' : 'num' }, c)))),
          h('tbody', {}, rc.hit_rates.map((r) => h('tr', {}, h('td', {}, r.picks), h('td.num', {}, r.n), h('td.num', {}, fmtPctPlain(r.top24_rate)), h('td.num', {}, fmt1(r.mean_value)), h('td.num', {}, fmt1(r.outcome_cv)))))),
        h('p.small.muted', {}, `${rc.method} Classes: ${Object.entries(rc.classes).map(([y, n]) => `${y} (${n})`).join(', ')}. Small samples — treat as directional.`));
    }
  }

  // Backtest
  const bt = h('div.panel', {}, h('h2', {}, 'Backtesting & source diagnostics'), h('p.muted', {}, 'Loading report…'));
  root.append(bt);
  fetch('reports/backtest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((rep) => {
    clear(bt).append(h('h2', {}, 'Backtesting & source diagnostics'));
    if (!rep) { bt.append(h('p.muted', {}, 'No backtest report found. Run `npm run backtest` to evaluate historical rankings vs. actual production.')); return; }
    bt.append(h('p.small.muted', {}, `${rep.method} Generated ${new Date(rep.generated_at).toLocaleDateString()}.`));
    for (const sec of rep.sections || []) {
      bt.append(h('h3.mt', {}, sec.title), sec.note ? h('p.small.muted', {}, sec.note) : null,
        h('div.table-wrap', {}, h('table.data', {}, h('thead', {}, h('tr', {}, sec.columns.map((c, i) => h('th', { class: i ? 'num' : '' }, c)))), h('tbody', {}, sec.rows.map((r) => h('tr', {}, r.map((v, i) => h('td', { class: i ? 'num' : '' }, typeof v === 'number' ? (Math.abs(v) < 1.5 && !Number.isInteger(v) ? v.toFixed(3) : fmt1(v)) : v ?? '—'))))))));
    }
    if (rep.conclusions) bt.append(h('h3.mt', {}, 'Takeaways'), h('ul', {}, rep.conclusions.map((c) => h('li', {}, c))));
  }).catch(() => { clear(bt).append(h('h2', {}, 'Backtesting'), h('p.muted', {}, 'Backtest report unavailable.')); });
}
