// `npm run audit-model` setup paths (handoff bug #2): fresh clones and data mismatches must skip with instructions,
// never crash, and the freeze → baseline → compare workflow must work. Runs the real CLI on the SYNTHETIC fixture in
// temp dirs (FFTA_DATA_DIR + --out), so data/ and the committed reports/audit are never touched. No network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeDataset } from './fixtures/make-dataset.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ffta-audit-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const audit = (dataDir, ...args) => {
  const r = spawnSync(process.execPath, ['scripts/audit-model.js', ...args], { cwd: ROOT, env: { ...process.env, FFTA_DATA_DIR: dataDir }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const writeDataset = (dataDir, version) => {
  fs.mkdirSync(path.join(dataDir, 'calculated'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'calculated', 'dataset.json'), JSON.stringify({ ...makeDataset(), data_version: version }));
};

test('audit-model on a fresh clone (no data) skips with instructions instead of crashing', () => {
  const data = tmp(), out = tmp();
  const r = audit(data, '--only=current,compare', `--out=${out}`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /SKIPPED.*no dataset/);
  assert.equal(audit(data, '--freeze').code, 1, 'freezing without a synced dataset is an error');
});

test('audit-model compare skips (exit 0) when the baseline was made on different data', () => {
  const data = tmp(), out = tmp();
  writeDataset(data, 'fixture-A');
  assert.equal(audit(data, '--freeze', '--snapshot-before', `--out=${out}`).code, 0);
  assert.ok(fs.existsSync(path.join(out, 'values-v1.json')));
  assert.equal(audit(data, '--freeze').code, 0);
  writeDataset(data, 'fixture-B');
  audit(data, '--freeze');
  const r = audit(data, '--only=compare', `--out=${out}`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /SKIPPED before\/after: the baseline .* fixture-A, but the dataset here is fixture-B/);
  assert.ok(!fs.existsSync(path.join(out, 'before-after.json')));
});

test('audit-model freeze → baseline → re-sync → compare uses the frozen data', () => {
  const data = tmp(), out = tmp();
  writeDataset(data, 'fixture-frozen');
  const snap = audit(data, '--snapshot-before', `--out=${out}`); // auto-freezes; runs no backtests
  assert.equal(snap.code, 0, snap.out);
  assert.match(snap.out, /Froze dataset fixture-frozen/);
  assert.doesNotMatch(snap.out, /E1 |Current-data/);
  writeDataset(data, 'fixture-resynced'); // live data moves on; the frozen copy must not
  const r = audit(data, '--only=compare', `--out=${out}`);
  assert.equal(r.code, 0, r.out);
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'before-after.json'), 'utf8'));
  assert.match(summary.label, /fixture-frozen/);
  for (const set of Object.values(summary.sets)) assert.equal(set.spearmanValues, 1); // same model, same data
});
