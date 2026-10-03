# Bug audit and reliability review

Two adversarial audits of the whole application. **Audit 2** (2026-10-03, below) ran against `2647190` (model 2.3.0,
after My Team saved teams, trade targets, the audit scorecard and the trade finder); **Audit 1** (2026-10-02, against
`e1312c6`, model 2.1.1) follows it unchanged. Every bug listed was **reproduced** before it was fixed; theoretical
findings are kept apart (§A2.10). Compact list: [BUG_FIX_HISTORY.md](BUG_FIX_HISTORY.md).

---

# Audit 2 — 2026-10-03

## A2.1 Testing scope

Everything, with emphasis on what changed since audit 1 (saved teams and opponents, trade targets, trade finder,
counteroffers, audit scorecard, daily archive) and on audit 1's thin areas (multi-tab editing, release-style startup):
server/API (races, hostile bodies, env vars, config files, schema versions), storage, sync and rebuild (idempotency,
concurrency with imports), manual import (encodings, sizes, empty files), identity (performance and equivalence on real
data), valuation engine (hostile league/profile settings, null and extreme model overrides, dates/season states,
monotonicity, explanations), trade engine and finder (properties, odd rosters), UI state (multi-tab, league/mode
switching with a trade, back/forward/refresh, rapid clicking, sync during a trade, postseason), accessibility, exports.

## A2.2 Environment

Linux container, Node 22.22.0, Chromium (Playwright 1.56.1, global), ESLint 10 (global). Real data: full syncs on
2026-10-03 (10/10 sources, 2,206 players, NFL week 4); a frozen copy (`2026-10-03-19640cbc`) for before/after value
diffs; isolated data directories (`FFTA_DATA_DIR`) for destructive tests; the synthetic fixture. Firefox/Safari are not
available here (not tested).

## A2.3 Baseline (before any change)

| Check | Result |
|---|---|
| `npm test` | 165/165 pass |
| `npm run lint` | clean |
| `npm run test:e2e` | all checks pass (1360/721/390 px) |
| `audit-model --only=current` (live data) | monotonicity 75 checks, 2 failures (Harold Fannin, Kenyon Sadiq: young TEs whose peak lies beyond the 5-season horizon — the documented model limitation, not a bug) |
| Full value snapshot (24,920 assets: 7 presets × 2 modes × actual/forced-preseason) | saved for the before/after diff |
| Console errors in the E2E run | none |

## A2.4 Tests performed (matrix)

| Area | How | Result |
|---|---|---|
| Server: concurrency | 20–25 parallel saved-trade POSTs / DELETEs | **R1** (3 of 20 kept) fixed |
| Server: hostile input | prototype keys in queries, object/array identity overrides, unknown player ids, sync bodies of the wrong type | R2, R3 fixed; sync bodies harmless |
| Startup / env / config | PORT 99999/-1/abc/0, HOST bogus, timeout/refresh env garbage, malformed and missing `config/*.json` | R4, R5, R6 fixed |
| Backwards compatibility | dataset / normalized files with another `schema_version` | R7 fixed (rebuild / skip / refuse) |
| League settings fuzz | 18 hostile + 30 random leagues × 2 modes through valuations, trade analysis, Even it out, combinations, lineups, expected points, trade targets, trade finder, counteroffers | **E1** fixed; then 96 sets, 0 problems |
| Model overrides | all 243 numeric parameters = null; 28 editable ones = −5 / 0 / 1e9 | **E2**, **E3** fixed; then 0 crashes, 0 non-finite, 0 empty |
| Dates / season states | garbage as_of, week 99/−3, off/pre/post, year rollover | D2 fixed; postseason → UI6 |
| Picks | 11 odd ids, 8 labels; single-slot ranges = exact slots; future discounting | no defect (one model observation, §A2.10) |
| Trade properties | 1,800 random trades × 3 leagues × 2 modes: order, swap antisymmetry, finiteness, non-negative sides, adding an asset never lowers its side, share-link round trip | no defect |
| League-setting monotonicity | 1QB→SF QB values, TEP 0/0.5/1, teams 10/12/14 scarcity, standard/half/PPR | all in the expected direction |
| Explanations | components sum to value, value inside its range: 12,425 assets | 0 mismatches |
| Roster helpers | duplicate ids, unknown ids, picks in redraft, 16–200-asset rosters | no defect; speed fine to 60 assets |
| Sync / rebuild | 3 identical rebuilds; status written during a sync | SY5, **SY6** fixed |
| Manual import | numbers/objects as text, bad mappings, UTF-16, Latin-1, header-only, nested/scalar JSON, NUL bytes, 500–60,000 rows | **I6**, I7, I8 fixed |
| Identity | old vs new matcher on a full real rebuild | byte-identical players + identity report |
| Export | trade CSV/JSON, player CSVs | EX1 fixed |
| Multi-tab | two tabs creating teams and league profiles | **UI4** fixed |
| State transitions | league switch with a trade, dynasty picks → redraft, back/forward/refresh with a player open, 20 rapid mode switches, clearing/typing out-of-range settings | UI5, U3, E2/E3 (form) fixed; rest OK |
| Postseason | redraft with `season_type: post` | **UI6** fixed |
| Rapid interaction / concurrency | 5 rapid Sync clicks with a trade built | one sync, trade kept, no errors |
| Accessibility | names/labels/duplicate ids on 12 routes × 2 modes | UI7/UI9 labels fixed (other hits were collapsed sections) |
| Destructive actions | saved-trade delete, team/profile delete, clear import | UI7 fixed |

## A2.5 Bugs discovered and fixed

Format: ID · Severity · Area — description; reproduce; expected / actual; root cause; files; fix; regression test;
verification.

### R1 · High · Server/persistence — Saving trades at the same time lost saves
* **Reproduce:** 20 parallel `POST /api/trades`. **Expected** 20 saved; **actual** 3 (also parallel DELETEs, identity overrides).
* **Root cause:** read-modify-write of one JSON file without serialization; every request read the same list.
* **Files:** `server/lib/store.js`, `server/index.js`. **Fix:** `updateJSON(file, fallback, update)` serializes
  updates per file (promise chain) — used by trade save/delete, overrides, source status.
* **Test:** `server.test.js` "audit 2: parallel saved-trade writes…" (fails on the old code: 3 of 26). **Verified.**

### E1 · High · Engine/settings — FLEX eligibility that is not a list crashed every page
* **Reproduce:** a profile (stored, imported, server copy) with `flex_eligibility: { FLEX: 5 }` or `"RB"`.
  **Actual:** `positions is not iterable` / `ok.map is not a function` in every valuation. Same class as audit 1's L1.
* **Root cause:** `sanitizeLeague` cleaned teams/roster/scoring but not `flex_eligibility`.
* **Files:** `js/core/settings.js`. **Fix:** eligibility = list of real positions, else the default.
* **Test:** `robustness.test.js` E1 (7 shapes × 2 modes, lineups and expected points). **Verified:** league fuzz 0/96.

### UI4 · High · Persistence — A second tab erased teams and league profiles saved in the first
* **Reproduce:** open the app in two tabs; tab A creates a team (or "Save as…" profile), then tab B does.
  **Actual:** A's item vanished from browser storage **and** the server copy.
* **Root cause:** each tab keeps the lists in memory and wrote its stale list back.
* **Files:** `js/ui/state.js`, `js/app.js`. **Fix:** every change starts from the stored list (`freshTeams`/
  `freshProfiles`); other tabs follow via the `storage` event and re-render.
* **Test:** `teams.test.js` "another tab's saves…" (fails on the old code). **Verified** in Chromium with two tabs.

### E2 · Medium · Settings/engine — Clearing a model setting silently set it to 0 (or crashed)
* **Reproduce:** Settings → Redraft Model → clear "Bench value fraction". **Actual:** the override became `null`,
  read as 0: 77 values zeroed; clearing "horizon" moved dynasty values up to 109%; a `null` weight table crashed
  every page; the field then showed blank, looking like the default.
* **Root cause:** the number field stored `null`; `deepMerge` copied it over the default; no type check.
* **Files:** `js/core/settings.js` (`sanitizeOverrides`), `js/ui/views/settings.js` (`unsetPath`).
  **Fix:** a cleared field removes the override (back to the default, with a toast); the engine drops override leaves
  whose type does not match the default (null, text, arrays where numbers belong, prototype keys).
* **Test:** `robustness.test.js` E2. **Verified:** null fuzz over all 243 parameters → 0 crashes/non-finite/empty;
  in Chromium: set 0.5 → `{bench_value_fraction: 0.5}`, clear → `{}` and the field shows 0.35.

### E3 · Medium · Engine/settings — Extreme parameters hung, crashed or produced negative values
* **Reproduce:** a stored profile with `dynasty.horizon_years` 1e9 (out of memory after 10 min, 8 GB), 0 (hang),
  −5 (crash); negative pick discount/class strength/value scale → negative values; typing −5 or 1e9 in the form was
  stored as is (input `min`/`max` are only hints).
* **Root cause:** no engine-side bounds; the form did not enforce its own limits.
* **Files:** `js/core/settings.js` (`MODEL_BOUNDS`, `clampModel`, overrides ≥ 0), `js/ui/views/settings.js` (clamp
  with a toast). Every default lies inside the bounds.
* **Test:** `robustness.test.js` E3 (8 parameters × 3 values, < 5 s each). **Verified:** ≈300 ms per case; in Chromium
  typing 7 for a 0–1 field stores 1.

### SY6 · Medium · Sync/import — A status written during a sync was erased by the sync
* **Reproduce:** commit a manual import (or clear one) while a sync runs. **Actual:** the import's status entry vanished
  (Data page "not imported" though the data is stored).
* **Root cause:** the sync wrote back the whole status object it had read at the start.
* **Files:** `server/sync-engine.js`, `server/import-service.js`. **Fix:** the sync merges only the sources it fetched
  into the current file; all status writes go through `updateJSON`.
* **Test:** `sync.test.js` "a status written while a sync runs…" (fails on the old code). **Verified.**

### I6 · Medium · Import/identity — Large imports of unknown names froze the whole app
* **Reproduce:** preview a CSV of 5,000 unknown names: 44 s; 60,000 rows: the (single-threaded) server stopped
  answering for over 5 minutes.
* **Root cause:** fuzzy matching re-normalized all ~5,800 player names and ran the conflict check for every record
  (~9 ms per unmatched row); no size limit.
* **Files:** `js/core/identity.js`, `js/core/import/mapper.js`. **Fix:** names normalized once per index (kept current on
  `add`), pairs skipped when the length ratio is < 0.7 — an exact bound (Jaro-Winkler cannot reach the 0.94 threshold),
  conflict check only for near-matches; imports limited to 20,000 rows with a clear message.
* **Test:** `ingestion.test.js` (row cap); identity suite unchanged. **Verified:** 5,000 rows 2.8 s (16× faster); a full
  real-data rebuild with the old and the new matcher gives byte-identical players and identity reports.

### UI6 · Medium · UX/dates — Redraft was empty with no explanation after the regular season
* **Reproduce:** NFL state `season_type: post` (January) or an early offseason. **Actual:** Players "0 players", trade
  search "No matches", nothing says why.
* **Root cause:** correct model behaviour (redraft then values the next season, which has no rankings/projections yet)
  with no empty state.
* **Files:** `js/app.js` (banner). **Fix:** banner "No redraft values yet: redraft values the next season (2027) …"
  with "Switch to Dynasty"; a different message if it happens in season.
* **Verified** in Chromium on a postseason copy of the data (screenshot reviewed).

### R7 · Low · Compatibility — Data in another schema version would be read as current
* Schema versions were written and never read (audit 1 noted it). **Fix:** `/api/dataset` rebuilds a dataset of another
  schema from the normalized data (409 with a message if it cannot); normalized files of another schema are skipped
  with a warning (the source needs a re-sync); static hosting refuses with a message. `server/index.js`,
  `server/dataset-builder.js`, `js/ui/api.js`. **Test:** `server.test.js` (a schema-99 dataset is rebuilt).

### SY5 · Low · Sync — Identical rebuilds piled up duplicate snapshots
* 3 rebuilds of the same data → 3 snapshots of one data version; duplicates pushed distinct versions out of the 90
  kept. **Fix:** skip when a snapshot of that data version exists (`server/sync-engine.js`). **Test:** `sync.test.js`
  (fails on the old code).

### I7 · Low · Import — An import with no valid rows "succeeded"
* A header-only file reported success and marked the source as just imported with 0 records. **Fix:** 400 "The file has
  no valid rows to import — nothing was changed." (`server/import-service.js`). **Test:** `server.test.js`.

### I8 · Low · Import — UTF-16 and Latin-1 files were misread
* Excel "Unicode text" (UTF-16) gave "Required column(s) not mapped"; Latin-1 accents became U+FFFD so "José" could not
  match. **Fix:** `decodeImportBytes` (byte-order mark, strict UTF-8, Windows-1252) in the import page; a UTF-16 file read
  as UTF-8 elsewhere gets an explicit message. `js/core/util/csv.js`, `js/core/import/mapper.js`, `js/ui/views/data.js`.
  **Test:** `ingestion.test.js` (5 encodings).

### R2 · Low · Server — `?cid=__proto__` returned an internal object
* `/api/history?cid=__proto__` returned `Object.prototype` as a series. **Fix:** own keys only. **Test:** `server.test.js`.

### R3 · Low · Server — Identity overrides accepted garbage
* `{key: {…}, cid: [...]}` was stored as `"[object Object]": ["x"]` (ignored later, but reported OK). **Fix:** string key,
  string cid of an existing player (or `ignore: true`), else 400. **Test:** `server.test.js`.

### R4 · Low · Startup — An invalid PORT crashed with a stack trace
* `PORT=99999`/`-1` → raw `RangeError`. **Fix:** warning + default port with port search; `FFTA_AUTO_REFRESH_HOURS`
  garbage → 12 with a warning. `server/index.js`. **Verified** by launching with each value.

### R5 · Low · Sync — A negative timeout setting made every download fail
* `FFTA_FETCH_TIMEOUT_MS=-5` → "Timed out after -5 ms" for every request. **Fix:** used only if ≥ 1,000 ms
  (`server/lib/http.js`). **Verified** with a live request.

### R6 · Low · Config — Broken or missing config files gave unhelpful errors
* A typo in `config/model.json` → bare "Unexpected token"; a missing file → `null` and an unrelated crash later.
  **Fix:** both errors name the file and how to restore it (`server/lib/store.js`, `server/lib/config.js`). **Verified.**

### D2 · Low · Engine/dates — A malformed dataset date nulled every pick season
* `state.as_of: "garbage"` → pick seasons `[null, null, null]`. **Fix:** `datasetAsOf` (first valid of as_of, built_at,
  now) in `picks.js` and `context.js`. **Test:** `robustness.test.js` D2.

### EX1 · Low · Export — The trade CSV could not be traced to its settings
* Only the JSON carried model/data version and league. **Fix:** a `SETTINGS` row (mode, league, model, data, settings
  hash, export time) in the CSV (`js/ui/views/trade.js`).

### UI3 · Low · Settings — An imported profile without a name showed "undefined"
* **Fix:** text name or "Imported league (<file>)"; non-object JSON refused clearly (`js/ui/views/settings.js`).

### UI5 · Low · UI — Re-entrant rendering logged "removeChild … no longer a child"
* Removing a focused settings field during a re-render fired its change handler, which re-rendered mid-clear.
  **Fix:** render guard (blur first, defer nested renders) in `js/app.js`. **Verified:** console clean in the same flow.

### U3 · Low · Navigation — Back left the player dialog open over another page
* **Fix:** any route other than `#/player/<id>` closes it (`js/app.js`, `player-modal.js closePlayerModal`).
  **Verified:** back/forward/reload → no stray dialog.

### UI7 · Low · UI/accessibility — Deleting a saved trade
* One click, no confirmation, a "✕" with no accessible name, failures swallowed. **Fix:** confirm, `aria-label`, toast on
  failure (`js/ui/views/trade.js`).

### UI8 · Low · UI — Saving an empty trade; double-click saved twice
* **Fix:** "Add assets to the trade first"; a second click while saving is ignored (`js/ui/views/trade.js`).

### UI9 · Low · Accessibility — Snapshot picker unlabeled; load failures silent
* "Why did this value change?" select had no label and an empty list on error. **Fix:** `aria-label`, error message
  (`js/ui/views/player-modal.js`).

## A2.6 Severity summary

25 bugs found and fixed (all pre-existing; none introduced by this audit's fixes survived — two interim mistakes in my
own fixes were caught by the tests before release: an override check that accepted unknown players when no player
database exists, and the first draft of `updateJSON`).

| Severity | Count | IDs |
|---|---|---|
| High | 3 | R1, E1, UI4 |
| Medium | 5 | E2, E3, SY6, I6, UI6 |
| Low | 17 | R2–R7, D2, SY5, I7, I8, EX1, UI3, UI5, U3, UI7, UI8, UI9 |

Most important root causes: **shared mutable state without serialization** (one JSON file per list, whole-list writes
from several requests or tabs — R1, SY6, UI4), **validation only in the form** (settings that bypass it: E1–E3, audit
1's L1 again), **`null` meaning 0 in arithmetic** (E2), **missing size/time bounds** (E3, I6), and **empty states that
are correct but unexplained** (UI6, I7).

## A2.7 Regression tests added

`tests/robustness.test.js` (new, 4: E1, E2, E3, D2), `server.test.js` +2 (R1/R2/R3/R7, I7), `sync.test.js` +2 (SY5, SY6),
`ingestion.test.js` +1 (I6 cap, I8), `teams.test.js` +1 (UI4). Unit tests 165 → 175. The targeted tests were checked to
fail on the pre-fix code (R1: 3 of 26 kept; SY5, SY6, UI4 fail; robustness fails to load without `sanitizeOverrides`).

## A2.8 Value integrity

No valuation formula or default changed (`model_version` stays 2.3.0): the full before/after diff on the frozen data is
**0 of 24,920 values**; `audit-model --only=compare` identical (Spearman 1, median change 0); monotonicity unchanged
(75 checks, the same 2 horizon cases).

## A2.9 Remaining / known issues (not fixed)

| Issue | Severity | Status |
|---|---|---|
| Young TEs (Fannin, Sadiq) worth less when 2 years younger: their peak lies beyond the 5-season horizon | Low (model) | Known — documented limitation; longer horizons tested worse (MODEL_AUDIT E3) |
| A future pick's ± can be smaller than the upcoming year's (fewer value parts → less disagreement outweighs the future-year term) | Low (model) | Known — a formula choice; changing it changes σ and dynasty verdicts (needs a model audit) |
| An open player dialog is not refreshed when a background sync finishes | Low | Known (audit 1) |
| Rosters of ~200 assets make the trade finder/targets take seconds | Low | Won't fix — real rosters are ≤ 60 (finder < 250 ms) |
| A cleared scoring or weight field means 0 (not "default") | Info | Intended: 0 points / weight 0 are meaningful |
| Five rapid Sync clicks send two requests | Info | Harmless — the server starts one sync and reports the other as already running |

## A2.10 Not reproduced / theoretical

* A team or profile deleted while the server is unreachable could reappear at the next start (the start-up merge is a
  union of browser and server lists). Reasoned from the code, not reproduced; deletions with the server running are
  written to both.

## A2.11 External limitations / not tested

Firefox and Safari (not installed); real phones (desktop-only app); a live Sleeper league (the "also save the other
teams" import path is unit-tested, the fetch is unchanged); a real NFL postseason/offseason response (simulated
states); the release ZIP launchers on Windows/macOS; screen readers (structure only).

## A2.12 Final results

| Check | Result |
|---|---|
| `npm test` | 175/175 pass |
| `npm run lint` | clean |
| `npm run test:e2e` | all checks pass (1360/721/390 px) |
| Clean clone (no data) | 175/175, lint clean, first launch 10/10 sources, 18 route renders clean (§A2.13) |
| Value diff vs baseline | 0 / 24,920 |
| Fresh data | Sync All from the UI with a trade built: 10/10 ok, trade and values refreshed, no console errors |

## A2.13 Clean build and fresh data

* **Clean clone:** the tracked files (plus the new test file) copied to an empty directory with **no `data/`** folder.
  `npm test` 175/175, `npm run lint` clean. First `npm start` printed "First launch: downloading football data…" and
  "Data ready: 10 sources updated". A Playwright crawl of all 9 routes at 1360 px and 390 px (18 renders) found no
  horizontal overflow and **no console errors or failed requests**.
* **Fresh data:** Sync All from the Data page with a trade built in the main checkout: 10/10 sources ok, the trade kept
  its assets and was re-valued, the data pill showed "just now", no console errors.
* There is no build step (vanilla ES modules), so "clean build" means a clean install and first run.

---

# Audit 1 — 2026-10-02

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

### L1 · High · Settings/engine — Settings that bypassed the form crashed every page or produced nonsense
* **Steps:** a stored/imported/server profile with `teams: -5`, `roster: { RB: "two" }` or `roster: null` →
  `computeValuations` threw (every page showed "Something went wrong"); `teams: 0`/`NaN` produced values with
  `teams = null`; a `NaN` scoring value silently changed values; 100 teams went through although 4–32 is documented.
  The Sleeper league import skipped `validateLeague` entirely.
* **Root cause:** validation lived only in the settings form and the profile-file import; the engine trusted its input.
* **Fix:** `sanitizeLeague()` (engine side) clamps teams 4–32 and roster slots to integers 0–30, drops non-finite
  scoring values/bonuses, fixes invalid present dynasty settings; `buildLeague` tolerates `roster: null` and stays
  unclamped so `validateLeague` still reports problems in the UI; the Sleeper import now validates and refuses leagues
  it cannot model. **Files:** `js/core/settings.js`, `js/core/valuation/engine.js`, `js/ui/views/settings.js`.
* **Test:** `tests/valuation.test.js` "league settings: hostile profiles never crash…" (13 hostile profiles × 2 modes).
* **Verification:** all valid presets unchanged (24,892 assets, 0 diffs); fuzz of 25 extreme configurations → no
  throws, no non-finite or negative values. Extreme-but-valid inputs (e.g. 1e6 points per reception) still yield
  extreme values by design (§9 Won't fix).

### D1 · High · Dates/season transition — In the offseason the app projected the season that had just ended
* **Steps:** Sleeper's documented offseason state is `{season: "2026", league_season: "2027", week: 0,
  season_type: "off"}` (Feb–Aug). The sync stored `season: 2026`, so adapters fetched 2026 *season projections*
  (last year's) and `computePhase` (week ≤ 0 → preseason) targeted 2026 as well: for half a year, redraft values would
  have rested on the previous season's projections. The calendar fallback (Sleeper down) mapped March–August to the new
  year but January–February to an "off" state for the old year — inconsistent with Sleeper.
* **Fix:** `normalizeNflState` uses `league_season` while `season_type === 'off'`; `calendarNflState` mirrors it
  (Jan–Feb = previous season's postseason, Mar–Aug = upcoming offseason, Sep–Dec = preseason without a week).
  **File:** `server/sync-engine.js`. **Test:** `tests/sync.test.js` "season transitions…" simulates end of 2026 season →
  2027 offseason → 2027 preseason → 2027 regular season. **Limit:** verified against Sleeper's documented state shape;
  a live offseason response could not be observed (it is October 2026).

### UI1 · High · Persistence — Malformed stored UI state broke pages permanently
* **Steps:** localStorage `ffta.trade.redraft = {"a":"x","b":null}` → the Trade page showed "Something went wrong" on
  every visit; `ffta.mode = "nonsense"` → Players page crash; `ffta.profiles = [null,5]` and `ffta.trades = {…}` →
  uncaught TypeErrors. Only clearing site data recovered. (Sources: older versions, another tab, manual edits; the
  server copy of profiles is also merged in.)
* **Root cause:** `load()` returned whatever JSON was stored; callers assumed the shape.
* **Fix:** `load(key, fallback, valid)` with shape checks at every read (trade sides, saved trades, profiles incl. the
  server copy, mode, remembered profile, compare list, player filters/columns). **Files:** `js/ui/state.js`,
  `js/ui/views/{trade,players,compare}.js`.
* **Test:** E2E "corrupt localStorage: trade page still works" (fails on the old UI); a probe of 13 corrupt
  values × 5 routes → no errors.

### UI2 · Medium · Responsive — Model, Data quality and Import pages scrolled sideways on phones
* **Steps:** 375–430 px wide → `#/model` overflowed 341–396 px (also 10 px at 768), `#/data/quality` 3–58 px,
  `#/data/import` 2–4 px. Measured on all 14 routes × 7 viewport sizes (375×812 … 1920×1080) × both modes.
* **Root cause:** six tables were not inside the horizontally scrolling `.table-wrap`; the single-column grid used
  `1fr`, which cannot shrink below its content. **Fix:** wrapped them; `minmax(0, 1fr)`. **Files:**
  `js/ui/views/{model,data}.js`, `css/app.css`. **Test:** E2E "<route>: no sideways page scroll" on 10 routes at
  1360/721/390 px; the full 7-size sweep now reports no overflow anywhere.

### V1 · Info (verified, no defect) — UI state vs engine after rapid switching
* Built a trade, switched through all league profiles 3× rapidly, toggled Redraft/Dynasty 10×, used back/forward:
  displayed side totals equal the engine's totals for the selected profile in every case (5 profiles checked), the
  final mode/profile/body class agree, no console errors. The valuation cache key includes mode + data version +
  profile hash, so no stale values were observed.

### SY1 · High · Sync/data integrity — Invalid values were stored although the report said "skipped"
* **Steps:** chaos test with fake adapters; a market batch containing `NaN`, `"abc"`, `-50` and `1e300` (under the
  25 % quarantine threshold). **Actual:** all four stored and attached to the dataset; the quality issue read
  "4 invalid records were skipped". `1e300` gave that player the best rank in the source's market list (top value from
  one corrupt number); `-50` was used as a real value.
* **Root cause:** `assessBatch` counted invalid records but `storeBatch` wrote `result.records` unfiltered; "invalid"
  also accepted any number ≥ 0 (no finiteness/outlier check).
* **Fix:** one shared rule `isInvalidRecord` (finite, non-negative; market values > 20× the batch's 95th percentile are
  outliers — scale-free) used by the verdict **and** by `cleanBatch`, which removes invalid records before storage;
  the number dropped is recorded with the batch. **Files:** `js/core/quality.js`, `server/sync-engine.js`.
* **Verification:** on the real normalized data `cleanBatch` drops **nothing** (no current impact); chaos test now stores
  only valid values. **Test:** `tests/sync.test.js` "stored batches exclude invalid values…".

### SY2 · Medium · Sync/data integrity — Duplicate records within one source batch were stored twice
* Five duplicated players in a batch → two market rows from the same source on each; in rank mapping the extra rows
  pushed every player listed below them down one rank. The warning existed; nothing deduplicated. **Fix:** `cleanBatch`
  keeps the first record per player + list variant (stats/projections/picks exempt). **Test:** same as SY1.

### SY3 · Low · Sync/UX — An empty response was reported as "Source format changed"
* An empty batch tripped the schema check ("Expected fields missing: value"). **Fix:** `no_records` — "The source
  returned no records." (still quarantined; previous data kept). **Test:** same as SY1.

### A6 · Low · Server — Non-object JSON bodies produced 500 TypeErrors; profiles accepted garbage entries
* `null`/array/scalar bodies → 500 with a raw TypeError on four endpoints; `PUT /api/profiles` stored `[null, 1]`, which
  the UI then crashed on (UI1). **Fix:** bodies must be JSON objects (400); profile entries must be objects with an id.
  **Test:** `tests/server.test.js` "API: non-object JSON bodies…". API fuzz (18 bodies × 11 endpoints, incl. a 2 MB
  upload and traversal attempts in ids): no 5xx, server healthy afterwards.

### SY4 · Info (verified, no defect) — Chaos and idempotency
* Sources: success, timeout, malformed JSON, empty, duplicates, ID change between syncs, invalid values; then the same
  sync five times. Successful sources update; failed ones are marked `error` with the message; the empty one is
  quarantined with the previous batch kept; a player whose source ID changed still resolves to the same player (no
  duplicate); repeated identical syncs leave the player set, market rows and values unchanged (no duplication or
  compounding); snapshots/history grow by one entry per new data version only.

### SR1 · Low · Search — The same pick appeared twice in results
* "1.04" → "2027 1.04 | 2027 1.04 | 2028 1.04"; "2027 1st" likewise: the pick parsed from the query was added and then
  found again in the index. **Fix:** results de-duplicated by id. **File:** `js/ui/search.js`.

### SR2 · Low · Search — Queries with name suffixes found nothing
* "beckham jr", "kenneth walker iii", "walker iii." → no results: indexed names have suffixes stripped (`nameKey`) but the
  query kept them. **Fix:** suffix tokens (Jr/Sr/II/III/IV/V) are dropped from the query.

### SR3 · Low · Search — A team code swallowed name prefixes while typing
* Typing "min" (for Minshew) or "ne" filtered strictly to MIN/NE players. **Fix:** a team token matches the team *or* a
  name word starting with those letters; position tokens stay strict ("qb" = quarterbacks).
* **Test (SR1–SR3):** new `tests/search.test.js` (3 tests, all fail on the old code). Other probes passed: apostrophes
  (`ja'marr`/`jamarr`), initials (`tj`/`t.j.`), hyphens, case, empty/nonsense/HTML queries; latency 0.1–0.2 ms per
  keystroke on 1,127 assets.

### PF1 · Info (verified, no defect) — Performance and resource use
* Valuation scales ~linearly: 2,208 → 13,248 players: redraft 136 → 372 ms, dynasty 254 → 844 ms; 100 keystroke
  searches ≤ 18 ms at every size. Browser: 3 rounds × 15 cycles of 8 routes + player modal + 2 mode switches → event
  listeners stay at 2, DOM nodes at 351, heap flat at 16 MB after warm-up, no leftover modals (no leaks).

### I4 · Low · Import UX — Every overwrite logged a failed (409) request in the console
* The UI discovered the "replaces N records" conflict by sending the import and getting HTTP 409. **Fix:** it asks
  first when the preview already shows records being replaced (the server's 409 remains as a guard).
  **File:** `js/ui/views/data.js`. **Verification:** browser run of the full import flow → no console errors.
* **Import workflow verified (no defect):** malformed CSV → clear error; fixed file → preview shows the invalid row as
  skipped and "Import 2 players"; commit stores 2 matched + 1 unmatched (kept for resolution), not the invalid one;
  re-import → overwrite banner + confirmation; **declining changes nothing**; accepting replaces (3 → 2 records);
  "Remove all imported data" → source back to "not imported".

### I5 · Low · Export — Signed percentages were prefixed with ' (regression from I3, fixed before release)
* The trade CSV's difference row holds text like `+12.3%`; the I3 formula guard prefixed it. **Fix:** numeric-looking
  text (`-12.5`, `+12.3%`, `-1,234`) is not prefixed; formulas still are. **Test:** extended "CSV export neutralizes…".
* **Exports verified:** trade CSV/JSON totals agree with each other and the engine; JSON audit carries model version,
  data version, settings hash, league and mode; names with apostrophes/hyphens round-trip; players CSV has one row per
  valued player (no duplicates), model/data version and league on every row, no NaN/undefined/Infinity cells.

### O1 · Low · Degraded operation — "Could not start sync: Failed to fetch" when the local server was gone
* After the server window is closed mid-session the app keeps working from memory (verified), but Sync showed a raw
  browser error. **Fix:** "The app's local server is not responding — if you closed its window, start the app again.
  Values already loaded stay available." **File:** `js/ui/sync.js`. Verified in the browser.

### X1 · Info (verified, no defect) — Explanations, degraded modes, clean install, concurrency
* **Explanation integrity:** all 12,418 assets (7 presets × 2 modes, real data): components sum exactly to the value,
  signal weights sum to 1, value lies inside its ± range (incl. picks rescaled by P2).
* **Static/read-only hosting** (no API): trade builder, players and search work; Sync explains the read-only mode;
  only the expected `/api/health` 404.
* **Clean environment:** fresh clone (no `data/`, no `node_modules`) → 103/103 tests, lint, E2E pass; first launch shows
  "Getting your data ready…", auto-syncs 10/10 sources in ≈6 s and the trade builder appears without a reload; the
  data pill shows "just now · 10/10"; search works on the fresh data.
* **Concurrency:** 10 simultaneous `POST /api/sync` → exactly one run (others get `already_running` with the new run's
  progress); 47 HTTP requests (same as a normal run), no retry storm.

## 5. Tests performed (matrix)

| Area | How | Result |
|---|---|---|
| Startup: clean install, empty/corrupt cache, missing data | fresh clone; corrupt state/normalized files; empty data dir | C2 fixed; first-run flow OK |
| Server/API security & robustness | raw-socket probes, CSRF/DNS-rebinding, 18 bodies × 11 endpoints fuzz | A1–A6 fixed |
| Navigation: routes, refresh, back/forward, deep links | Playwright | U1 fixed; back/forward OK |
| Redraft/dynasty valuation, league cross-tests | 7 presets × 2 modes × 2 phases full-value diffs; 25 hostile/extreme leagues | L1 fixed; no stale values |
| Rookie picks (exact, bucket, range, unknown, invalid) | label/id/valuer probes; whole-grid monotonicity property | P1, P2 fixed (model 2.1.2) |
| Search | 40 queries incl. apostrophes, suffixes, initials, HTML; latency | SR1–SR3 fixed |
| Player identity | same-name, contradicting birth date/age/draft year, team changes, fuzzy, ID change between syncs; real-data rebuild old vs new | ID1 (Critical), ID2 fixed; no false positives on real data |
| Trade builder & engine invariants | 800 random trades × 2 modes (order, swap, determinism, finiteness, package); duplicates; one-sided/empty | T1 fixed; engine invariants hold |
| Sync: success/partial/timeout/HTTP error/malformed/empty/duplicates/ID change/invalid values, retries, idempotency ×5 | fake-adapter chaos runs; real sync | SY1–SY3, C1 fixed; isolation & idempotency OK |
| Concurrency | parallel rebuilds; 10 parallel syncs; rapid UI switching | B1 fixed; single sync |
| Manual import CSV/JSON | 300-file fuzz × 7 templates; malformed → fix → retry; overwrite decline/accept; remove | I1, I2, I4 fixed |
| Export | trade CSV/JSON, players CSV; escaping; formula injection | I3, I5 fixed |
| Dates & season transitions | phase table; simulated 2026 → 2027 cycle; calendar fallback | D1 fixed |
| State & persistence | 13 corrupt localStorage values × 5 routes; rapid profile/mode switching vs engine | UI1 fixed; no stale state |
| Responsive | 14 routes × 7 sizes (375×812 … 1920×1080) × 2 modes | UI2 fixed (+ earlier #6/#7/#13) |
| Accessibility | keyboard dialogs, focus | U2 fixed |
| Injection | HTML/script/Unicode player name through the UI | safe (S1) |
| Performance & leaks | 1×–6× dataset; repeated navigation/modals/mode switches | linear; no leaks (PF1) |
| Degraded/offline | static hosting; server killed mid-session | O1 fixed |

## 6. Severity summary

32 bugs fixed (31 pre-existing + 1 regression introduced and caught during the audit, I5):

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 | ID1 |
| High | 13 | A1, A2, A3, B1, C1, C2, I1, I2, ID2, L1, D1, UI1, SY1 |
| Medium | 8 | A4, I3, P1, P2, T1, U1, UI2, SY2 |
| Low | 10 | A5, A6, I4, I5, U2, SY3, SR1, SR2, SR3, O1 |

Most important root causes: **validation in one layer only** (form vs engine, verdict vs storage, preview vs commit),
**trusting decoded/parsed input** (paths, JSON bodies, stored state), **missing ordering/locking** (rebuilds, temp
files, progress publication), and **identity matching that ignored contradicting evidence**.

## 7. Regression tests added

`tests/server.test.js` (6), `tests/search.test.js` (3), and new cases in `tests/sync.test.js` (+7),
`tests/identity.test.js` (+3), `tests/ingestion.test.js` (+5, incl. a 300-file import fuzz), `tests/valuation.test.js`
(+5, incl. the pick-grid monotonicity property and 13 hostile leagues); E2E smoke (+ injection, duplicate picks,
modals, corrupt storage, per-route overflow at 3 widths). Unit tests: 78 → 103. Every targeted test was checked to fail
on the pre-fix code.

## 8. Remaining / known issues (not fixed)

| Issue | Severity | Status |
|---|---|---|
| An open player modal is not refreshed if a background sync finishes while it is open (values as of opening) | Low | Known — close/reopen; not reproduced as a user-visible problem |
| `data_version` is unchanged by `npm run rebuild` after a code-only change (same inputs) | Low | Known — the UI clears its cache on every dataset load |
| Absurd-but-valid scoring (e.g. 1,000,000 per reception via stored overrides) gives absurd values | Low | Won't fix — the form limits scoring to ±50; the engine stays finite |
| Server 500 messages can include local file paths | Low | Won't fix — local app; no secrets/headers/credentials are ever included |
| Typing a team code ranks that team's players before name-prefix matches (by value) | Low | Won't fix — both are shown |

## 9. External limitations / not tested

* **Browsers:** only Chromium (Playwright 1.56) is available here. Firefox and Safari were **not** tested; no
  cross-browser support is claimed beyond Chromium.
* **Live offseason data:** D1 is verified against Sleeper's documented offseason state shape and a simulated season
  cycle; a real offseason response cannot be observed in October.
* **Sleeper league import** with a real league ID, and the release ZIPs on Windows/macOS, were not exercised.
* **Historical backtests** (`audit-model` E1–E4) were not re-run (no model formula affecting players changed).
* Screen-reader behaviour was only checked structurally (roles, focus), not with an actual screen reader.

## 10. Final results

| Check | Result |
|---|---|
| `npm test` | 103/103 pass |
| `npm run lint` | clean |
| `npm run test:e2e` | all checks pass at 1360/721/390 px |
| Clean clone (no data, no node_modules) | tests, lint, E2E pass; first launch syncs 10/10 and renders |
| Model change | 2.1.1 → 2.1.2 (picks only); full-value diffs documented in P2 |

This audit does not make the application bug-free. High-risk areas that passed current testing: identity resolution
against real data (old vs new identical), sync isolation/idempotency, trade-engine invariants, valuation explanations.
Areas with thinner coverage: real-world source format changes (only simulated), multi-tab editing of the same profile,
the release ZIP launchers, and non-Chromium browsers.
