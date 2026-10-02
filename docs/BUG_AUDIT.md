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

### I1 · High · Import/data integrity — Rows the preview flagged as errors were imported anyway
* **Steps:** Manual import → rankings template with ranks `0` and `-3`. The preview listed both as errors, but Import
  committed them ("3 players imported"). **Impact:** rank 0 / −3 (or ADP ≤ 0) maps as the *best* rank in the list;
  negative market values were stored.
* **Root cause:** `validateRows` reported error-level issues but `commitImport` only skipped rows marked `_invalid`.
* **Fix:** error-level row problems mark the row `_invalid` (excluded from counts, identity report and commit).
* **Files:** `js/core/import/mapper.js`. **Test:** `tests/ingestion.test.js` "import validation: rows with error-level
  problems…". Verified end-to-end with `commitImport` on real data: only the valid row is stored.

### I2 · High · Import/numbers — Decimal commas read as thousands separators (`0,85` → 85)
* **Steps:** import a European CSV (`;`-delimited) with `12,5` or `0,85`. **Actual:** 125 and 85 — silent 10–100×
  errors in projections or values. **Root cause:** `toNumber` stripped every comma. **Fix:** commas are thousands
  separators only in 3-digit groups (`1,234`, `12,345.6`); otherwise a decimal comma. **File:** `js/core/util/csv.js`.
  **Test:** `tests/ingestion.test.js` "numbers: decimal commas…".

### I3 · Medium · Export/security — CSV exports allowed spreadsheet formula injection
* A source- or import-provided text cell such as `=HYPERLINK(…)` / `+…` / `@…` was written verbatim, so opening a
  Players/Trade/health CSV in Excel or Sheets would evaluate it. **Fix:** such text cells get a leading `'`; numbers
  (also negative numbers written as text) are untouched; quoting round-trips. **File:** `js/core/util/csv.js`
  (all six `toCSV` exports). **Test:** "CSV export neutralizes spreadsheet formulas…".

### ID1 · Critical · Identity — A unique name match overrode contradicting birth date / age / draft year
* **Steps:** player DB has one "Mike Williams" (WR, born 1994). A source/import record "Mike Williams, WR, born
  2003-05-01" (or age 22, or draft year 2025) → **matched** to the 1994 player. Any data for a new namesake (a rookie the
  authoritative sources have not created yet) silently attached to the wrong person. Same for fuzzy matches.
* **Root cause:** the single-candidate and fuzzy paths never compared the record's own identity evidence.
* **Fix:** `identityConflict()` — birth dates > 2 days apart, age > 2 years off, or a different draft year → the
  record stays **unmatched** with `identity_conflict` and the candidate listed for manual review. **File:**
  `js/core/identity.js`. **Tests:** `tests/identity.test.js` (3 new). **Verification on real data:** rebuild with old vs
  new code → identical unresolved/ambiguous lists (24/2): no false positives today; purely protective.

### ID2 · High · Identity — Team outranked birth date when disambiguating same-name players
* "Chris Jones, RB, DEN, born 2001-01-01" with two Chris Joneses (DEN born 1995, NYG born 2001) matched the **DEN** one —
  the team filter ran first and stopped. Teams change; birth dates don't. **Fix:** filter order birth date → age → draft
  year → team, then the conflict check. **Test:** "birth date outranks team…".

### P1 · Medium · Picks — Picks that cannot exist were valued
* `2027 1.13` in a 12-team league was valued like 1.12; slot 0/−1 silently became "2027 1st" (asset id ≠ shown pick);
  a 9th-round pick in a 4-round league, and the already-drafted 2026 1st (valued like a 2027 1st, 3,163) were all
  priced. Such ids reach the app via search/labels, imports and old saved trades (after a rookie draft).
* **Fix:** `validDescriptor` in `picks.js` (season upcoming..upcoming+5, round 1..league rounds, slot/range inside
  1..teams) → unavailable (named in trade notes since bug #11); `parsePickAssetId` rejects unknown suffixes;
  `parsePickLabel` rejects round/slot 0. **Test:** `tests/valuation.test.js` "picks: impossible picks are unavailable…".

### P2 · Medium · Model/picks — Future-class pick values inverted at round boundaries (model 2.1.2)
* Found by a new **property test** (value must not increase with a later slot/round). Real data, 12-team dynasty:
  2028 3.01 = 614 > 2028 2.12 = 571; 2029 3.12 < 4.01; within-round inversions in some presets (10-team: 2029
  3.04 = 176 < 3.05 = 213).
* **Root cause:** for future seasons, round-level market values scale each round's segment of the upcoming season's
  curve separately (discontinuous at boundaries), and a source missing one round changes the component blend there.
* **Fix:** per-season isotonic (PAV) pass over class positions; components rescaled to stay additive. Model 2.1.2.
* **Verification:** full value diff on the frozen dataset, 7 presets × both modes × in-season/preseason: **0 player
  values changed**; only future-class picks adjacent to inversions moved (pooled, e.g. 2028 2.12/3.01 → 593/593);
  upcoming class unchanged. **Test:** "picks: value never increases with a later slot, round or season".

### T1 · Medium · Trade builder — Two identical generic picks could not be entered
* **Steps:** dynasty → add "2027 1st" to Team A → add "2027 1st" again (owning two 2027 1sts is common). **Actual:**
  "already in this trade" and the pick disappeared from search results; removing a pick removed every copy.
* **Root cause:** duplicate prevention (and search exclusion and removal) worked on asset ids, but a generic pick id
  (`pick:2027:1`, buckets, ranges) is not unique the way a player or an exact slot is.
* **Fix:** generic picks may repeat; players and exact slots stay unique; removal is by position. Pick ids dropped from
  a stored trade are named ("2027 1st"), not shown as `pick:2027:1`. **File:** `js/ui/views/trade.js`.
* **Test:** E2E "dynasty: the same generic pick can be added twice" / "removing one duplicate pick keeps the other".
  Property check in the audit: 800 random trades × 2 modes — order-invariant, swap-antisymmetric, deterministic,
  finite, package adjustment never adds value (no defects found in the engine itself).

### U1 · Medium · Navigation — Player modals stacked; closing left a stale `#/player/…` URL
* **Steps:** open `#/player/A`, then navigate to `#/player/B` (link, back/forward). **Actual:** two modals stacked,
  Escape closed both; after closing, the URL still said `#/player/B`, so the same link no longer reopened it (no
  hashchange) and a refresh reopened a modal the user had closed. Found when the E2E test hit two `.modal-body`s.
* **Fix:** one player modal at a time; closing a hash-opened modal replaces the URL with the page underneath; Escape
  closes only the topmost dialog. **Files:** `js/ui/views/player-modal.js`, `js/ui/dom.js`.
* **Test:** E2E "modals: one player modal at a time" and "Escape closes it and the URL leaves #/player" (the old UI
  fails at the first stacked modal).

### U2 · Low · Accessibility — Dialogs lost focus on close and let Tab escape behind the backdrop
* **Fix:** focus returns to the element that opened the dialog; Tab/Shift+Tab cycle inside it. **File:** `js/ui/dom.js`.
  Verified manually with Playwright keyboard navigation; covered indirectly by the modal E2E checks.

### S1 · Info (verified, no defect) — Injection through data
* A player named `<img src=x onerror="window.__xss=1">Evil <b>Name</b> & "Co" é🏈` renders literally in the player
  modal and lists; nothing executes (`h()` builds text nodes; the unused `innerHTML` branch was removed in batch 1).
  **Test:** E2E "injection: HTML in a player name renders as text and never executes".
