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
