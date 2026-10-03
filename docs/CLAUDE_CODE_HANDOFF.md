# Claude Code Handoff — Fantasy Football Trade Analyzer

> **Read this first in any new session.** It records the *actual* state of the repository as inspected on
> **2026-10-02**. Originally written at commit `464841f` ("Model audit and valuation model 2.0.0"); last updated with
> the 2.1.0 session (all known bugs #1–#13 fixed; lint/E2E; lint in CI; bug audit; usability audit, model 2.1.2) — see §38 for the git state.
> The code is the source of truth. Verify anything here before acting on it, and **update this file** when the
> project's state changes (see §42 "Maintaining this handoff").
>
> Verification tags used below: **[verified]** = run or inspected this session · **[inferred from code]** = read in
> code, not exercised · **[documented, not independently verified]** · **[unverified]**.

---

## 1. Purpose of the project

A **locally run fantasy football trade analyzer** for **redraft and dynasty** leagues. It is for fantasy managers,
including non-technical ones, who want to judge a trade **for their own league's settings**, not one website's
generic values. It builds its own transparent valuation from many free sources and explains every number.

Supported workflows today [verified in the browser this session]:

* Evaluate a trade (players and, in dynasty, rookie picks) with totals, difference, uncertainty-relative verdict,
  component breakdown, package (consolidation) adjustment, and saved trades.
* Browse, filter and sort players; compare up to 8 assets; open a player detail ("Why this value?", dynasty
  outlook, sources, stats, trends, "Why did this value change?").
* Dynasty: rookie prospect values and rookie **pick** values (known slot, early/mid/late, unknown, custom range,
  up to 3 future years by default).
* Configure league settings (teams, roster, FLEX/Superflex, scoring incl. TE premium and bonuses), use presets, or
  import a Sleeper league.
* One-button **Sync All** from 10 automated sources with a status dashboard; **manual CSV/JSON import** as a
  fallback (e.g. KeepTradeCut, which forbids scraping).
* Double-click launchers and ready-to-run release ZIPs for non-technical users.

Long-term objective: a comprehensive, future-proof trade-analysis system that survives any single source
disappearing, stays transparent, and keeps getting more accurate through evidence (backtests), not complexity.

| Capability | Status |
|---|---|
| Redraft valuation | **Implemented** (model 2.1.2; bug #1 ADP-only values fixed) |
| Dynasty valuation | **Implemented** |
| Rookie / future pick values | **Implemented** |
| Trade analyzer (multi-asset, packages, uncertainty) | **Implemented** |
| Automated sync (10 sources) | **Implemented**, all 10 OK on 2026-10-02 [verified] |
| Manual import (7 templates) | **Implemented** [verified via API: preview, overwrite guard, commit, delete] |
| Canonical player DB / identity resolution | **Implemented** |
| Model audit tooling (`npm run audit-model`) | **Implemented**; reproducible on fresh clones since the bug #2 fix (`--freeze`, `--out`, graceful skips) |
| Usability (UX) audit | **Not performed** (no UX audit document exists) |
| Lint in repo | **Implemented** dev-only: `eslint.config.mjs` + `npm run lint` (no dependency); no type-check |
| Browser E2E in repo | **Implemented** optional: `npm run test:e2e` (Playwright if installed, else skips) |
| Custom K/DEF scoring, contracts, IDP, best ball, auction, keeper | **Not implemented** |
| Yahoo / FantasyPros API adapters | **Planned only** (reserved env vars in `.env.example`) |

## 2. Current project status

```text
Overall Status:  Working, tested. Model 2.1.2 (2.0.0 audit model + ADP corroboration rule + market list
                 format rules + monotone pick curves). ALL known bugs (§19 #1–#13) FIXED. Lint runs in CI.
Bug audit:       Adversarial reliability audit DONE (2026-10-02): 32 bugs fixed (1 Critical, 13 High, 8 Medium,
                 10 Low) — docs/BUG_AUDIT.md (matrix, root causes, remaining issues) and docs/BUG_FIX_HISTORY.md.

Redraft:         Implemented. Expected-surplus valuation, consensus-dominant weights. Since 2.1.0 ADP only
                 corroborates: ADP-only players are N/A (FA ≥100 in 12-team 1QB: 63 → 3, all with consensus).
Dynasty:         Implemented. Multi-year fundamental (aging power 2, attrition, draft priors, evidence gate)
                 blended with consensus/market.
Rookie Picks:    Implemented. Market + historical LS-exponential slot curve + current class; unknown, bucketed and
                 ranged slots; future-year discount.
Trade Analyzer:  Implemented. Additive values + package adjustment + z-score verdict + audit record.
Data Sync:       Implemented. 10 automated adapters, validation/quarantine, failover, snapshots, history.
Manual Import:   Implemented. 7 templates, column auto-mapping, identity report, overwrite confirmation.
Player Database: Implemented. 17 external ID systems, never merges ambiguous players, manual overrides.
Model Audit:     Done (docs/MODEL_AUDIT.md, docs/MODEL_COMPARISON.md). Tool works on fresh clones: `--freeze`,
                 `--out=DIR`, before/after skipped with instructions on data mismatch (bug #2 fixed).
UX Audit:        DONE (2026-10-03): docs/USABILITY_AUDIT.md (friction log F-01–F-44, findings, before/after) and
                 docs/FEATURE_AUDIT.md (opportunity matrix, Tier 1/2/3/Do-Not-Build). Tier 1 implemented: verdict-
                 first trade result, "Even it out"/value matches, share link/text, Model − Market column, grouped
                 settings, a11y fixes; plus My Team (optional roster → lineup impact, "Which side is you?",
                 roster quick-add). Next: counteroffer table, combination matches. Asset values unchanged.
Testing:         122/122 node:test tests pass (≈5 s, offline). Optional E2E `npm run test:e2e` and `npm run lint`
                 (dev-only, zero dependencies) both pass.
Documentation:   Extensive (11 docs). Minor code/doc discrepancies listed in §21 and §39.
CI/Release:      GitHub Actions: lint → tests → build → publish ZIPs on every push to main (lint step added in
                 the 2.1.0 session; a lint error now blocks the release — owner decision 2026-10-02).
```

## 3. How to start the project

**Prerequisites:** Node.js **≥ 18.17** (`package.json` engines; `.node-version` pins 22.22.0 for releases). No npm
install is needed — **zero dependencies** (there is no `node_modules`, no lockfile). No database. No API keys.

| Command | What it does | Verified |
|---|---|---|
| `npm start` | Start the local server + UI at **http://127.0.0.1:5177** (next free port if busy). Auto-syncs on first launch and when data is older than 12 h | yes |
| `npm start -- --open` | Same, and open the browser | documented |
| `npm run sync` | Sync all sources from the terminal, prints a status table | yes (10/10 OK) |
| `npm run sync:force` / `npm run sync -- --force` | Re-download everything (ignore the 30-min freshness skip) | inferred |
| `npm run sync -- --failed` | Retry only failed/partial/quarantined sources | inferred |
| `npm run sync -- --source fantasycalc,espn` | Sync specific sources | documented |
| `npm run rebuild` | Rebuild player DB/dataset/values from cached normalized data (no network) | inferred |
| `npm test` | `node --test tests/*.test.js` — 103 tests, offline | **yes, 103/103** |
| `npm run lint` | `npx --yes eslint@10 .` with `eslint.config.mjs` (uses a global ESLint 10 if present, else the npx cache; never `node_modules`). **CI runs it before the tests; a lint error blocks the release** | **yes, clean** |
| `npm run test:e2e` | `tests/e2e/smoke.mjs`: server on a random port + temp `FFTA_DATA_DIR` with the synthetic fixture; Chromium at 1360, 721 and 390 px: layout (no sideways page scroll, Sync and all tabs on screen), trade 1-for-1 with verdict, every main route, player Trends with a seeded two-model history (marker, broken line, within-model change), no console errors. Skips (exit 0) without Playwright | **yes, pass; skip path and failure path (exit 1) checked** |
| `npm run audit-model` | Full model audit → `reports/audit/` (`--only=e1,e2,e3,e4,current,compare`, `--rebuild`, `--freeze`, `--snapshot-before`, `--out=DIR`). `--freeze`/`--snapshot-before` without `--only` do only that (no backtests) | yes (fresh clone, mismatch and full before/after workflow; §17 item 10) |
| `npm run calibrate` | Re-derive `config/calibration/*.json` from nflverse 2006–2025 (downloads ~60 MB to `scripts/.cache/`) | ran earlier in project |
| `npm run backtest` | ECR vs realised production → `reports/backtest.json` (shown on the Model page) | ran earlier in project |
| `npm run package` | Build release ZIPs into `dist/` (`scripts/package-release.sh`) | CI runs it |

* **No build step** (vanilla ES modules served as-is). **Lint:** `npm run lint` (dev-only, owner-approved
  2026-10-02: no devDependencies, no lockfile). `eslint.config.mjs` imports nothing; globals are scoped per tree and
  the blocks are **disjoint** (flat config merges globals of overlapping blocks): Node for server/adapters/scripts/
  tests, browser for `js/**`, and only shared APIs for `js/core/**` — so lint also enforces that the valuation engine
  stays isomorphic. Rules: a core subset of eslint:recommended + `no-unused-vars` (`_`-prefixed args ignored). No
  type-check command exists.
* A backend **is required** for sync, import, profiles and saved trades. `index.html` opened via `file://` shows a
  help page; the server must serve the app.
* Environment variables are optional (§25). Copy `.env.example` → `.env` (git-ignored).
* Useful dev env: `PORT=5199 FFTA_NO_AUTOSYNC=1 node server/index.js` (no auto-sync on start);
  `FFTA_DATA_DIR=/some/dir` relocates all runtime data.
* Non-technical users use `Start Trade Analyzer (Windows).bat` / `(Mac).command` / `(Linux).sh` or the release ZIPs
  (README "Download & run"). The `.bat` must keep CRLF line endings (`.gitattributes`: `*.bat -text`).

## 4. Repository structure

```text
adapters/        One module per source → normalized records. No valuation logic. Registry in index.js.
  base.js          BaseAdapter + METHOD_FOR_TYPE (data type → fetch method)
  sleeper.js       sleeper, sleeper_projections, sleeper_stats (3 adapters)
  dynastyprocess.js dynastyprocess_values, dynastyprocess_ids, fantasypros_ecr (FP ECR via DP mirror)
  fantasycalc.js, nflverse.js, ffc.js, espn.js
server/          Zero-dependency Node HTTP server
  index.js         static allow-list, JSON API routes, auto-open, port fallback, auto-sync
  sync-engine.js   runSync (3 parallel workers), storeBatch (validation/quarantine), rebuild
  dataset-builder.js buildPlayerDB (authoritative sources) + buildDataset (merge, failover, schedule context)
  history.js       value history (reference league, per build)
  import-service.js manual import preview/commit/clear
  lib/             config loader, .env loader, HTTP client (timeouts/retries), paths, atomic JSON/gzip store
js/core/         Isomorphic (browser + Node): the whole valuation engine lives here
  valuation/       engine, redraft, dynasty, picks, context, replacement, mapping, blend, signals, confidence, trade, explain
  identity.js      PlayerStore (builds canonical DB) + PlayerIndex.resolve (matches every other record)
  scoring.js       league scoring (PPR/half/std, TE premium, first downs, bonuses)
  quality.js       batch validation rules (schema drift, counts, duplicates, mass value change …)
  settings.js      buildLeague, buildModel (config + calibration + per-league overrides), computePhase
  import/mapper.js manual-import column mapping; pick-labels.js; util/ (stats, csv, names, teams, positions)
  version.js       APP_VERSION, NORMALIZED_SCHEMA_VERSION, DATASET_SCHEMA_VERSION
  roster.js        My Team: bestLineup (dedicated → FLEX → SF), rosterImpact (lineup value/points before → after)
  valuation/balance.js  "Even it out" / value matches (exact, via analyzeTrade)
js/ui/           Vanilla ES-module UI: app.js (router), state.js, api.js, dom.js, search.js, charts.js, sync.js,
                 trade-helpers.js (verdict wording, side names, share links)
  views/           trade, team (My Team), players, compare, rookies, data, settings, model, help, player-modal
config/          sources.json, model.json (model_version + every parameter), league-defaults.json,
                 profiles.json (7 presets), import-specs.json (7 templates), calibration/*.json (6 files)
scripts/         sync.js (CLI), calibrate.js, backtest.js, audit-model.js + audit/{benchmark,backtests,current,compare}.js,
                 lib/history-data.js (downloads/caches historical CSVs), package-release.sh
tests/           node:test suites + fixtures/make-dataset.js (SYNTHETIC players "Test RB 1" …)
docs/            design, model, audit, sources, import, troubleshooting docs (+ img/ screenshots)
reports/         backtest.json (served to the Model page); audit/ (audit outputs, committed, ~940 KB)
data/            RUNTIME, git-ignored except data/README.md (raw, normalized, players, calculated, snapshots,
                 state, user, benchmark)
index.html, css/app.css, favicon.svg   single-page app shell
.github/workflows/release.yml           lint + test + build + publish ZIPs on push to main
Start Trade Analyzer (*.bat|.command|.sh), HOW TO START.txt, scripts/package-release.sh   non-technical launchers
CLAUDE.md        standing instructions for Claude sessions (git workflow, model versioning rules)
```

Relationships: adapters → sync-engine → `data/normalized` → dataset-builder (identity) → `data/calculated/dataset.json`
→ the **browser** runs `js/core/valuation` on it (the server never computes values for the UI; it computes them only
for history/snapshots and scripts).

## 5. Architecture overview

```text
External sources (Sleeper, FantasyCalc, DynastyProcess repo, FantasyPros-ECR mirror, nflverse, FFC, ESPN)
      ↓  adapters/*.js  (BaseAdapter.fetchX → {records, schema, minRecords})
      ↓  raw response saved gzipped: data/raw/<source>/<runStamp>/   (last 3 runs kept)
Validation  js/core/quality.js assessBatch() → ok | warning | QUARANTINE (previous good batch kept)
      ↓  data/normalized/<source>/<type>.json   (envelope with schema_version, fetched_at, records)
Canonical player DB  server/dataset-builder.js buildPlayerDB()
      ← authoritative player sources in order: dynastyprocess_ids → nflverse → sleeper (team authority: sleeper)
      ↓  data/players/players.json (+ overrides.json, identity events, unresolved report)
Merge  buildDataset(): every other record → PlayerIndex.resolve() → attached to a player;
       exclusive types use ONE source with failover (stat_week: nflverse → sleeper_stats);
       weekly projections summed to ROS for remaining games; keep players with ≥1 signal
      ↓  data/calculated/dataset.json (≈4.9 MB) + data/snapshots/*.json.gz (last 90) + history.json
Browser loads dataset.json → js/core/valuation/engine.computeValuations({dataset, league, mode, config})
      ├ context.js     league-scored inputs (projections, production rate, last season, injury, SoS, remaining games)
      ├ replacement.js league structure (starters incl. FLEX/SF, replacement, waiver, displacement)
      ├ redraft.js | dynasty.js   signal groups → blend → score (surplus points)
      ├ picks.js       (dynasty only) pick assets from market + historical curve + current class
      └ engine.js      reference-league run → scale factor → value, σ, components, ranks, league effect
Trade  js/core/valuation/trade.js analyzeTrade() → totals, package adjustment, z verdict, audit record
UI     js/ui/views/*  (hash router in js/app.js; valuation cached per mode+league+data hash in state.js)
```

* **Frontend:** vanilla JS ES modules, no framework, hand-written DOM helper `h()` (`js/ui/dom.js`), hash routes
  (`#/trade`, `#/players`, `#/compare`, `#/rookies`, `#/data[/sources|/import|/quality|/snapshots]`,
  `#/settings[/section]`, `#/model`, `#/help`).
* **Backend:** `server/index.js` — static allow-list (never serves raw caches, user data or `.env`) + JSON API:
  `/api/health`, `/api/config`, `/api/status`, `/api/sync` (POST), `/api/sync/progress`, `/api/rebuild`,
  `/api/dataset`, `/api/quality`, `/api/history`, `/api/snapshots[/<file>]`, `/api/import/preview|commit`,
  `DELETE /api/import/<source>`, `/api/profiles` (GET/PUT), `/api/trades` (GET/POST/DELETE), `/api/overrides`,
  `/api/export/health.csv`.
* **Storage:** JSON/gzip files under `data/` (atomic writes, `server/lib/store.js`). No database.
* **UI state/persistence:** league profiles and saved trades on the server (`data/user/`); UI conveniences in
  `localStorage` under `ffta.*` (guarded by try/catch).
* **Configuration:** everything model-related is in `config/model.json`; per-league overrides are stored in the
  profile's `overrides` and deep-merged by `buildModel()`.

## 6. Technology stack

| Technology | Use | Why it matters |
|---|---|---|
| JavaScript (ES modules), Node ≥18.17 | everything | The **same valuation modules** run in browser and Node (tests, history, audit). Keep `js/core/` free of Node- and DOM-only APIs. |
| Node built-ins only (`http`, `fs`, `zlib`, global `fetch`) | server, scripts | **Zero npm dependencies** is a deliberate property (no install step for non-technical users). Adding a dependency breaks the release/launcher model. |
| Vanilla DOM + `css/app.css` (custom properties, light/dark) | UI | No framework/build. |
| Hand-written SVG charts (`js/ui/charts.js`) | charts | No charting library. |
| `node:test` + `node:assert` | tests | `npm test`; synthetic fixture, fake adapters, no network. |
| ESLint 10 / Playwright (global installs; `npx`) | `npm run lint`, optional `npm run test:e2e` | **Dev-only, never dependencies** (owner decision 2026-10-02). The release ZIPs contain the config/script files but need neither tool. |
| GitHub Actions | lint (`npm run lint`, ESLint fetched by `npx`), tests, release ZIPs with bundled Node | `.github/workflows/release.yml` |

## 7. Important architectural decisions (do not undo casually)

| Decision | Reason | Current implementation | Avoid |
|---|---|---|---|
| Local backend + browser-side valuation | Sync/import need a server (CORS, files); valuation in the browser recalculates in ~0.25 s on any settings change without network | `server/index.js`; `computeValuations` runs in `js/ui/state.js` | Moving valuation server-side or adding a DB without a strong reason |
| Adapters isolate source formats | Sources change or die; nothing outside `adapters/` may know a raw format | `adapters/*`, registry `adapters/index.js`, config `config/sources.json` | Source names in code outside `adapters/` and `config/` (CLAUDE.md rule) |
| Raw + normalized caching, last-good retention | One failed or malformed source must never break the app | quarantine in `sync-engine.storeBatch`, raw kept 3 runs, snapshots 90 | Overwriting good data with an unvalidated batch |
| Canonical player IDs; ambiguous never merged | Silent wrong merges corrupt values invisibly | `js/core/identity.js` | Fuzzy auto-merging; letting non-authoritative sources create players |
| Separate redraft and dynasty models | Dynasty is not redraft × age (audit E3: multi-year structure beats year-1-only) | `redraft.js` vs `dynasty.js`, shared `context/replacement/mapping/blend` | Adding age to redraft, or deriving dynasty from redraft values |
| Rank mapping, never averaging raw scales | Sources use incompatible scales; league math sets magnitudes | `mapping.js` positional/overall rank onto model curves | Averaging raw source values |
| Market vs fundamental kept separate and visible | Market ≠ intrinsic value; users see both | groups in each asset; "Signals compared separately" in trade view | Collapsing everything into one opaque number |
| Weights from evidence, not count of sources | Most sources are near-copies (PCA: 1.2–1.7 effective signals) | `source_weights` (DynastyProcess player values = 0) | Adding correlated sources at full weight |
| Manual import as a first-class path | KTC/FantasyPros forbid scraping; any source can disappear | `server/import-service.js`, `config/import-specs.json` | Scraping sites whose terms forbid it |
| All parameters in config, versioned | Reproducibility; saved trades carry `model_version`/`data_version`/`settings_hash` | `config/model.json` (`model_version` 2.0.0) | Hard-coded constants in formulas; changing defaults without bumping `model_version` |
| Uncertainty shown, verdict by z-score | Avoid fake precision | `trade.js` z < 1 close, 1–2 modest edge, > 2 clear | Raw-difference "good/bad trade" labels |
| Zero dependencies | Double-click distribution with bundled Node | no `node_modules` | npm dependencies (dev tooling might be acceptable if it isn't needed at runtime — decide deliberately) |

## 8. Data sources

All automated sources were synced successfully on **2026-10-02** [verified: `npm run sync` → 10 succeeded, 0 failed].
None needs authentication. Registry: `config/sources.json`. Details and terms notes: `docs/DATA_SOURCES.md`.

| Source id | Purpose / data types | Status | Adapter (file) | Limitations | Fallback |
|---|---|---|---|---|---|
| `sleeper` | player DB + IDs, reported injuries, NFL state (season/week) | active, primary | `sleeper` (`adapters/sleeper.js`) | team authority for transactions | nflverse players; calendar-derived state |
| `sleeper_projections` | Rotowire weekly projections → ROS; ADP (redraft/dynasty, ppr/half/sf) | active, secondary | `sleeper_projections` | **undocumented endpoint** | ESPN projections; manual import |
| `sleeper_stats` | weekly stats | active (failover only) | `sleeper_stats` | undocumented | used only if nflverse stats unusable |
| `fantasycalc` | trade-derived market values (dynasty/redraft, 1QB/SF, PPR, teams), pick values, 30-day trend | active, primary market | `fantasycalc.js` | — | KTC import; manual market |
| `dynastyprocess_values` | DP player values (weight **0**, ρ .99 with FP ECR) and pick values (weight .8) | active | `dynastyprocess.js` | derived from FP ECR, so not independent | FantasyCalc |
| `dynastyprocess_ids` | ID crosswalk (authoritative player source #1) | active | `dynastyprocess.js` | weekly updates | nflverse/sleeper IDs |
| `fantasypros_ecr` | FantasyPros ECR (redraft, ROS, dynasty, rookie) via the DynastyProcess GitHub mirror | active, primary consensus | `dynastyprocess.js` | weekly mirror; no TE-premium list | `fantasypros_manual` import |
| `nflverse` | players/bio/draft, weekly stats (incl. snaps, target share), official injury report, schedule | active, primary | `nflverse.js` | current-season files 404 in the offseason (expected) | sleeper_stats |
| `ffc_adp` | Fantasy Football Calculator redraft ADP | active, supplemental | `ffc.js` | small list (≈400) | Sleeper/ESPN ADP |
| `espn` | independent projections, ADP, injury status | active, supplemental | `espn.js` | **undocumented endpoint**; ADP ≥169 is ESPN's undrafted default and is collapsed to 170 (`undrafted: true`) so those players tie | Sleeper projections |
| `ktc` | KeepTradeCut values/picks | **manual only** | `manual` | Terms §2.1 forbid automated collection — never fetched | FantasyCalc |
| `fantasypros_manual`, `manual_projections`, `manual_market`, `manual_rankings`, `manual_adp`, `manual_picks` | user imports | manual, "not imported" | `manual` | — | — |

Exclusive data types (one source at a time, with failover reported): `stat_week` [nflverse, sleeper_stats],
`schedule` [nflverse], `injury_official` [nflverse], `injury_reported` [sleeper, espn], `state` [sleeper].
Freshness targets (h): player 24, injury 8, market 24, picks 48, ranking 168, projection 72, adp 168, stats 96,
schedule 336; "stale" = age > 2× target.
Planned (not implemented): Yahoo, FantasyPros API (`.env.example` placeholders only).

## 9. Data pipeline

1. **Retrieval** — `runSync()` resolves the NFL state (Sleeper → cached `data/state/nfl-state.json` → calendar),
   then runs enabled non-manual adapters in **3 parallel workers**. A source fetched successfully < 30 min ago is
   skipped unless `--force`, `--source` or `--failed` is used. HTTP: `server/lib/http.js` (timeout
   `FFTA_FETCH_TIMEOUT_MS`, default 45 s, polite User-Agent).
2. **Raw storage** — gzipped responses in `data/raw/<source>/<runStamp>/` (last 3 runs).
3. **Normalization** — adapters return normalized records per type (field mapping lives only in the adapter).
4. **Validation** — `assessBatch()` (`js/core/quality.js`). Errors (→ quarantine): `schema_changed`,
   `too_few_records`, `invalid_records` (>25%), `mass_value_change` (>45%). Warnings: duplicates, duplicated ranks,
   extreme value change, impossible age, invalid team, record-count drop, missing optional fields.
5. **Store** — `data/normalized/<source>/<type>.json` (envelope with `schema_version` 1). Quarantined batches are
   not stored; the previous good batch stays (`kept_previous`).
6. **Player matching** — `buildPlayerDB()` upserts authoritative records; `buildDataset()` resolves every other
   record with `PlayerIndex.resolve()`. Unresolved (18) / ambiguous (4) at the last sync are reported, never merged.
7. **Feature generation** — dataset builder attaches rankings, market, ADP, projections (weekly projections for
   unplayed weeks summed to ROS), weekly stats, last season, injuries, bye weeks, team schedule context
   (`remaining_games`, `remaining_opponents`). Players without any signal are dropped.
8. **Outputs** — `data/calculated/dataset.json`, snapshot `data/snapshots/<data_version>.json.gz` (90 kept),
   `history.json` (reference-league values per build), `data/state/{sources-status,last-sync,sync-log,quality-report,nfl-state}.json`.
9. **UI** — the browser fetches `/api/dataset` (or the static file) and computes values locally.

| Situation | Behaviour |
|---|---|
| Source succeeds | status ok; new data used at rebuild |
| Source fails (network/HTTP) | status error with message; previous normalized data still used; other sources unaffected |
| Incomplete data (some types fail) | status `partial`; good types stored |
| Schema change / too few records / mass change | batch **quarantined**; previous good data kept; Data → Data quality shows expected vs received |
| Stale (age > 2× freshness) | flagged ⚠ in the UI; stale sources lower confidence (×0.85) |
| Exclusive type unusable | next source in `exclusive_data_types` used; substitution recorded in `dataset.meta.substitutions` |
| Cannot be accessed automatically (KTC, FP direct) | manual import template; never scraped |
| Rebuild error | sync summary records `build_error`; the old dataset stays |

## 10. Player ID / entity resolution

* **Canonical id** (`cid`): `P` + hash of the first available external ID in `ID_TYPES` priority (gsis, sleeper,
  espn, fantasypros, pfr, mfl, sportradar, yahoo, nfl, ktc, fantasycalc, cbs, fleaflicker, rotowire, pff,
  fantasy_data, ffc); team defenses are `DEF_<TEAM>`. (`js/core/identity.js` `canonicalIdFor`)
* **Who may create players:** only `authoritative_player_sources.order` = dynastyprocess_ids → nflverse → sleeper.
  Team conflicts are resolved by `team_authority` = sleeper; changes emit `team_change` events.
* **Resolution order** (`PlayerIndex.resolve`): manual override (`data/players/overrides.json`, created on the first manual resolution; `IGNORE` allowed)
  → external IDs (conflicting IDs → `conflict`) → exact normalized name (+position) → disambiguation by team /
  birth date / age / draft year → conservative Jaro-Winkler fuzzy match (flagged `fuzzy_match_review`).
  Duplicate names that can't be disambiguated → `ambiguous` with candidates (resolved in Data → Data quality UI).
* **Rookies:** created by authoritative sources once they appear (Sleeper/DP crosswalk), with draft info.
* **Retired players:** **not removed** from the player DB or dataset. A retired player who still appears in any
  source list keeps that signal (e.g. 41-year-old Adrian Peterson has FantasyCalc dynasty values of ~22). Since
  model 2.0.0, dynasty no longer gives them fundamental value from draft capital alone; since 2.1.0 redraft no
  longer values them from ADP alone (§19 #1, fixed). `status` (Active/Inactive/IR) is carried but not used for eligibility.
* **Data shape note [verified at handoff time]:** 1,359 of 2,211 dataset players have team `FA`; 1,151 of them have
  **only** ADP records (median ADP 372) from the long ADP lists of two sources. On the 2026-10-02 re-sync (2,208
  players), 782 of ESPN's 1,050 redraft ADP entries sit at its ≈168–170 "undrafted" placeholder, and Sleeper's PPR list
  runs to ADP ≈500 with 605 free agents. These players stay in the dataset but get no redraft value since 2.1.0.
* **Weaknesses:** name-only sources (FFC, manual imports) depend on name/team matching; fuzzy matches need
  review; no automatic retirement detection.

## 11. Current redraft model (model 2.1.1) — `js/core/valuation/redraft.js`

Inputs per player (`context.js derivePlayerInputs`), all re-scored with **your** scoring:

* **Projection** points: ROS projections in season (weekly projections for unplayed weeks summed by the dataset
  builder) or season projections pre/offseason; weighted mean across sources (`source_weights.projection`:
  sleeper_projections 1.0, espn 0.8, manual 1.0). In season, IR/PUP/NFI/Suspended players **absent** from
  projections get a projection of **0** (not "missing").
* **Production** ROS points:
  `blend = 0.75·ppg + 0.25·xppg` (xppg = targets/carries/attempts × league-average points per opportunity);
  `rate = (gp·blend + 2·prior)/(gp + 2)`, prior = last-season PPG if ≥4 games, else positional **median** PPG, and
  then **≥3 games are required** (`min_games_without_history`);
  `prodROS = rate × max(0, remGames − gamesLost) × availability_pos × SoS` (availability QB .80, RB .77, WR .83,
  TE .82; SoS = 1 + 0.5·reliability·(opponent FPA ratio − 1), reliability = weeks observed/8);
  `gamesLost`: Out 1, Doubtful .8, Questionable .25, IR/PUP/NFI 5, Suspended 3 (or all remaining games if
  zero-projected). Free agents (`team === 'FA'`) get no production signal.
* **League structure** (`replacement.js`) from `basePoints = weightedMean(projection w1, prodROS w α)`:
  starters = teams × slots, FLEX/SF filled greedily by points; `r` = mean of last starter and first non-starter;
  `w` = first unrostered (bench split pro rata to starters); displacement = rank `s − teams/2`.
* **Surplus (expected, v2):** σ_pos = `sd_per_game[phase][pos] × gamesLeft` (gamesLeft = median team remaining
  games, or 17 preseason; in-season SD/game QB 5.5, RB 4.4, WR 4.3, TE 3.8, K/DEF 3.0; preseason 4.9/4.2/3.8/3.1/3/3)
  `S(pts) = ES(pts,σ;r) + 0.35·max(0, ES(pts,σ;w) − ES(pts,σ;r))`, `ES(μ,σ;r) = (μ−r)Φ(z)+σφ(z)`, z=(μ−r)/σ;
  `S(0) = 0`.
* **Curves:** per position, sorted S of the pool. **Consensus** (FP ROS/redraft ECR, manual rankings) and
  **market** (FantasyCalc redraft, best-matching format) map by **positional rank** onto the curve; **ADP** maps by
  **overall rank** (`adpFormatsFor`: redraft_ppr/half/std or redraft_sf). Lists need ≥20 matched players.
* **Blend:** `score = Σ w_g·v_g / Σ_{available} w_g`; weights interpolate preseason → in-season with
  α = clamp((week−1)/(8−1), 0, 1):

  | group | preseason | in-season |
  |---|---|---|
  | consensus | .40 | .45 |
  | projection | .30 | .30 |
  | market | .15 | .15 |
  | adp | .15 | 0 |
  | production | 0 | .10 |

  Pre/offseason forces production 0. Trend weight 0 (30-day trend displayed only).
* **ADP corroboration (2.1.0):** `redraft.adp_requires_corroboration` (default true). If ADP is a player's only
  usable group (no projection, production, consensus or market with weight > 0), the player gets **no asset** (N/A in
  the UI, "unavailable" in trades) instead of renormalizing ADP to 100%. With any other group, ADP blends at its normal
  weight. `false` restores 2.0.0 behaviour (test "ADP corroboration rule is configurable").
* **Value:** `value = score × factor` (engine.js `scaleFactor`: `7000 / mean(top-12 reference scores)`;
  reference = 12-team 1QB PPR, roster QB1 RB2 WR2 TE1 FLEX1 BENCH6, no K/DEF). Components (`contributions`) sum to
  the value; production is split into production and injury.
* **Recency:** no extra weight on recent games (audit E2 fitted recency weight = 0).
* **Positions K/DEF:** valued from source fantasy points; custom K/DEF scoring not modelled.

## 12. Current dynasty model — `js/core/valuation/dynasty.js`

* **μ1 (league points/game):** weighted mean of evidence: projection rate (w 1.0, if ≥2 projected games),
  current production blend (w min(1, gp/8)), last-season PPG (w 0.8·min(1, gp/8), ≥4 games), draft-capital prior
  for this career year (w 20/(20 + career games); PPR priors × league/PPR scoring ratio).
  **Evidence gate:** after career year 1, prior-only evidence → no fundamental (prevents retired players being
  valued from draft slot).
* **Years t = 1..5:** `μ_t = (1−π)·μ1·(A(age_t)/A(age_0))^2 + π·prior_t` (π = prior share; `aging_power` 2);
  `σ_t = μ_t·√(cv1² + (t−1)g²)` (+0.2 rookie cv); survival `S_t = Π(1 − hazard(age))`; season points
  X ~ N(μ_t·17·avail, σ_t·17·avail); `F = Σ δ^{t−1}·S_t·[ES(X; r) + 0.35·band]`,
  δ = contending .70 / balanced .82 / rebuilding .92 (profile `dynasty.strategy`).
  Aging curves, attrition, availability, CV, draft priors: `config/calibration/*.json` (nflverse 2006–2025).
* **Replacement** from Y1 points (μ1·17·avail) with the league structure.
* **Signals and weights:** fundamental .25, market .35 (FantasyCalc dynasty, KTC import; DP 0), consensus .40
  (FP dynasty positional ECR), ADP 0 (Sleeper dynasty ADP). Market/consensus map by positional rank onto the
  **fundamental** curve. Injury: IR/PUP/NFI −35% of year-1 contribution, Suspended −15%. Trend weight 0.
* **Components:** market, consensus, projection / production / prospect (year-1 fundamental split by evidence
  share), longevity (years 2+), injury. Details: breakout probability, decline probability, career horizon,
  per-year table.

## 13. Current rookie / draft-pick model — `js/core/valuation/picks.js`

* Seasons: upcoming class (switches to next year from **September**, `upcoming_class_switch_month` 9) + 2 more
  (`years_ahead` 3, per league `dynasty.pick_years`, max 6). Rounds: league `dynasty.rookie_rounds` (default 4,
  max 6). [verified: 2027 is "upcoming" on 2026-10-02]
* Class position `p = (round−1)·teams + slot`.
  `V(p) = .45·M(p) + .30·H(p) + .25·C(p)` (renormalized over available parts):
  * **M** market: FantasyCalc (1.0), DynastyProcess (0.8), KTC/manual pick values, each mapped to our scale through
    the same source's player values (`fitValueFunction`); slot/bucket anchors interpolated; future seasons with only
    round values reuse the upcoming season's slot shape.
  * **H** historical: `anchor × shape(p) × 0.88^Δ × prior_class_adjustment(0.8 if the class used is already
    drafted)`, shape = least-squares exponential (b ≈ 0.118) from `config/calibration/rookie-slot-curve.json`
    (72 positions; `H` = null beyond p = 72).
  * **C** current class: isotonic model values of the latest rookie class by rookie ECR (≥12 players), same
    discounts.
* Descriptors: exact slot, early/mid/late bucket (thirds), custom range (`r3-5`), unknown (mean over all slots).
  Asset ids: `pick:<season>:<round>[:<slot>|:<bucket>|:r<a>-<b>]`.
* **Uncertainty:** σ = √(slot spread² + part disagreement² + (0.1·Δyears·V)² + (0.05·V)²); confidence label
  Moderate only for exact upcoming slots with market + another part, else Low; outcome risk (hit-rate CV .55)
  reported separately.
* Not implemented: per-class strength estimates (manual `class_strength` = 1.0), pick values for >72 class
  positions from the historical curve.

## 14. Current trade engine — `js/core/valuation/trade.js`

* Inputs: asset ids **received** by Team A and Team B; works for any mix of players and picks, 1-for-1 through
  many-for-many, player-for-pick and pick-for-pick (picks only in dynasty mode).
* **Additive:** side totals are sums of asset values; σ_side = √Σσ²; components and group values are summed.
* **Package adjustment (not additive):** for the side receiving more **players** (picks exempt), the lowest-valued
  extras are charged `strength × min(value, displacement value) + roster_slot_cost × value of the last rostered
  player`, capped so each keeps ≥ min_retained (redraft strength 1.0 / keep .25; dynasty 0.6 / .35).
  Displacement value = value at rank `starters − teams/2` at that position.
* `diff = adjA − adjB`, `pct = diff / max(adjA, adjB)`, `z = |diff| / √(σA² + σB²)`; verdict: z<1 "close",
  1–2 "modest edge", >2 "clear". Never "good/bad trade".
* Notes: value-weighted age (dynasty), now-vs-future split (dynasty: picks are future; market/consensus split in
  the fundamental's proportion), consolidation, low-confidence assets, missing assets.
* Audit record: model_version, data_version, dataset build time, settings_hash, league, phase, source timestamps.
* **Incomplete trades** (one side empty) get **no package adjustment** (usability audit F-12: a lone player used to be
  shown at a fraction of his value while the trade was being built). Complete trades are unchanged (2,393 random
  trades identical before/after).
* Notes: a pick-for-player trade names the side receiving extra players ("draft picks don't count as players")
  instead of calling the pick side a consolidator (F-11).
* **`js/core/valuation/balance.js` `balanceSuggestions(result, idsA, idsB, {limit, pool, exclude})`** — "Even it
  out" / "Value matches": scores the `pool` (80) assets nearest the gap with `analyzeTrade` itself (so package
  adjustments are exact), generic picks only, free agents excluded; with one side empty it returns matches for the
  empty side. Read-only (no value changes). UI wording: "value math, not a prediction of what anyone will accept".
* UI wording helpers (`js/ui/trade-helpers.js`): `verdictHeadline` ("Close — roughly fair" / "Leans Team X" /
  "Team X clearly ahead" — same z thresholds), `marketCheck` (market-only diff vs the model), `leadText`
  ("B +6,160"), `tradeHash`/`tradeFromHash` (share links `#/trade?m=<mode>&a=<ids>&b=<ids>`, ids URL-encoded,
  ≤25 per side, ≤80 chars each; `js/app.js` switches mode first).
* **Roster context (My Team, `js/core/roster.js`)** is a layer on top, not a different valuation: asset values stay
  generic for the league format; `rosterImpact(result, rosterIds, giveIds, getIds, {points})` reports the best
  lineup (highest-valued eligible player per slot: dedicated → FLEX → SUPERFLEX) before/after, lineup value,
  projected points/game of the starters (`pointsPerGame` = redraft `details.projection.rate`), starters in/out,
  depth, assets given that aren't on the roster, and players beyond starting + bench spots. Rosters are stored per
  league profile in browser storage (`ffta.myteam.<profileId>` = `{ids, source, …}`; copied when a preset is
  copied on first edit) — not on the server. `trade.me` ('a'|'b') stores "which side is you" with the trade (auto-
  detected from the roster: my assets are what the other side receives).

## 15. League settings

`config/league-defaults.json` (`default_league`, `base_scoring`, `scoring_presets`), `config/profiles.json`
(7 presets: `preset_10_1qb_half`, `preset_12_1qb_ppr`, `preset_12_sf_ppr`, `preset_12_sf_half`, `preset_14_sf_ppr`,
`preset_dyn_12_1qb`, `preset_dyn_12_sf`), user profiles in `data/user/profiles.json` + browser.

| Setting | Values | Propagation |
|---|---|---|
| teams | 4–32 (validated in the form, profile and Sleeper imports; clamped by `sanitizeLeague` in the engine) | replacement levels, pick class positions, market variant preference |
| roster QB/RB/WR/TE/FLEX/SUPERFLEX/K/DEF/BENCH/IR | 0–30 | `computeLeagueStructure`: starters, greedy FLEX then SF, waiver level from bench |
| flex_eligibility | default FLEX RB/WR/TE, SF QB/RB/WR/TE | same |
| qb_format | derived: SUPERFLEX>0 → `sf`; QB≥2 → `2qb`; else `1qb` | market/ranking/ADP list selection (2qb uses SF lists) |
| scoring_preset | standard / half_ppr / ppr | `rec` 0 / .5 / 1 over `base_scoring` |
| scoring keys | pass_yd .04, pass_td 4, pass_int −2, rush/rec yd .1, td 6, 2pt 2, fum_lost −2, first downs (pass/rush/rec_fd, estimated from yards when missing), cmp/inc/sack/rush_att, `bonus_rec_te/rb/wr`, `bonus_fd_te`, yardage `bonuses[]` (expected value for aggregates) | `scoreStats` for projections, production, last season, priors' scoring ratio |
| dynasty.strategy / rookie_rounds / pick_years | contending/balanced/rebuilding; 1–6; 1–6 | discount δ; pick assets |
| overrides | any `config/model.json` path | `buildModel` deep merge (Settings → Advanced etc.) |
| Sleeper league import | league ID → scoring + roster | Settings |

TE premium raises TE production/projection points and the replacement TE alike (effect is in surplus).
Market list choice (`signals.js marketMismatch`, since 2.1.1): wrong QB format → list excluded (reported in
`meta.excluded_market_lists` and on the player's Market & sources tab); then closest PPR (×10), team count (×0.5) and
TE premium (`|tep − bonus_rec_te|` ×5).

## 16. Current UI / UX

Verified by Playwright screenshots this session (desktop 1360 px and mobile 390 px); E2E run: no console errors.

| Page (route) | Purpose | Main interactions | Data | Known UX issues |
|---|---|---|---|---|
| Header | mode toggle REDRAFT/DYNASTY, league profile dropdown, data pill (age, n/10 sources), Sync All | sync progress overlay | `/api/status` | — (tabs wrap onto a second row on narrow screens; compact header 721–1120 px; bugs #6/#13 fixed) |
| Trade (`#/trade`, home) | build and analyze a trade | context line (mode, league, what values mean); search ("jef", "det rb", "2027 1st", "1.04"), pick adder; **verdict headline first**, bars, market check, notes, **Even it out / Value matches** chips; package details and "Full breakdown" (KPIs, components, signals, reproducibility) collapsed; Swap / Save / Share ▾ (copy text, copy link, CSV+JSON, print) / Clear; phones: pinned verdict bar; saved trades (Then/Now "B +6,160", "Why changed?" dialog) | valuations + `/api/trades` | No roster context (Tier 2); sides are Team A/B, not You/Them |
| Players (`#/players`) | searchable table | filters (pos, team, age, value, injured, rookies), sort (keyboard: Enter/Space, `aria-sort`), custom columns incl. **Model − Market** (default on), CSV exports; rows open with Enter | valuations | — (phones get cards) |
| Player modal | "Why this value?", dynasty outlook, market & sources, stats, trends, "Why did this value change?" | tabs | valuations, `/api/history`, snapshots | — (Trends marks model changes since the bug #3 fix) |
| My Team (`#/team`) | optional roster per league | search-add, paste a list (matched with the trade search), Sleeper team import (public API: `league/<id>/users` + `/rosters`, mapped via `ids.sleeper`; picks not imported), best lineup / bench / picks / depth / pts per game, "Trade" (asks before mixing into an unrelated trade), remove, clear | valuations, browser storage | roster not synced to the server; no Sleeper picks |
| Compare (`#/compare`) | up to 8 assets, age-curve overlay | add/remove; empty state offers the current trade's assets | valuations | — |
| Rookies & Picks (`#/rookies`, dynasty only) | prospect values, pick grid, methodology | tabs | valuations, picks | — (prospect table fits 1360 px; scrolls inside its box with a pinned Player column below that; bug #7 fixed) |
| Data (`#/data`, `/sources`, `/import`, `/quality`, `/snapshots`) | sync dashboard, source health (details, retry), manual import wizard, identity resolution, snapshots | Retry, Force refresh, import steps, resolve ambiguous | `/api/status`, `/api/quality`, `/api/import/*` | — |
| Settings (`#/settings/...`) | sections grouped **Your league** (League, Scoring, Roster) / **Model — advanced** (Redraft, Dynasty, Pick model, Source weights, Package) / **App** (Data refresh, Advanced/Debug); advanced banner, "•" on sections with overrides, "Reset all model settings"; profile import/export, Sleeper league import | number fields write `overrides`; teams is a 4–32 number field | profiles | Recommended: hide the advanced group behind a toggle; merge Data Refresh into Data |
| Model (`#/model`) | methodology, replacement levels, calibration charts, backtest | — | `reports/backtest.json`, calibration | Does **not** show the 2.0 audit results (`reports/audit/` isn't served by the static allow-list). Stray "null" under two backtest headings fixed (usability audit F-14) |
| Help (`#/help`) | plain-language FAQ (verdict words, Even it out, sharing) | "Show the welcome tips again" | — | — |

Header: league dropdown grouped "<Mode> presets" (current mode first); mode toggle uses `aria-pressed`; on phones
the header is not sticky and the data pill shows the data age ("6 h"). Usability audit: `docs/USABILITY_AUDIT.md`,
`docs/FEATURE_AUDIT.md`.

## 17. What has already been completed (verified in git history and code)

1. `cb8e7ff` — Full application: adapters for 10 automated sources, sync engine with validation/quarantine and
   failover, canonical player DB, dataset builder, snapshots/history, valuation engine (redraft, dynasty, picks,
   trade, confidence, explanations), full UI, manual import, calibration and backtest scripts, tests, docs.
2. `f80fcc6` — `CLAUDE.md` with the owner's standing git workflow (always push to `main`).
3. `7ac5d50` — Non-technical distribution: double-click launchers, bundled-Node release ZIPs via GitHub Actions,
   auto-open, auto-sync on first launch / refresh after 12 h, port fallback, first-run screen, welcome card, Help tab,
   `HOW TO START.txt`. Release download links were verified working (HTTP 200) after the repo went public.
4. `464841f` — **Model audit and model 2.0.0**: walk-forward backtests E1–E4 on real 2018–2025 data, current-data
   analyses, package simulation, before/after comparison, `npm run audit-model`, `docs/MODEL_AUDIT.md`,
   `docs/MODEL_COMPARISON.md`, 13 new sanity/monotonicity tests; fixes for prior-only veterans, one-game backups,
   non-monotone scale, deterministic-surplus bias; re-weighting (§11–13). CI release run succeeded.
5. `ac054d8`, `a0548bd` — this handoff and the CLAUDE.md rule to keep it current.
6. **Model 2.1.0 — bug #1 fixed** (ADP corroboration rule, §11). Validation on the frozen 2026-10-02 dataset
   (`2026-10-02-46adf62e`): full before/after of every asset in all 7 presets × redraft/dynasty × actual phase
   (week 4) and forced preseason — the **only** change is that ADP-only players lose their value (12-team 1QB in
   season: 990 ADP-only assets removed, 70 of them ≥100; 14-team SF: 159 ≥100; preseason 12-team 1QB: 95 ≥100);
   **0** value changes for every other asset; dynasty unchanged (ADP weight 0). `audit-model --only=current,compare`:
   monotonicity 75 checks / 0 failures, before/after Spearman 1.0 and median change 0 in all four reference leagues,
   scorecard metrics unchanged. 2 new tests (failing on 2.0.0). Committed `reports/audit/` was deliberately left as
   the 2.0.0 audit record (the 2.1.0 run only relabels it).
7. **ESPN undrafted-ADP placeholder (bug #10)** — `adapters/espn.js` collapses ADP ≥ 169 (within one pick of ESPN's
   undrafted default 170) to exactly 170 and flags `undrafted: true`. Dropping those entries was tried first and
   **rejected on evidence**: the ≈170 value carries real "undrafted" information, and without it 248 deep players rose
   (e.g. a production-only WR 90 → 269) because Sleeper's deep ADP alone then mapped them higher. Collapsing to a tie
   (frozen-dataset simulation, then confirmed on a live re-sync): in season only **decreases** (235 players in 12-team
   1QB, e.g. backup QBs Mason Rudolph 194 → 15 and Kenny Pickett 190 → 11 in the 12-team dynasty roster preset as
   redraft; Kyle Juszczyk 172 → 104), forced preseason ≤ ~10-point rises; SF presets unaffected (no ESPN SF ADP);
   dynasty unaffected. Data normalization, not a formula/default change → `model_version` stays 2.1.0. New
   `tests/adapters.test.js` (stubbed HTTP).
8. **Dev tooling:** `eslint.config.mjs` + `npm run lint`, `tests/e2e/smoke.mjs` + `npm run test:e2e` (both dev-only,
   §3, §26). Lint found and the commit fixed 3 dead variables (unused `.map` index in `js/ui/views/compare.js` and
   the test fixture; unused `binary` option of `cached()` in `scripts/lib/history-data.js`). No behaviour change.
9. **Lint in CI** — `release.yml` runs `npm run lint` before the tests (owner decision: a lint error blocks the
   release). Simulated CI (no global ESLint, empty npm cache/prefix): `npx` fetched ESLint 10 into its cache in ≈4 s,
   exit 0, no `node_modules`/lockfile created.
10. **Bug #2 fixed (audit-model reproducibility).** `scripts/audit-model.js`: `--freeze` (copies the synced dataset to
    `data/benchmark/dataset-frozen.json`; error + exit 1 if nothing is synced), `--snapshot-before` freezes first when
    no frozen dataset exists, `--out=DIR` redirects every output **and** the baseline (so validation runs no longer
    overwrite the committed `reports/audit/`), and `--freeze`/`--snapshot-before` alone no longer start the full
    backtest suite. `current` and `compare` skip with instructions (exit 0) when nothing is synced; `compare` skips
    when the baseline's `data_version` differs (it used to throw), and notes when it falls back to the live dataset.
    Verified: fresh clone (no data) → exit 0 + instructions; synced clone vs committed baseline → skip, exit 0,
    committed reports unchanged; old-model (2.0.0) baseline → simulated re-sync → new-model compare on the frozen data
    → `model 2.0.0 → 2.1.0`, one player ≥500 dropped to 0 (bug #1 fix). `tests/audit-tool.test.js` (3 tests, runs the
    real CLI on the synthetic fixture in temp dirs); the fresh-clone test fails on the old code (ENOENT).
11. **Bug #3 fixed (Trends mixes model versions).** Display-only (no data/schema change; `history.json` already stored
    `model_version` per entry; `model_version` not bumped). New pure helpers `js/ui/history-series.js`
    (`modelBoundaries`, `modelMarkers`, `windowDelta`, `currentModelStart`); `lineChart` gained `markers` (dashed
    vertical line + label, kept inside the chart, included in the x-range) and per-series `breaks`. Trends: model line
    broken at each change, KPIs count model-value change only since the current version, market/ECR/projection lines
    unchanged (raw data). Verified on real local history (2.0.0 → 2.1.0): KaVontae Turpin's change now −30 (the ESPN
    data change) instead of −60 (which included the model upgrade); Justin Tucker shows his last 2.0.0 value, then
    the marker. Tests: `tests/history-series.test.js` (3); E2E seeds a two-model history and checks marker, broken
    line and all three KPIs — the E2E Trends checks fail on the old UI (+50/−1,950/−1,950).
12. **Model 2.1.1 — bugs #4 and #5 fixed** (`signals.js`): a source whose only lists are in the wrong QB format is
    excluded instead of silently used (`meta.excluded_market_lists`, note on the player's Market & sources tab); TEP
    lists are matched to the league's `bonus_rec_te`. Validation: 0 value changes across all 28 preset × mode × phase
    sets on the frozen dataset (current data has both QB formats for every source and no TEP lists, so only imports
    are affected); monotonicity 75/0 (`audit-model --only=current --out=<scratch>`). 2 new tests in
    `valuation.test.js` (both fail on 2.1.0).
13. **Bug #11 fixed (trade notes / unavailable assets)** — see §19. Not a valuation-model change (asset values are
    untouched; only how a trade treats ids that have no value), so `model_version` stays 2.1.1. Before the fix, a
    1-for-1 with an unavailable player charged the other side's player a consolidation package adjustment. Verified
    in Node (Philip Rivers for Jeremiyah Love: package 0, named note) and in the browser (toast when a stored trade
    loses an N/A player, saved-trade "Now" column). 1 new test in `trade.test.js` (fails on the old code).
14. **Bugs #6, #7 and #13 fixed (layout)** — `css/app.css`, `js/ui/views/rookies.js`: section tabs wrap instead of
    scrolling behind a hidden scrollbar (all 8 visible at 390/360 px); header compacts between 721 and 1120 px (it
    overflowed the page by 67–370 px and hid Sync); phone header stays one row. Rookie prospect table: columns
    declared once (header + cell), "Rookie ADP" dropped when no player has one (true for all current data), shorter
    headers ("Team", "Range" with the SD in a tooltip, "Conf."), sticky Player column — 1,381 → 1,292 px, fits 1360 px
    with no scroll. Verified with Playwright on real data (all routes × both modes at 1024/800 px: no page overflow).
    E2E now runs 1360/721/390 px and checks no sideways page scroll, Sync visible and all tabs on screen — the old
    CSS fails at 721 px (334 px overflow) and 390 px (5 tabs cut). `eslint.config.mjs` gained a Node+browser block
    for `tests/e2e/**` (`page.evaluate` callbacks).
15. **Bugs #8, #9, #12 fixed (hygiene).** #8: `js/core/version.js` no longer points at a non-existent
    `js/core/schema.js`; it states the truth (schema versions are written, never read; no migration code — add reader
    handling when bumping). #9: `npm run calibrate` re-run (≈23 s from the cached history). First run in a throwaway
    worktree: all six calibration files came out identical to the committed ones apart from `generated_at` (and the
    position of the hand-added `fit` block in `rookie-slot-curve.json`), so the audit's in-place refit is exactly what
    the generator produces; the committed files are now the generator's output. Full value diff: 24,892 assets, 0
    changes → no `model_version` bump. #12: `tests/sync.test.js` removes its temp data dir after the suite.
16. **Adversarial bug audit** (32 bugs) — `docs/BUG_AUDIT.md`, `docs/BUG_FIX_HISTORY.md`.
17. **Usability / product audit + Tier 1 implementation** (2026-10-03) — `docs/USABILITY_AUDIT.md` (§15 lists every
    change with measurements), `docs/FEATURE_AUDIT.md`. New: `js/core/valuation/balance.js`, `js/ui/trade-helpers.js`,
    `tests/balance.test.js`, `tests/trade-helpers.test.js`; E2E extended (share link, Even it out, totals = bars,
    keyboard row → player, stray null/undefined/NaN text on 12 routes). Only trade-analysis change: no package
    adjustment while a side is empty. Full value diff 24,892/0; 2,393 random complete trades 0 changes → model stays
    2.1.2.
18. **My Team + lineup impact** (same session, second batch) — `js/core/roster.js`, `js/ui/views/team.js`, `#/team` tab,
    trade-page "Which side is you?" (You/Them wording via `sideNames`/`relabel`), lineup impact block, "From my
    roster" quick-add, roster-restricted "Even it out" (`balanceSuggestions({only})`). `tests/roster.test.js` (6),
    balance `only` test, E2E My Team flow. No valuation change.

## 18. What is currently in progress

Nothing is mid-edit (clean tree after the 2.1.0 commit). Open items that were consciously deferred (not half-written
code). Owner decisions (2026-10-02): dev-only ESLint/Playwright via global tools / `npx`, **no** `package.json`
devDependencies (done); ESPN placeholder ADP handled in the adapter (done, as a tie rather than a drop — §17 item 7).

| Feature | Current state | What remains | Files | Blocker | Next step |
|---|---|---|---|---|---|
| Audit results in the UI | only `reports/backtest.json` shown | serve/show `reports/audit/scorecard.csv` or a summary JSON | `server/index.js` STATIC_ALLOW, `js/ui/views/model.js` | none | §35 item 3 |

## 19. Known bugs

| # | Bug | Severity | Reproduce | Expected | Actual | Likely cause | Files | Workaround |
|---|---|---|---|---|---|---|---|---|
| 1 | ~~Free agents valued from stale ADP alone in redraft~~ **FIXED in model 2.1.0** | was High | handoff snippet (PICK UP HERE) | ADP-only players N/A | now 3 FA ≥100 in 12-team 1QB in season (Tyreek Hill 297, Zane Gonzalez 217, Odell Beckham 186 — all corroborated by consensus; kept deliberately, owner decision 2026-10-02); 0 ADP-only assets | was: placeholder/stale deep ADP ranks × expected-surplus tail × lone-group renormalization | `redraft.js` (`adp_requires_corroboration`), `config/model.json` | — |
| 2 | ~~`npm run audit-model` crashes on a fresh clone~~ **FIXED** (2.1.0 session) | was Medium | `FFTA_DATA_DIR=<empty dir> node scripts/audit-model.js --only=current,compare` | skip or explain | exit 0 with instructions; mismatched baseline → skip with instructions | was: no freeze command, `compareSnapshots` threw, `loadFrozenDataset` read a missing file | `scripts/audit-model.js`, `scripts/audit/{compare,current}.js`, `tests/audit-tool.test.js` | — |
| 3 | ~~Value history mixes model versions~~ **FIXED** (2.1.0 session) | was Medium | Player → Trends with history spanning a model change | model changes marked | dashed marker + label at each change, model-value line broken there, 7/30-day/season change measured within the current model version (market change still across versions), explanatory note | was: `server/history.js` recorded `model_version` per entry but the UI ignored it | `js/ui/history-series.js`, `js/ui/charts.js` (`markers`, series `breaks`), `js/ui/views/player-modal.js`, `css/app.css` | — |
| 4 | ~~Format-mismatched market lists used silently~~ **FIXED in model 2.1.1** | Low (no current impact: FantasyCalc provides SF lists) | a source with only 1QB lists in an SF league | warn or exclude | `formatMismatch: true` is set but never read | unfinished guard | `js/core/valuation/signals.js` L35 | — |
| 5 | ~~TE-premium market lists never preferred~~ **FIXED in model 2.1.1** | Low | TEP league with a source that publishes TEP values (KTC import with `tep`) | prefer the matching TEP list | always prefers `tep: 0` | `marketMismatch` uses `Math.abs(rec.tep − 0)` | `signals.js` L12 | none |
| 6 | ~~Mobile header nav clipped~~ **FIXED** (2.1.0 session) | Low (UX) | 390 px viewport | all tabs reachable visibly | tabs cut off at "Setti…" | nav overflow styling | `css/app.css`, `index.html` | swipe/scroll the nav |
| 7 | ~~Rookie prospect table wider than desktop viewport~~ **FIXED** (2.1.0 session) | Low (UX) | `#/rookies` at 1360 px | fits or scrolls clearly | last column cut | many columns | `js/ui/views/rookies.js`, `css/app.css` | horizontal scroll |
| 8 | ~~`js/core/version.js` comment references `js/core/schema.js migrate*`, which doesn't exist~~ **FIXED** (2.1.0 session) | Low (doc/code) | read file | migration helpers exist, or no reference | no schema migration code at all | aspirational comment | `js/core/version.js` | — |
| 9 | ~~`config/calibration/rookie-slot-curve.json` `generated_at` predates its current shape~~ **FIXED** (2.1.0 session) | Low | compare `generated_at` with git history | timestamp of the LS-exponential refit | shape was refit in place from `raw_mean_by_rank` during the audit; `generated_at` still 13:33 | manual refit | that file; `npm run calibrate` regenerates consistently | rerun `npm run calibrate` |
| 10 | ~~ESPN ADP placeholder (≈168–170) treated as a real ADP~~ **FIXED in the adapter** (after 2.1.0) | was Low | `data/normalized/espn/adp.json` | undrafted players tie | 815 of 1,050 entries are now exactly 170 with `undrafted: true`; they share one average overall rank (≈0 value) instead of being ordered by noise | was: adapter kept every ADP < 300 | `adapters/espn.js` (`ESPN_UNDRAFTED_ADP`, `ESPN_UNDRAFTED_MARGIN`) | — |
| 11 | ~~Trade note "Unavailable assets" lists raw ids, and a missing asset still counts as "Team A consolidates"~~ **FIXED** (2.1.0 session) | was Low | `analyzeTrade` with an N/A player (e.g. Philip Rivers) | names; no false consolidation | note names the player (`names` option: function or map; falls back to the id); unavailable non-pick ids count as players (value 0), so a 1-for-1 with an N/A player no longer charges the other side a package adjustment; a side with only unavailable assets is no longer "incomplete"; the live trade builder tells you by name (toast) when it drops unavailable assets, and saved-trade "Now" uses the same names/counting | was: notes used ids; player count only included resolved assets | `js/core/valuation/trade.js`, `js/ui/views/trade.js`, `tests/trade.test.js` | — |
| 13 | Header overflowed the page between 721 and ~1090 px (found while fixing #6) — **FIXED** (2.1.0 session) | was Medium (UX: Sync button off-screen on tablets/small laptops, page scrolled sideways on every route) | 800 px viewport, any page | header fits | right-hand controls (651 px) pushed the page 67–370 px sideways | no breakpoint between 720 px (phone layout) and desktop | `css/app.css` (≤1120 px: brand text hidden, header wraps; ≤960 px: data-pill text and Sync label hidden, as on phones) | — |
| 12 | ~~`npm test` leaves one `ffta-sync-*` temp dir per run in the OS temp folder~~ **FIXED** (2.1.0 session) | Low (test hygiene) | run `npm test`, list `$TMPDIR/ffta-sync-*` | removed after the suite | stays | `tests/sync.test.js` creates it with `mkdtemp` and never removes it | `tests/sync.test.js` | delete them by hand |

**All known bugs (#1–#13) are fixed as of the 2.1.0 session; none open.** Record new ones here.

No flaky tests have been observed (66/66 across several runs in the 2.0.0 session; 68–72 in the 2.1.0 session).

## 20. Known model / data problems (not software bugs)

* **Untestable weights:** projections, ADP, FantasyCalc and DynastyProcess have no free historical archives, so
  their weights are judgment (`docs/MODEL_AUDIT.md` §4, §20). Snapshots (90 kept) are the only archive going forward.
* **Consensus dependence:** FantasyPros ECR is the dominant signal; losing ECR and FantasyCalc together moves
  dynasty values a lot (ρ .933, p90 change 40%, `reports/audit/cur-missing-sources.json`).
* **σ / ± ranges are a signal-disagreement heuristic**, not calibrated intervals; trade z-scores inherit that
  (`js/core/valuation/confidence.js`).
* **Expected surplus has hindsight optimism** for deep players (audit §5); combined with single-signal
  renormalization this produced bug #1 (fixed for ADP in 2.1.0; a lone projection/consensus/market group is still
  renormalized to 100%, which is intended — those are real evidence).
* **Forced-preseason observation (2.1.0 validation):** running preseason weights on today's in-season data values
  ~25–39 free agents ≥100 in SF leagues from **projection alone** (e.g. Derek Carr, Teddy Bridgewater), because
  last summer's season projections are still in the dataset. This is an artifact of forcing the phase; in a real
  preseason the projections are current. Worth re-checking in the next real preseason (August).
* **Rookie curve** (now exactly reproducible by `npm run calibrate`) smooths the historical drop after pick 2 (1.01–1.02 mean 228 vs fit 177); class strength is
  not modelled (CV .28 across 4 classes).
* **Dynasty backtest** covers only 2020–2023 (4 seasons); ρ differences < .01 are noise.
* **Not validated:** injury games-lost table, SoS strength (inconclusive), K/DEF values, dynasty discount rates,
  the package adjustment for 3+ player trades (simulation correlation .49–.54).
* **Not modelled:** contracts, coaching, college production, landing spot (only via consensus/market), TE-premium
  dynasty consensus, Superflex-specific redraft ECR beyond what FP provides.
* **Dataset bloat:** ≈1,000 ADP-only players (≈45% of the dataset) are kept but get no redraft value since 2.1.0 — wasted
  compute/size only (backlog: prune or flag).
* **Source age biases** (audit §4): ESPN projections are less favourable to young QBs; FantasyCalc favours veteran
  TEs vs ECR (+7.6 pct pts). Not corrected.

## 21. Previous audits

* **Model audit** — `docs/MODEL_AUDIT.md` (20 sections) and `docs/MODEL_COMPARISON.md`; outputs in
  `reports/audit/` (`scorecard.csv` is the one-line-per-metric summary; `before-after.csv` compares every player
  v1 vs v2 in four leagues; `v1/` holds the current-data analyses as run on model 1.0.0).
  * Findings fixed in 2.0.0: prior-only veteran values, one-game backup values, non-monotone scale,
    deterministic-surplus bias (−14 pts), over-weighted in-season production, ignoring availability, DP
    double-counting, dynasty age bias (γ = 2), isotonic rookie curve, trend in values.
  * Still open from the audit: SoS (inconclusive), injury table (untestable), σ calibration, 3+-player package
    under-correction, ESPN young-QB bias, MAE-vs-mean pick curve trade-off.
  * **Not found by the audit, discovered while writing this handoff:** bug #1 (FA ADP-only values). The audit's
    monotonicity and extreme-case checks covered top players, not deep free agents. Fixed in 2.1.0 (§17 item 6).
* **Usability audit** (2026-10-03) — `docs/USABILITY_AUDIT.md` (sections 1–16, friction log F-01–F-44, before/after
  validation, PM summary) and `docs/FEATURE_AUDIT.md` (opportunity matrix F1–F39, classification, remove/simplify,
  ideal journey, Tier 1/2/3/Do-Not-Build). Tier 1 implemented; open: F-33–F-36, F-40 (model question: package
  charge on a star acquired for picks), F-41–F-44.

## 22. Design principles

* Future-proof, modular sources: every source replaceable via an adapter and config; the app is useful if any one
  source disappears.
* Free/open data; respect terms of service (no scraping where prohibited; KTC/FantasyPros direct are manual only).
* Automated sync first, manual import second.
* Never fabricate data: missing → N/A and lower confidence, never imputed.
* Transparency: every value decomposes into components that sum to it; explanations in the UI and docs.
* Redraft and dynasty are separate models on shared infrastructure.
* League-specific values via replacement levels (no generic positional multipliers).
* Uncertainty over fake precision (values rounded to 10, ± shown, z-based verdicts).
* Evidence before complexity: change formulas only with walk-forward evidence; keep untestable parts simple and
  labelled as judgment.
* Simple for non-technical users (double-click start, zero dependencies) and responsive on mobile.

## 23. Important non-goals

* Does not treat market value (or consensus) as objective truth, nor force the model toward it.
* Does not fabricate or back-fill missing data (value history starts from the first sync).
* Does not depend permanently on any one website.
* Does not require advanced settings for basic use (presets + defaults).
* Does not present projections or dynasty outlooks as precise forecasts.
* Does not scrape sites whose terms prohibit it.
* Does not (yet) value assets relative to a specific user's roster.

## 24. Model version / data version

```text
Model version:   2.1.2          config/model.json → model_version (bump on ANY formula/default change; CLAUDE.md rule)
App version:     1.0.0          js/core/version.js APP_VERSION and package.json "version" (release tag v<version>-build.<n>)
Schemas:         NORMALIZED_SCHEMA_VERSION 1, DATASET_SCHEMA_VERSION 1 (js/core/version.js); history.json schema_version 1;
                 config files carry their own schema_version
Data version:    2026-10-02-46adf62e at the 2.1.0 validation (data/calculated/dataset.json; changes every build;
                 format <date>-<hash>); the committed 2.0.0 audit reports used 2026-10-02-77e3c35d
settings_hash:   stableHash(league + model) per calculation (js/core/settings.js)
```

Every saved trade and export stores model_version, data_version and settings_hash. No migration code exists for
schema changes (bug #8): if you change a schema, bump it **and** add reader handling. Model bumps: patch for
parameter tweaks with no formula change, minor for new optional components, major for value-scale or formula changes
(2.0.0 changed both). Record changes in the versioning table in `docs/VALUATION_MODEL.md` §7.

## 25. Configuration

| File | Key settings (current) | Effect |
|---|---|---|
| `config/model.json` | `scale` (top_value 10000, anchor_top_n 12, anchor_value null → 7000); `reference_league`; `phase.full_in_season_week` 8; `redraft.weights`, `.production` (regression_games 2, xfp_blend .25, min_games_without_history 3, sos_strength .5, availability), `.uncertainty.sd_per_game`, `.injury_games_lost`, `.bench_value_fraction` .35, `.trend.weight` 0, `.adp_requires_corroboration` true (2.1.0); `dynasty.weights` (.25/.35/.40/0), `horizon_years` 5, `strategy_discount`, `rate_evidence` (prior_pseudo_games 20), `aging_power` 2, `require_current_evidence_after_year` 1, `uncertainty`, `injury_year1_fraction`, `trend.weight` 0; `picks` (weights .45/.30/.25, future_year_discount .88, buckets, prior_class_adjustment .8, upcoming_class_switch_month 9); `source_weights` (projection/consensus/market/adp/pick_market); `mapping.min_source_players` 20; `package`; `confidence` | all valuation; per-league overrides via the profile's `overrides` |
| `config/sources.json` | per source: enabled, priority, method, data_types, update_frequency_hours, urls, terms, fallback, independence_group; `freshness_hours`; `exclusive_data_types`; `authoritative_player_sources`; `history_series` | sync, failover, staleness, identity |
| `config/league-defaults.json`, `config/profiles.json` | §15 | leagues |
| `config/import-specs.json` | templates `ktc_values`, `fantasypros_rankings`, `projections_generic`, `market_generic`, `rankings_generic`, `adp_generic`, `picks_generic` | manual import |
| `config/calibration/*.json` | aging-curves, attrition, availability, draft-priors, rookie-slot-curve, year-over-year | replace model defaults in `buildModel` |

Environment variables (all optional): `PORT` (5177), `HOST` (127.0.0.1 — keep local unless LAN access is wanted),
`FFTA_USER_AGENT`, `FFTA_FETCH_TIMEOUT_MS` (45000), `FFTA_DATA_DIR` (relocate `data/`), `FFTA_NO_AUTOSYNC`,
`FFTA_AUTO_REFRESH_HOURS` (12), `FFTA_OPEN`. No feature flags beyond config `enabled` and `package.enabled`.

## 26. Testing status

`npm test` → **122 tests, 122 pass, ≈5 s, no network** [verified]. Fixture: `tests/fixtures/make-dataset.js`
(SYNTHETIC "Test QB 1" players, 2026 week 6, 40 rookies, FantasyCalc-style picks).

| File | Tests | Covers |
|---|---|---|
| `history-series.test.js` | 3 | Trends model-version boundaries, markers, within-model change vs raw-series change |
| `server.test.js` | 6 | HTTP hardening: path traversal, malformed requests, CSRF/DNS rebinding, saved-trade ids, JSON body validation (BUG_AUDIT A1–A6) |
| `search.test.js` | 3 | asset search de-dup, suffixes, team-code prefixes (SR1–SR3) |
| `audit-tool.test.js` | 3 | `audit-model` CLI on the synthetic fixture in temp dirs: fresh clone skips, freeze needs data, baseline/data mismatch skips, freeze → baseline → re-sync → compare uses frozen data |
| `adapters.test.js` | 1 | ESPN ADP undrafted-default collapse (stubbed HTTP; first adapter-level test) |
| `identity.test.js` | 12 | normalizers, ID/name matching, suffixes/nicknames, team change, ambiguous never merged, conflicts, overrides, DEF, PlayerStore |
| `ingestion.test.js` | 12 | CSV parsing (quotes, BOM, CRLF, malformed), delimiter detection, auto column mapping, required fields, duplicates, JSON uploads, pick labels |
| `scoring.test.js` | 6 | PPR/half/std, QB scoring, TE premium, first downs, bonuses, K/DEF |
| `sync.test.js` | 13 | partial failures, exclusive failover, retry failed, freshness skip, quarantine keeps previous, stale flag, snapshots/history |
| `trade.test.js` | 11 | 1-for-1, 2-for-1, 3-for-2 package math, disable package, player vs picks, z-score verdict, missing ids, dynasty age notes, pick-for-player note, incomplete trade has no package adjustment |
| `balance.test.js` | 7 | Even it out / Value matches: correct side, exact (= analyzeTrade), sorted, improves the gap, no free agents, generic picks only, one-sided matches, read-only, `only` (my roster) |
| `roster.test.js` | 6 | best lineup (dedicated/FLEX/SF, empty slots), lineup impact (starters in/out, points, unchanged starters, not-on-roster, roster overflow), dynasty picks and duplicate generic picks |
| `trade-helpers.test.js` | 4 | verdict headline wording, market check cases, "B +6,160" formatting, share-link round trip and junk handling |
| `valuation.test.js` | 20 | rank mapping, blend, ES helpers, components sum, scale anchor, scarcity, SF, TEP, dynasty vs redraft, strategy, picks, missing data, confidence, phase weights, IR zero projection, market list QB-format exclusion, TEP list preference |
| `model-audit.test.js` | 15 | monotonicity (projection, age), expected surplus, evidence gate, one-game backups, zero-weight DP, trend display-only, pick monotonicity, slot curve fit, league effects, finite values, age cliffs, elite > replacement, ADP-only N/A (FA + rostered, in season + preseason, corroborated ADP still counts), corroboration flag off |

Optional browser E2E: `npm run test:e2e` (`tests/e2e/smoke.mjs`, not matched by the `npm test` glob; §3). It covers
the trade builder (desktop + mobile width), share links, Even it out, side totals = bars, keyboard (Players row →
player), My Team (add → "Trade" → You/Them labels → lineup impact), every main route (no sideways scroll, no stray null/undefined/NaN text), the player Trends tab
(model-change marker) and console errors — not the import wizard, Settings round-trips, the other player-modal tabs or dynasty picks. CI runs lint and `npm test`, not E2E.

Gaps: no test for most adapters against recorded real responses (only ESPN ADP, stubbed), the HTTP API routes,
deeper UI flows (see above), Sleeper league import, history/trends, the audit backtests (E1–E4).
Manual checks still worth doing after UI changes: trade builder on mobile, import wizard end-to-end in the browser,
Settings overrides round-trip, Sleeper league import with a real league ID.

## 27. Current validation / benchmark results

From `docs/MODEL_AUDIT.md` / `reports/audit/` (REAL HISTORICAL = nflverse + FantasyPros ECR archive, walk-forward):

| Experiment | Result |
|---|---|
| E1 preseason redraft 2021–25 (ρ / MAE) | ECR .505 / 57.2; last-season PPG .410 / 61.7; fitted ECR weight 1.0 every fold |
| E1b value scale bias by tier | deterministic −14 in all tiers; expected surplus −8.4 / −0.2 / −2.0 / +1.9 |
| E2 in-season ROS 2021–24 | ECR .490 / 32.5; v1 blend .487 / 35.5; fitted blend .512 / 34.5; consensus weight .8–1.0 at weeks 4–12 |
| E3 dynasty 2020–23 | ECR .581; fundamental .502 (v2 variant .506, age bias removed); 75/25 blend .583 |
| E4 rookie slot curve (LOO) | isotonic MAE 40.7; LS exponential 37.9 (top-12 bias +1.7); MAE-fitted curves biased −34 to −74 |

CURRENT DATA (frozen 2026-10-02 snapshot): monotonicity 75 checks, v1 3 failures → v2 0. SIMULATION: package-sim
correlation .25 → .63. Older `reports/backtest.json` (`npm run backtest`, also real data) is what the Model page
shows. The benchmark itself (`data/benchmark/benchmark.json`, ~29 MB) is git-ignored and rebuilt automatically by
the audit (downloads ≈60 MB + streams the 105 MB ECR archive).

## 28. Performance considerations

* One valuation run ≈ **240–260 ms** in Node on current data (2,211 players) [verified]; the engine runs the user
  league **and** the reference league (2 runs unless identical). The UI caches per mode + league + data hash.
* `dataset.json` ≈ 4.9 MB (served gzip-compressed when >2 KB). Half the players are ADP-only free agents (§20).
* A full sync took ≈ 10 s and downloaded ≈ 93 MB over 47 requests [verified]; 3 parallel workers.
* `npm run audit-model --only=current` ≈ 40 s; full audit with backtests takes minutes (E3 recalibrates per season).
* Disk: `data/` ≈ 85 MB incl. raw caches and benchmark; `scripts/.cache/` (git-ignored) holds historical CSVs and
  Node distributions for packaging.

## 29. Security / credentials

* No source needs credentials today. Secrets would go in `.env` (git-ignored; template `.env.example` lists
  reserved `FANTASYPROS_API_KEY`, `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` — unused).
* Never commit: `.env`, `data/**` (except `data/README.md`), `scripts/.cache/`, `dist/`, `node_modules/`.
  `data/benchmark/` is git-ignored since 2.0.0.
* The server binds to `127.0.0.1` by default and serves only allow-listed static paths (never `data/raw`,
  `data/user`, `.env`). `HOST=0.0.0.0` exposes the app (and its write APIs: sync, import, profiles) to the LAN with no
  authentication — only for deliberate use.
* Release workflow uses only the built-in `GITHUB_TOKEN`.

## 30. How to add a new data source

Full guide: `docs/ADDING_A_SOURCE.md` (matches the code [verified structure]).

1. **Adapter** `adapters/<name>.js` extending `BaseAdapter`; implement the `fetchX()` methods for its data types
   (`METHOD_FOR_TYPE` in `adapters/base.js`); return `{records, schema:{expected, received}, minRecords}`; save raw
   with `this.saveRaw()`; throw on failure.
2. **Register** in `adapters/index.js` `ADAPTERS`.
3. **Configure** in `config/sources.json` (id, adapter, enabled, priority, data_types, frequency, urls, terms,
   fallback, independence_group). Add to `exclusive_data_types` / `authoritative_player_sources` only if needed.
4. **Normalization** is the adapter's job (record shapes: see existing adapters and `docs/DESIGN.md`).
5. **Player mapping** is automatic via `PlayerIndex.resolve` — supply external IDs when the source has them.
6. **Validation** is automatic (`assessBatch`); set a sensible `minRecords` and schema.
7. **Weights:** add the source id to `config/model.json source_weights.<group>` (unknown sources default to 0.5).
   **Check its correlation with existing sources first** (`npm run audit-model -- --only=current`, `cur-correlations.json`);
   a near-copy should get weight 0. Bump `model_version` if defaults change.
8. **Tests:** add a fake-adapter case to `tests/sync.test.js` if behaviour is new.
9. **UI/source health:** nothing to do — the Data page lists sources from config.
10. **Docs:** `docs/DATA_SOURCES.md`, README source table, this handoff §8.

## 31. How to modify the valuation model safely

1. Formulas: `js/core/valuation/{redraft,dynasty,picks,context,replacement,blend,mapping,engine,trade}.js`.
   Parameters: `config/model.json`; calibration: `scripts/calibrate.js` → `config/calibration/`.
2. Before changing anything: `npm test`; `npm run sync` if `data/` is empty; save a baseline on the OLD model:
   `npm run audit-model -- --freeze --snapshot-before --out=/some/dir` (freezes the synced dataset, writes
   `values-v1.json` to the out dir; ~1 s, no backtests). Use `--out` unless you intend to commit a new audit:
   without it, outputs go to the *committed* `reports/audit/`. A full-asset diff (every asset, all presets, both modes,
   forced preseason) is a cheap, stronger check than the top-400 compare for targeted fixes.
3. Make the change; **bump `model_version`**.
4. Validate: `npm test`; `npm run lint`; `npm run audit-model -- --only=current,compare --out=/some/dir`
   (monotonicity, stability, before/after against the frozen data — a re-sync in between doesn't matter); for formula changes with historical relevance, the relevant backtest (`--only=e1|e2|e3|e4`).
5. Avoid leakage: fit only on seasons before the test season; rankings dated before the target window; refit
   calibration per season as `calibrateBefore()` in `scripts/audit/backtests.js` does.
6. Redraft vs dynasty: they share `context.js` (production rate feeds dynasty μ1), `replacement.js`, `mapping.js`,
   `blend.js`. Changing shared code changes both — run both modes' tests and the before/after for all four leagues.
7. Look at extremes, not only top players: deep free agents, rookies, IR players, retired veterans, picks
   (`cur-extremes.json`, `before-after-sample.json`). Bug #1 slipped through because nobody looked at deep FAs.
8. Update `docs/VALUATION_MODEL.md` (versioning table), `DYNASTY_MODEL.md` / `ROOKIE_PICK_MODEL.md`,
   `MODEL_AUDIT.md` if findings change, and this handoff.

## 32. How to perform a data refresh

* **Normal:** click **Sync All** (header) or `npm run sync`. Sources fetched in the last 30 min are skipped;
  **Force full refresh** (Data page) or `npm run sync -- --force` re-downloads everything. The app also auto-syncs on
  launch when data is older than `FFTA_AUTO_REFRESH_HOURS` (12).
* **Failure:** Data → Sources shows ✕ error / ⛔ quarantined / ⚠ stale per source with the message; the previous good
  data is used. Click **Retry** or run `npm run sync -- --failed` / `--source <id>`. Quarantine details:
  Data → Data quality. Broken undocumented endpoints: set `"enabled": false` in `config/sources.json` or fix the
  adapter (`docs/TROUBLESHOOTING.md`).
* **Manual fallback:** Data → Manual Import → choose a template → file → confirm mapping → review preview
  (validation, unmatched/ambiguous, overwrite impact) → Import (re-import of the same format asks to confirm overwrite;
  API field `confirm: true`). Remove an import: Data page or `DELETE /api/import/<source_id>`.
* **Full rebuild:** `npm run rebuild` (no network). Clean slate: stop the server, delete `data/` except `README.md`,
  `npm run sync` (profiles also live in browser storage; `data/user/` holds the server copy).
* **Calibration refresh** (yearly, after a season): `npm run calibrate`, then review, bump `model_version`, run tests
  and the audit.

## 33. Most important files

| File | Purpose | Why it matters |
|---|---|---|
| `CLAUDE.md` | standing instructions | git workflow (push to `main`), versioning rules |
| `server/index.js` | server entry, API, static allow-list, auto-sync | where every API route lives |
| `server/sync-engine.js` | sync orchestration, quarantine, rebuild | data reliability |
| `server/dataset-builder.js` | player DB + merged dataset | what the model sees |
| `js/core/identity.js` | canonical IDs, matching | wrong matches corrupt values silently |
| `js/core/quality.js` | batch validation rules | quarantine thresholds |
| `adapters/index.js`, `adapters/base.js` | adapter registry/interface | adding sources |
| `config/sources.json` | source registry | enable/disable, failover, authority |
| `config/model.json` | all model parameters + `model_version` | every value |
| `js/core/valuation/engine.js` | orchestration, scale, finalize, ranks | entry point `computeValuations` |
| `js/core/valuation/context.js` | league-scored inputs, production rate | shared by both modes |
| `js/core/valuation/replacement.js` | scarcity + expected surplus | league effects |
| `js/core/valuation/redraft.js` | redraft model | bug #1 lives around the blend |
| `js/core/valuation/dynasty.js` | dynasty model | aging, evidence gate |
| `js/core/valuation/picks.js` | pick values | rookie picks |
| `js/core/valuation/signals.js`, `mapping.js`, `blend.js` | list selection, rank mapping, blending | format matching, renormalization |
| `js/core/valuation/trade.js` | trade analysis | package adjustment, verdict |
| `js/core/settings.js` | league/model building, phase | overrides, qb_format |
| `js/ui/state.js`, `js/app.js` | UI state + router | valuation caching, routes |
| `js/ui/views/trade.js` | trade page | main user workflow |
| `server/import-service.js`, `config/import-specs.json` | manual import | fallback path |
| `scripts/audit-model.js`, `scripts/audit/*.js` | audit tooling | validating model changes |
| `tests/fixtures/make-dataset.js`, `tests/*.test.js` | tests | safety net |
| `docs/MODEL_AUDIT.md`, `docs/VALUATION_MODEL.md` | model rationale | why parameters are what they are |

## 34. Current open issues (backlog)

| Priority | Task | Why it matters | Current state | Dependencies | Files |
|---|---|---|---|---|---|
| Low | Show audit scorecard on the Model page | transparency | not served | none | `server/index.js`, `js/ui/views/model.js` |
| Low | Prune ADP-only players from the dataset (or flag them) | ≈45% of dataset rows carry no redraft value since 2.1.0 | not done | bug #1 fixed; decide | `server/dataset-builder.js` |
| Research | Calibrate σ (± ranges) against outcomes; archive projections/markets for future backtests | trust in verdicts | not started | months of snapshots | `confidence.js`, snapshots |
| Research | 3+-player package adjustment; roster-specific valuation | multi-player trades are the weakest area | evidence insufficient | simulation work | `trade.js`, `scripts/audit/current.js` |
| Medium | Counteroffer table, combination value matches (FEATURE_AUDIT F7, F4) | trade exploration speed | not started | — | `trade.js`, `balance.js` |
| Low | My Team: Sleeper draft picks (`traded_picks`), refresh from Sleeper, server copy of rosters | completeness | players only, browser-only | — | `js/ui/views/team.js`, `server/index.js` |
| Research | Package charge on a star acquired for picks (usability F-40) | experienced users find it wrong | open model question | quantitative audit | `trade.js` `packageAdjustment` |
| Low | Player dialog summary-first; unlabeled table inputs (Scoring/Import); chart text alternatives (F-33, F-42, F-44) | polish / a11y | open | — | `player-modal.js`, `settings.js`, `data.js` |

## 35. Recommended next steps

1. *(done — lint tooling, §3; runs in CI)*
2. *(done — optional E2E smoke test, §26)*. Possible extension: import wizard, player modal, dynasty pick adder.
3. **Model page shows the audit scorecard:** allow `/reports/audit/scorecard.csv` (or a small summary JSON) in
   `STATIC_ALLOW` and render it in `js/ui/views/model.js`.
4. **Dataset pruning:** decide whether ADP-only players should stay in `dataset.json` (bug #1 is fixed, so they are
    dead weight in redraft). Measure size and valuation time before and after.
5. **Counteroffer table** and **combination value matches** — Tier 2 of `docs/FEATURE_AUDIT.md` (§8).

# PICK UP HERE

> **Bug audit completed** — read `docs/BUG_AUDIT.md` §8–§9 for remaining known issues and untested areas. Server
> rules to keep: static paths are resolved after decoding; state-changing API calls must be same-origin
> `application/json` with a JSON object body; non-loopback `Host` headers are refused unless `HOST` exposes the app.
> Sync stores only `cleanBatch`-validated records; the engine sanitizes league settings; stored UI state is
> shape-checked on load.

```text
Current state:            Model 2.1.2. All known bugs (§19 #1–#13) and the 32 bug-audit bugs fixed. Usability audit
                          done (docs/USABILITY_AUDIT.md, docs/FEATURE_AUDIT.md) with Tier 1 + My Team implemented.
                          122/122 tests, lint clean (also in CI), E2E pass at 3 widths. All 10 sources sync.
Most important unfinished: Counteroffer table and combination value matches (FEATURE_AUDIT Tier 2), My Team
                          Sleeper picks, §35 items 3–4 (audit scorecard on the Model page; prune ADP-only players)
                          and the §34 research items (incl. usability F-40: package charge on stars bought with picks).
Known blockers:           None (no live Sleeper league was available to test the roster import; it was tested
                          against a mocked API).
Files to inspect first:   js/ui/views/{trade,team}.js, js/core/{roster.js,valuation/balance.js}, js/ui/trade-helpers.js
Tests to run first:       npm test (expect 122/122); npm run lint (clean); npm run test:e2e (pass or SKIP)
Docs to read first:       this file → docs/VALUATION_MODEL.md → docs/MODEL_AUDIT.md §1, §5, §19–20 → CLAUDE.md
Expected immediate action: next item in §35, with tests; update this handoff in the same commit; push to the
                          assigned branch and main (CLAUDE.md).
```

Bug #1 check (run from the repo root after a sync; expected since 2.1.0: a handful of FA players, all with
consensus/market/projection, and no `adp`-only weights):

```bash
node -e "import('./server/lib/config.js').then(async ({loadConfig}) => {
  const { computeValuations } = await import('./js/core/valuation/engine.js');
  const ds = JSON.parse(require('fs').readFileSync('data/calculated/dataset.json'));
  const c = loadConfig();
  const r = computeValuations({ dataset: ds, league: c.profiles.presets.find(p => p.id === 'preset_12_1qb_ppr'), mode: 'redraft', config: c });
  const x = [...r.assets.values()].filter(a => a.kind === 'player' && a.team === 'FA' && a.value >= 100);
  console.log(x.length, x.slice(0, 5).map(a => a.name + ' ' + Math.round(a.value) + ' ' + Object.keys(a.weights)));
})"
```

# INSTRUCTIONS FOR FUTURE CLAUDE CODE SESSIONS

1. Read this handoff first, then `CLAUDE.md` (owner's standing rules: commit and push all work to `main` as well as
   any assigned branch, run `npm test` before pushing, never force-push `main`, bump `model_version` on model
   changes, no source names outside `adapters/` and `config/sources.json`).
2. Inspect the actual code; treat it as the source of truth. Verify any claim here before acting on it — data
   counts and versions change with every sync.
3. Check `git status` / `git log` first; don't discard uncommitted work you didn't create.
4. Read the relevant doc before changing a major system (model docs, `ADDING_A_SOURCE.md`, `DATA_IMPORT.md`).
5. Don't undo the decisions in §7 without understanding their rationale and recording the new one.
6. Run `npm test` and `npm run lint` before and after changes (CI blocks the release on either); for model changes
   follow §31 (before/after, monotonicity, extremes).
7. Never fabricate data, never scrape sources whose terms forbid it, never commit `data/` or `.env`.
8. The container is ephemeral: `data/` (git-ignored) won't exist in a new session — run `npm run sync`. Lint and E2E
   are in the repo now (`npm run lint`, `npm run test:e2e`); the cloud container has ESLint 10 and Playwright
   installed globally.
9. Update this file after **any** change to the project (owner's standing instruction in `CLAUDE.md`), in the same
   commit, and add new bugs, decisions or architectural changes here.

## 38. Git / version control state

* Remote: `https://github.com/smbrynien/Fantasy-Football-Trade-Analyzer` (public). Default branch `main`.
* Branches: the 2.0.0 session used `claude/brave-mccarthy-uib8s8`; the 2.1.0 session uses
  `claude/funny-heisenberg-v7kjan`. Per `CLAUDE.md` every commit is pushed to the session branch **and** to `main`
  (fast-forward; never force-push `main`).
* Recent commits: `cb8e7ff` initial full app → `f80fcc6` CLAUDE.md → `7ac5d50` non-technical distribution →
  `464841f` model audit + 2.0.0 → `ac054d8` handoff → `a0548bd` CLAUDE.md "update the handoff after any change" →
  model 2.1.0 (bug #1 fix) → ESPN undrafted-ADP collapse (bug #10) → dev-only lint + E2E tooling → lint in CI +
  audit-model reproducibility (bug #2) → Trends model-version markers (bug #3) → model 2.1.1 market list
  format rules (bugs #4, #5) → trade notes / unavailable assets (bug #11) → layout fixes (bugs #6, #7, #13) →
  hygiene (bugs #8, #9, #12). Every known bug is now fixed. → bug-audit batch 1: server hardening + sync/storage
  reliability (docs/BUG_AUDIT.md A1–A5, B1, C1, C2) → batch 2: import validation, CSV export formula injection,
  identity conflicts, pick validity + monotone pick curves (model 2.1.2; I1–I3, ID1–ID2, P1–P2) → batch 3: duplicate
  generic picks, single player modal + URL, dialog focus, injection probe (T1, U1, U2, S1) → batch 4: hostile league
  settings sanitized, offseason projects the upcoming season (L1, D1) → batch 5: corrupt stored UI state, phone
  overflow on Model/Data pages (UI1, UI2) → batch 6: sync stores only valid, de-duplicated records; API body
  validation (SY1–SY3, A6) → batch 7: search de-dupe/suffixes/team prefixes; performance and leak checks (SR1–SR3,
  PF1) → batch 8: import overwrite confirmation, CSV signed-number regression; import/export workflows verified
  (I4, I5) → batch 9: offline message; audit documents completed (O1) → usability audit + Tier 1 UX changes
  (verdict-first trade result, Even it out / value matches, share, Model − Market, grouped settings, a11y) → My Team
  + lineup impact + "Which side is you?" (this update). CI (release.yml) succeeded for every 2.1.0-session push checked.
* Working tree: clean after each commit. `data/` (incl. `data/benchmark/dataset-frozen.json`) is git-ignored.
* Direction: accuracy and validation of the model (audit-driven), then robustness/UX polish.

## 39. Confidence in this handoff

* **Verified in the 2.1.0 session (2026-10-02):** git state (HEAD = main = branch at `a0548bd` before the fix),
  `npm test` 66/66 before and 68/68 after, `npm run sync` 10/10 OK (9.6 s, 92.6 MB), `npm start` + headless Chromium
  over Trade/Players/Data/Model (no console errors), bug #1 reproduced exactly (63) and fixed (3, all corroborated),
  full before/after asset diff, `audit-model --only=current,compare`, trade analysis with an N/A player. Global
  ESLint 10.1.0 and Playwright 1.56.1 exist in the cloud container (`/opt/node22/lib/node_modules`).
* **Verified in the 2.0.0 session:** test run (66/66), lint with the /tmp config (clean), sync (10/10 OK), server health and
  status API, browser E2E (no console errors; desktop + mobile screenshots), import API flow, CI run status, valuation
  timings, bugs #1–#3 reproduced, the FA/ADP data counts, git state.
* **Inferred from code (not exercised this session):** `--failed`/`--force` CLI flags, rebuild-only, Sleeper league
  import, Settings override round-trips, retry button, snapshots view, bugs #4/#5 impact.
* **Documented, not independently verified:** the historical numbers in §27 were produced earlier in this same
  project session by the audit scripts (reproducible with `npm run audit-model`), not re-run while writing this.
* **Doc/code discrepancies found (2.0.0 session; both fixed in 2.1.0):** `js/core/version.js` referenced a non-existent
  `js/core/schema.js`; the rookie-slot-curve `generated_at` predated its shape; `docs/MODEL_AUDIT.md` doesn't mention bug #1 (added to its §20
  with this handoff); README/docs didn't mention that there was no lint command (resolved: `npm run lint` exists and
  is in the README). 2.1.0 session: §9 listed wrong state file names (fixed: `sources-status.json`,
  `quality-report.json`); the handoff skips from §35 to §38 (no §36–37).

## 40. Handoff quality check

Checked against: what the app is (§1), how to run it (§3), where code lives (§4, §33), data pipeline (§9), valuation
(§11–13), trade engine (§14), completed (§17), incomplete (§18, §34), broken (§19), tried (§21, §27), next (§35, PICK
UP HERE), not to change casually (§7, §22). Commands in §3 exist in `package.json` or as documented CLI flags; paths
were listed from the repository tree.

## 41–42. Maintaining this handoff

Keep it a project-state document, not a code dump: summarize and link to files. **Standing owner instruction
(recorded in `CLAUDE.md`): after ANY change to the project, update `docs/CLAUDE_CODE_HANDOFF.md` in the same commit
so it reflects the current status.** Pay particular attention when:

* architecture changes, or major features are added/removed
* formulas or defaults change (with the `model_version` bump)
* data sources are added, removed, disabled or break
* important bugs are discovered or resolved (§19)
* priorities, the PICK UP HERE section, or blockers change

At minimum, refresh §2 (status), §19 (bugs), §34–35 (backlog/next steps), PICK UP HERE and §38 (git state). This rule
is also recorded in `CLAUDE.md`.
