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
// Injection probe (BUG_AUDIT §6): a source-provided name containing HTML/script must render as text, never execute.
const XSS_NAME = '<img src=x onerror="window.__xss=1">Evil <b>Name</b> & "Co" \u00e9\u{1F3C8}';
const xssTwin = JSON.parse(JSON.stringify(ds.players.find((p) => p.cid === 'TWR3')));
Object.assign(xssTwin, { cid: 'XSS1', name: XSS_NAME, ids: {} });
ds.players.push(xssTwin);
const builtAt = new Date(ds.built_at || Date.now());
const UPCOMING = builtAt.getUTCMonth() + 1 >= 9 ? builtAt.getUTCFullYear() + 1 : builtAt.getUTCFullYear();
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
  for (const viewport of [{ width: 1360, height: 900 }, { width: 721, height: 900 }, { width: 390, height: 844 }]) {
    console.log(`viewport ${viewport.width}×${viewport.height}`);
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    // Corrupt persisted state (older versions, manual edits) must not break any page (BUG_AUDIT UI1).
    await page.goto(`${base}/#/help`);
    await page.evaluate(() => { localStorage.setItem('ffta.trade.redraft', '{"a":"x","b":null}'); localStorage.setItem('ffta.mode', '"nonsense"'); localStorage.setItem('ffta.profiles', '[null,5]'); localStorage.setItem('ffta.trades', '{"x":1}'); });
    await page.goto(`${base}/#/trade`); await page.reload();
    const builderUp = await page.locator('.trade-side input[type=search]').first().waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(builderUp && !/Something went wrong/.test(await page.locator('#view').innerText()), 'corrupt localStorage: trade page still works');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/#/trade`);
    await page.locator('#tabs a').first().waitFor({ timeout: 15000 });
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
    const verdict = page.locator('.verdict-head');
    const level = (await verdict.count()) ? await verdict.first().getAttribute('class') : '';
    check(/\b(even|lean|clear)\b/.test(level || ''), `trade: verdict computed (${level || 'none'})`);

    // Usability audit: a shared link replaces the trade (after confirmation), the lopsided verdict offers
    // "even it out" additions that really narrow the gap, and the side totals match the bars.
    page.once('dialog', (d) => d.accept());
    await page.goto(`${base}/#/trade?m=redraft&a=TWR30&b=TWR1`);
    await page.locator('.verdict-head').waitFor({ timeout: 8000 });
    const linked = await page.evaluate(() => ({ hash: location.hash, sides: [...document.querySelectorAll('.trade-side')].map((x) => x.innerText) }));
    check(linked.hash === '#/trade' && /Test WR 30\b/.test(linked.sides[0]) && /Test WR 1\b/.test(linked.sides[1]), 'share link: trade loaded, link consumed');
    const gapOf = async () => Number((await page.locator('.bar-row .num').allInnerTexts()).map((t) => t.replace(/,/g, '')).reduce((x, y) => x - y));
    const gap0 = Math.abs(await gapOf());
    const chip = page.locator('.chip.suggest').first();
    const hasChip = await chip.waitFor({ timeout: 3000 }).then(() => true, () => false);
    check(hasChip, 'even it out: suggestions offered for a lopsided trade');
    if (hasChip) { await chip.click(); await page.waitForTimeout(300); }
    check(hasChip && Math.abs(await gapOf()) < gap0, 'even it out: clicking a suggestion narrows the gap');
    const totals = await page.evaluate(() => ({ side: [...document.querySelectorAll('.side-total')].map((x) => x.firstChild.textContent.trim()), bars: [...document.querySelectorAll('.bar-row .num')].map((x) => x.textContent.trim()) }));
    check(JSON.stringify(totals.side) === JSON.stringify(totals.bars), `trade: side totals equal the bars (${totals.side} vs ${totals.bars})`);

    // Keyboard: a Players row opens the player with Enter.
    await page.goto(`${base}/#/players`);
    const row = page.locator(viewport.width > 720 ? 'table.data tbody tr' : '.pcard').first();
    await row.waitFor({ timeout: 5000 });
    await row.focus(); await page.keyboard.press('Enter');
    check(await page.locator('.modal').waitFor({ timeout: 3000 }).then(() => true, () => false), 'players: Enter on a focused row opens the player');
    await page.keyboard.press('Escape');

    for (const route of ['#/players', '#/compare', '#/data', '#/data/import', '#/data/quality', '#/data/snapshots', '#/settings', '#/settings/roster', '#/settings/redraft', '#/model', '#/help']) {
      await page.goto(`${base}/${route}`);
      await page.waitForTimeout(700);
      check((await page.locator('main, #app, body').first().innerText()).trim().length > 50, `${route} renders`);
      if (route === '#/model') await page.waitForTimeout(800); // backtest report loads asynchronously
      // Native Element.append(null) prints "null" (it did on the Model page): no stray null/undefined/NaN text.
      const junk = await page.evaluate(() => { const w = document.createTreeWalker(document.getElementById('view'), NodeFilter.SHOW_TEXT); const bad = []; for (let n = w.nextNode(); n; n = w.nextNode()) if (/^\s*(null|undefined|NaN)\s*$|\b(undefined|NaN)\b/.test(n.textContent)) bad.push(n.textContent.trim().slice(0, 40)); return bad; });
      check(!junk.length, `${route}: no stray null/undefined/NaN text${junk.length ? ` (${junk.slice(0, 3).join(' | ')})` : ''}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(over <= 0, `${route}: no sideways page scroll (${over}px)`);
    }
    // Layout (handoff bugs #6/#7 and the mid-width header overflow): every section tab and the Sync button are on
    // screen, and the page never scrolls sideways.
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      offTabs: [...document.querySelectorAll('#tabs a')].filter((a) => a.offsetParent).filter((a) => { const r = a.getBoundingClientRect(); return r.left < 0 || r.right > window.innerWidth; }).map((a) => a.textContent.trim()),
      syncOn: (() => { const r = document.querySelector('#sync-btn').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })(),
    }));
    check(layout.overflow <= 0 && layout.syncOn, `layout: no sideways page scroll, Sync visible (overflow ${layout.overflow}px)`);
    check(layout.offTabs.length === 0, `layout: all section tabs on screen${layout.offTabs.length ? ` (cut: ${layout.offTabs.join(', ')})` : ''}`);
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
    // Injection: the hostile name is shown literally and nothing executed.
    await page.goto(`${base}/#/player/XSS1`);
    await page.locator('.modal-body').waitFor({ timeout: 10000 });
    const modalText = await page.locator('.modal').first().innerText();
    check(modalText.includes('<img src=x') && !(await page.evaluate(() => window.__xss)), 'injection: HTML in a player name renders as text and never executes');
    // Navigating to another player replaces the modal (no stacking); closing it clears the #/player URL.
    await page.goto(`${base}/#/player/TWR2`);
    await page.waitForTimeout(400);
    check((await page.locator('.modal').count()) === 1, `modals: one player modal at a time (open: ${await page.locator('.modal').count()})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check((await page.locator('.modal').count()) === 0 && !/#\/player\//.test(page.url()), 'modals: Escape closes it and the URL leaves #/player');

    // Dynasty: the same generic pick can be added twice (two 2027 1sts); removing one keeps the other.
    await page.evaluate(() => { localStorage.setItem('ffta.mode', '"dynasty"'); localStorage.setItem('ffta.trade.dynasty', '{"a":[],"b":[]}'); });
    await page.goto(`${base}/#/trade`); await page.reload();
    const dynBox = page.locator('.trade-side').first().locator('input[type=search]');
    await dynBox.waitFor({ timeout: 15000 });
    for (let k = 0; k < 2; k++) {
      await dynBox.fill(`${UPCOMING} 1st`);
      const opt = page.locator('.search-results [role=option]').first();
      await opt.waitFor({ timeout: 5000 });
      await opt.dispatchEvent('mousedown');
      await page.waitForTimeout(300);
    }
    const rows = page.locator('.trade-side').first().locator('.asset-list > *');
    check((await rows.count()) === 2, `dynasty: the same generic pick can be added twice (rows: ${await rows.count()})`);
    await rows.first().locator('button.x').click();
    await page.waitForTimeout(300);
    check((await page.locator('.trade-side').first().locator('.asset-list > *').count()) === 1, 'dynasty: removing one duplicate pick keeps the other');
    await page.evaluate(() => { localStorage.setItem('ffta.mode', '"redraft"'); });

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
