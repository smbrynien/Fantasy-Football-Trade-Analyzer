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
