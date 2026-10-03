# Bug fix history

Concise list of meaningful fixes. Details, reproduction and verification: [BUG_AUDIT.md](BUG_AUDIT.md) (audit IDs) and
[CLAUDE_CODE_HANDOFF.md](CLAUDE_CODE_HANDOFF.md) §19 (pre-audit bugs #1–#13).

| Issue | Root cause | Fix | Regression test | Affected components |
|---|---|---|---|---|
| A1 Path traversal served any repo file (`/js/..%2f.env`) | allow-list checked on raw URL, file read from decoded path | check decoded, normalized path inside ROOT | server.test "static files…" | server/index.js |
| A2/A3 Malformed `%`-escape or Host header crashed the server | unawaited rejection; URL parsed outside `try` | `return await`; parse inside `try` | server.test "malformed requests…" | server/index.js |
| A4 Cross-site pages could POST to the local API | no Origin/Content-Type/Host checks | same-origin + JSON + loopback Host | server.test CSRF / rebinding | server/index.js |
| A5 Client could set a saved trade's id | body spread after server fields | server fields last, unique ids | server.test "saved trades…" | server/index.js |
| A6 `null`/array bodies → 500; garbage profiles stored | no body shape validation | 400 for non-object bodies/invalid profiles | server.test "API: non-object…" | server/index.js |
| B1 Concurrent rebuilds failed (ENOENT) | colliding temp names; no lock | unique temp names; serialized rebuilds | sync.test "concurrent rebuilds…" | server/lib/store.js, sync-engine.js |
| C1 Early sync failure shown as success | progress published late, never on error | publish first; `phase: failed` | sync.test "a sync that fails early…" | sync-engine.js, js/ui/sync.js |
| C2 One corrupt JSON file broke the app | parse errors thrown to every caller | move aside, fall back, report | sync.test "corrupt state…" | server/lib/store.js, data view |
| I1 Rows flagged as errors were imported | commit ignored error-level issues | error rows marked invalid | ingestion.test "import validation…" | js/core/import/mapper.js |
| I2 `0,85` parsed as 85 | all commas stripped | decimal vs thousands comma | ingestion.test "numbers…" | js/core/util/csv.js |
| I3 CSV formula injection | cells written verbatim | prefix `=+-@` text with `'` | ingestion.test "CSV export…" | js/core/util/csv.js |
| I4 Overwrite logged a 409 | conflict found by failing request | confirm from the preview | browser workflow | js/ui/views/data.js |
| I5 `+12.3%` prefixed (audit regression) | I3 rule too broad | keep numeric-looking text | ingestion.test (extended) | js/core/util/csv.js |
| ID1 Name match beat contradicting birth date/age/draft year (Critical) | no contradiction check | `identityConflict` → unmatched for review | identity.test (3) | js/core/identity.js |
| ID2 Team outranked birth date in disambiguation | filter order | birth date → age → draft year → team | identity.test "birth date outranks…" | js/core/identity.js |
| P1 Impossible picks valued (1.13, slot 0, drafted class) | no descriptor validation | `validDescriptor`; parser/id checks | valuation.test "impossible picks…" | picks.js, pick-labels.js |
| P2 Future pick values inverted at round boundaries (model 2.1.2) | per-round market scaling | isotonic per season | valuation.test monotonicity property | js/core/valuation/picks.js |
| T1 Two identical generic picks impossible | id-based de-dup/removal | repeatable generic picks; remove by index | E2E duplicate picks | js/ui/views/trade.js |
| U1 Player modals stacked; stale `#/player` URL | no single-modal rule | one modal; restore hash | E2E modals | player-modal.js, dom.js |
| U2 Dialog focus lost / Tab escaped | no focus management | restore + Tab loop | E2E modals (indirect) | js/ui/dom.js |
| L1 Hostile stored settings crashed/garbled valuations | engine trusted input; Sleeper import unvalidated | `sanitizeLeague`; validate Sleeper import | valuation.test "hostile profiles…" | settings.js, engine.js, settings view |
| D1 Offseason projected the finished season | Sleeper `season` = completed season while off | use `league_season`; consistent calendar fallback | sync.test "season transitions…" | server/sync-engine.js |
| UI1 Corrupt localStorage broke pages permanently | shape never checked | `load(key, fallback, valid)` | E2E corrupt storage | js/ui/state.js + views |
| UI2 Pages scrolled sideways on phones | unwrapped tables; `1fr` grid | `.table-wrap`; `minmax(0,1fr)` | E2E per-route overflow | model/data views, app.css |
| SY1 Invalid values stored despite "skipped" | verdict and storage used different data | shared rule + `cleanBatch` before storage | sync.test "stored batches…" | quality.js, sync-engine.js |
| SY2 Duplicate source records stored | no de-dup | keep first per player/variant | same | quality.js |
| SY3 Empty response called "format changed" | schema check on empty batch | `no_records` | same | quality.js |
| SR1–SR3 Search duplicates, suffixes, team-code prefixes | merge without de-dup; suffix tokens; strict team filter | de-dup, drop suffixes, team-or-prefix | search.test (3) | js/ui/search.js |
| O1 Raw "Failed to fetch" on server loss | network error shown verbatim | plain-language message | browser check | js/ui/sync.js |

**Audit 2 (2026-10-03)** — details in [BUG_AUDIT.md](BUG_AUDIT.md) §A2.5.

| Issue | Root cause | Fix | Regression test | Affected components |
|---|---|---|---|---|
| R1 Parallel trade saves lost saves (20 → 3) | read-modify-write of one JSON file without serialization | per-file `updateJSON` queue for trades, overrides, source status | server.test "audit 2: parallel saved-trade writes…" | server/lib/store.js, server/index.js |
| E1 Non-list FLEX eligibility crashed every page | `sanitizeLeague` skipped `flex_eligibility` | list of real positions, else the default | robustness.test E1 | js/core/settings.js |
| UI4 A second tab erased teams/profiles saved in the first | each tab wrote back its stale in-memory list | changes start from stored lists; `storage` event sync | teams.test "another tab's saves…" | js/ui/state.js, js/app.js |
| E2 Clearing a model setting set it to 0 / crashed | form stored `null`; merged over the default untyped | cleared field removes the override; type-checked overrides | robustness.test E2 | js/core/settings.js, settings view |
| E3 Extreme parameters hung, ran out of memory, went negative | no engine-side bounds; form limits only hints | `MODEL_BOUNDS`/`clampModel`; form clamps with a toast | robustness.test E3 | js/core/settings.js, settings view |
| SY6 Sync erased a status written while it ran | whole status object written back | merge only fetched sources via `updateJSON` | sync.test "a status written while a sync runs…" | server/sync-engine.js, server/import-service.js |
| I6 Large unknown-name imports froze the server | names re-normalized per record; no size limit | cached name keys, exact length-ratio skip; 20,000-row cap | ingestion.test (row cap) | js/core/identity.js, js/core/import/mapper.js |
| UI6 Empty redraft after the season, unexplained | correct model, no empty state | banner explaining it + "Switch to Dynasty" | browser check | js/app.js |
| R7 Other-schema data read as current | schema versions never read | rebuild/skip/refuse on mismatch | server.test (schema 99) | server/index.js, dataset-builder.js, js/ui/api.js |
| SY5 Duplicate snapshots of one data version | snapshot written on every rebuild | skip when that version exists | sync.test SY5 | server/sync-engine.js |
| I7 Import with no valid rows "succeeded" | no empty check | 400, nothing changed | server.test "audit 2: an import with no valid rows…" | server/import-service.js |
| I8 UTF-16/Latin-1 files misread | file read as UTF-8 text | `decodeImportBytes` (BOM, UTF-8, Windows-1252) | ingestion.test (encodings) | js/core/util/csv.js, mapper.js, data view |
| R2 `?cid=__proto__` returned an internal object | inherited key lookup | own keys only | server.test | server/index.js |
| R3 Identity overrides accepted garbage | no body validation | string key + existing cid or ignore, else 400 | server.test | server/index.js |
| R4 Invalid PORT → stack trace | unvalidated env | warning + default; same for auto-refresh hours | launch check | server/index.js |
| R5 Negative fetch timeout broke all downloads | unvalidated env | used only if ≥ 1,000 ms | live request | server/lib/http.js |
| R6 Broken/missing config gave unhelpful errors | bare parse error; `null` config | errors name the file and the restore step | launch check | server/lib/store.js, config.js |
| D2 Malformed dataset date nulled pick seasons | `new Date(garbage)` used | `datasetAsOf` falls back to built_at/now | robustness.test D2 | js/core/settings.js, picks.js, context.js |
| EX1 Trade CSV untraceable to settings | settings only in JSON export | `SETTINGS` row | browser check | trade view |
| UI3 Imported profile named "undefined" | name not validated | trimmed name or "Imported league (file)" | browser check | settings view |
| UI5 "removeChild" console error on re-render | change handler re-rendered mid-render | render guard (blur, defer nested) | browser check | js/app.js |
| U3 Back left the player dialog open | route change ignored the dialog | close on other routes | browser check | js/app.js, player-modal.js |
| UI7 Saved-trade delete: no confirm, no name, silent failure | — | confirm, `aria-label`, toast | browser check | trade view |
| UI8 Empty trade saved; double-click saved twice | no guards | empty check, in-flight flag | browser check | trade view |
| UI9 Snapshot picker unlabeled, errors silent | — | `aria-label`, error shown | browser check | player-modal.js |
