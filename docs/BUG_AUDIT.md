# Bug audit and reliability review

Adversarial audit of the whole application (server, sync, import, identity, valuation, trade engine, UI), run on
2026-10-02 against commit `e1312c6` (model 2.1.1). Every bug listed here was **reproduced** before it was fixed;
speculative findings are kept separate (§10). A compact list of fixes is in [BUG_FIX_HISTORY.md](BUG_FIX_HISTORY.md).

## 1. Scope

Local HTTP server and its API, static file serving, sync engine and adapters' error paths, storage (atomic writes,
corrupt files), manual import, identity resolution, valuation engine (redraft, dynasty, picks), trade engine, UI
(navigation, state, persistence, layout, accessibility), dates and season transitions, performance.

## 2. Environment

Linux container, Node 22.22.0 (the release ZIPs bundle the same version), Chromium via Playwright 1.56.1 (global),
ESLint 10.1.0 (global). Real data from a full sync on 2026-10-02 (10/10 sources, 2,208 players, NFL week 4), plus the
synthetic test fixture. Firefox and Safari are **not** available in this environment (see §11).

## 3. Baseline (before any change)

| Check | Result |
|---|---|
| `npm test` (node:test) | 78/78 pass, ≈6 s |
| `npm run lint` | clean |
| `npm run test:e2e` (Playwright smoke) | all checks pass |
| Type check / production build | none exist (vanilla ES modules, no build step) — not applicable |
| Console errors in the E2E run | none |

## 4. Bugs found and fixed

Format per bug: ID · Severity · Area — then description, reproduction, expected/actual, root cause, files, fix,
regression test, verification.

### A1 · High · Server/security — Static file path traversal served any repository file (`.env`, `data/`)
* **Steps:** `curl --path-as-is 'http://127.0.0.1:5177/js/..%2f.env'` (or `/config/..%2fdata%2fuser%2fprofiles.json`).
* **Expected:** 404. **Actual:** 200 with the file's contents (a planted `.env` secret was returned; also
  `package.json`, `data/README.md`). With `HOST=0.0.0.0` this exposed `.env` and user data to the LAN.
* **Root cause:** the static allow-list was matched against the *raw* URL (`/js/…` passes), but the file path was
  built from the *percent-decoded* URL, where `..%2f` becomes `../`. `file.startsWith(ROOT)` did not help because the
  escape stayed inside the repository root.
* **Files:** `server/index.js` (`resolveStaticPath`).
* **Fix:** decode first, resolve against ROOT, reject anything whose relative path leaves ROOT, then match the
  allow-list against the cleaned relative path.
* **Regression test:** `tests/server.test.js` "static files: encoded ../ cannot escape the allow-list".
* **Verification:** six traversal variants return 404; `/js/app.js` and `/` still 200; test fails on the old code.

### A2 · High · Server/robustness — A malformed percent-escape crashed the server
* **Steps:** `GET /js/%E0%A4%A`. **Expected:** 4xx. **Actual:** the Node process exited (unhandled rejection).
* **Root cause:** `decodeURIComponent` threw inside `serveStatic`, which the request handler called as
  `return serveStatic(…)` *without* `await` inside its `try`, so the rejection escaped the `catch`.
* **Fix:** `return await serveStatic(…)`; decoding failures resolve to 404.
* **Regression test / verification:** `tests/server.test.js` "malformed requests are rejected without crashing";
  server answers `/api/health` afterwards.

### A3 · High · Server/robustness — A malformed `Host` header crashed the server
* **Steps:** raw request with `Host: a b`. **Actual:** process exit. **Root cause:** `new URL(req.url, 'http://' + host)`
  ran *before* the handler's `try`. **Fix:** the URL is parsed inside the `try` against a fixed base; the Host header is
  validated separately (A4). **Test:** same as A2.

### A4 · Medium · Server/security — Cross-site requests could change local state (CSRF / DNS rebinding)
* **Steps:** any web page the user visits can send `fetch('http://127.0.0.1:5177/api/trades', {method:'POST',
  body:'{…}'})` with the default `text/plain` type — a "simple" request that needs no CORS preflight. Reproduced with
  `Origin: https://evil.example`: the trade was stored. The same applied to `/api/sync`, `/api/import/commit`,
  `/api/overrides` (identity overrides → silent data corruption) and `/api/rebuild`.
* **Root cause:** the server parsed any POST body as JSON regardless of `Content-Type` and never checked `Origin`/`Host`.
* **Fix:** state-changing requests must be same-origin (when the browser sends `Origin`; `Origin: null` refused) and
  POST/PUT must be `application/json` (forces a preflight the server never grants). When bound to loopback (default),
  requests with a non-loopback `Host` are refused (DNS-rebinding guard). The app's own requests already met all three.
* **Test:** `tests/server.test.js` CSRF and DNS-rebinding tests; E2E smoke (the real UI) still passes.

### A5 · Low · Server — Client could overwrite a saved trade's server-assigned `id`/`saved_at`
* **Root cause:** `{ id, saved_at, ...body }` spread the body last. A client `id` such as `../x y` made the trade
  undeletable (`DELETE /api/trades/(\w+)`). **Fix:** body first, server fields last; ids gain a random suffix (two
  saves in one millisecond collided). **Test:** `tests/server.test.js` "saved trades: server-assigned id…".

### B1 · High · Storage/concurrency — Concurrent rebuilds failed (`ENOENT` on rename) and could half-finish
* **Steps:** `Promise.all([rebuild(), rebuild(), rebuild()])` on real data (as happens when an import or identity
  override is committed while a sync is rebuilding). **Actual:** one rebuild rejected with
  `ENOENT … rename 'unresolved.json.<pid>.<ms>.tmp'`, after `dataset.json` was written but before the quality report
  and history — a half-finished build, and a 500 for the user's import.
* **Root cause:** (1) atomic-write temp names were `<file>.<pid>.<Date.now()>.tmp`, identical for two writes of the
  same file in the same millisecond, so the second rename found nothing; (2) nothing serialized rebuilds.
* **Fix:** unique temp names (counter + random, temp removed on failure); `rebuild()` runs through a promise-chain
  lock. **Files:** `server/lib/store.js`, `server/sync-engine.js`.
* **Tests:** `tests/sync.test.js` "concurrent rebuilds are serialized…", "atomic writes: concurrent writes…" (both
  fail on the old code).

### C1 · High · Sync/UI — A sync that failed early was announced as a success
* **Steps:** finish one sync, then make the next one fail before it starts fetching (e.g. a corrupt
  `data/state/sources-status.json`). **Actual:** `/api/sync/progress` still returned the *previous* run's finished
  progress, so the UI toasted "Sync finished: 1 ok". A failure after progress was set would instead leave
  `running: true` forever (the UI polls every 700 ms indefinitely).
* **Root cause:** `progress` was only replaced after the first `await`s, and a thrown error never updated it.
* **Fix:** progress for the new run is published synchronously before any work; any thrown error sets
  `phase: 'failed', error, summary: null`; the UI shows "Sync failed: … Previous data is still in use."
* **Test:** `tests/sync.test.js` "a sync that fails early reports failure…".

### C2 · High · Storage/recovery — One corrupt JSON file broke the app permanently
* **Steps:** write `{corrupt` into `data/state/sources-status.json`. **Actual:** `/api/status` → 500 on every call
  (header, Data page) and every later sync threw immediately; the same for any corrupt normalized batch (that source
  could never sync again), history, profiles or trades. Recovery required deleting files by hand.
* **Root cause:** `readJSON` turned a parse error into a thrown error for every caller.
* **Fix:** an unparseable JSON/gzip file is moved aside to `<file>.corrupt-<time>` (bytes kept, never deleted), the
  caller gets its normal fallback, and the event is listed in `/api/status` `recovered_files` and on the Data page.
  Missing-file and I/O errors behave as before. Config files (`config/*.json`) still fail loudly at startup by design.
* **Test:** `tests/sync.test.js` "corrupt state/normalized files are moved aside…".
