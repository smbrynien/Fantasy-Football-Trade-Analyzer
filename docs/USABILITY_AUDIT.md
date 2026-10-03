# Usability, UX & Workflow Audit

*Second audit: 2026-10-03 · App 1.0.0 · Model 2.3.0 (unchanged by this audit) · Data `2026-10-03` (NFL week 4)*

This is the **product / usability** audit; the quantitative model audit is `docs/MODEL_AUDIT.md`. Feature-by-feature
evaluation (opportunity matrix, priorities, remove/simplify, ideal journey) is in `docs/FEATURE_AUDIT.md`.

The **first** usability audit (2026-10-02/03, friction log F-01–F-47, verdict-first result, Even it out, Share, My
Team, counteroffers…) is kept unchanged as **Appendix A** below. This second pass started from its conclusions and
re-audited the whole application as it stands after model 2.3.0, looking for what the first pass missed and for
problems introduced since.

**Method.** The app ran locally on the real synced dataset (2,206 players, 10/10 sources) and was driven with
Playwright (Chromium): every route × both modes × 1360 px and 390 px (72 page renders, measured for height, overflow,
unlabeled controls, nameless buttons, tap-target size and console errors), every player-dialog tab, 13 search queries
per mode and width, duplicate and cross-side adds, a real Sync All from the header and a Force full refresh from the
Data page (progress captured every 300–400 ms), manual import of a malformed and a valid KTC-style CSV, a share link
with unknown ids, corrupted browser storage, keyboard-only reach, and scenarios A–F (§5.3). Timings and positions were
measured by script. Not testable here: Safari/Firefox, real phones, screen readers, a live Sleeper league.

Severity: **High** = blocks or misleads a core job · **Medium** = slows a core job or erodes trust · **Low** = polish.

---

## 1. Executive summary

The first audit fixed the big structural problems (answer buried, numbers disagreeing, no way to balance or share a
trade, no roster context). The core trade workflow is now fast: a 1-for-2 trade on a phone takes **6 taps plus
typing**, the verdict is pinned on screen, and search answers in **≈1 ms per keystroke**.

This pass found a different class of problem: **places where the app quietly did something other than what the user
meant, or answered with data instead of an answer.**

* **Search could add the wrong player.** Search hid assets already in the trade, so typing "chase" + Enter a second
  time silently added **Chase Brown** instead of saying Ja'Marr Chase was already there; on the other side the same
  query just said "No matches". Pasting a roster with a repeated name did the same.
* **Switching mode threw the trade away** (trades are stored per mode): "how does this look in redraft?" meant
  re-typing every player.
* **Changing the league format changed the verdict with no explanation.** Josh Allen for Bijan Robinson is "Team B
  clearly ahead" in 1QB dynasty and "Close" in Superflex — the user only saw numbers jump (Scenario F).
* **Compare listed 18 rows of facts but never said who was ahead or whether the gap mattered.**
* **Small trust leaks**: "Remaining schedule: harder than average (×1.000 applied)" (schedule strength has been off
  since model 2.2.0), a literal "null" in the import preview, a silent redirect from #/rookies in redraft.
* **Phones**: the first search box sat at the bottom edge of the first screen; the dynasty pick picker added two rows
  per side before anyone needed it.
* **Information overload in the back office**: ~80 model parameters at the same level as "Teams"; Data quality opened
  with a 21-row table of "ok" batches, and the two items that needed a decision started at 1,495 px.

All of these were fixed (§15), with no change to any value or trade calculation (no file under `js/core`, `config` or
`server` changed in this batch). What remains is mostly polish plus two larger items: using the app from a phone
(it runs on the user's computer, §6) and merging the two near-duplicate data-source tables.

## 2. Current strengths

* **The trade answer comes first** and is honest: verdict levels follow how often trades with that margin actually
  worked out (redraft, model 2.3.0), with a market cross-check and the package arithmetic one click away.
* **"Next question" tools exist**: Even it out (single assets and two-asset combinations), counteroffer comparison,
  share as text or link, saved trades with Then/Now and "Why changed?".
* **Roster context is optional and objective**: My Team shows lineup value and expected lineup points before → after
  with a historical frequency, never "accept/decline".
* **Transparency**: every value decomposes into components; every source shows its timestamp; every analysis carries
  model version, data snapshot and settings hash.
* **Speed**: first usable trade screen 558 ms (52 requests, 823 KB), search 0.5–4 ms per keystroke over ~2,200
  players, mode switch 271 ms, Players page 161 ms.
* **Robustness**: corrupt storage recovered, unknown ids in a link dropped with a named toast, malformed CSV reported
  plainly ("Malformed CSV: unterminated quoted field"), failing sources quarantined while the last good data stays.
* **Sync dashboard** shows real per-source progress ("3/10 sources done", fetching/queued/ok per source).

## 3. Major usability problems

| # | Problem | Severity | Status |
|---|---|---|---|
| 1 | Search hid assets already in the trade, so Enter silently added a different player (G-01, G-02, G-03) | High | **Fixed** |
| 2 | League-format changes (1QB ↔ Superflex, league size, scoring) changed verdicts with no explanation (G-08) | Medium–High | **Fixed** ("This trade in other league formats") |
| 3 | Switching Redraft ↔ Dynasty discarded the trade being built (G-07) | Medium | **Fixed** (carried into the empty trade) |
| 4 | Compare gave data, not an answer (G-09) | Medium | **Fixed** |
| 5 | Settings presented model internals at the same level as league setup (G-19; first audit Tier 2 #4) | Medium | **Fixed** (folded away) |
| 6 | Data quality opened with a table of "ok" batches; the two decisions needed started at 1,495 px (G-21) | Medium | **Fixed** (summary first) |
| 7 | Phones: first search box at the bottom edge; pick picker clutter (G-17, G-18) | Medium | **Fixed** |
| 8 | Using it from a phone at all needs a terminal command documented in one README line (G-23) | Medium | **Partly** (Help explains; a safe "phone mode" is Tier 2) |

## 4. Major missing features

1. **Format comparison** — the same trade across saved leagues/presets (1QB vs Superflex is the most common reason
   two sites disagree). **Added** (lazy, 273 ms on real data).
2. **A stated answer on Compare** — who leads, by how much, and whether the gap is inside the combined ± range.
   **Added**.
3. **Mode carry-over** — see the same trade in the other mode in one click. **Added**.
4. **Nickname search** ("cmc", "jsn", "arsb", "btj") — **added** with a generic capital-letter rule (no hand-made list
   to maintain).
5. **Safe phone access** — the app runs on the user's computer; reaching it from a phone needs `HOST=0.0.0.0` (no
   authentication). Help now explains the steps and the risk; a read-only LAN mode is Tier 2 (FEATURE_AUDIT F45).
6. **Biggest movers / watchlist** — still not built (Tier 3); per-player Trends exist.

## 5. Workflow problems

### 5.1 Primary user jobs — how well they are supported now

| Job | Support | Remaining gap |
|---|---|---|
| Quick trade check | Verdict headline + historical frequency, pinned on phones; 6 taps + typing for a 1-for-2 | Phone access itself (G-23) |
| Deep analysis | Full breakdown, package math, per-asset "Why this value?"; player Overview now starts with the 3 biggest value drivers | Component names are still model terms (tooltips explain them) |
| Player comparison | Compare states the answer first (G-09) | No "show only rows where they differ" |
| Dynasty decision (player vs picks) | Value matches incl. picks; now-vs-future; age; pick search "2027 1st", "1.04"; inline custom slot range (G-16) | — |
| Trade exploration | Even it out, two-asset combinations, counteroffer table, other formats | — |
| Trade targeting | Players: Model − Market column, filters | No "positions where my roster is thin" view (F11, Tier 2) |
| Roster-aware analysis | My Team: lineup value, expected lineup points/week with frequency, starters in/out, depth | Sleeper draft picks not imported; byes not modelled |
| Weekly decision support | Player dialog (projection, range of outcomes, injury, usage) | Start/sit is out of scope (Do Not Build) |

### 5.2 Personas

* **Casual redraft manager** — reads one headline ("Leans your team — trades with this margin went your way about
  65% of the time") and stops. Unchanged; already good.
* **Serious redraft manager** — now gets the format comparison and the player's value drivers without opening the
  full breakdown.
* **Dynasty manager** — pick picker folded on phones, inline custom range, mode carry-over to check "win-now" value in
  redraft, other formats (1QB vs SF is the dynasty question).
* **Experienced dynasty manager** — Model − Market, sources, model settings still one click away ("Show model
  settings").
* **New user** — fewer things to read before the first search on a phone (context line shortened), a hint when a pick
  is searched in redraft, an explanation instead of a silent redirect for Rookies & Picks.
* **Mobile user** — see §6; the remaining blocker is reaching the app from the phone.

### 5.3 Scenarios A–F (walked in the browser)

| Scenario | What happened (before this pass) | After |
|---|---|---|
| **A** — trade offer on a phone | 6 taps + typing; pinned verdict "Close — roughly fair · A +760"; first search box at ≈810 px on first visit. Real-world caveat: the phone must reach the computer running the app (`HOST=0.0.0.0`), documented only in the README | First search box at 714 px; Help explains phone access and its risk; "Share → Copy text" works from any device |
| **B** — are two dynasty players close? | Compare: 18 rows, no answer | First line: "Ja'Marr Chase has the highest dynasty value (10,200)… Malik Nabers: 3,520 less (−34%) — a real gap: bigger than their combined ± range" |
| **C** — player vs several future picks | Search "2027 1st" (dynasty) works; in redraft "No matches" with no reason; custom range via a blocking prompt() | Redraft says picks are valued in Dynasty; inline range fields |
| **D** — stale data | Pill shows age; banner after 72 h; header button said only "Syncing…" | Header shows "Syncing 3/10…" / "Building…" with a tooltip pointing to the dashboard |
| **E** — one source fails | Unchanged and good: quarantine keeps last good data; dashboard and banner name it | Data quality now opens with a one-line verdict ("⛔ 1 of 21 batches failed… previous good data in use") |
| **F** — 1QB → Superflex | Values update instantly, verdict flips, no explanation | "This trade in other league formats": 1QB "Team B clearly ahead B +3,980" vs Superflex "Close A +570", one click |

### 5.4 Other workflow findings

* Mode switching keeps each mode's own trade; only an **empty** destination trade is filled (players only — picks are
  dynasty-only, and the toast says how many were left out). An existing trade in the other mode is never overwritten.
* Keyboard: reaching the first search box took **21 Tab presses**; **"/"** now jumps to the first empty side's search.
* The import wizard's sequence (choose source → instructions → file → mapping → validation → preview → import →
  rebuild) already matches the ideal; it printed a literal "null" after the mapping table and had unlabeled controls
  (both fixed). It warns once per row that KTC rows have no position (noise; open, Low).

## 6. Mobile problems

| Finding | Before | After |
|---|---|---|
| First search box on a first visit (390 × 844) | ≈810 px — at the bottom edge | 714 px (context description hidden on phones; badge + league + "Change league" stay) |
| Dynasty pick picker | 2 rows of selects on **each** side before use | Folded behind "+ Draft pick" (phones only; desktop unchanged) |
| Dynasty trade, verdict position (1-for-1) | 1,730 px | 1,372 px (and the pinned bar) |
| Search placeholder | Truncated mid-example | Shorter examples |
| Header in dynasty | Tabs wrap to 3 rows (≈210 px), not sticky | Open (Low) — "Rookies & Picks" could be shortened on phones |
| Reaching the app from a phone | Needs `HOST=0.0.0.0` from a terminal; no launcher option; link copies `localhost` | Help Q&A with steps and the security caveat; a safe read-only phone mode is Tier 2 |
| Horizontal page scroll | none on any of 36 phone renders | unchanged (E2E guards it) |

## 7. Accessibility issues

| Finding | Severity | Status |
|---|---|---|
| Import: source select, file input and paste box unlabeled; column-mapping selects unlabeled | Medium | **Fixed** (aria-labels naming the column) |
| Scoring: bonus-point inputs unlabeled (first audit F-42) | Low | **Fixed** ("Bonus points for rec_yd ≥ 100") |
| Search results: a disabled-looking entry must not be selectable | — | Marked `aria-disabled`, explained in the row text ("— already on Team A's side") |
| Compare remove "×" buttons had only a title | Low | **Fixed** (aria-label "Remove Ja'Marr Chase") |
| Keyboard reach to the first search: 21 Tabs | Low | **Fixed** ("/" shortcut; also in Help) |
| Compare answer and Data-quality summary | — | Announced (`role=status`) |
| Column-chooser checkboxes 13 px (WCAG 2.2 target size) | Low | Open |
| Charts have no text alternative (F-44) | Low | Open (Compare now states the result in text above the chart) |
| Nameless buttons / unlabeled inputs, all 72 renders | — | 0 after the fixes (crawl) |
| Real screen-reader pass | — | Not done (not available here) |

## 8. Performance issues

Measured on the local server with the real dataset (Chromium, desktop):

| Measure | Result |
|---|---|
| First usable trade screen | 558 ms (DOMContentLoaded 124 ms; 52 requests, 823 KB) |
| Search per keystroke | 4.2 ms first (builds the index), then 0.5–0.9 ms |
| Mode switch (re-valuation) | 271 ms |
| Players page | 161 ms |
| "This trade in other league formats" | 273 ms on first open (one valuation per format, cached afterwards); computed only when opened |
| Full sync (Force full refresh) | ≈10 s, per-source progress shown |

No performance problem affects a user. The new features were designed not to cost anything on the default path
(other formats and combinations are computed only when their section is opened).

## 9. Trust / transparency issues

| Finding | Status |
|---|---|
| "Remaining schedule: harder than average (×1.000 applied to production)" — contradicts itself since schedule strength was switched off (model 2.2.0) | **Fixed** (shown only when it changes something) |
| Literal "null" in the import preview | **Fixed** (and the cause — `append()` writing `null` — documented at the call) |
| Verdict flips between formats with no explanation | **Fixed** (other formats table) |
| Search silently substituting a different player | **Fixed** |
| ± vs range of outcomes (model 2.3.0) — the ± is source disagreement; the player view shows the calibrated range of outcomes | Already done in 2.3.0; Help explains both |
| Dynasty verdict still z-based ("about 2.3× the uncertainty") while redraft is outcome-based | Open — model question (no multi-season outcome data); wording is consistent within each mode |
| Ambiguous identity candidates sometimes show "dob ?" for one of two same-named players | Open (data) |

## 10. Information architecture issues

| Page | First | Second | Under "details" | Change in this pass |
|---|---|---|---|---|
| Trade | Verdict + totals | Market check, notes, Even it out, lineup impact (My Team) | Package math, **other formats**, full breakdown | + other formats; shorter context line on phones |
| Compare | **Who leads and whether the gap is real** | The comparison table | Aging chart (dynasty) | + answer line |
| Player dialog | Values, rank, ± and confidence | **Biggest value drivers**, projection, range of outcomes | Why / sources / stats / trends tabs | + drivers line; "Long-term" tab name in redraft; schedule row only when applied |
| Settings | Your league (League, Scoring, Roster) | — | **"Show model settings"** (auto-shown when a profile changes one) | Model group folded; "Data Refresh" tab removed (link → sync dashboard) |
| Data → Quality | **What needs attention** (failed batches, ambiguous players) | Identity resolution | Batch-by-batch table (collapsed unless something failed) | Summary first |
| Data → Sources | Duplicates the dashboard's per-source table with technical columns | — | — | Open: merge into the dashboard as expandable rows (Tier 2) |

## 11. Recommended improvements

Implemented items: §15. Recommended next (details in `FEATURE_AUDIT.md` §8):

1. **Safe phone access** (Tier 2): an opt-in "phone mode" that serves the app read-only on the LAN with a one-time
   pairing code shown in the start window, so a phone can check trades without exposing sync/import/settings.
2. **Merge Data → Sources into the Sync dashboard** (expandable rows: URL, method, fallback, terms).
3. **My Team: Sleeper draft picks and "Refresh from Sleeper"** (carried over from the first audit).
4. **Positional rank column on Players** (e.g. "5 · WR3"); show fewer default columns at ≤1360 px.
5. **Roster-need targeting**: from My Team, list positions where your expected lineup gains most from an upgrade.

## 12. Features worth adding

See `FEATURE_AUDIT.md` §2–§3: format comparison, compare answer, mode carry-over, nickname search (all added); safe
phone mode, roster-need targeting, biggest movers, merge of the data-source tables.

## 13. Features not worth adding

`FEATURE_AUDIT.md` §5 (unchanged conclusions, re-checked): a separate Quick Trade mode (the trade page already *is*
the quick path: 6 taps to a pinned verdict), a dashboard home page, buy/sell or accept/decline advice, acceptance
probabilities, push alerts, per-player value overrides, scenario sliders, AI chat, start/sit, decorative charts.

## 14. Features to simplify / remove

Done in this pass: ~80 model parameters folded behind one toggle; "Data Refresh" settings tab removed; Data quality's
all-"ok" table collapsed; phone context line shortened; phone pick picker folded; Compare's 18-row table now preceded
by its one-line answer. Recommended: merge Data → Sources into the dashboard; trim default Players columns.

## 15. Changes actually implemented

No valuation formula, default, engine or server file changed (`git diff -- js/core config server` is empty for this
batch): every asset value and trade calculation is unchanged by construction, so `model_version` stays 2.3.0.

| Change | Files | Measured effect |
|---|---|---|
| Search keeps assets already in the trade in the list, marked "— already on Team A's side" / "your roster" / "the comparison", not selectable; Enter on them explains instead of adding the next match | `js/ui/search.js` (`taken`), `trade.js`, `team.js`, `compare.js`, `css/app.css` | "chase" + Enter twice: Chase Brown added → nothing added, message shown |
| Paste roster: a repeated name is reported "already on your roster" instead of matching the next-best player | `team.js` | — |
| Nickname search by capital letters ("cmc", "jsn", "arsb", "btj"), ranked first; generic, no hand-made list | `search.js` (`capsKey`) | "cmc" → Christian McCaffrey (was: no results) |
| Redraft pick queries explain that picks are valued in Dynasty; shorter placeholders with examples | `search.js`, `trade.js` | — |
| Mode switch carries the trade into the other mode's **empty** trade (players only; toast says how many picks were left out) | `js/ui/state.js` (`setMode`), `trade.js` | re-typing a trade → 0 actions |
| **This trade in other league formats** — the same assets in every saved league and preset of the mode: totals, verdict, who leads; computed on open | `trade.js` | Allen for Bijan: 1QB "Team B clearly ahead B +3,980" vs SF "Close A +570"; 273 ms |
| **Compare answer**: leader, every gap (value, %), "about the same" when the gap is inside the combined ± | `js/ui/trade-helpers.js` (`compareSummary`), `compare.js` | Scenario B answered in the first line |
| Player dialog: "Biggest value drivers" first on Overview (with "why? →"); "Long-term" tab name in redraft; schedule row only when it changes something | `player-modal.js` | removes the "×1.000 … harder than average" contradiction |
| #/rookies in redraft: an explanation with "Switch to Dynasty" instead of a silent Trade page | `js/app.js` | — |
| Header Sync button shows real progress ("Syncing 3/10…", "Building…") | `js/app.js` | — |
| Settings: model parameters folded behind "Show model settings ▸" (remembered; always shown when the profile overrides one or a link targets them); "Data Refresh" tab removed, old links → sync dashboard; "Advanced / Debug" → "Display & reset" | `settings.js` | visible settings sections 10 → 4 by default |
| Data quality: summary first (batches, ambiguous players to resolve, unmatched records), identity resolution next, batch table collapsed unless something failed | `data.js`, `css/app.css` | ambiguous players to resolve: 1,495 → 742 px, and named in the first lines |
| Import: stray "null" removed; labels on the source select, file input, paste box and every column-mapping select | `data.js` | 3 unlabeled controls → 0 |
| Scoring: labels on bonus inputs | `settings.js` | 6 unlabeled inputs → 0 |
| Pick picker: inline custom slot range instead of `prompt()`; folded behind "+ Draft pick" on phones | `trade.js`, `css/app.css` | dynasty verdict on a phone 1,730 → 1,372 px |
| Phone context line: badge, league and "Change league" only | `trade.js`, `css/app.css` | first search box 810 → 714 px |
| "/" focuses the first empty trade side's search (or the page's search) | `js/app.js` | 21 Tab presses → 1 key |
| Help: "Can I use it on my phone?" (LAN steps, security caveat, share-text alternative, "/" tip) | `help.js` | — |

**Validation** (Part III below): unit tests 145 → 147 (`tests/search.test.js` nickname search,
`tests/trade-helpers.test.js` compare summary); E2E extended with 10 checks at 1360/721/390 px (duplicate search, "/",
other formats, mode carry-over, rookies in redraft, compare answer, folded settings, old Data Refresh link) — all pass;
lint clean; no console errors on any of 72 crawled renders.

## 16. Remaining opportunities

* Safe phone mode (read-only LAN with a pairing code) — Tier 2.
* Merge Data → Sources into the dashboard; trim Players' default columns; positional rank column.
* My Team: Sleeper draft picks + refresh; roster-need targeting.
* Dynasty verdict calibration (model audit); bye weeks in expected lineup points (model audit).
* Column-chooser checkbox size; chart text alternatives; phone tab rows in dynasty.
* Import: one summary line instead of a "no position" warning per row for sources without positions.
* Real-device, Safari/Firefox and screen-reader testing.

---

# Part II — Friction log (second audit)

Fields: **Where** · **Why it matters** · **Severity** · **Suggested improvement** · **Difficulty** · **Benefit** ·
**Status**. (First-audit items F-01–F-47 are in Appendix A.)

| ID | Issue | Where | Why it matters | Sev. | Suggested improvement | Diff. | Benefit | Status |
|---|---|---|---|---|---|---|---|---|
| G-01 | Search hid assets already in the trade; typing the same name + Enter added the *next* match (Ja'Marr Chase → Chase Brown) | Trade search | A wrong player silently enters the trade | High | Keep them listed, marked and unselectable | Low | High | **Fixed** |
| G-02 | A player already on the other side: "No matches" | Trade search | Looks like the player doesn't exist | Medium | "— already on Team A's side" | Low | Medium | **Fixed** |
| G-03 | Paste roster: a repeated line matched the next-best name | My Team → Paste | Wrong player on the roster | Medium | Report "already on your roster" | Low | Medium | **Fixed** |
| G-04 | Nicknames ("cmc", "jsn", "arsb", "btj") found nothing | All searches | Common fantasy shorthand | Low–Med | Capital-letter rule, exact, ≥3 letters | Low | Medium | **Fixed** |
| G-05 | "2027 1st" in redraft: "No matches" | Trade search | Dead end without a reason | Low | Explain picks are dynasty-only | Low | Low | **Fixed** |
| G-06 | Redraft placeholder had no examples; dynasty's was cut off on phones | Trade search | Discoverability | Low | Short examples | Low | Low | **Fixed** |
| G-07 | Switching mode showed an empty trade (trades stored per mode) | Header toggle | Re-typing every player to compare modes | Medium | Carry players into an empty trade | Low | Medium | **Fixed** |
| G-08 | Changing league format changed the verdict silently | Trade | "Why did it change / why does site X disagree?" unanswered | Med–High | Same trade in other formats, on demand | Low–Med | High | **Fixed** |
| G-09 | Compare showed 18 rows, no answer | Compare | Scenario B needs reading every row | Medium | Leader, gaps, within-± test, first | Low | High | **Fixed** |
| G-10 | "harder than average (×1.000 applied)" | Player Overview | Self-contradiction erodes trust | Low | Hide when not applied | Low | Low | **Fixed** |
| G-11 | Overview had facts but no "why" summary (F-33) | Player dialog | Most users never open the second tab | Low–Med | Top-3 value drivers + link | Low | Medium | **Fixed** |
| G-12 | #/rookies in redraft rendered the Trade page silently | Router | Confusing link target | Low | Explain + "Switch to Dynasty" | Low | Low | **Fixed** |
| G-13 | Header sync showed only "Syncing…" | Header | No idea how long it takes | Low–Med | "Syncing 3/10…" | Low | Medium | **Fixed** |
| G-14 | Literal "null" after the mapping table | Data → Import | Looks broken | Low | Filter optional nodes | Low | Low | **Fixed** |
| G-15 | Import controls and mapping selects unlabeled; bonus inputs unlabeled (F-42) | Import, Scoring | Screen readers | Low | aria-labels | Low | Low | **Fixed** |
| G-16 | Custom pick range via `prompt()` (F-46) | Pick picker | Blocking dialog, poor on phones | Low | Inline fields | Low | Low | **Fixed** |
| G-17 | Pick picker: 2 rows per side on phones before use | Trade, 390 px | Pushes the result down | Low–Med | Fold behind "+ Draft pick" on phones | Low | Medium | **Fixed** |
| G-18 | First search box at ≈810 px on a phone's first visit | Trade, 390 px | Primary action at the fold | Medium | Shorter context line on phones | Low | Medium | **Fixed** |
| G-19 | ~80 model parameters beside league settings (first audit Tier 2 #4) | Settings | Accidental model changes; overwhelming | Medium | Fold behind a toggle | Low | Medium | **Fixed** |
| G-20 | "Data Refresh" tab: a read-only table that only links to Data | Settings | Redundant navigation | Low | Remove; redirect | Low | Low | **Fixed** |
| G-21 | Data quality: a 21-row "ok" table first; the 2 ambiguous players at 1,495 px | Data → Quality | Actionable item below the fold | Medium | Summary first; collapse the table | Low | Medium | **Fixed** (742 px, and in the summary) |
| G-22 | 21 Tab presses to the first search; no shortcut (F-43) | Trade | Power users, keyboard users | Low | "/" shortcut | Low | Low | **Fixed** |
| G-23 | Phone use needs `HOST=0.0.0.0` (one README line); copied links say `localhost` | Whole app | Scenario A in real life | Medium | Help now; safe read-only phone mode later | Medium | High | **Partly** (Help) |
| G-24 | Data → Sources repeats the dashboard's source table with technical columns | Data | Two places, same job | Low | Expandable rows in the dashboard | Medium | Low | **Done** (2026-10-03, fourth session: one source table on the dashboard, names open the details; `#/data/sources` lands there) |
| G-25 | Players: 12 default columns; the last is cut at 1360 px | Players | Scanning effort | Low | Fewer defaults | Low | Low | **Done** (fourth session: 12/11 defaults fit 1360 px; headers wrap below 1300 px so 1024 px fits too) |
| G-26 | Players: overall rank only; no positional rank column | Players | Fantasy users think "WR12" | Low | "5 · WR3" | Low | Low | **Done** (fourth session: Rank column and CSV) |
| G-27 | Dynasty header: 3 rows of tabs on phones (≈210 px) | Header, 390 px | Space | Low | Shorter tab labels on phones | Low | Low | Open |
| G-28 | Dynasty verdict is z-based, redraft outcome-based | Trade | Different meaning of "clearly" across modes | Low | Calibrate dynasty (needs outcome data) | High | Medium | **Done** (model 2.4.0, audit E15: dynasty levels from a 3-season outcome frequency) |
| G-29 | Data-page sync buttons stay enabled while a sync runs | Data | A second click only gets "already running" | Low | Re-render on progress | Low | Low | Open |
| G-30 | Column-chooser checkboxes 13 px | Players | Target size | Low | Larger hit area | Low | Low | Open |
| G-31 | KTC-style import: a "no recognised position" warning per row | Import | Noise hides real warnings | Low | One summary line | Low | Low | Open |
| G-32 | Ambiguous identity candidates sometimes "dob ?" | Data → Quality | Harder to choose | Low | Show team/draft year instead | Low | Low | Open (data) |

---

# Part III — Before/after validation

| Area | How validated | Result |
|---|---|---|
| Desktop + phone, both modes | Crawl of 18 routes × 2 modes × 2 widths before and after | 0 console errors, 0 page overflow, 0 nameless buttons, 0 unlabeled inputs after |
| First-time user (phone) | Cleared storage, 390 × 844 | First search box 810 → 714 px |
| Power user | Keyboard: "/" to search (E2E), Enter on a taken result (E2E) | ✓ |
| Redraft / dynasty | Mode carry-over (E2E), rookies-in-redraft panel (E2E), dynasty pick picker on phones | ✓ |
| Trade construction | Duplicate search (E2E), paste with a repeated name, nickname search (unit) | ✓ |
| Player comparison | Compare answer (E2E fixture; real data: Chase vs Nabers "a real gap") | ✓ |
| Draft picks | Inline custom range, search "2027 1st"/"1.04", redraft hint | ✓ |
| Sync | Real header Sync All and Force full refresh on real sources (10/10 ok, ≈10 s), header progress label | ✓ |
| Manual import | Malformed CSV (clear message), KTC-style CSV (2 matched, 1 unmatched, 1 pick), no stray "null" | ✓ |
| Saved data / corrupt storage | Existing E2E (corrupt localStorage, saved trades) | ✓ |
| Trade calculations | No file under `js/core`, `config` or `server` changed → values and analyses identical by construction; `npm test` 147/147 | ✓ |
| Responsive / stray text | E2E at 1360/721/390 px on every route | ✓ |
| Lint | `npm run lint` | clean |

---

# Product-management summary

**The 5 biggest usability problems (this pass)**
1. Search could silently put the wrong player into a trade or roster. *Fixed.*
2. League-format changes flipped verdicts with no explanation. *Fixed (other formats table).*
3. Switching mode threw away the trade being built. *Fixed.*
4. Compare and Data quality showed data instead of an answer. *Fixed.*
5. Using the app from a phone requires exposing the local server from a terminal. *Partly (Help); Tier 2.*

**The 5 highest-value features to add**
1. Same trade in other league formats — *added*.
2. A stated answer on Compare — *added*.
3. Safe read-only phone mode with a pairing code — Tier 2.
4. Roster-need targeting from My Team (positions where an upgrade raises expected lineup points most) — Tier 2.
5. Biggest movers (objective 7-day value/market changes; no buy/sell labels) — Tier 3.

**5 things simplified / to simplify**
1. Model parameters folded behind "Show model settings" (*done*).
2. "Data Refresh" settings tab removed (*done*).
3. Data quality: summary first, "ok" table collapsed (*done*).
4. Phone: context line and pick picker trimmed (*done*).
5. Merge Data → Sources into the dashboard; fewer default Players columns (recommended).

**What would make the trade workflow dramatically faster?** It is already near the floor (search + Enter per asset,
verdict pinned). What remained was *rework*: re-typing a trade to see the other mode (fixed), re-building it in another
league to understand a format difference (fixed), and recovering from a silently wrong search pick (fixed). Next:
reaching it from the phone where offers arrive.

**Dynasty managers** — the format comparison (1QB vs Superflex is *the* dynasty pricing question), pick search and
inline ranges, now-vs-future, and mode carry-over to see win-now value; next: a calibrated dynasty verdict and Sleeper
picks on My Team.

**Redraft managers** — the outcome-based verdict and expected lineup points/week with My Team; next: roster-need
targeting and phone access.

**What most improves trust in the numbers?** Never doing something other than what the user asked (search), saying why
a number changed (formats, "why changed?"), and no self-contradicting lines (schedule ×1.000, "null"). Keep the ± /
range-of-outcomes distinction explicit.

**What should NOT be built** — a separate Quick Trade mode, a dashboard home page, buy/sell or accept/decline advice,
acceptance predictions, push alerts, per-player overrides, scenario sliders, AI chat, start/sit, decorative charts
(`FEATURE_AUDIT.md` §5).

---


# Appendix A — First usability audit (2026-10-02/03, model 2.1.2)

*Date: 2026-10-02/03 · App 1.0.0 · Model 2.1.2 (unchanged by this audit) · Data 2026-10-02 (NFL week 4)*

This is the **product / usability** audit. The quantitative model audit is separate (`docs/MODEL_AUDIT.md`); where a
usability finding turned out to be a model question it is recorded here and handed to that audit, not changed.
Feature-by-feature evaluation (opportunity matrix, priorities, remove/simplify, ideal journey) is in
`docs/FEATURE_AUDIT.md`.

**Method.** The app was run locally on a copy of the real synced data and driven with Playwright (Chromium) at
1360 × 900 (desktop), 721–800 px (tablet / small laptop) and 390 × 844 (phone): every route, the player and pick
dialogs, search, the pick adder, save / load / "why changed", share, print, settings, the Data pages and the
first-run empty state. Scenarios A–F of the brief were walked end to end (§5.3). Screen positions, timings, keyboard
behaviour and accessibility attributes were measured by script, not estimated. Not testable here: Firefox/Safari,
real phones (touch, iOS Safari), screen readers, a live Sleeper league.

Severity: **High** = blocks or misleads a core job · **Medium** = slows a core job or erodes trust · **Low** = polish.

---

### 1. Executive summary

The analytical core is strong: league-specific values, explicit uncertainty, a package adjustment, separate market
and model signals, a reproducibility record and "why did this change". The weaknesses were in **presentation and
workflow**, not in the numbers:

* The trade result **led with data, not the answer.** Five KPI cards (three of which disagreed with each other:
  −6,160 model, −8,300 market, −10,990 projection) and two tables came before a one-line "Interpretation". On a
  phone the answer was 1,833 px down — more than two screens below the players just added.
* **Numbers that should match didn't.** The side totals showed raw sums (14,680) while the bars, verdict and export
  used package-adjusted totals (11,640). A lone player in an unfinished trade was shown at 29% of his value.
* The app answered "is it fair?" but **not the next question — "what would make it fair?"** There was no way to
  find assets of similar value except trial and error.
* **No way to share** a trade (link or text) — the most common thing people do with a trade analysis.
* Keyboard and screen-reader users could not open players from the table or the trade list, sort columns, or hear
  the search suggestions.
* Settings put ~80 model parameters on the same level as "number of teams".

The highest-value fixes were implemented (§15): a verdict-first result with the breakdown one click away; totals
that match everywhere; **"Even it out" / "Value matches"** (exact, package-aware value matching); share as text or
link; a pinned verdict bar on phones; a model-vs-market column; grouped settings; a "why changed" dialog; a set of
accessibility fixes; and — the largest missing piece — an optional **My Team** roster with **lineup impact** ("your
starting lineup value 31,940 → 33,290; projected points/game 97.9 → 102.0; into your lineup: X, out: Y") and
"You / Them" wording. All 24,892 asset values and all 2,393 sampled complete trades are numerically unchanged.

The largest remaining gaps are a side-by-side counteroffer view and multi-asset value matches — see §16 and
`FEATURE_AUDIT.md`.

### 2. Current strengths

* **League-specific values** with clear provenance: every value is decomposed ("Why this value?"), every source is
  visible with its timestamp, and every saved trade records model version, data snapshot and settings hash.
* **Honest uncertainty**: ± ranges per asset, combined uncertainty per trade, and a verdict that says "close" rather
  than inventing a winner when the gap is inside the noise. It never says "good/bad trade".
* **Market vs model kept apart** — the right foundation for trust and for buy/sell discovery.
* **Fast**: first usable screen ≈0.6 s locally, search ≈0.2–5 ms per keystroke over ~2,200 players, mode switch
  ≈0.3 s (§8).
* **Robust**: works offline, read-only mode without the engine, corrupt-storage recovery, quarantine of bad source
  data (see `docs/BUG_AUDIT.md`).
* **Search** understands names, partial names, suffixes, team + position ("det rb") and pick expressions
  ("2027 1st", "1.04").
* **Pick model UX**: exact slot, early/mid/late, unknown, custom range; generic picks can be added twice.
* Saved trades re-check themselves against today's data ("Then / Now", "Why changed?").

### 3. Major usability problems

(Detail and status for each in the friction log, Part II.)

| # | Problem | Severity | Status |
|---|---|---|---|
| 1 | Verdict buried below KPIs/tables; on phones 1,833 px down (F-02, F-03) | High | **Fixed** |
| 2 | Side totals (raw) contradicted bars/verdict (adjusted) (F-01) | High | **Fixed** |
| 3 | No guidance on making a lopsided trade fair, or on what an asset is "worth" in trade terms (F-04, F-05) | High | **Fixed** |
| 4 | Core interactions not keyboard/screen-reader accessible (F-23–F-26) | High | **Fixed** |
| 5 | No roster context: values are generic for the league format (F-34) | High | **Fixed** (optional My Team + lineup impact) |
| 6 | Unfinished trades charged a package adjustment; pick-for-player note mislabelled the consolidating side (F-11, F-12) | Medium | **Fixed** |
| 7 | Settings: model internals presented as peers of league setup (F-19) | Medium | **Fixed** (grouped) |
| 8 | No share/export path suited to a league chat (F-06) | Medium | **Fixed** |

### 4. Major missing features

1. **Roster context / My Team** (brief §9–11): which of *my* starters change, starting-lineup value before/after,
   positional depth. Was not present at all — **added** (optional; manual, paste or Sleeper import; lineup impact
   on the trade page; one-click "Trade" from the roster; "From my roster" quick-add).
2. **Value matching / "what would make this close?"** (§13, §54) — **added** (Even it out / Value matches).
3. **Share** (link + text summary) — **added**.
4. **Model-vs-market divergence view** (§56) — **added** as a sortable Players column.
5. **Counteroffer comparison** (§14): comparing several variants side by side. Partly covered (save/load, swap,
   Even it out); a true side-by-side is Tier 2.
6. **Perspective** ("Your team / Their team" instead of Team A/B) — **added** ("Which side is you?", detected from the roster).
7. **Watchlist / value-movement view** (§26) — Tier 3; history exists per player, there is no cross-player
   "biggest movers" list.

### 5. Workflow problems

#### 5.1 Primary user jobs — how well they are supported

| Job | Before | After | Remaining gap |
|---|---|---|---|
| Quick trade check (phone) | Possible, but the answer was 2+ screens down | Verdict headline first; pinned verdict bar on phones | — |
| Deep analysis ("why do the sides differ?") | Good (components, signals, package math) but all shown at once | Same content under "Full breakdown" | Component labels still technical |
| Player comparison | Compare page; empty state was a dead end | One click to compare the assets of the current trade | — |
| Dynasty decision (player vs picks) | Trade page with picks; now-vs-future split | Value matches include generic picks | Player + pick combinations not suggested |
| Trade exploration | Trial and error | Even it out / Value matches (single assets) | Multi-asset combinations, counteroffer table |
| Trade targeting | Players table sortable by value/age | + Model − Market column (sortable); My Team depth by position | No automatic "excess at position X" suggestions |
| Roster-aware analysis | **Not supported** | My Team: best lineup, lineup value and projected points before → after, starters in/out, depth, roster-limit warning | Picks owned aren't imported from Sleeper (add by search) |
| Weekly decision support | Player dialog (projection, injury, trends) | unchanged | Start/sit is out of scope (Do Not Build) |

#### 5.2 Personas

* **Casual redraft manager** — wants one sentence. Previously had to parse five KPIs; now reads a headline
  ("Team B clearly ahead — receives 6,160 more (53%)…") and can stop.
* **Serious redraft manager** — wants evidence. Everything is still one click away ("Full breakdown"), plus the
  market cross-check line and exact package math.
* **Dynasty manager** — now-vs-future and age stay visible (not hidden in the breakdown); value matches include
  picks; My Team shows the roster's value-weighted age and picks. Missing: a multi-year roster timeline.
* **Experienced dynasty manager** — the Model − Market column is the main new tool; source-level detail unchanged.
* **New user** — the welcome card is now 3 short lines (was 510 px tall on a phone and could not be brought back;
  now restorable from Help). Jargon (replacement level, σ, z) is confined to the breakdown and Model page; Help
  explains the verdict words, "Even it out" and sharing.
* **Mobile user** — see §6.

#### 5.3 Scenarios A–F (walked in the browser)

| Scenario | Before | After |
|---|---|---|
| **A** — trade offer on a phone | 3 searches + Enter each (fast), then scroll ~1,830 px past both lists and five KPI cards to find "Interpretation". | Same 3 searches; the verdict is pinned to the bottom of the screen as soon as both sides have assets ("Team B clearly ahead · B +6,160 — details ↓"), tap to jump. Header scrolls away (was 170 px fixed). |
| **B** — are two dynasty players close? | Trade page (2 searches) or Compare. Answer correct but buried. | Headline answers directly ("Close — roughly fair" + gap vs uncertainty). Well under a minute. |
| **C** — player vs several future picks | Pick adder (year/round/slot) per pick, or search "2027 1st". Worked; "Team A consolidates" note was wrong for pick-for-player. | Note fixed. With only the player entered, **Value matches** lists generic picks/players of similar value. |
| **D** — stale data | Banner after 72 h, data pill colour, Sync All. On phones/tablets the pill was a bare coloured dot. | Pill shows the age ("6 h") at every width and has an accessible label. |
| **E** — one source fails | Verified in the bug audit: banner names stale sources, last good data used, Data page shows the failure. Clear. | unchanged |
| **F** — 1QB → Superflex | Change the dropdown; values update instantly. No "what changed" view across settings. | Dropdown grouped by mode; context line names the active league above the trade. A settings-comparison view is Tier 3 (scenario analysis). |

#### 5.4 Other workflow findings

* Building a normal trade takes **one search + Enter per asset**, keyboard-only — already near the ideal in brief §5.
* Opening a shared link while building another trade asked nothing and would have overwritten it — now confirms.
* "Why changed?" was a 12-second toast with several lines of text — now a dialog with a Then/Now/Drivers table.
* Export downloaded two files at once (CSV + JSON) — kept (reproducibility), but moved into a labelled Share menu.

### 6. Mobile problems

| Finding | Before | After |
|---|---|---|
| Verdict position (390 × 844, 1-for-2 trade) | 1,833 px from top | 1,385 px, **and** pinned verdict bar always visible |
| Page length of the trade view | 3,484 px | 2,724 px (breakdown collapsed) |
| Welcome card height | 510 px | 376 px; trade builder now starts at 574 px (inside the first screen) |
| Sticky header | 170 px of every screen | scrolls away on phones (and on landscape phones ≤560 px high) |
| Data freshness | coloured dot only | "6 h" + accessible label |
| Suggestion chips | n/a | full-width on phones |
| No horizontal page scroll | ✓ (fixed in the bug audit) | ✓ re-verified on every route (E2E) |

Remaining: the player dialog's six tabs scroll horizontally on a phone (acceptable, but "Overview / Why this value?"
are the only two most people need); settings forms are long on phones.

### 7. Accessibility issues

| Finding | Severity | Status |
|---|---|---|
| Players table rows and sort headers were mouse-only (`tr onclick`, `th onclick`) | High | **Fixed**: focusable, Enter opens / Enter-Space sorts, `aria-sort` |
| Trade asset names were `div onclick` (not focusable) | High | **Fixed**: real buttons |
| Mobile player cards not focusable | Medium | **Fixed**: `role=button`, Enter/Space |
| Search suggestions not announced (no combobox semantics) | Medium | **Fixed**: `role=combobox`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-selected` |
| 7 unlabeled filter inputs on Players, 6 on Scoring settings, 3 on Import | Medium | Players **fixed**; Scoring/Import number fields are wrapped in labels without text for table cells → open (Low) |
| Mode toggle used `role=tab` without tab panels | Low | **Fixed**: `aria-pressed` toggle buttons |
| No `<h1>` | Low | **Fixed** (visually hidden) |
| Focus ring missing on links, `summary` and focusable rows | Low | **Fixed** |
| No reduced-motion handling (spinning sync icon, smooth scrolling) | Low | **Fixed** (`prefers-reduced-motion`) |
| Colour-only meaning | — | Verdict, trend and diffs always carry text/sign as well as colour ✓ |
| Dialogs: focus trap, Escape, focus return | — | ✓ (bug audit) |
| Charts have no text alternative | Low | Open (values are also in tables next to them) |
| Screen-reader pass with a real reader | — | **Not done** (not available here) |

### 8. Performance issues

Measured on the local server with the real dataset (2,208 players), Chromium, desktop:

| Measure | Result |
|---|---|
| First usable trade screen | ≈590 ms (DOMContentLoaded 106 ms; 48 requests, 807 KB, of which the dataset is 638 KB) |
| Search per keystroke | 4.8 ms first (builds the index), then 0.2–0.9 ms |
| Mode switch (re-valuation) | ≈280 ms |
| Players page (both modes valued) / "Show more" | ≈190 ms / ≈190 ms |
| "Even it out" (80 exact trade analyses) | ≈40 ms redraft, ≈7 ms dynasty (Node, real data) |

No performance problem affects a user. Minor waste: the trade view recomputes the analysis three times per change
(two side headers + summary) — negligible (<5 ms) and kept for simplicity. The dataset (638 KB) is the only large
transfer and is cached by the valuation cache.

### 9. Trust / transparency issues

| Finding | Status |
|---|---|
| Totals that disagree on screen (raw vs adjusted) | **Fixed** — one number everywhere; "before package adj." shown under it |
| "Signals compared separately" totals were larger than the trade totals with no explanation | **Fixed** — the table says these are each signal *on its own*, before blending and before the package adjustment |
| No quick cross-check against the market | **Added** — "Market check: market values alone agree / call this close / favour the other team" |
| Pick-for-player note blamed the wrong side | **Fixed** |
| Lone player shown at a fraction of his value while building | **Fixed** (no package charge until both sides have assets) |
| "-0", "14.000000000000002 games", "null" on the Model page | **Fixed** (+ an E2E check for stray null/undefined/NaN on every page) |
| Value matches could read as advice | Worded as "value math, not a prediction of what anyone will accept" |
| "Why changed?" after a model upgrade | Dialog says when the model version changed, so model changes aren't mistaken for news |
| **Package charge on a star acquired for picks** (e.g. a WR1 for a 1st: −1,810 in dynasty) | **Open — model question**, handed to the quantitative audit: displacement is charged even when the incoming player would start over everyone. Not changed (model preserved). |

Already good: per-source timestamps, model version and data snapshot on every analysis and export, confidence
badges with reasons, the stale-source banner, quarantine messages.

### 10. Information architecture issues

What each page should communicate first, second, and what can hide (✓ = now true):

| Page | First | Second | Under "details" | Unnecessary |
|---|---|---|---|---|
| Trade | ✓ Verdict headline + totals | ✓ market check, notes, Even it out; dynasty now/future | ✓ KPIs, component and signal tables, package math, reproducibility | Five equally-weighted KPI cards (moved) |
| Players | value + rank for the active league | ✓ Model − Market, trend, confidence | column chooser, exports | — |
| Player dialog | value, rank, range, confidence | why this value | sources, stats, trends | — (6 tabs is the upper limit) |
| Settings | ✓ "Your league" (league/scoring/roster) | — | ✓ "Model — advanced" (banner, changed markers, reset) | — |
| Data | sync status, failing/stale sources | per-source detail | import, quality, snapshots | — |
| Model | how values are produced (5 bullets) | league structure | calibration, backtests | — |

Navigation: eight top-level tabs (+ Rookies in dynasty). Considered merging Compare into Players and Model into
Help; not done — both are distinct destinations and the tab bar fits at all widths since the bug-audit fix. The
brand link returns to Trade, which is the right home: it *is* "Build a Trade", and the context line now states the
mode, league and what the values mean. A separate dashboard home page was rejected (Do Not Build: an extra click
before the primary task).

### 11. Recommended improvements

Implemented items are in §15. Recommended next (detail and rationale in `FEATURE_AUDIT.md`):

1. ~~**Counteroffer table**~~ — *done* (§15).
2. ~~**Value matches with combinations**~~ (player + pick) — *done* (§15).
3. **Player dialog**: put "Why this value?" content summary on Overview; rename "Dynasty outlook" to "Long-term"
   in redraft.
4. **Label the remaining unlabeled number fields** (Scoring/Import tables); replace the pick "Custom range…"
   `prompt()` with inline fields.
5. **Sleeper draft picks** in the roster import (`traded_picks`), and roster refresh from Sleeper on demand.

### 12. Features worth adding

See `FEATURE_AUDIT.md` §2–§3 (High/Medium). In short: roster context and perspective labels (both now added),
counteroffer comparison, pick + player value matches, a biggest-movers view, settings comparison ("what if
Superflex?").

### 13. Features not worth adding

See `FEATURE_AUDIT.md` §5 (Do Not Build): buy/sell recommendations, acceptance-probability predictions, a dashboard
home page, real-time alerts/push, social features, user-adjustable per-player overrides of model values,
start/sit advice, AI chat, more chart types.

### 14. Features to simplify / remove

Done: five KPI cards → one headline (KPIs moved to the breakdown); four action buttons → "Share" menu; flat
10-tab settings → three groups; long welcome card → three lines; `prompt()` for team count → number field.
Recommended: see `FEATURE_AUDIT.md` §6.

### 15. Changes actually implemented

All in this session; no valuation formula or default changed (`model_version` stays 2.1.2).

| Change | Files | Measured effect |
|---|---|---|
| Verdict-first trade result: headline + sub-line, bars, market check, notes, Even it out; full breakdown collapsed (open state remembered; auto-opened for printing) | `js/ui/views/trade.js`, `js/ui/trade-helpers.js`, `css/app.css` | Desktop: verdict at 708 px (was 862 px, below the 900 px fold with the welcome card). Phone: 1,385 px (was 1,833) + pinned bar. Trade page 2,724 px tall (was 3,484) on a phone |
| Side totals = package-adjusted totals (raw shown underneath when different) | `trade.js` | totals, bars, verdict, text summary and export now agree (E2E check) |
| **Even it out / Value matches** — exact, package-aware single-asset matches for the short (or empty) side; generic picks only; free agents excluded; one click adds | `js/core/valuation/balance.js` (new), `trade.js` | 1-for-2 example: one click turned "Team B clearly ahead (−6,160)" into "Close (+700)" |
| No package adjustment while one side is still empty | `js/core/valuation/trade.js` | a lone player is shown at full value; complete trades: 0 of 2,393 changed |
| Pick-for-player note names the charged side | `trade.js` (core) | — |
| Share menu: copy text summary, copy link (`#/trade?m=…&a=…&b=…`), download CSV+JSON, print | `trade.js`, `js/app.js`, `js/ui/dom.js` (`copyText` with manual-copy fallback) | links open the same trade in the right mode; confirm before replacing a trade in progress |
| Pinned verdict bar on phones (hides when the verdict itself is on screen) | `trade.js`, `css/app.css` | 0 scrolling needed to see the verdict |
| Trade context line (mode badge, league, what the values mean, change link) | `trade.js`, `css/app.css` | mode + league visible next to every result |
| Saved trades: Then/Now as "B +6,160"; "Why changed?" dialog with Then/Now/Drivers table and model-change warning | `trade.js` | — |
| Players: **Model − Market** column (default on, sortable); keyboard rows/headers; labeled filters | `js/ui/views/players.js` | divergences sortable in one click |
| Search: combobox ARIA; positional rank in results ("MIN · WR7 · 27.3") | `js/ui/search.js` | — |
| Settings grouped: Your league / Model — advanced / App; advanced banner; "•" on changed sections; "Reset all model settings"; team count as a number field; "League type" wording | `js/ui/views/settings.js`, `css/app.css` | — |
| League dropdown grouped by mode (current mode first) | `js/app.js` | — |
| Compare: empty state offers the current trade's assets | `js/ui/views/compare.js` | — |
| Welcome card shortened; restorable from Help; Help Q&A for the verdict words, Even it out, sharing | `js/ui/views/help.js` | 510 → 376 px on a phone |
| Phones: header no longer sticky; data pill shows the age | `css/app.css`, `index.html`, `js/app.js` | +170 px of usable screen while scrolling |
| Accessibility: focusable asset names, `aria-pressed` mode toggle, `<h1>`, focus rings, reduced motion | several | §7 |
| **My Team** (`#/team`, new tab): optional roster per league profile — search-add, paste a list from any site, or import a Sleeper team (public API, no login); best lineup by slot (dedicated → FLEX → SF), bench, picks, projected points/game, depth, value-weighted age (dynasty); "Trade" button starts an offer with that asset (asks before mixing into an unrelated trade) | `js/core/roster.js` (new: `bestLineup`, `rosterImpact`), `js/ui/views/team.js` (new), `js/ui/state.js`, `index.html`, `js/app.js` | roster → offer in 1 click |
| **Lineup impact** on the trade page: lineup value and projected points/game before → after, starters into/out of the lineup, depth changes, "not on your roster" and roster-limit warnings | `trade.js` | e.g. "31,940 → 33,290 (+1,350) · 97.9 → 102.0 (+4.1) · Into your lineup: Puka Nacua · Out: Justin Jefferson" |
| **"Which side is you?"** (detected from the roster): every label becomes "Your team / Their team" (bars: You / Them), including engine notes; "From my roster" quick-add list on the side receiving your assets; "Even it out" suggests from your roster when you are the one who should add | `trade.js`, `js/ui/trade-helpers.js` (`sideNames`, `relabel`), `balance.js` (`only`) | adding your own players: pick from a list instead of typing |
| Polish bugs: "-0" values, "14.000000000000002 games", "null" on the Model page | `js/ui/dom.js`, `player-modal.js`, `model.js`, `settings.js` | E2E now fails on any stray null/undefined/NaN text |
| **Two-asset combinations** (Tier 2, F4) under Even it out / Value matches: "Two assets together" (collapsed, open state remembered) — player + pick, two picks (the same generic pick may appear twice), two players; exact `analyzeTrade` scores, package-aware; each asset in one combination only; the best even combination of each kind kept; from your roster when you are the side that adds | `balance.js` (`comboSuggestions`), `trade.js`, `css/app.css` | 50–85 ms on real data, only when opened. Dynasty Garrett Wilson for Puka Nacua ("B +2,520", clearly ahead): "2028 Early 3rd + 2027 Late 1st" → exactly even |
| **Counteroffer table** (Tier 2, F7, F-36): "+ Compare" keeps the current version (first = Original, then Counter 1…); table re-analyzes every version live — verdict, who gets more, adjusted totals, lineup impact with My Team; "+ added"/struck-through assets vs the original; unsaved current trade shown as a row with "+ Add"; Load / rename / remove / clear; up to 8 per mode in browser storage; cards on phones | `js/core/counteroffers.js` (new), `trade.js`, `css/app.css` | variants compared without save/load cycles |

**Validation** (before/after, see Part III): unit tests 103 → 122 (new `tests/balance.test.js`,
`tests/trade-helpers.test.js`, `tests/roster.test.js`, 2 trade tests); E2E smoke at 1360/721/390 px extended (share
link, Even it out, totals = bars, keyboard row → player, My Team → "Trade" → You/Them labels → lineup impact,
stray-text check on 13 routes) — all pass; lint clean; full value snapshot 24,892/24,892 identical; 2,393 random
complete trades identical before/after.

### 16. Remaining opportunities

* ~~Counteroffer table, combination value matches (Tier 2)~~ — done (§15, last rows).
* My Team: Sleeper draft picks and one-click refresh; roster per league is browser-only (not synced to the local
  server like profiles).
* Package charge on stars acquired for picks — quantitative audit.
* Real-device and screen-reader testing; Firefox/Safari.
* Player dialog summary-first layout; unlabeled table inputs in Scoring/Import.
* Biggest-movers / watchlist (Tier 3), settings what-if comparison (Tier 3).

---

## Part II — Friction log

Fields: **Where** · **Why it matters** · **Severity** · **Suggested improvement** · **Difficulty** · **Benefit** ·
**Status**.

| ID | Issue | Where | Why it matters | Sev. | Suggested improvement | Diff. | Benefit | Status |
|---|---|---|---|---|---|---|---|---|
| F-01 | Side totals showed raw sums; bars/verdict/export used package-adjusted totals (14,680 vs 11,640) | Trade, side headers | Two different "totals" for the same side destroys confidence in every number | High | Show the adjusted total; raw underneath when different | Low | High | **Fixed** |
| F-02 | Answer buried: 5 KPI cards (model −6,160, market −8,300, projection −10,990), then tables, then "Interpretation" | Trade result | Casual users can't find the answer; the KPIs appear to contradict each other | High | Headline verdict first; KPIs/tables under "Full breakdown" | Low | High | **Fixed** |
| F-03 | On a phone the verdict was 1,833 px below the top | Trade, 390 px | The phone quick-check (Scenario A) needed 2+ screens of scrolling | High | Pinned verdict bar; shorter page | Low | High | **Fixed** |
| F-04 | Lopsided trade: no way to see what would even it out | Trade | The natural next question after "unfair" had no answer; trial and error | High | Exact single-asset matches for the short side | Medium | High | **Fixed** |
| F-05 | "What is Player X worth in trade terms?" unsupported | Trade with one side filled | Common question (dynasty especially) | Medium | Value matches for the empty side | Low | High | **Fixed** |
| F-06 | No way to share a trade | Trade | Trades are discussed in league chats | Medium | Copy text summary; copy link | Low | High | **Fixed** |
| F-07 | Export always downloads two files | Trade | Surprising | Low | Keep (reproducibility), label clearly | Low | Low | **Mitigated** ("Download CSV + JSON" in Share) |
| F-08 | Five same-weight action buttons (Swap/Save/Export/Print/Clear) | Trade | Visual noise next to the answer | Low | Swap, Save, Share ▾, Clear | Low | Low | **Fixed** |
| F-09 | Active mode/league not stated near the result | Trade | "Why is this different from site X?" usually = different format | Medium | Context line with mode badge + league | Low | Medium | **Fixed** |
| F-10 | "Signals compared separately" totals larger than trade totals, unexplained | Trade breakdown | Looks like an error | Medium | Explain they are per-signal, pre-blend, pre-package | Low | Medium | **Fixed** |
| F-11 | Pick-for-player: "Team A consolidates" when A received a pick | Trade notes | Wrong statement | Medium | Name the side receiving extra players | Low | Medium | **Fixed** |
| F-12 | Unfinished trade: a lone player charged a package adjustment (7,209 → 2,126 on the bar) | Trade while building | Looks like the player is worth 70% less | Medium | No package until both sides have assets | Low | Medium | **Fixed** |
| F-13 | "-0" component value; "14.000000000000002 games" | Trade breakdown; player dialog | Sloppy numbers reduce trust | Low | Normalise −0; round game counts | Low | Low | **Fixed** |
| F-14 | Model page printed "null" under two backtest headings | Model | Looks broken | Low | Null-safe append + E2E guard | Low | Low | **Fixed** |
| F-15 | Welcome card 510 px on a phone; could not be brought back | Trade (first visit) | Pushes the builder below the fold; no way back without clearing storage | Medium | 3 short lines; restore button in Help | Low | Medium | **Fixed** |
| F-16 | Saved trades "Then/Now" as signed numbers (−6,160) | Trade → Saved trades | Sign convention must be remembered | Low | "B +6,160" | Low | Low | **Fixed** |
| F-17 | "Why changed?" = 12-second toast with multi-line text | Saved trades | Can't be read or compared before it disappears | Medium | Dialog with table | Low | Medium | **Fixed** |
| F-18 | One "Presets" list mixing redraft and dynasty presets | Header dropdown | Unclear which to pick | Low | Group by mode, current first | Low | Low | **Fixed** |
| F-19 | 10 settings tabs at one level; ~80 model parameters next to "Teams" | Settings | Invites accidental model changes; overwhelming | Medium | Group: Your league / Model — advanced / App; banner; changed markers; reset | Low | Medium | **Fixed** |
| F-20 | Custom team count via `prompt()` | Settings → League | Blocking browser dialog | Low | Number field 4–32 | Low | Low | **Fixed** |
| F-21 | "Default mode hint" | Settings → League | Jargon | Low | "League type" + tooltip | Low | Low | **Fixed** |
| F-22 | No model-vs-market divergence view | Players | Main trade-targeting signal missing | Medium | Sortable Model − Market column | Low | High | **Fixed** |
| F-23 | Players rows/sort headers mouse-only | Players | Keyboard users can't use the table | High | Focusable rows/headers, Enter/Space, aria-sort | Low | Medium | **Fixed** |
| F-24 | Trade asset names `div onclick` | Trade | Keyboard users can't open "Why this value?" | High | Buttons | Low | Medium | **Fixed** |
| F-25 | Unlabeled filter inputs | Players | Screen readers read "edit text" | Medium | aria-labels | Low | Medium | **Fixed** |
| F-26 | Search suggestions not announced | All searches | Screen-reader users can't pick a player | Medium | Combobox ARIA | Low | Medium | **Fixed** |
| F-27 | Mode toggle `role=tab` without panels | Header | Wrong semantics | Low | `aria-pressed` buttons | Low | Low | **Fixed** |
| F-28 | No `<h1>` | All | Heading navigation | Low | Hidden h1 | Low | Low | **Fixed** |
| F-29 | No reduced-motion support | All | Vestibular sensitivity | Low | Media query | Low | Low | **Fixed** |
| F-30 | Sticky 170 px header on phones | All, 390 px | 20% of the screen permanently used | Medium | Not sticky on phones | Low | Medium | **Fixed** |
| F-31 | Compare empty state: "Add players to compare." only | Compare | Dead end; usually you compare the trade's assets | Low | One-click "compare the assets in your current trade" | Low | Medium | **Fixed** |
| F-32 | Search results lacked positional rank | Search | Hard to pick between similar names / judge tier | Low | "MIN · WR7 · 27.3" | Low | Low | **Fixed** |
| F-33 | Player dialog: 6 tabs; "Dynasty outlook" shown in redraft | Player dialog | Some clutter; scrolls on phones | Low | Rename to "Long-term" in redraft; summary-first Overview | Low | Low | Open |
| F-34 | No roster / My Team context | Trade | Can't answer "how does this affect MY team?" | High | Roster per league + lineup before/after | Medium–High | High | **Fixed** (My Team, lineup impact) |
| F-35 | Sides only "Team A / Team B" | Trade | Users think "I give / I get" | Medium | Optional "You / Them" labels | Low–Medium | Medium | **Fixed** ("Which side is you?") |
| F-36 | Comparing counteroffers requires save/load cycles | Trade | Slow exploration of variants | Medium | Counteroffer table | Medium | Medium | **Fixed** (Compare counteroffers) |
| F-37 | Data pill = bare dot ≤960 px | Header | Freshness invisible on phones/tablets | Medium | Show age ("6 h") | Low | Medium | **Fixed** |
| F-38 | Shared link silently replaced a trade in progress | Trade | Lost work | Medium | Confirm | Low | Medium | **Fixed** |
| F-39 | Printing would omit the collapsed breakdown | Trade print | Incomplete report | Low | Open details on `beforeprint` | Low | Low | **Fixed** |
| F-40 | Package charge on a star acquired for picks (WR1 for a 1st: −1,810) | Trade (dynasty) | Feels wrong to experienced users | Medium | Re-examine displacement for players who would start | — | — | **Model audit** |
| F-41 | Dynasty signal table shows zeros for picks on one side | Trade breakdown | Looks like missing data | Low | Already footnoted; could hide rows when one side is picks only | Low | Low | Open |
| F-42 | Scoring / Import tables: number inputs without text labels | Settings, Data | Screen readers | Low | aria-labels from row/column | Low | Low | Open |
| F-43 | No keyboard shortcut to focus search | Trade | Power users | Low | "/" focuses the first empty side | Low | Low | Open (Tier 3) |
| F-44 | Charts have no text alternative | Player dialog, Model | Screen readers | Low | Summary sentence / aria-label | Low | Low | Open |
| F-45 | "Trade" on My Team would silently join an unrelated trade in progress | My Team | Surprising mix of offers | Medium | Ask: new trade or add | Low | Medium | **Fixed** |
| F-46 | Pick adder "Custom range…" uses a `prompt()` box | Trade (dynasty) | Blocking browser dialog, poor on phones | Low | Two inline number fields | Low | Low | Open |
| F-47 | Adding my own players to "their side" required searching names I already know | Trade | Slow; error-prone | Medium | "From my roster" list | Low | Medium | **Fixed** |

---

## Part III — Before/after validation

| Area | How validated | Result |
|---|---|---|
| Desktop trade (redraft 1-for-2, dynasty pick-for-player) | Playwright at 1360 px, screenshots before/after | verdict first, totals agree, no errors |
| Mobile trade | 390 × 844: positions measured, pinned bar, chips | §6 numbers |
| First-time user | cleared storage; welcome card, builder position | builder within the first screen on a phone |
| Power user | keyboard-only: search → Enter ×3, Players row → Enter, sort with Enter, Share menu | all reachable |
| Redraft / Dynasty | both modes, presets in both groups, `?m=` link switches mode | ✓ |
| Trade construction | add/remove/duplicate picks (E2E), Even it out click narrows the gap (E2E) | ✓ |
| Player comparison | Compare empty state → current trade assets | ✓ |
| Draft picks | "2027 1st" search, pick adder, value matches include generic picks only (unit test) | ✓ |
| Sync | unchanged code; `npm test` sync suite (13 tests) | ✓ |
| Manual import | unchanged code; import tests + E2E route render | ✓ |
| Saved data | save → "Why changed?" dialog; corrupt-storage E2E | ✓ |
| My Team | manual add, paste (3 of 4 matched, 1 reported), Sleeper import against a mocked API (3 of 4 mapped, incl. a defense), "Trade" → offer, lineup impact, You/Them labels, 1360 and 390 px (E2E + Playwright walkthrough) | ✓ (no live Sleeper league available here) |
| Trade calculations | full snapshot (24,892 asset values, 28 preset × mode × phase sets) and 2,393 random complete trades, old vs new engine | **0 differences** |
| Responsive | E2E: no sideways scroll on 12 routes at 1360/721/390 | ✓ |
| Stray text | E2E: no "null"/"undefined"/"NaN" text on 12 routes (failed on the old Model page) | ✓ |

---

## Product-management summary

**5 biggest usability problems (found)**
1. The answer was buried under data (and two screens down on a phone). *Fixed.*
2. Numbers that should match didn't (raw side totals vs adjusted verdict; a lone player at 29% while building). *Fixed.*
3. No help after a lopsided result — no way to find what would balance it. *Fixed.*
4. No roster context — "how does this affect *my* team?" couldn't be answered. *Fixed (optional My Team + lineup impact).*
5. Core interactions inaccessible by keyboard/screen reader. *Fixed (real screen-reader test still owed).*

**5 highest-value features to add**
1. Roster context / My Team with starting-lineup value before → after — *added*.
2. Even it out / Value matches — *added*.
3. Share as text/link — *added*.
4. Model − Market divergence — *added*.
5. Counteroffer comparison table — *added*.

**5 things simplified / to simplify**
1. Five KPI cards → one verdict headline (*done*).
2. Flat settings → "Your league" vs "Model — advanced" (*done*); next: hide advanced behind one toggle.
3. Action buttons → Share menu (*done*).
4. Welcome card → three lines (*done*).
5. Player dialog → summary-first Overview, fewer tabs for redraft (open).

**What would make trade analysis dramatically faster**
Search + Enter per asset (already), the verdict visible without scrolling (done), one-click balancing (done), and a
roster so "my side" is filled from a list or with one click from My Team (done), and the counteroffer table (done).

**Dynasty-specific**
Value matches that include picks (single assets and player + pick / two-pick combinations, done), now-vs-future kept on screen, and a
roster timeline view (Tier 2/3: age profile of my starters, picks owned).

**Redraft-specific**
Roster context matters most in redraft: "starting lineup value / projected points per game before → after" is the
objective version of "does this help me win now?" — now shown on the trade page once My Team is set.

**What most improves trust**
Consistent numbers (done), the market cross-check line (done), clear wording that matches are value math (done),
model-change warnings in "why changed" (done), and resolving the package charge for stars acquired for picks
(model audit).

**What NOT to build**
Buy/sell or accept/decline recommendations, acceptance predictions, a dashboard home page, real-time alerts, AI chat,
user overrides of individual values, start/sit advice, more charts for their own sake (`FEATURE_AUDIT.md` §5).
