// Model audit scorecard (reports/audit/scorecard.json, written by `npm run audit-model`) for the Model page: rows
// grouped per experiment, pivoted to candidate × metric, with the best candidate per metric where "best" has a clear
// direction. Pure functions — tested in tests/audit-scorecard.test.js.

/** Which way a metric is better: 'higher', 'lower', 'zero' (closest to 0) or null (no ranking, e.g. a calibration share). */
export function metricDirection(metric) {
  const m = String(metric).toLowerCase();
  if (/bias/.test(m)) return 'zero';
  if (/mae|loss|failures|error/.test(m)) return 'lower';
  // Not ranked: calibration shares (E7 win share by margin bucket, E10 share inside ±) describe, they don't compete.
  if (/spearman|corr|log-likelihood/.test(m)) return 'higher';
  return null;
}

// Short names for candidates the reports don't label themselves.
const GLOSS = {
  ecr: 'FantasyPros expert consensus', blend: 'the app\'s signal blend', app: 'the app\'s weights', fit: 'weights fitted on earlier seasons',
  fitW: 'fitted weights', fitPts: 'fitted weights (points)', consensus: 'expert consensus alone', projection: 'projections alone', projectionPts: 'projected points alone',
  production: 'production alone', adp: 'ADP alone', adpSleeper: 'Sleeper ADP', adpFFC: 'FFC ADP', ecrProj: 'consensus + projections',
  det: 'deterministic surplus (σ = 0)', exp: 'expected surplus', emp: 'empirical surplus', fundamental: 'multi-year fundamental model',
  current: 'current model', margin: 'value margin', zShare: 'z-score (share)', zApp: 'z-score with the app\'s ±', zDis: 'z-score with signal disagreement',
  raw: 'plain sums (no package adjustment)', packageAdjusted: 'with the package adjustment', seasonPPG: 'season points per game', last4: 'last 4 games',
  usageOnly: 'usage only', currentBlend: 'current blend', fittedBlend: 'fitted blend', prodLastSeason: 'last season\'s production',
};
export const candidateLabel = (exp, model) => exp.candidates?.[model] || GLOSS[model] || null;

/** Kind of evidence from the report's data label. */
export function evidenceKind(label) {
  const l = String(label || '');
  if (/SIMULATED/.test(l)) return 'Real outcomes, simulated leagues';
  if (/^CURRENT DATA/.test(l)) return 'Current data';
  if (/REAL/.test(l)) return 'Real historical data';
  return 'Other';
}

/** Candidate × metric table of one experiment, with the best candidate per rankable metric. */
export function pivotExperiment(exp) {
  const models = [], metrics = [];
  const cells = new Map();
  for (const r of exp.rows || []) {
    if (!models.includes(r.model)) models.push(r.model);
    if (!metrics.includes(r.metric)) metrics.push(r.metric);
    cells.set(`${r.model}\u0000${r.metric}`, r.value);
  }
  const cell = (model, metric) => { const v = cells.get(`${model}\u0000${metric}`); return Number.isFinite(v) ? v : null; };
  const best = {};
  for (const metric of metrics) {
    const dir = metricDirection(metric);
    const vals = models.map((m) => [m, cell(m, metric)]).filter(([, v]) => v !== null);
    if (!dir || vals.length < 2) continue;
    const score = (v) => (dir === 'higher' ? v : dir === 'lower' ? -v : -Math.abs(v));
    const top = Math.max(...vals.map(([, v]) => score(v)));
    best[metric] = vals.filter(([, v]) => score(v) === top).map(([m]) => m);
  }
  return { models, metrics, cell, best };
}

/** One-line result: the best candidate on the experiment's first rankable metric. */
export function headline(exp) {
  const p = pivotExperiment(exp);
  const metric = p.metrics.find((m) => p.best[m]);
  if (!metric) {
    if (p.models.length === 1 && p.metrics.length === 1) return { metric: p.metrics[0], model: p.models[0], value: p.cell(p.models[0], p.metrics[0]) };
    return null;
  }
  const model = p.best[metric][0];
  return { metric, model, value: p.cell(model, metric), tied: p.best[metric].length > 1 };
}

export function fmtMetric(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
}
