#!/usr/bin/env node
// Automated model audit: `npm run audit-model` → reports/audit/*.json (+ CSV)
//   --only=e1,…,e13,current,compare   run selected sections   --rebuild   rebuild the historical benchmark
//   --only=scorecard    only rewrite scorecard.csv/.json from the reports already in the output dir (no experiments)
//   E1–E4 (2.0.0 audit): preseason/in-season/dynasty backtests, rookie curve. E5–E8 (2.2.0 audit): hindsight-free
//   lineup value (σ), historical league simulation (trades, package), verdict calibration, dynasty value spacing.
//   E9–E13 (2.3.0 research): signal weights from projection/ADP archives, ± calibration, availability by rank,
//   roster-specific values, backtest from the app's own daily signal archive (skips until a season is archived).
//   --freeze            copy the synced dataset to data/benchmark/dataset-frozen.json (the data before/after runs use)
//   --snapshot-before   save current-model values on the frozen dataset as the 'before' baseline (values-v1.json);
//                       freezes first if no frozen dataset exists
//   --out=DIR           write every output (and read/write the baseline) in DIR instead of the committed reports/audit
// --freeze / --snapshot-before without --only do only that (no backtests). A before/after comparison is skipped with
// instructions, never thrown, when the baseline was made on different data.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/lib/paths.js';
import { loadBenchmark } from './audit/benchmark.js';
import { preseasonRedraft, inSeasonROS, dynasty, rookieCurve, measureOppRates } from './audit/backtests.js';
import { loadSeasons } from './lib/history-data.js';
import { FROZEN, freezeDataset } from './audit/current.js';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const setupOnly = !only.length && (args.includes('--freeze') || args.includes('--snapshot-before'));
const want = (k) => (only.length ? only.includes(k) : !setupOnly);
const outArg = args.find((a) => a.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice('--out='.length)) : path.join(ROOT, 'reports', 'audit');
fs.mkdirSync(OUT, { recursive: true });
const rel = (f) => { const r = path.relative(ROOT, f); return !r || r.startsWith('..') ? f : r; };
const write = (name, obj) => { const f = path.join(OUT, `${name}.json`); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); console.log(`  wrote ${rel(f)}`); };

const t0 = Date.now();
const HOW = 'To compare model versions: `npm run sync` → `npm run audit-model -- --freeze --snapshot-before` on the OLD model → change the model → `npm run audit-model -- --only=compare`.';
if (OUT !== path.join(ROOT, 'reports', 'audit')) console.log(`Writing outputs to ${OUT}`);
if (args.includes('--freeze') || (args.includes('--snapshot-before') && !fs.existsSync(FROZEN))) {
  try {
    const { previous, current } = freezeDataset();
    console.log(`Froze dataset ${current} → ${rel(FROZEN)}${previous && previous !== current ? ` (replaced ${previous})` : ''}`);
  } catch (e) { console.error(`  ${e.message}`); process.exit(1); }
}
const needBench = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12'].some(want);
const bench = needBench ? await loadBenchmark({ rebuild: args.includes('--rebuild') }) : null;
if (want('e1')) { console.log('E1 preseason redraft…'); write('e1-preseason-redraft', { label: 'REAL HISTORICAL DATA', oppRates: measureOppRates(bench), ...preseasonRedraft(bench) }); }
if (want('e2')) { console.log('E2 in-season ROS…'); write('e2-inseason-ros', { label: 'REAL HISTORICAL DATA', ...inSeasonROS(bench) }); }
if (want('e3')) { console.log('E3 dynasty…'); const hist = await loadSeasons(2006, 2025); write('e3-dynasty', { label: 'REAL HISTORICAL DATA', ...dynasty(bench, hist) }); }
if (want('e4')) { console.log('E4 rookie curve…'); write('e4-rookie-curve', { label: 'REAL HISTORICAL DATA', ...rookieCurve(bench) }); }
if (want('e5')) { const { lineupValue } = await import('./audit/lineup.js'); console.log('E5 hindsight-free lineup value…'); write('e5-lineup-value', { label: 'REAL HISTORICAL DATA', ...lineupValue(bench) }); }
if (want('e6') || want('e7')) {
  const { leagueSimulation } = await import('./audit/league.js');
  const { tradeCalibration } = await import('./audit/calibration.js');
  console.log('E6 historical league simulation (5,000 trades, ~40 s)…');
  const sim = leagueSimulation(bench, { tradesPerSeason: 1000 });
  const { tradeRows, ...e6 } = sim;
  if (want('e6')) write('e6-league-simulation', e6);
  if (want('e7')) { console.log('E7 trade verdict calibration…'); write('e7-verdict-calibration', { label: sim.labels, ...tradeCalibration(tradeRows) }); }
}
if (want('e9') || want('e10')) {
  const { loadConfig } = await import('../server/lib/config.js');
  const model = loadConfig().model;
  if (want('e9')) { const { signalWeights } = await import('./audit/weights.js'); console.log('E9 signal weights from historical projection/ADP archives…'); write('e9-signal-weights', await signalWeights(bench, model)); }
  if (want('e10')) { const { uncertaintyCalibration } = await import('./audit/uncertainty.js'); console.log('E10 ± range calibration (~30 s)…'); write('e10-uncertainty', await uncertaintyCalibration(bench, model)); }
}
if (want('e11')) { const { availabilityShape } = await import('./audit/lineup.js'); console.log('E11 availability by rank…'); write('e11-availability-shape', availabilityShape(bench)); }
if (want('e12')) { const { rosterSpecific } = await import('./audit/roster-value.js'); console.log('E12 roster-specific values (~30 s)…'); write('e12-roster-values', rosterSpecific(bench)); }
if (want('e13')) {
  const { listArchive, loadArchiveDay } = await import('../server/archive.js');
  const { archiveBacktest } = await import('./audit/archive-backtest.js');
  const { loadCSV } = await import('./lib/history-data.js');
  const { weekPts } = await import('./audit/backtests.js');
  const { normalizePosition } = await import('../js/core/util/positions.js');
  const { mapNflverseStats } = await import('../adapters/nflverse.js');
  console.log('E13 backtest from the daily signal archive…');
  const days = [];
  for (const d of await listArchive()) { const rec = await loadArchiveDay(d.file); if (rec) days.push(rec); }
  // Outcomes only for completed seasons (nflverse weekly stats; a season is complete once the next one has started).
  const thisYear = new Date().getUTCFullYear();
  const done = [...new Set(days.map((d) => Number(d.state?.season)).filter((y) => y && (y < thisYear - 1 || (y === thisYear - 1 && new Date().getUTCMonth() >= 1))))];
  const pts = new Map();
  for (const y of done) {
    const rows = await loadCSV(`stats_player_week_${y}.csv`, `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${y}.csv`);
    for (const r of rows) { if (r.season_type && r.season_type !== 'REG') continue; const pos = normalizePosition(r.position); if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue; const k = `${r.player_id}:${y}`; if (!pts.has(k)) pts.set(k, []); pts.get(k).push([Number(r.week), weekPts(mapNflverseStats(r), pos)]); }
  }
  const outcomes = (g, y, from) => { const ws = pts.get(`${g}:${y}`); return ws ? ws.filter(([w]) => w >= from).reduce((a, [, p]) => a + p, 0) : (done.includes(y) ? 0 : null); };
  const res = archiveBacktest(days, outcomes, { completedSeasons: done });
  if (res.skipped) console.log(`  SKIPPED: ${res.reason}`);
  write('e13-archive-backtest', { label: 'REAL DATA from the app\'s own daily signal archive (data/archive)', ...res });
}
if (want('e8')) { const { dynastyShape } = await import('./audit/dynasty-shape.js'); console.log('E8 dynasty value spacing…'); const hist = await loadSeasons(2006, 2025); write('e8-dynasty-spacing', { label: 'REAL HISTORICAL DATA', ...dynastyShape(bench, hist, { mults: [0, 0.5, 1, 1.25] }) }); }
if (want('current')) {
  const { currentDataAudit } = await import('./audit/current.js');
  console.log('Current-data analyses…');
  const res = await currentDataAudit();
  if (!res) console.log(`  SKIPPED: no dataset. Run \`npm run sync\` first. ${HOW}`);
  else for (const [k, v] of Object.entries(res)) write(k, v);
}
if (want('compare') || args.includes('--snapshot-before')) {
  const { loadConfig } = await import('../server/lib/config.js');
  const { snapshotValues, compareSnapshots, sampleTable, loadV1, v1File } = await import('./audit/compare.js');
  const { loadFrozenDataset } = await import('./audit/current.js');
  const frozen = loadFrozenDataset();
  if (!frozen) console.log(`  SKIPPED before/after: no dataset. Run \`npm run sync\` first. ${HOW}`);
  else {
    if (!frozen.frozen) console.log(`  NOTE: no frozen dataset; using the live dataset ${frozen.ds.data_version}, which changes on every sync. ${HOW}`);
    const now = snapshotValues(frozen.ds, loadConfig());
    if (args.includes('--snapshot-before')) {
      fs.writeFileSync(v1File(OUT), JSON.stringify(now));
      console.log(`  saved baseline ${rel(v1File(OUT))} (model ${Object.values(now.sets)[0].model_version}, data ${now.data_version})`);
    } else {
      const before = loadV1(OUT);
      if (!before) console.log(`  SKIPPED before/after: no baseline at ${rel(v1File(OUT))}. ${HOW}`);
      else if (before.data_version !== now.data_version) {
        console.log(`  SKIPPED before/after: the baseline (${rel(v1File(OUT))}) was computed on data ${before.data_version}, but the dataset here is ${now.data_version}.`);
        console.log('  Values would differ because of data, not the model. To compare: check out the old model, then');
        console.log('  `npm run audit-model -- --freeze --snapshot-before` (add --out=DIR to keep the committed reports untouched),');
        console.log('  return to the new model and run `npm run audit-model -- --only=compare` (same --out).');
      } else {
        console.log('Before/after comparison…');
        const { summary, csv } = compareSnapshots(before, now);
        write('before-after', summary);
        fs.writeFileSync(path.join(OUT, 'before-after.csv'), csv);
        console.log(`  wrote ${rel(path.join(OUT, 'before-after.csv'))}`);
        write('before-after-sample', { label: summary.label, rows: sampleTable(before, now) });
      }
    }
  }
}
// Scorecard: one CSV row per (experiment, model/baseline, metric) from whatever reports exist.
if (!setupOnly) {
  const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `${f}.json`), 'utf8')); } catch { return null; } };
  const rows = [['experiment', 'data_label', 'model', 'metric', 'value']];
  const e1 = rd('e1-preseason-redraft'), e2 = rd('e2-inseason-ros'), e3 = rd('e3-dynasty'), e4 = rd('e4-rookie-curve');
  if (e1) {
    for (const [m, v] of Object.entries(e1.summary || {})) { rows.push(['E1 preseason redraft', e1.label, m, 'spearman', v.meanRho]); rows.push(['E1 preseason redraft', e1.label, m, 'MAE', v.meanMAE]); }
    for (const [m, v] of Object.entries(e1.scaleSummary || {})) { rows.push(['E1b value scale', e1.label, m, 'MAE', v.mae]); for (const t of v.biasByTier) rows.push(['E1b value scale', e1.label, m, `bias ranks ${t.tier}`, t.bias]); }
  }
  if (e2) for (const [m, v] of Object.entries(e2.overall || {})) { rows.push(['E2 in-season ROS', e2.label, m, 'spearman', v.rho]); rows.push(['E2 in-season ROS', e2.label, m, 'MAE', v.mae]); }
  if (e3) {
    const keys = Object.keys(e3.results?.[0]?.rho || {});
    for (const k of keys) rows.push(['E3 dynasty', e3.label, k, 'spearman', Math.round(1000 * e3.results.reduce((a, r) => a + r.rho[k], 0) / e3.results.length) / 1000]);
    for (const k of Object.keys(e3.results?.[0]?.variants || {})) rows.push(['E3 dynasty', e3.label, `fundamental ${k}`, 'spearman', Math.round(1000 * e3.results.reduce((a, r) => a + r.variants[k], 0) / e3.results.length) / 1000]);
  }
  if (e4) for (const [m, v] of Object.entries(e4.families || {})) { rows.push(['E4 rookie slot curve', e4.label, m, 'LOO MAE', v.looMAE]); if (v.looBias !== undefined) rows.push(['E4 rookie slot curve', e4.label, m, 'LOO bias', v.looBias]); }
  const e5 = rd('e5-lineup-value'), e6 = rd('e6-league-simulation'), e7 = rd('e7-verdict-calibration'), e8 = rd('e8-dynasty-spacing');
  if (e5) for (const [m, v] of Object.entries(e5.preseason?.candidates || {})) { rows.push(['E5 lineup value (preseason)', e5.label, m, 'tier loss (log ratio²)', v.loss]); for (const t of v.ratio) rows.push(['E5 lineup value (preseason)', e5.label, m, `value ratio ranks ${t.tier}`, t.ratio]); }
  if (e5) for (const s of e5.inSeason || []) for (const [m, v] of Object.entries(s.candidates)) rows.push([`E5 lineup value (from week ${s.startWeek})`, e5.label, m, 'tier loss (log ratio²)', v.loss]);
  if (e6) for (const [m, v] of Object.entries(e6.summary || {})) { rows.push(['E6 league simulation', e6.labels, m, 'corr(predicted margin, realised outcome)', v.all.corr]); rows.push(['E6 league simulation', e6.labels, m, 'corr, uneven player counts', v.unevenCount.corr]); }
  if (e7) for (const b of e7.byMargin || []) rows.push(['E7 verdict calibration', e7.label, `margin ${b.margin}`, 'share won by favoured side', b.hitRate]);
  if (e8) for (const [m, v] of Object.entries(e8.results || {})) rows.push(['E8 dynasty spacing', e8.label, m, 'tier loss (log ratio²)', v.loss]);
  const e9 = rd('e9-signal-weights'), e10 = rd('e10-uncertainty'), e12 = rd('e12-roster-values');
  if (e9) { for (const [m, v] of Object.entries(e9.preseason?.summary || {})) rows.push(['E9 preseason weights', e9.label, m, 'spearman (season points)', v.rho]); for (const [m, v] of Object.entries(e9.inSeason?.overall || {})) rows.push(['E9 in-season weights', e9.label, m, 'MAE (rest-of-season points)', v.mae]); }
  if (e10) { rows.push(['E10 ± calibration', e10.labels, 'app ± range', 'share of season outcomes inside ±1', e10.player.shareInsideAppRange]); rows.push(['E10 ± calibration', e10.labels, 'signal disagreement', 'spearman with outcome error', e10.player.spearmanDisagreementVsError]); for (const [m, v] of Object.entries(e10.trades?.models || {})) rows.push(['E10 win-probability models', e10.labels, m, 'test log-likelihood per trade', v.testLogLikPerTrade]); }
  if (e12) { for (const [m, v] of Object.entries(e12.margin || {})) rows.push(['E12 roster-specific values', e12.labels, m, 'corr(predicted margin, realised outcome)', v.corr]); for (const [m, v] of Object.entries(e12.ownGain || {})) rows.push(['E12 roster-specific values', e12.labels, m, 'corr(predicted own change, own realised gain)', v]); }
  const mono = rd('cur-monotonicity'), pk = rd('cur-package-simulation');
  if (mono) rows.push(['Monotonicity', mono.label, 'current', 'failures', mono.failures]);
  if (pk) for (const [m, v] of Object.entries(pk.overall || {})) rows.push(['Package simulation', pk.label, m, 'corr(model diff, simulated lineup gain)', v]);
  if (rows.length > 1) { fs.writeFileSync(path.join(OUT, 'scorecard.csv'), rows.map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n')); console.log(`  wrote ${rel(path.join(OUT, 'scorecard.csv'))}`); }
  // scorecard.json: the same rows grouped by experiment, with each report's own description and candidate labels, for
  // the Model page (reports/audit/scorecard.json is served; the other audit files are not).
  if (rows.length > 1) {
    const { loadConfig } = await import('../server/lib/config.js');
    const reportOf = { E1: 'e1-preseason-redraft', E1b: 'e1-preseason-redraft', E2: 'e2-inseason-ros', E3: 'e3-dynasty', E4: 'e4-rookie-curve', E5: 'e5-lineup-value', E6: 'e6-league-simulation', E7: 'e7-verdict-calibration', E8: 'e8-dynasty-spacing', E9: 'e9-signal-weights', E10: 'e10-uncertainty', E12: 'e12-roster-values', Monotonicity: 'cur-monotonicity', Package: 'cur-package-simulation' };
    const fallback = { Monotonicity: 'Monotonicity checks on current data (e.g. more projected points or a younger age never lowers a value)', Package: 'Package-adjustment simulation on current data (does the adjustment track the simulated lineup gain of uneven trades?)' };
    const candidateLabels = (rep) => {
      const out = {};
      for (const [k, v] of Object.entries(rep?.preseason?.candidates || {})) if (typeof v?.label === 'string') out[k] = v.label;
      for (const [k, v] of Object.entries(rep?.summary || {})) if (typeof v?.label === 'string') out[k] = v.label;
      for (const [k, v] of Object.entries(rep?.predictors || {})) if (typeof v === 'string') out[k] = v;
      return out;
    };
    const groups = new Map();
    for (const [name, label, model, metric, value] of rows.slice(1)) {
      if (!groups.has(name)) {
        const key = name.split(' ')[0];
        const rep = reportOf[key] ? rd(reportOf[key]) : null;
        groups.set(name, { name, id: key, data_label: label, description: (typeof rep?.experiment === 'string' && rep.experiment) || fallback[key] || '', candidates: candidateLabels(rep), rows: [] });
      }
      groups.get(name).rows.push({ model, metric, value: typeof value === 'number' ? value : Number(value) });
    }
    const e13 = rd('e13-archive-backtest');
    const pending = e13?.skipped ? [{ name: 'E13 market weight from the daily signal archive', data_label: e13.label, reason: e13.reason }] : [];
    // The model the reports were run with (the current-data label names it), not the one installed when the scorecard is rebuilt.
    const audited = String(rd('cur-meta')?.label || '').match(/model (\d+\.\d+\.\d+)/)?.[1] || loadConfig().model.model_version;
    write('scorecard', { generated_at: new Date().toISOString(), model_version: audited, note: 'One row per experiment, candidate and metric (scorecard.csv). Full reports: reports/audit/*.json; method and conclusions: docs/MODEL_AUDIT.md.', experiments: [...groups.values()], pending });
  }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
