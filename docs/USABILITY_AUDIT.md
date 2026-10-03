# Usability, UX & Workflow Audit

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

## 1. Executive summary

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

## 2. Current strengths

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

## 3. Major usability problems

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

## 4. Major missing features

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

## 5. Workflow problems

### 5.1 Primary user jobs — how well they are supported

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

### 5.2 Personas

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

### 5.3 Scenarios A–F (walked in the browser)

| Scenario | Before | After |
|---|---|---|
| **A** — trade offer on a phone | 3 searches + Enter each (fast), then scroll ~1,830 px past both lists and five KPI cards to find "Interpretation". | Same 3 searches; the verdict is pinned to the bottom of the screen as soon as both sides have assets ("Team B clearly ahead · B +6,160 — details ↓"), tap to jump. Header scrolls away (was 170 px fixed). |
| **B** — are two dynasty players close? | Trade page (2 searches) or Compare. Answer correct but buried. | Headline answers directly ("Close — roughly fair" + gap vs uncertainty). Well under a minute. |
| **C** — player vs several future picks | Pick adder (year/round/slot) per pick, or search "2027 1st". Worked; "Team A consolidates" note was wrong for pick-for-player. | Note fixed. With only the player entered, **Value matches** lists generic picks/players of similar value. |
| **D** — stale data | Banner after 72 h, data pill colour, Sync All. On phones/tablets the pill was a bare coloured dot. | Pill shows the age ("6 h") at every width and has an accessible label. |
| **E** — one source fails | Verified in the bug audit: banner names stale sources, last good data used, Data page shows the failure. Clear. | unchanged |
| **F** — 1QB → Superflex | Change the dropdown; values update instantly. No "what changed" view across settings. | Dropdown grouped by mode; context line names the active league above the trade. A settings-comparison view is Tier 3 (scenario analysis). |

### 5.4 Other workflow findings

* Building a normal trade takes **one search + Enter per asset**, keyboard-only — already near the ideal in brief §5.
* Opening a shared link while building another trade asked nothing and would have overwritten it — now confirms.
* "Why changed?" was a 12-second toast with several lines of text — now a dialog with a Then/Now/Drivers table.
* Export downloaded two files at once (CSV + JSON) — kept (reproducibility), but moved into a labelled Share menu.

## 6. Mobile problems

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

## 7. Accessibility issues

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

## 8. Performance issues

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

## 9. Trust / transparency issues

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

## 10. Information architecture issues

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

## 11. Recommended improvements

Implemented items are in §15. Recommended next (detail and rationale in `FEATURE_AUDIT.md`):

1. ~~**Counteroffer table**~~ — *done* (§15).
2. ~~**Value matches with combinations**~~ (player + pick) — *done* (§15).
3. **Player dialog**: put "Why this value?" content summary on Overview; rename "Dynasty outlook" to "Long-term"
   in redraft.
4. **Label the remaining unlabeled number fields** (Scoring/Import tables); replace the pick "Custom range…"
   `prompt()` with inline fields.
5. **Sleeper draft picks** in the roster import (`traded_picks`), and roster refresh from Sleeper on demand.

## 12. Features worth adding

See `FEATURE_AUDIT.md` §2–§3 (High/Medium). In short: roster context and perspective labels (both now added),
counteroffer comparison, pick + player value matches, a biggest-movers view, settings comparison ("what if
Superflex?").

## 13. Features not worth adding

See `FEATURE_AUDIT.md` §5 (Do Not Build): buy/sell recommendations, acceptance-probability predictions, a dashboard
home page, real-time alerts/push, social features, user-adjustable per-player overrides of model values,
start/sit advice, AI chat, more chart types.

## 14. Features to simplify / remove

Done: five KPI cards → one headline (KPIs moved to the breakdown); four action buttons → "Share" menu; flat
10-tab settings → three groups; long welcome card → three lines; `prompt()` for team count → number field.
Recommended: see `FEATURE_AUDIT.md` §6.

## 15. Changes actually implemented

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

## 16. Remaining opportunities

* ~~Counteroffer table, combination value matches (Tier 2)~~ — done (§15, last rows).
* My Team: Sleeper draft picks and one-click refresh; roster per league is browser-only (not synced to the local
  server like profiles).
* Package charge on stars acquired for picks — quantitative audit.
* Real-device and screen-reader testing; Firefox/Safari.
* Player dialog summary-first layout; unlabeled table inputs in Scoring/Import.
* Biggest-movers / watchlist (Tier 3), settings what-if comparison (Tier 3).

---

# Part II — Friction log

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

# Part III — Before/after validation

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

# Product-management summary

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
