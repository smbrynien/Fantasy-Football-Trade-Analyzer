// Model page audit scorecard (js/ui/audit-scorecard.js) and the committed reports/audit/scorecard.json it reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metricDirection, pivotExperiment, headline, evidenceKind, candidateLabel, fmtMetric } from '../js/ui/audit-scorecard.js';
import { parseCSV } from '../js/core/util/csv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('metric direction: correlations up, errors/losses down, bias toward 0, calibration shares unranked', () => {
  assert.equal(metricDirection('spearman'), 'higher');
  assert.equal(metricDirection('corr(predicted margin, realised outcome)'), 'higher');
  assert.equal(metricDirection('test log-likelihood per trade'), 'higher');
  assert.equal(metricDirection('MAE (rest-of-season points)'), 'lower');
  assert.equal(metricDirection('tier loss (log ratio²)'), 'lower');
  assert.equal(metricDirection('failures'), 'lower');
  assert.equal(metricDirection('LOO bias'), 'zero');
  assert.equal(metricDirection('share won by favoured side'), null);
  assert.equal(metricDirection('share of season outcomes inside ±1'), null);
});

test('pivot and headline: best per metric, ties kept, bias closest to zero', () => {
  const exp = { name: 'X', rows: [
    { model: 'a', metric: 'spearman', value: 0.5 }, { model: 'b', metric: 'spearman', value: 0.6 }, { model: 'c', metric: 'spearman', value: 0.6 },
    { model: 'a', metric: 'LOO bias', value: -3 }, { model: 'b', metric: 'LOO bias', value: 1 }, { model: 'c', metric: 'LOO bias', value: 5 },
  ] };
  const p = pivotExperiment(exp);
  assert.deepEqual(p.models, ['a', 'b', 'c']);
  assert.deepEqual(p.best.spearman, ['b', 'c']);
  assert.deepEqual(p.best['LOO bias'], ['b']);
  assert.equal(p.cell('a', 'LOO bias'), -3);
  assert.equal(p.cell('a', 'nope'), null);
  assert.deepEqual(headline(exp), { metric: 'spearman', model: 'b', value: 0.6, tied: true });
  assert.equal(headline({ rows: [{ model: 'm', metric: 'share won by favoured side', value: 0.5 }, { model: 'n', metric: 'share won by favoured side', value: 0.7 }] }), null, 'calibration buckets are not a ranking');
  assert.equal(fmtMetric(0.12345), '0.123'); assert.equal(fmtMetric(57.247), '57.2'); assert.equal(fmtMetric(1), '1'); assert.equal(fmtMetric(null), '—');
  assert.equal(evidenceKind('REAL HISTORICAL DATA'), 'Real historical data');
  assert.equal(evidenceKind('REAL HISTORICAL outcomes (…); SIMULATED league behaviour'), 'Real outcomes, simulated leagues');
  assert.equal(evidenceKind('CURRENT DATA (x) — model 2.3.0'), 'Current data');
  assert.equal(candidateLabel({ candidates: { v22: 'model 2.2.0' } }, 'v22'), 'model 2.2.0');
  assert.equal(candidateLabel({}, 'ecr'), 'FantasyPros expert consensus');
});

test('committed scorecard.json matches scorecard.csv row for row', () => {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/audit/scorecard.json'), 'utf8'));
  const csv = parseCSV(fs.readFileSync(path.join(ROOT, 'reports/audit/scorecard.csv'), 'utf8')).records;
  const flat = json.experiments.flatMap((e) => e.rows.map((r) => [e.name, r.model, r.metric, r.value]));
  assert.equal(flat.length, csv.length);
  csv.forEach((r, i) => {
    assert.deepEqual(flat[i].slice(0, 3), [r.experiment, r.model, r.metric]);
    assert.ok(Math.abs(flat[i][3] - Number(r.value)) < 1e-9);
  });
  for (const e of json.experiments) { assert.ok(e.rows.length > 0); assert.equal(typeof e.description, 'string'); assert.ok(e.description.length > 0, `${e.name} has a description`); }
  assert.match(json.model_version, /^\d+\.\d+\.\d+$/);
});
