# Feature Audit — opportunity matrix and priorities

*Companion to `docs/USABILITY_AUDIT.md` (friction log, findings, validation). Date: 2026-10-02/03, model 2.1.2.*

Every feature here was treated as **guilty until demonstrated useful**. There is deliberately **no overall score**:
each feature is judged on the dimensions below and then classified in words.

* **User value** — how much it helps someone decide about a trade (High / Medium / Low).
* **Frequency** — how often a typical user would use it (every trade / weekly / occasionally / rarely).
* **Differentiation** — does it do something other free tools don't?
* **Implementation / maintenance cost** — in this zero-dependency codebase (Low / Medium / High).
* **Data requirements** — what it needs beyond the current dataset.
* **Confusion risk** — could it mislead or clutter?
* **Core-workflow impact** — does it speed up or slow down "add assets → see verdict"?

Classes: **High priority** (large usefulness gain, reasonable effort) · **Medium** (useful, not essential) ·
**Low** (interesting, limited practical benefit) · **Avoid** (complexity without meaningful value).

---

## 1. Opportunity matrix

| ID | Feature | User value | Frequency | Differentiation | Impl. cost | Maint. cost | Data requirements | Confusion risk | Core-workflow impact | Class | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | **Roster context / My Team** — roster per league profile; trade shows starting-lineup value before → after, which starters change, depth by position | High | every trade (once set up) | High (most calculators ignore your roster) | Medium–High | Medium | a roster: manual entry, or Sleeper `league/{id}/rosters` (IDs already in the crosswalk) | Medium — must stay optional and objective (no "you should") | Positive if optional; must not slow the no-roster path | **High** | **Implemented** (`js/core/roster.js`, My Team tab, lineup impact) |
| F2 | **Even it out** — exact single-asset additions that bring a lopsided trade closest to even (package-aware) | High | most lopsided trades | Medium–High (exact, league-specific, includes the package adjustment) | Low | Low | none | Medium → mitigated by "value math, not a prediction" wording | Positive (one click) | **High** | **Implemented** |
| F3 | **Value matches** — one side filled: single assets of equal trade value | High | frequent (dynasty) | Medium | Low | Low | none | Low | Positive | **High** | **Implemented** |
| F4 | Value matches with combinations (player + pick, 2-for-1) | Medium–High | occasional | Medium | Medium (combinatorics; must stay fast) | Low | none | Medium (long lists) | Neutral if collapsed | **Medium** | Tier 2 |
| F5 | **Share**: text summary for chats; link that reopens the trade (`#/trade?m=…&a=…&b=…`) | High | frequent | Low–Medium | Low | Low | none (ids only; no data in the URL) | Low | Positive | **High** | **Implemented** |
| F6 | **Model − Market divergence** column (sortable) | High (trade targeting) | weekly | High | Low | Low | none (market signal already on the same scale) | Medium — wording says "a difference, not a recommendation" | Neutral | **High** | **Implemented** |
| F7 | Counteroffer table: original + variants with verdicts side by side | Medium–High | occasional | Medium | Medium | Low | none | Low | Positive for negotiation, neutral otherwise | **Medium** | Tier 2 |
| F8 | Perspective labels ("Your team / Their team" vs Team A/B) | Medium | every trade | Low | Low–Medium (wording in core notes + UI) | Low | none | Low | Positive | **Medium** | **Implemented** ("Which side is you?", roster-detected) |
| F9 | Trade history with then/now | Medium | occasional | Medium (reproducible re-check) | — | — | snapshots | Medium (hindsight ≠ proof) — dialog says so | Neutral | Medium | Exists; improved (Then/Now as "B +6,160") |
| F10 | "Why did this change?" (player Trends; saved trades) | High (trust) | occasional | High | — | — | history/snapshots | Low | Neutral | **High** | Exists; saved-trade version now a dialog with drivers |
| F11 | Trade-target explorer (filters: position, value band, age) | Medium | weekly | Low | Low | Low | none | Low | Neutral | Medium | Covered by Players filters + Model − Market sort; "excess at position" needs F1 |
| F12 | Watchlist / bookmarked players | Low–Medium | weekly | Low | Low | Low | none | Low | Neutral | **Low** | Tier 3 |
| F13 | Biggest movers (value/market change over 7 days, objective) | Medium | weekly | Medium | Low–Medium (history exists per player) | Low | history (exists) | Medium (must not read as buy/sell) | Neutral | **Medium** | Tier 3 |
| F14 | Scenario analysis ("what if workload −20%?") | Low–Medium | rare | Medium | High (needs a per-player override layer through both engines) | High | none | High (easily read as a forecast) | Negative (complex UI) | **Low** | Do not build now |
| F15 | Settings what-if ("this trade in Superflex") | Medium | occasional | Medium | Low–Medium (re-value with another profile; cache exists) | Low | none | Low | Neutral | **Medium** | Tier 3 |
| F16 | Source disagreement view | Medium (experts) | occasional | Medium | — | — | — | — | — | Medium | Exists (player → Market & sources) |
| F17 | Dynasty timeline / team age profile | Medium | occasional | Medium | Medium | Low | needs F1 | Low | Neutral | Medium | Tier 3 (after F1) |
| F18 | Age-curve visualization | Low–Medium | rare | Low | — | — | — | — | — | Low | Exists (Model page, Compare overlay) — keep, don't expand |
| F19 | Pick-equivalent explorer ("Player X ≈ two 1sts") | Medium | occasional | Medium | Low (special case of F4) | Low | none | Low | Neutral | Medium | Partly via F3 (single picks); full version = F4 |
| F20 | Draft-pick range analysis | Medium | occasional | Medium | — | — | — | — | — | Medium | Exists (early/mid/late, custom range) |
| F21 | League-specific rankings | High | weekly | Medium | — | — | — | — | — | High | Exists (Players page is exactly this) |
| F22 | Replacement-level explainer | Low–Medium | rare | Low | — | — | — | — | — | Low | Exists (Model → league structure); add a plain-language tooltip (Tier 3) |
| F23 | Contender / rebuild context | Medium | occasional | Medium | — | — | — | Medium | — | Medium | Exists as a dynasty setting + now-vs-future split; a view needs F1 |
| F24 | Multiple saved leagues | Medium | every session (switching) | Low | — | — | — | — | — | Medium | Exists (profiles; dropdown now grouped by mode) |
| F25 | Keyboard shortcut "/" to search; Esc to clear | Low | every trade (power users) | Low | Low | Low | none | Low | Positive | **Low** | Tier 3 |
| F26 | Recent players / favourites in search | Low | frequent | Low | Low | Low | none | Low | Slightly positive | **Low** | Tier 3 |
| F27 | Separate "Quick Trade" mode | Medium (need is real) | — | — | — | Medium (two UIs) | — | High (two places to do one thing) | — | **Avoid** | The verdict-first layout gives the quick answer on the one trade page |
| F28 | Dashboard home page (Build / Compare / Values / Sync tiles) | Low | every visit | Low | Low | Low | — | Medium | **Negative** (extra click before the core task) | **Avoid** | Trade stays home; context line states mode/league/meaning |
| F29 | Buy / sell / accept / decline recommendations | Looks high, is low | — | — | Low | High (credibility) | — | **High** — presents an uncertain model as advice | — | **Avoid** | — |
| F30 | Acceptance-probability prediction | Low | — | — | High | High | data that doesn't exist | High | — | **Avoid** | — |
| F31 | Real-time alerts / push notifications | Low | — | Low | High (background service, permissions) | High | — | Medium | — | **Avoid** | A local app opened when needed; F13 covers "what moved" |
| F32 | Per-player manual value overrides | Low–Medium | rare | Low | Medium | Medium | — | High (users then trust their own numbers as the model's) | — | **Avoid** | Weights/settings already allow principled tuning |
| F33 | AI chat / natural-language Q&A | Low | — | — | High | High | external service | High | — | **Avoid** | — |
| F34 | Start/sit advice | — | weekly | — | High | High | weekly projections & matchups | — | — | **Avoid** | Different product |
| F35 | Separate data-coverage badge | Low | — | — | Low | Low | — | Medium (two badges) | — | **Low** | The confidence badge already reports source coverage/agreement |
| F36 | Printable trade report | Medium | occasional | Low | — | — | — | — | — | Medium | Exists; breakdown now auto-opens for printing |
| F37 | Platform roster sync (Sleeper) | High (as part of F1) | once per league | Medium | Medium | Medium (API changes) | Sleeper rosters | Low | Positive | **High** (with F1) | **Implemented** (players; picks not yet) |
| F38 | Command palette | Low | — | — | Medium | Low | — | Low | — | **Low** | Not now |
| F39 | Trade side "perspective" remembered | Low | — | — | Low | Low | — | Low | — | Low | Implemented with F8 (stored with the trade) |
| F40 | "From my roster" quick-add; roster-restricted "Even it out" | Medium–High | every trade (with a roster) | Medium | Low | Low | F1 | Low | Positive | **High** | **Implemented** |

## 2. High priority

* **F2 Even it out**, **F3 Value matches**, **F5 Share**, **F6 Model − Market**, **F10 Why changed** (improved) —
  implemented this session.
* **F1 Roster context / My Team (+ F37 Sleeper rosters, F40 roster quick-add)** and **F8 perspective labels** —
  implemented in the second batch of this session.

## 3. Medium priority

F4 combination matches, F7 counteroffer table, F13 biggest movers, F15 settings what-if, F17 dynasty age profile
(F1 now exists), F11 position-excess targeting (F1 now exists).

## 4. Low priority

F12 watchlist, F25 keyboard shortcut, F26 recent players, F35 separate coverage badge, F38 command palette,
F22 replacement-level tooltip.

## 5. Avoid (Do Not Build)

| Feature | Why not |
|---|---|
| F29 Buy/sell/accept/decline advice | The values carry ± ranges that often overlap; advice would present a heuristic as truth and erode trust when wrong. The app shows differences and uncertainty instead. |
| F30 Acceptance probability | No data about league-mates; any number would be invented. |
| F27 Separate Quick Trade mode | Two places to do the same job. The single trade page now gives the quick answer first and the depth on demand. |
| F28 Dashboard home | Adds a click before the primary task; the app *is* the trade calculator. |
| F31 Push alerts | Background infrastructure for a local, open-when-needed tool; F13 (a "what moved" list) covers the need. |
| F32 Per-player value overrides | Users would mix their opinions into "the model's" numbers; principled tuning exists (weights, strategy). |
| F33 AI chat | External dependency, cost and unverifiable answers; explanations already exist per value. |
| F34 Start/sit | Different product with different data (weekly matchups). |
| F14 Scenario sliders (now) | High cost, easily mistaken for forecasts; revisit only if F1 ships and users ask. |
| More charts | Existing charts are kept where they answer a question (value trend with model-change markers, age curves, pick curve); no decorative additions. |

## 6. Remove / simplify audit

| Item | Recommendation | Status |
|---|---|---|
| Five KPI cards above the verdict | Replace with one headline; KPIs into "Full breakdown" | **Done** |
| Swap / Save / Export / Print / Clear as five equal buttons | Swap, Save, Share ▾ (text, link, download, print), Clear | **Done** |
| "Signals compared separately" shown by default | Into the breakdown, with a clear caption | **Done** |
| Package math open by default | Collapsed; the verdict notes when totals include it | **Done** |
| Welcome card (long, permanent once dismissed) | 3 lines; restorable from Help | **Done** |
| Settings: 10 flat tabs | Groups: Your league / Model — advanced / App | **Done** |
| Model parameters for normal users | Next step: hide "Model — advanced" behind one "Show advanced model settings" toggle (remembered) | Recommended |
| "Data Refresh" settings tab (read-only freshness table) | Merge into Data → Sources (it only links there) | Recommended |
| Player dialog: 6 tabs | Overview with the 3 biggest value drivers; "Dynasty outlook" → "Long-term" in redraft | Recommended |
| Export = two downloads | Keep (CSV for spreadsheets, JSON for reproducibility) | Kept |
| Rookies & Picks tab | Keep (dynasty-only, distinct job) | Kept |
| Model page backtest tables (long) | Keep, but collapse by season (low traffic page) | Recommended (Low) |

## 7. Ideal user journey — and where the app deviates

```text
Open app → Choose league → Build trade → See quick result → Expand explanation → Review roster/context
        → Explore alternatives → Save/export
```

| Step | Current app | Deviation |
|---|---|---|
| Open app | Opens on Trade; data auto-syncs on start; pill shows freshness | — |
| Choose league | Header dropdown (grouped by mode) + context line with "Change league" | Fine. Exact-league setup (Sleeper import) is in Settings, one click away |
| Build trade | Search + Enter per asset; pick adder; keyboard-only works | — |
| See quick result | **Verdict headline** + bars; pinned on phones | — (was the biggest deviation) |
| Expand explanation | "Full breakdown"; click any asset for "Why this value?" | Component names still model-centric |
| Review roster/context | Dynasty now-vs-future and age; positions received; **lineup impact** with My Team | Roster must be set up once (optional) |
| Explore alternatives | Even it out / Value matches; Swap; saved trades | No side-by-side counteroffers (F7); no combinations (F4) |
| Save/export | Save (with reproducibility record), Share text/link, CSV+JSON, print | — |

## 8. Implementation priorities

### Tier 1 — implement now (**done this session**)
Verdict-first result with progressive disclosure · consistent (package-adjusted) totals · Even it out / Value
matches · Share (text + link, with confirmation) · pinned verdict on phones · trade context line · Model − Market
column · grouped settings with changed markers and reset · "why changed" dialog · mode-grouped league dropdown ·
Compare from the current trade · keyboard/screen-reader fixes · phone header and freshness · polish bugs (−0,
float game counts, stray "null") · **My Team + lineup impact + "Which side is you?" + roster quick-add** (pulled
forward from Tier 2 — it was the largest gap and fitted the existing values without model changes). Details and
measurements: `USABILITY_AUDIT.md` §15.

### Tier 2 — implement soon
1. **Counteroffer table** (F7): original + variants side by side, each with its verdict and lineup impact.
2. **Combination value matches** (F4: player + pick, two assets).
3. Sleeper draft picks (`traded_picks`) and a "refresh from Sleeper" button on My Team.
4. Hide "Model — advanced" settings behind a toggle; merge "Data Refresh" into Data.

### Tier 3 — future
Biggest movers (F13), settings what-if (F15), team age profile (F17), watchlist (F12), keyboard shortcut (F25),
recent players (F26), player-dialog summary-first redesign, replacement-level tooltip.

### Do Not Build
F27–F34 and scenario sliders (§5).
