#!/usr/bin/env node
// OPTIONAL browser smoke test (dev-only): `npm run test:e2e`.
// Starts the real server on a free port with FFTA_DATA_DIR pointing at a temp dir holding the SYNTHETIC test fixture
// (no network, your data/ is untouched), then drives Chromium through the main pages and a 1-for-1 trade, failing on
// any console error or uncaught page error. Playwright is NOT a project dependency: if it isn't installed (locally or
// globally) the test prints how to get it and exits 0, so `npm test` and the release stay dependency-free.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeDataset } from '../fixtures/make-dataset.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not installed locally */ }
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
  } catch { return null; }
}

const pw = await loadPlaywright();
if (!pw) {
  console.log('SKIP e2e smoke test: Playwright is not installed. Install it globally (npm i -g playwright && npx playwright install chromium) to run it.');
  process.exit(0);
}

// --- fixture data dir ---
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffta-e2e-'));
fs.mkdirSync(path.join(dataDir, 'calculated'), { recursive: true });
const ds = makeDataset();
ds.data_version = ds.data_version || 'e2e-fixture';
fs.writeFileSync(path.join(dataDir, 'calculated', 'dataset.json'), JSON.stringify(ds));
// Value history spanning a model change (handoff bug #3): the Trends tab must mark it and break the model line.
const day = 864e5, t0 = Date.parse(ds.built_at || '2026-10-01T12:00:00Z') - 20 * day;
fs.writeFileSync(path.join(dataDir, 'calculated', 'history.json'), JSON.stringify({
  schema_version: 1,
  entries: ['1.9.0', '1.9.0', 'e2e-model', 'e2e-model'].map((model_version, i) => ({ t: new Date(t0 + i * 5 * day).toISOString(), data_version: `e2e-${i}`, model_version, week: 4, season: 2026 })),
  series: { TWR1: { name: 'Test WR 1', pos: 'WR', r: [9000, 9100, 7000, 7050], d: [9500, 9600, 8000, 8100], mr: [8000, 8100, 8200, 8300], md: [9000, 9000, 9100, 9200], er: [1, 1, 1, 1], ed: [1, 1, 1, 1], proj: [200, 198, 196, 195] } },
}));

// --- server ---
const port = 5300 + Math.floor(Math.random() * 600);
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(port), FFTA_DATA_DIR: dataDir, FFTA_NO_AUTOSYNC: '1', FFTA_OPEN: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
const base = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`server did not start:\n${serverOut}`)), 15000);
  const onData = (b) => { serverOut += b; const m = serverOut.match(/http:\/\/[\w.]+:(\d+)/); if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } };
  server.stdout.on('data', onData); server.stderr.on('data', (b) => { serverOut += b; });
  server.on('exit', (c) => reject(new Error(`server exited (${c}):\n${serverOut}`)));
});

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? '  ok ' : '  FAIL'} ${msg}`); };
let browser;
try {
  browser = await pw.chromium.launch();
  for (const viewport of [{ width: 1360, height: 900 }, { width: 390, height: 844 }]) {
    console.log(`viewport ${viewport.width}×${viewport.height}`);
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${base}/#/trade`);
    const boxes = page.locator('.trade-side input[type=search], input[type=search]');
    await boxes.first().waitFor({ timeout: 15000 });
    // Add one player to each side via search (fixture names: "Test WR 1", "Test RB 1").
    for (const [i, q] of [[0, 'Test WR 1'], [1, 'Test RB 1']]) {
      const input = (await boxes.count()) > 1 ? boxes.nth(i) : boxes.first();
      await input.fill(q);
      const opt = page.locator('.search-results [role=option]').first();
      await opt.waitFor({ timeout: 5000 });
      await opt.dispatchEvent('mousedown');
      await page.waitForTimeout(300);
    }
    const sides = page.locator('.trade-side');
    check((await sides.count()) === 2 && /Test WR 1\b/.test(await sides.nth(0).innerText()) && /Test RB 1\b/.test(await sides.nth(1).innerText()), 'trade: one player added to each side');
    const verdict = page.locator('.verdict');
    const level = (await verdict.count()) ? await verdict.first().getAttribute('class') : '';
    check(/\b(even|lean|clear)\b/.test(level || ''), `trade: verdict computed (${level || 'none'})`);

    for (const route of ['#/players', '#/compare', '#/data', '#/settings', '#/model', '#/help']) {
      await page.goto(`${base}/${route}`);
      await page.waitForTimeout(700);
      check((await page.locator('main, #app, body').first().innerText()).trim().length > 50, `${route} renders`);
    }
    // Trends: model change marked, model line broken, change measured within the current model only.
    await page.goto(`${base}/#/player/TWR1`);
    await page.locator('.modal-body').waitFor({ timeout: 10000 });
    await page.locator('.modal-body button', { hasText: 'Trends' }).first().click();
    const firstChart = page.locator('.modal-body .chart').first();
    await firstChart.waitFor({ timeout: 10000 });
    check((await firstChart.locator('line.marker').count()) === 1, 'trends: model change marked on the value chart');
    check((await firstChart.locator('polyline').count()) === 3, 'trends: model line broken at the change (2 runs) + market line');
    const kpis = (await page.locator('.modal-body .kpis .kpi .v').allInnerTexts()).map((t) => t.trim());
    check(kpis.length === 3 && kpis.every((t) => t === '+50'), `trends: 7/30-day/season change counted within the current model (+50 each, got ${kpis.join(', ')})`);
    check(errors.length === 0, `no console/page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
if (failures.length) { console.error(`e2e smoke: ${failures.length} failure(s)`); process.exit(1); }
console.log('e2e smoke: all checks passed');
