#!/usr/bin/env node
// Automated model audit: `npm run audit-model` → reports/audit/*.json (+ CSV)
//   --only=e1,e2,e3,e4,current,compare   run selected sections   --rebuild   rebuild the historical benchmark
//   --snapshot-before   save current-model values on the frozen dataset as the 'before' baseline (values-v1.json)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/lib/paths.js';
import { loadBenchmark } from './audit/benchmark.js';
import { preseasonRedraft, inSeasonROS, dynasty, rookieCurve, measureOppRates } from './audit/backtests.js';
import { loadSeasons } from './lib/history-data.js';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const OUT = path.join(ROOT, 'reports', 'audit');
fs.mkdirSync(OUT, { recursive: true });
const write = (name, obj) => { fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(obj, null, 2)); console.log(`  wrote reports/audit/${name}.json`); };

const t0 = Date.now();
const needBench = ['e1', 'e2', 'e3', 'e4'].some(want);
const bench = needBench ? await loadBenchmark({ rebuild: args.includes('--rebuild') }) : null;
if (want('e1')) { console.log('E1 preseason redraft…'); write('e1-preseason-redraft', { label: 'REAL HISTORICAL DATA', oppRates: measureOppRates(bench), ...preseasonRedraft(bench) }); }
if (want('e2')) { console.log('E2 in-season ROS…'); write('e2-inseason-ros', { label: 'REAL HISTORICAL DATA', ...inSeasonROS(bench) }); }
if (want('e3')) { console.log('E3 dynasty…'); const hist = await loadSeasons(2006, 2025); write('e3-dynasty', { label: 'REAL HISTORICAL DATA', ...dynasty(bench, hist) }); }
if (want('e4')) { console.log('E4 rookie curve…'); write('e4-rookie-curve', { label: 'REAL HISTORICAL DATA', ...rookieCurve(bench) }); }
if (want('current')) {
  const { currentDataAudit } = await import('./audit/current.js');
  console.log('Current-data analyses…');
  for (const [k, v] of Object.entries(await currentDataAudit())) write(k, v);
}
if (want('compare') || args.includes('--snapshot-before')) {
  const { loadConfig } = await import('../server/lib/config.js');
  const { snapshotValues, compareSnapshots, sampleTable, loadV1, V1_FILE } = await import('./audit/compare.js');
  const { loadFrozenDataset } = await import('./audit/current.js');
  const config = loadConfig();
  const { ds } = loadFrozenDataset();
  const now = snapshotValues(ds, config);
  if (args.includes('--snapshot-before')) { fs.writeFileSync(V1_FILE, JSON.stringify(now)); console.log(`  saved baseline ${path.relative(ROOT, V1_FILE)}`); }
  else {
    const before = loadV1();
    if (!before) console.log('  no baseline (run with --snapshot-before on the old model first)');
    else {
      console.log('Before/after comparison…');
      const { summary, csv } = compareSnapshots(before, now);
      write('before-after', summary);
      fs.writeFileSync(path.join(OUT, 'before-after.csv'), csv);
      console.log('  wrote reports/audit/before-after.csv');
      write('before-after-sample', { label: summary.label, rows: sampleTable(before, now) });
    }
  }
}
// Scorecard: one CSV row per (experiment, model/baseline, metric) from whatever reports exist.
{
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
  const mono = rd('cur-monotonicity'), pk = rd('cur-package-simulation');
  if (mono) rows.push(['Monotonicity', mono.label, 'current', 'failures', mono.failures]);
  if (pk) for (const [m, v] of Object.entries(pk.overall || {})) rows.push(['Package simulation', pk.label, m, 'corr(model diff, simulated lineup gain)', v]);
  if (rows.length > 1) { fs.writeFileSync(path.join(OUT, 'scorecard.csv'), rows.map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n')); console.log('  wrote reports/audit/scorecard.csv'); }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
