// HTTP server hardening (BUG_AUDIT A1–A4): runs the real server on a random port with a temp FFTA_DATA_DIR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffta-server-'));
let proc, port;

before(async () => {
  port = 5400 + Math.floor(Math.random() * 500);
  proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FFTA_DATA_DIR: dataDir, FFTA_NO_AUTOSYNC: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 10000);
    proc.stdout.on('data', (b) => { out += b; if (/➜/.test(out)) { clearTimeout(t); resolve(); } });
    proc.stderr.on('data', (b) => { out += b; });
  });
});
after(() => { proc?.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

/** Raw HTTP/1.1 request (fetch normalizes paths and headers, which would hide these bugs). */
function raw(lines) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`${lines.join('\r\n')}\r\n\r\n`));
    let buf = '';
    s.on('data', (d) => { buf += d; });
    s.on('end', () => resolve({ status: Number((buf.match(/^HTTP\/1\.1 (\d+)/) || [])[1]) || 0, body: buf.split('\r\n\r\n').slice(1).join('\r\n\r\n') }));
    s.on('error', () => resolve({ status: 0, body: '' }));
  });
}
const get = (p, host = `127.0.0.1:${port}`) => raw([`GET ${p} HTTP/1.1`, `Host: ${host}`, 'Connection: close']);
const alive = async () => (await get('/api/health')).status === 200;

test('static files: encoded ../ cannot escape the allow-list (package.json, .env, data/)', async () => {
  for (const p of ['/js/..%2fpackage.json', '/js/..%2f.env.example', '/config/..%2fdata%2fREADME.md', '/js/..%2f..%2f..%2fetc%2fpasswd', '/js/%2e%2e%2fCLAUDE.md', '/css/..\\..\\package.json']) {
    const r = await get(p);
    assert.equal(r.status, 404, `${p} → ${r.status}`);
    assert.doesNotMatch(r.body, /fantasy-football-trade-analyzer|SECRET|FANTASYPROS_API_KEY/);
  }
  assert.equal((await get('/js/app.js')).status, 200);
  assert.equal((await get('/')).status, 200);
});

test('malformed requests are rejected without crashing the server', async () => {
  assert.equal((await get('/js/%E0%A4%A')).status, 404);
  assert.ok(await alive(), 'server survived a malformed percent-escape');
  const r = await raw(['GET /api/health HTTP/1.1', 'Host: a b', 'Connection: close']);
  assert.ok(r.status === 400 || r.status === 403, `status ${r.status}`);
  assert.ok(await alive(), 'server survived a malformed Host header');
});

test('DNS-rebinding guard: a foreign Host is refused when bound to loopback', async () => {
  assert.equal((await get('/api/health', 'evil.example:5177')).status, 403);
  assert.equal((await get('/api/health', `localhost:${port}`)).status, 200);
});

test('CSRF: cross-origin or non-JSON state-changing requests are refused; the app\'s own requests work', async () => {
  const post = (headers, body = '{"a":[],"b":[],"mode":"redraft"}') => raw(['POST /api/trades HTTP/1.1', `Host: 127.0.0.1:${port}`, ...headers, `Content-Length: ${Buffer.byteLength(body)}`, 'Connection: close', '', body]);
  assert.equal((await post(['Origin: https://evil.example', 'Content-Type: text/plain'])).status, 403);
  assert.equal((await post(['Origin: https://evil.example', 'Content-Type: application/json'])).status, 403);
  assert.equal((await post(['Origin: null', 'Content-Type: application/json'])).status, 403);
  assert.equal((await post(['Content-Type: text/plain'])).status, 415);
  const ok = await post([`Origin: http://127.0.0.1:${port}`, 'Content-Type: application/json']);
  assert.equal(ok.status, 200, ok.body);
});

test('saved trades: server-assigned id and timestamp cannot be overridden by the client', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/trades`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '../x y', saved_at: 'never', a: [], b: [] }) });
  const { id } = await res.json();
  assert.match(id, /^t_\w+$/);
  const { trades } = await (await fetch(`http://127.0.0.1:${port}/api/trades`)).json();
  const t = trades.find((x) => x.id === id);
  assert.ok(t && t.saved_at !== 'never');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/trades/${id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await (await fetch(`http://127.0.0.1:${port}/api/trades`)).json()).trades.some((x) => x.id === id));
});

test('API: non-object JSON bodies and malformed profiles are 400, never 500 (BUG_AUDIT A6)', async () => {
  const call = (m, p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body });
  for (const [m, p] of [['POST', '/api/import/preview'], ['POST', '/api/import/commit'], ['PUT', '/api/profiles'], ['POST', '/api/overrides'], ['POST', '/api/trades']]) {
    for (const body of ['null', '[]', '5', '"x"', '{bad']) assert.equal((await call(m, p, body)).status, 400, `${m} ${p} ${body}`);
  }
  assert.equal((await call('PUT', '/api/profiles', JSON.stringify({ profiles: [null, 1] }))).status, 400);
  assert.equal((await call('PUT', '/api/profiles', JSON.stringify({ profiles: [{ id: 'u1', name: 'ok' }] }))).status, 200);
});

test('My Team saved teams: PUT/GET round trip, shape validation, same-origin rule', async () => {
  const put = (body) => fetch(`http://127.0.0.1:${port}/api/teams`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/teams`)).json(), { teams: [] });
  const teams = [{ id: 'team_a', name: 'Gang', profileId: 'preset_12_1qb_ppr', ids: ['P1', 'pick:2027:1'] }];
  assert.equal((await put({ teams })).status, 200);
  assert.deepEqual((await (await fetch(`http://127.0.0.1:${port}/api/teams`)).json()).teams, teams);
  for (const bad of [{ teams: 'x' }, { teams: [{ id: 'a', name: 'n', ids: [1] }] }, { teams: [{ id: 'a', ids: [] }] }, { teams: [{ name: 'n', ids: [] }] }, { teams: [{ id: 'a', name: 'n', ids: Array(501).fill('P') }] }]) {
    assert.equal((await put(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  const body = JSON.stringify({ teams: [] });
  const cross = await raw(['PUT /api/teams HTTP/1.1', `Host: 127.0.0.1:${port}`, 'Origin: https://evil.example', 'Content-Type: application/json', `Content-Length: ${body.length}`, 'Connection: close', '', body]);
  assert.equal(cross.status, 403);
  assert.deepEqual((await (await fetch(`http://127.0.0.1:${port}/api/teams`)).json()).teams, teams, 'unchanged by rejected writes');
});

test('static: the audit scorecard is served, other audit outputs are not', async () => {
  assert.equal((await get('/reports/audit/scorecard.json')).status, 200);
  assert.equal((await get('/reports/audit/scorecard.csv')).status, 200);
  assert.equal((await get('/reports/audit/values-v1.json')).status, 404);
  assert.equal((await get('/reports/audit/e6-league-simulation.json')).status, 404);
});

test('audit 2: parallel saved-trade writes are all kept; overrides and history reject garbage; other-format datasets are rebuilt', async () => {
  const post = (body) => fetch(`http://127.0.0.1:${port}/api/trades`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const before = (await (await fetch(`http://127.0.0.1:${port}/api/trades`)).json()).trades.length;
  const ids = (await Promise.all(Array.from({ length: 25 }, (_, i) => post({ a: [`X${i}`], b: [] }).then((r) => r.json())))).map((r) => r.id);
  const after = (await (await fetch(`http://127.0.0.1:${port}/api/trades`)).json()).trades;
  assert.equal(after.length, before + 25, 'R1: every parallel save is kept');
  await Promise.all(ids.slice(0, 10).map((id) => fetch(`http://127.0.0.1:${port}/api/trades/${id}`, { method: 'DELETE' })));
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/trades`)).json()).trades.length, before + 15, 'parallel deletes all applied');
  const ov = (body) => fetch(`http://127.0.0.1:${port}/api/overrides`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const bad of [{ key: { a: 1 }, cid: 'P1' }, { key: 'k', cid: ['x'] }, { key: 'k', cid: 'P_does_not_exist' }, { key: '', ignore: true }]) assert.equal((await ov(bad)).status, 400, JSON.stringify(bad));
  for (const k of ['__proto__', 'constructor', 'toString']) assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/history?cid=${k}`)).json()).series, null, k);
  // R7: a dataset in another schema is rebuilt, never served as current.
  fs.mkdirSync(path.join(dataDir, 'calculated'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'calculated', 'dataset.json'), JSON.stringify({ schema_version: 99, players: [{ cid: 'X', name: 'Old format' }], picks: [] }));
  const ds = await (await fetch(`http://127.0.0.1:${port}/api/dataset`)).json();
  assert.equal(ds.schema_version, 1);
  assert.ok(!ds.players.some((p) => p.name === 'Old format'));
});

test('audit 2: an import with no valid rows is refused and never marks the source as imported (I7)', async () => {
  const commit = await fetch(`http://127.0.0.1:${port}/api/import/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec_id: 'ktc_values', text: 'name,position,value\n', filename: 'empty.csv' }) });
  assert.equal(commit.status, 400);
  assert.match((await commit.json()).error, /no valid rows/i);
  const st = (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()).sources.find((s) => s.id === 'ktc');
  assert.notEqual(st?.state, 'ok');
});
