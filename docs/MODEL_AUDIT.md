# Model Audit (model 2.1.2 → 2.2.0, 2026-10-03; research batch → 2.3.0 in §21)

A second adversarial, quantitative review of the valuation system. The first audit (model 1.0.0 → 2.0.0) is
[MODEL_AUDIT_2.0.0.md](MODEL_AUDIT_2.0.0.md); this one starts from its conclusions and tries to break them.
Every number is reproducible with `npm run audit-model` (outputs in `reports/audit/`, one row per metric in
`reports/audit/scorecard.csv`). Candidate models side by side: [MODEL_COMPARISON.md](MODEL_COMPARISON.md).

**Data labels** (never mixed without saying so):

| Label | What it is | Where |
|---|---|---|
| **REAL HISTORICAL DATA** | nflverse weekly stats 2018–2025, schedules, players; FantasyPros ECR archive (preseason, ROS, dynasty, rookie) republished by DynastyProcess | `data/benchmark/benchmark.json` (built by `scripts/audit/benchmark.js`, git-ignored, rebuilt on demand) |
| **BACKTESTED** | walk-forward experiments E1–E8; everything fitted only on seasons before the test season | `reports/audit/e1…e8-*.json` |
| **SIMULATION** | leagues simulated on real weekly points (E6/E7): drafts, weekly lineups, waivers and trades are simulated, outcomes are real | `e6-league-simulation.json`, `e7-verdict-calibration.json` |
| **CURRENT DATA** | the synced dataset of 2026-10-03 (`2026-10-03-db0b55b5`, week 4), frozen so before/after isolates the model | `cur-*.json`, `before-after*.json/csv` |
| **SYNTHETIC** | fake players for tests and positional-equity probes | `tests/fixtures/`, `cur-positional-equity.json` |

The benchmark was rebuilt from scratch for this audit; all 73 E1–E4 metrics of the 2.0.0 audit reproduced exactly.

---

## 1. Executive summary

The 2.0.0 model is structurally sound: league-specific surplus over replacement, rank mapping instead of averaging raw
scales, consensus-dominant weights, distinct redraft and dynasty models. This audit found that one of 2.0.0's own
central fixes was **validated against a target with hindsight**, plus several smaller defects, and changed only what
the evidence supports.

**The biggest weakness — redraft over-valued depth relative to stars.** 2.0.0 made redraft values *expected* surplus
`E[max(0, X − r)]` with an outcome SD equal to the full forecast error (weekly noise and missed games included), and
judged it against `max(0, season points − replacement)`. That target assumes a manager knew before the season whom to
start. Re-scored against what players actually added to lineups when start/sit decisions were made before each week
(E5, new), the 2.1.2 σ over-valued ranks 13–72 relative to the top 12 by **24–57% preseason and 2–4× deep in season**.
Week-to-week randomness and missed games are not option value — you cannot bench a player before his bad week. In a
historical league simulation (E6, new: 5,000 random trades on real 2021–2025 weekly points), σ × 0.4 predicted
realised trade outcomes better than 2.1.2 in **all five seasons**. → σ × 0.4 (2.2.0). Stars barely move; bench/depth
values fall (12-team 1QB #150: 972 → 447). A trade calculator that over-values depth says "two mid players ≈ one
star", the classic failure mode.

**Other findings implemented in 2.2.0:**

* **Age monotonicity failures on current data.** The 2.0.0 audit reported 0 of 75 monotonicity failures; on today's
  data there were 2: making Harold Fannin (22) or Travis Kelce (37) two years *younger* lowered their dynasty value by
  8–11%. Causes: calibrated aging curves went flat beyond the data (a 37-year-old TE stopped declining) and the exit
  hazard was un-regularised at young ages (one noisy cell: 9 of 36 TEs aged 22). → shape constraints in calibration
  (monotone hazard, unimodal curves whose decline never slows past the data). 1 failure remains, explained (§14).
* **Dynasty counted the current season in full at any week.** At week 4 a quarter of the season is gone; values
  concentrated in this season (veterans) were over-stated and would jump at the season boundary. → only remaining
  games count; later seasons discounted from now; a partial final season keeps the 5-season horizon.
* **Dynasty injury rule** "IR = −35% of a full season" ignored the week and differed from redraft's games-lost table. →
  expected games lost as a share of games left (shared table); out for the season = whole remaining season.
* **Strength of schedule** kept in 2.0.0 as "inconclusive": without it the production forecast was at least as good in
  **17 of 20** walk-forward checkpoints, and projections already contain matchups → removed (weight 0).
* **Trade verdict communication.** Even a "clear" edge (z > 2) went the other way in about 3 of 10 simulated seasons
  (E7). → the trade view now states how often a margin that size worked out historically (redraft).

**Tested and kept** (evidence in §§5–13): the package adjustment (beats plain sums in every season), bench fraction
0.35, package strengths, dynasty uncertainty (E8: proportional spacing; removing it under-values depth by up to ~30×),
dynasty 5-season horizon (beats 8 and 12), consensus-dominant weights, rookie slot curve, DP/ADP zero weights.
**Tested and rejected:** scaling projections by availability (E6: worse), a volatility penalty (no relationship),
longer dynasty horizons, larger dynasty uncertainty (best in 1 of 3 seasons only).

**What remains uncertain:** projections, ADP and trade-market values still have no free history (their weights are
judgment); the ± range is a disagreement heuristic; dynasty outcomes beyond three seasons cannot be validated with
2018–2025 data; the E6 simulation models managers simply. See §20.

## 2. Current model architecture (what is actually estimated)

```
dataset.json ── context.js (league-scored projection, production, last season, injury → games lost, remaining games)
      │
      ├─ replacement.js  starters (greedy FLEX/SF), replacement r, waiver w, displacement — from the league settings
      ├─ REDRAFT  S(points) = E[max(0, X − r)] + β·(E[max(0, X − w)] − E[max(0, X − r)]),  X ~ N(points, σ_pos·G)
      │           curves = sorted S by position; consensus/market (positional rank) and ADP (overall rank) mapped onto
      │           them; phase-weighted blend
      ├─ DYNASTY  F = Σ_t δ^(t−2+f) · S_t · share_t · E[surplus of year-t points]  (μ_t aged, σ_t growing, S_t survival)
      │           consensus/market mapped onto the F curve; blend .40 / .35 / .25
      ├─ PICKS    market (value-function mapped) + historical slot curve + current class, isotonic per season
      ├─ engine   value = score × 7,000 / mean(top-12 reference-league scores)
      └─ trade    sums − package adjustment; z = |diff| / √Σσ²; historical outcome frequency (redraft)
```

**Formal specification.**

* **Redraft** estimates each player's *expected rest-of-season lineup surplus* in the user's league: expected points
  above the positional replacement level (the best player you could start instead), plus a fraction of the band down
  to the waiver level (bench/bye/injury fill-in value), with a small option value for persistent role uncertainty.
* **Dynasty** estimates the *discounted sum of expected lineup surplus* over the remaining part of this season and the
  next five seasons of football, with position-specific aging, attrition (dropping out of fantasy relevance), growing
  uncertainty (whose option value is real over several seasons, E8) and a strategy discount (a preference, not an
  estimate).
* **Picks** estimate the expected dynasty value of whoever the pick selects (mean, not median, of a right-skewed
  outcome).

**Is it a ranking model?** Partly, and deliberately. The *ordering* of most players comes mostly from expert consensus
and the market (they beat every fundamental model in every walk-forward test). The *magnitudes* — how much more the
3rd RB is worth than the 25th, how much a Superflex QB is worth — come from the league's replacement-level math, which
is a genuine expected-value model. So the app is a consensus-ordered, league-priced surplus model, not "just a
ranking": the same ranking yields different values under different rosters, scoring, TE premium and team counts
(§8), and the numbers are on a cardinal points scale.

**Dependency map** (what each parameter feeds; full formula inventory in §3):

| Input / parameter | Feeds | Effect on value | Linear? | Evidence |
|---|---|---|---|---|
| league teams / roster / flex | replacement, waiver, displacement | all values (scarcity), package charges | non-linear (surplus) | §8 |
| scoring (incl. TEP, bonuses) | projection/production points, prior scoring ratio | fundamentals → curves → every mapped signal | ~linear in points | §8 |
| `sd_per_game` (σ) | expected-surplus option value | values near/below replacement | convex | **E5, E6 (changed)** |
| `bench_value_fraction` β | band below replacement | depth players | linear | E6 (kept) |
| redraft weights / phase ramp | blend | redraft | linear | E1, E2 |
| production (x, k, availability, SoS) | production signal, dynasty μ₁ | in-season redraft (w .10), dynasty μ₁ | linear | E2 (SoS removed) |
| injury games-lost table | production ROS; dynasty year-1 share | injured players | linear in games | untestable (§13) |
| dynasty weights, aging γ, prior k, hazard, CV, δ, horizon | F, F curve | dynasty | non-linear | E3, E8 |
| calibration files | aging, attrition, priors, CV, slot shape | dynasty, picks | non-linear | E3 (changed: shape constraints) |
| scale anchor | one multiplicative factor | all values equally | linear | monotonicity |
| package parameters | trade adjustment | uneven trades only | piecewise | E6 (kept) |
| trade outcome slope | displayed frequency | none (display) | logistic | E7 (new) |

**Double-counting check.** Consensus, market and ADP are mapped onto the same curve and blended — they are
correlated (§10), which is why the weights reflect accuracy and independence, not source count (DP values and dynasty
ADP have weight 0). Projection and SoS double-counted matchups (removed). Dynasty aging and attrition are *not* a
double count: the delta-method curve is conditional on staying in the league and attrition models leaving it; γ = 2
corrects the survivorship of the conditional curve and was re-tested (age bias near 0, §6).

## 3. Formula inventory

Notation: r replacement, w waiver, β bench fraction, G games, f share of the current season left, δ discount.
Classification is the final implementation decision (brief §62).

| # | Formula / component | Purpose | Inputs (units) | Potential problems found | Evidence | Decision |
|---|---|---|---|---|---|---|
| 1 | starters = teams × slots; FLEX/SF greedy by points | league structure | roster, projected points | none: SF goes to QBs even at 16 teams (QB32 141 vs best RB/WR 122 pts) | §8 | KEEP |
| 2 | r = mid(last starter, first non-starter); w = first unrostered (bench pro rata) | replacement levels | points | arbitrary bench split (pro rata) | positional equity §8 | KEEP |
| 3 | `S = ES(μ,σ;r) + β(ES(μ,σ;w) − ES(μ,σ;r))` | surplus | points, σ | σ too large (hindsight-calibrated) | E5, E6 | **MODIFY** σ × 0.4 |
| 4 | σ = c_pos × G | option value scale | per-game SD | included weekly noise + missed games | E5 decomposition | **MODIFY** |
| 5 | β = 0.35 | bench value | — | judgment | E6: β 0/.35/.7 within ±.006 | KEEP (judgment) |
| 6 | projection = weighted mean of sources, re-scored | redraft signal | stat lines | assumes all remaining games played | E6: availability scaling worse | KEEP |
| 7 | production `rate = (gp·blend + k·prior)/(gp + k)`, blend .75 ppg + .25 xppg | in-season signal | weekly stats | — | E2 (fitted) | KEEP |
| 8 | × availability (QB .80 RB .77 WR .83 TE .82) | expected games | measured | position-level (tier matters more) | E2, E5 | KEEP |
| 9 | × SoS = 1 + .5·rel·(opp ratio − 1) | schedule | FPA | double counts projections; no gain | E2 17/20 | **REMOVE** (weight 0) |
| 10 | games lost: Out 1, D .8, Q .25, IR/PUP/NFI 5, Sus 3 | injury | status | judgment | untestable | KEEP / INVESTIGATE |
| 11 | positional-rank mapping onto curves | normalization | ranks / values | inherits curve shape | §9 | KEEP |
| 12 | blend `Σ w v / Σ w(available)` | combine | group values | renormalization on missing data | §15 | KEEP |
| 13 | redraft weights pre .40/.30/.15/.15/0, in .45/.30/.15/0/.10 | weighting | — | proj/market untestable | E1, E2 | KEEP |
| 14 | ADP corroboration rule | no ADP-only values | — | — | 2.1.0 | KEEP |
| 15 | trend × 0 | momentum | 30-day trend | no predictive evidence | 2.0.0 | KEEP (display only) |
| 16 | dynasty μ₁ evidence weights (proj 1, prod min(1,gp/8), last .8·…, prior 20/(20+games)) | current rate | rates | — | E3 | KEEP |
| 17 | evidence gate after year 1 | no prior-only veterans | — | — | 2.0.0 | KEEP |
| 18 | μ_t = μ₁(A(a_t)/A(a₀))^γ, γ = 2 | aging | curves | flat tails beyond data | E3, monotonicity | KEEP γ; **MODIFY** curve tails |
| 19 | hazard(age) | attrition | exits | young cells unregularised | E3, monotonicity | **MODIFY** (monotone fit) |
| 20 | σ_t = μ_t√(cv₁² + (t−1)g²) | dynasty uncertainty | CV | — | E8: proportional spacing | KEEP |
| 21 | F = Σ δ^(t−1) S_t ES_t | dynasty value | — | full current season at any week | logic | **MODIFY** (f share, δ^(t−2+f), tail) |
| 22 | H = 5 | horizon | — | penalises the very young slightly | E3: 5 > 8 > 12 | KEEP |
| 23 | injury −35% of year 1 (dynasty) | injury | status | ignores week; differs from redraft | logic | **REPLACE** (games lost) |
| 24 | dynasty weights F .25 / mkt .35 / cons .40 / ADP 0 | weighting | — | — | E3 (.582 vs .581 ECR) | KEEP |
| 25 | pick V = .45M + .30H + .25C, isotonic | picks | — | weights untestable | E4 | KEEP |
| 26 | slot shape a·e^(−b(p−1)), b ≈ .118 | historical curve | — | smooths 1.01–1.02 cliff | E4 | KEEP |
| 27 | future discount .88/yr; prior-class adj .8 | picks | — | judgment | — | KEEP (judgment) |
| 28 | scale = 7,000 / mean(top-12 ref) | currency | — | — | monotonicity | KEEP |
| 29 | confidence score, σ = max(floor·v, SD of groups) | ± range | — | heuristic, not calibrated | E7 (verdicts ordered) | KEEP / INVESTIGATE |
| 30 | package charge `s·min(v, disp) + c·v_last`, keep ≥ m | consolidation | values | — | E6: beats sums every season | KEEP |
| 31 | z thresholds 1 / 2 | verdict | — | means less than users think | E7 | KEEP + **ADD** outcome frequency |
| 32 | market list format rules (QB format, PPR, teams, TEP) | list choice | — | — | 2.1.1 | KEEP |
| 33 | DP player values weight 0; dynasty ADP 0 | independence | — | ρ .99 / .96 with ECR | §10 | KEEP |

## 4. Input / source audit

| Source | Role | Coverage / freshness | Independence (current data, within-position ρ) | Historical test | Weight |
|---|---|---|---|---|---|
| FantasyPros ECR (DP mirror) | consensus | weekly mirror | — | **yes** (E1–E3: best single signal everywhere) | dominant |
| FantasyCalc | market | daily, real trades | ρ .946 with dynasty ECR; .950 redraft | no archive | .35 dyn / .15 red |
| DynastyProcess values | market (display) | weekly | **ρ .990 with FP dynasty ECR** (a transform) | — | 0 |
| Sleeper dynasty ADP | ADP | live | ρ .959 with dynasty ECR | no archive | 0 |
| Sleeper/Rotowire, ESPN projections | projection | weekly | ρ .927 with each other; .933 with ROS ECR | no archive | .30 |
| Sleeper, ESPN, FFC ADP | ADP | live / daily | ρ .913 Sleeper–ESPN | no archive | .15 preseason, corroborating |
| nflverse stats | production | weekly | ρ .764 season PPG vs ROS ECR (most independent, noisiest) | yes (E2) | .10 in season |
| KTC / manual imports | market / any | user | — | — | as configured |

Market data: FantasyCalc values come from real trades in its users' leagues (sample size and participant population
not published; format variants per QB format, PPR and team count). They are used only for their ordering within
position (§9), so the source's own scale and inflation never enter values. They cannot be backtested.

## 5. Redraft audit

**What should the value be (brief §7)?** Raw projected points ignore replacement and cannot be summed across
positions; points above replacement is the right target, measured as lineup surplus. Tested formulations against the
hindsight-free lineup target (E5, preseason 2022–2025, 12-team 1QB; ratio = value of a tier relative to ranks 1–12
after the app's rescaling, 1.0 = proportionally right):

| Value definition | ranks 1–6 | 7–12 | 13–24 | 25–36 | 37–72 | loss Σlog² | MAE |
|---|---|---|---|---|---|---|---|
| raw points | — (not additive across positions) | | | | | | |
| deterministic `max(0, μ − r)` (σ = 0) | 0.99 | 1.01 | 1.09 | 0.95 | **0.71** | 0.132 | 29.6 |
| expected surplus, **2.1.x σ** | 0.96 | 1.06 | **1.28** | **1.20** | **1.57** | 0.306 | 33.3 |
| expected surplus, **0.4 × σ (2.2.0)** | 0.98 | 1.03 | 1.14 | 0.98 | 0.95 | **0.020** | 30.4 |
| expected surplus, σ fitted each fold on earlier seasons (0, 0, .3, .3) | 0.99 | 1.02 | 1.10 | 0.96 | 0.78 | 0.073 | 29.9 |
| expected surplus, rate-only σ (weekly noise removed: QB 1.7–2.4, RB 2.5–3.1, WR 2.5–2.9, TE 1.9–2.2) | 0.98 | 1.04 | 1.16 | 1.03 | 1.25 | 0.075 | 31.2 |

Robust to the start rule (prior weight 2 / 8 pseudo-games: 2.1.x loss 0.35 / 0.44, 0.4× 0.04 / 0.03). In season
(ROS rankings at weeks 4 and 8): from week 5, 2.1.x 0.58 → 0.4× 0.16; from week 9, 1.81 → 0.67 (σ = 0: 0.39; the
deepest tier is over-valued at every σ there and dominates the loss). The old hindsight target has nearly the same
tier shape as the new one (0.94–1.02), so the error was not the target alone: the old σ also folded missed games and
weekly noise (≈ a third of the per-game variance) into the option value.

**E6 — does it matter for trades?** 12 teams draft real players each season 2021–2025; weekly lineups are set from
information available before each week, with waiver pickups; 1,000 random trades per season (1-for-1 … 4-for-2) are
applied after the draft and the season replayed. Outcome = change in A's season points minus change in B's. Correlation
of each candidate's preseason trade margin with the outcome:

| Candidate | all | even counts | uneven counts | per season 2021 / 22 / 23 / 24 / 25 |
|---|---|---|---|---|
| 2.1.2 | 0.542 | 0.560 | 0.540 | .419 / .690 / .491 / .511 / .605 |
| 2.1.2 without package adjustment | 0.523 | 0.560 | 0.522 | .419 / .658 / .456 / .480 / .589 |
| **σ × 0.4 (2.2.0)** | **0.549** | 0.558 | **0.547** | **.421 / .695 / .496 / .519 / .609** |
| σ × 0.4 + projections × availability | 0.527 | 0.522 | 0.527 | lower in all 5 |

**Starter vs roster value, volatility (brief §9–10).** The value already *is* lineup value (surplus over the player
you would start instead; bench players get only the fill-in band). Weekly volatility: at equal preseason rank, last
season's weekly CV does not predict lineup value (correlation with the residual: RB −0.09, WR −0.05, QB +0.13,
TE +0.21 — if anything volatile QB/TEs did *better*). No volatility penalty: none is supported, and with start
decisions made before the games, expected lineup value is linear in weekly points.

**Recency / usage (brief §13; E2, unchanged).** Season-long rate beats last-4 (ρ .443 vs .416); usage-only expected
points are worse than points (.373) but help as a 25% blend; fitted recency weight 0; ROS consensus beats all
(.490); the fitted consensus share stays 0.8–1.0 from week 4 to 12.

**Season phase (brief §46).** The only consistent phase effect is that production starts to add a little information
in season; there is no week at which production overtakes consensus (E2). Weights ramp to the in-season set by week 8;
finer phases (playoff run, post-draft) showed no consistent pattern and were not added.

## 6. Dynasty audit

**E3 (walk-forward, 2020–2023 preseason dynasty ECR → realised discounted 3-season surplus; calibration refitted each
season on earlier data only).** ρ: ECR .581, fundamental .508, 75/25 consensus/fundamental blend .582. Model setting
(γ 2, prior 20): ρ .513 → **.518** with the new calibration constraints, worst season .471 → **.494**, age bias
(young / old) −.016/+.015 → **−.014/+.012**. Every fundamental component still earns its place (ablations: no age
curve .484, no attrition .508, no draft prior .483, deterministic .494, year 1 only .469).

**Age monotonicity on current data.** 2.1.2 failed 2 of 75 checks (Fannin 22 → 20: 3,677 → 3,380; Kelce 37 → 35:
1,447 → 1,290). Traced to calibration artefacts at thinly observed ages:

* aging curves copied a **flat default tail** beyond the data (TE 0.579 at 36, 0.499 at 37, then 0.502 to 42), so a
  37-year-old stopped declining while a 35-year-old fell 12–14% a year;
* exit hazard pooled ±1 year with monotonicity enforced only *after* its minimum, so one TE cell (9 exits of 36 at 22)
  gave ages 21–22 a 12–20% hazard vs 4.5% at 24.

Fix (`scripts/lib/calibration-shape.js`, used by both `npm run calibrate` and the backtest refits): a weighted monotone
fit of the pooled hazard; unimodal aging curves whose decline never slows beyond the last age with ≥15 pairs. Values
inside the data range are unchanged.

**Current season (brief §16).** 2.1.2 counted year 1 as a full season at any week. 2.2.0 counts f = remaining team
games / 17 of it, discounts later seasons from now (δ^(t−2+f)) and adds (1 − f) of a sixth season so the horizon stays
five seasons of football — no jump when the season rolls over (tested: offseason values unchanged by construction).

**Horizon and discounting.** Horizon 5 vs 8 vs 12 against realised 3-season value: ρ .518 / .513 / .508, young-player
over-rating 0 / +.027 / +.040 → keep 5. Discount rates (.70/.82/.92) are preferences, not estimable (kept as the user's
strategy setting). Longer horizons cannot be validated with 2018–2025 outcomes.

**Young players vs proven producers (brief §18).** ECR is unbiased by age; the fundamental model with γ = 2 has a
small residual (young −1.4, old +1.2 percentile points). Current-data examples (12-team 1QB): Carnell Tate (21.7, little
production) 5,155 dynasty vs 1,277 redraft — market 4,522, fundamental 6,386: the model does not assume "younger =
better" (McCaffrey 30.3: fundamental 6,359 > market 4,914), it lets evidence and age curves trade off.

**Dynasty vs redraft separation (brief §47).** Distinct models on shared infrastructure: dynasty has its own μ₁,
multi-year aging, attrition, uncertainty growth, discount and curves; redraft uses no age at all. Ablating the
multi-year structure costs ρ .039 (fundamental .508 → year-1-only .469).

## 7. Rookie-pick audit

Unchanged in 2.2.0. E4 reproduced exactly: least-squares exponential LOO MAE 37.9, top-12 bias +1.7 (isotonic 40.7;
absolute-error fits 32–35 but biased low by 21–31 — they fit the median rookie, while a pick's trade value is the mean).
Shape (§20 of the brief): every class position ≈11% below the previous one, so 1.01 → 1.02 is ~3× the absolute drop of
1.10 → 1.11, as in the historical means; the remaining misfit is the post-pick-2 cliff (data 228 vs fit 177), carried
by market and current-class inputs (70% weight). Unknown slots are uniform probability-weighted averages; buckets
average a third of the round; projected standings are not modelled (no reliable free source). Current values
(12-team 1QB): 2027 1.01 5,494; Early 1st 4,574; unknown 1st 3,178; Late 1st 2,003; 2028 1st 2,463 — monotone in slot
and year (checked automatically). Untestable: the .45/.30/.25 weights, .88 future discount, .8 prior-class adjustment.

## 8. Positional scarcity, league formats, Superflex, TE premium

Synthetic equal players (250 PPR points over 14 games; SYNTHETIC) valued in each league (`cur-positional-equity.json`,
2.2.0):

| League | QB | RB | WR | TE |
|---|---|---|---|---|
| 10-team 1QB | 1,361 | 5,271 | 5,064 | 5,579 |
| 12-team 1QB | 1,499 | 5,972 | 5,947 | 5,871 |
| 14-team 1QB | 2,000 | 6,765 | 6,345 | 6,213 |
| 16-team 1QB | 2,585 | 7,152 | 7,029 | 6,781 |
| 12-team Superflex (= 2QB) | **5,941** | 6,805 | 6,378 | 6,213 |
| 12-team TE premium +1.0 | 1,499 | 5,671 | 5,064 | **10,007** |
| 12-team 3WR 2FLEX | 1,429 | 6,942 | 6,764 | 6,857 |

Differences come only from replacement levels (no positional multipliers). A 250-point QB is barely above replacement
in 1QB (≈220 points) and becomes a premium asset in Superflex. Deeper leagues raise every starter. TE premium raises the
TE *surplus*: the same player scores more, but so does the replacement TE. Superflex and 2QB are identical here because
the greedy allocation fills every SF slot with a QB — verified at 16 teams (QB32 projects 141 ROS points vs the best
remaining RB/WR 119–122), which is real Superflex behaviour, not a bug.

League grid (`cur-league-grid.json`, 2.2.0): Josh Allen 5,168 (12-team 1QB) → 9,563 (SF); Brock Bowers 5,177 → 7,033
(TEP 0.5) and smooth over TEP 0 / 0.25 / 0.5 / 1 (monotone check); WR values fall slightly under TEP (TEs take more FLEX
slots, raising WR replacement) — correct roster economics. Dynasty uses the same structure (TE premium, SF, depth all
flow through the fundamental curve onto which consensus/market are mapped).

## 9. Market-value audit

Market and consensus are separate, visible groups; the fundamental model is a third. The model is **not** forced
toward the market: market lists contribute their *ordering* within position; magnitudes come from league math.
Dynasty disagreements on current data are concentrated where the model lacks information (rookies without NFL
production, veterans with situation risk) — e.g. Carnell Tate fundamental 6,386 vs market 4,522; McCaffrey 6,359 vs
4,914 — and are displayed, not hidden. Whether market data *improves* accuracy cannot be tested (no archive); FP ECR
(which the market tracks at ρ .95) improves every backtest, so the market is weighted below consensus.

## 10. Correlation analysis

Current data, within-position Spearman ρ (`cur-correlations.json`): DP dynasty values ↔ FP dynasty ECR **.990**;
Sleeper dynasty ADP ↔ ECR .959; FantasyCalc dynasty ↔ ECR .946; FantasyCalc redraft ↔ ROS ECR .950; Sleeper ↔ ESPN
projections .927; projections ↔ ROS ECR .933; Sleeper ↔ ESPN ADP .913; season PPG ↔ ROS ECR .764.
PCA per position (9 signals): the first component explains **79% (QB), 92% (RB), 85% (WR)** of variance; effective
independent signals 1.2–1.6. The second component contrasts "now" (projections, PPG) with "future" (dynasty
lists) — the redraft/dynasty distinction, not an extra quality signal. Consequence: adding correlated sources adds
almost nothing and silently up-weights what they copy; weights follow independence and accuracy (DP 0, dynasty ADP 0).

## 11. Backtesting results

| Exp. | Question | Data | Result |
|---|---|---|---|
| E1 | preseason redraft predictors | 2021–25 tests | ECR ρ .505 / MAE 57.2; last-season PPG .410; ECR blend weight 1.0 every fold |
| E2 | in-season ROS | 2021–24 × weeks 4–12 | ROS ECR .490 / 32.5; fitted blend .512 / 34.5; **no-SoS ≥ SoS in 17/20** |
| E3 | dynasty 3-season | 2020–23 | ECR .581; fundamental .508 (.518 at model settings); 75/25 blend .582 |
| E4 | rookie slot curve | 2020–23 classes LOO | LS exponential 37.9 / bias +1.7 |
| **E5** | value definition vs hindsight-free lineup value | 2022–25 (pre), 2022–24 (in) | 2.1.x σ loss .306 → 0.4× **.020** (preseason) |
| **E6** | trade margins vs realised outcomes | 5,000 trades 2021–25 | 2.1.2 .542 → **.549**; package > sums every season |
| **E7** | verdict calibration | same trades | favoured side won 53% / 58% / 71% for close / lean / clear |
| **E8** | dynasty value spacing | 2021–23 rankings | current CV proportional (loss .043); CV × 0 loss 13.4 |

Method: strict walk-forward (training seasons < test season; ranking snapshots dated before the window; weekly start
decisions use only earlier weeks). Metrics: within-position Spearman ρ (ordering), MAE (level), tier ratio after the
app's rescaling (additivity, the property trade sums need), outcome correlation and hit rates (trade usefulness).

## 12. Baseline comparisons

| Task | Naive baseline | Consensus only | 2.1.2 | 2.2.0 |
|---|---|---|---|---|
| Preseason ordering (ρ) | last-season PPG .410 | **.505** | .505 | .505 |
| In-season ROS (ρ / MAE) | season PPG .443 / 37.3 | .490 / **32.5** | ≈ .512 / 34.5 (fitted blend) | ≈ .512 / 34.5 |
| Dynasty (ρ) | — | .581 | .582 (75/25 blend) | .582 |
| Redraft tier proportionality (E5 loss) | deterministic .132 | (rank list: no magnitudes) | .306 | **.020** |
| Trade outcome correlation (E6) | plain sums .523 | — | .542 | **.549** |

Consensus is hard to beat on ordering, and the model does not pretend otherwise. Its added value is in magnitudes:
league-specific, additive values that predict trade outcomes better than plain sums, and that survive a missing source.

## 13. Ablation results

Influence on current values when a component is removed (`cur-influence.json`, 2.2.0; influence, not accuracy):
redraft — projection median 8.1% / p90 22%; consensus 6.2% / 21%; market 1.6% / 6.2%; ADP 2.0% / 6.8%; production
1.4% / 2.9%; injury 0.8% / 2.2%; SoS 0 (off); trend 0. Dynasty — fundamental 4.7% / 13%; market 3.4% / 12%.
Accuracy ablations: E2 (SoS, recency, usage), E3 (age, attrition, prior, uncertainty, horizon), E6 (package, β,
package strength, availability), E8 (dynasty uncertainty).
Injury: the games-lost table cannot be backtested (no historical injury designations in the benchmark); its influence
is small. KEEP, INVESTIGATE.

## 14. Sensitivity, monotonicity, extreme cases

* **+10% projection** (`cur-sensitivity.json`): stars +10–12% (Gibbs +11%, Smith-Njigba +10%); players near
  replacement are leveraged by construction (Bo Nix +31%, a rank-261 QB +92% — of a very small value). Surplus over
  replacement is supposed to be leveraged; σ no longer masks it. **+1 year of age** (dynasty): −1% to −9%, most for
  young elite RBs whose value is mostly future. **+10% market**: dynasty ≤ 1%, redraft ≈ 0 (ordering-based).
* **Monotonicity** (`cur-monotonicity.json`, 75 checks): 2.1.2 **2 failures**, 2.2.0 **1**: Harold Fannin made two years
  younger at 20.2 loses 1.9% because his TE peak (26) falls outside a 5-season window — the cost of a finite horizon,
  which beat longer horizons in E3. Documented, not tuned away.
* **Extreme cases** (`cur-extremes.json`, 12-team; redraft / dynasty 1QB / dynasty SF): elite young RB Gibbs
  9,886 / 11,812 / 11,660; elite veteran RB McCaffrey (30) 6,491 / 4,967; aging star WR Adams (34) 3,600 / 3,686;
  young WR with little production Tate 1,277 / 5,155; elite TE Bowers 5,177 / 8,188; top QB Allen 5,168 / 6,042 /
  **10,441 SF**; IR star A.J. Brown 1,975 / 4,060; rookie R1 WR Tyson 588 / 4,761; late-round rookie RB 0 / 228; 2027
  1.01 5,494, early 1st 4,574, unknown 1st 3,178, late 1st 2,003, 2028 1st 2,463. Each is explainable from its
  components (player view "Why this value?").

## 15. Stability analysis

| Perturbation (`cur-stability.json`, `cur-missing-sources.json`) | redraft ρ / median / p90 | dynasty ρ / median / p90 |
|---|---|---|
| market ±5% noise | 1.000 / 0% / 2.2% | .998 / 0.5% / 5.0% |
| ECR ±1 rank noise | .999 / 0.1% / 5.4% | .998 / 0.2% / 4.6% |
| projections ±5% noise | .993 / 4.5% / 14.9% | 1.000 / 0.6% / 1.6% |
| remove FantasyCalc | .998 / 1.6% / 6.2% | .992 / 3.4% / 11.5% |
| remove FantasyPros ECR | .985 / 6.2% / 21% | .983 / 5.0% / 15.6% |
| remove both projection sources | .948 / 17.5% / 100% (deep players lose their only signal) | — |

Redraft relative sensitivity to projection noise rose (p90 7.8% → 14.9%) because deep values are now small; in value
points it is unchanged (projections ±5%, 3 seeds: top-50 median change 100 → 107, ranks 51–200 43 → 39, all p90 83 →
80). Missing sources degrade gracefully: weights renormalise over what a player has (equivalent to imputing the missing
group with the available ones, since all groups are on the same curve), confidence drops, nothing is invented.

## 16. Identified biases

| Bias | Evidence | Status |
|---|---|---|
| Depth over-valued relative to stars (redraft option value) | E5 tier ratios 1.20–1.57; E6 | **fixed** (σ × 0.4) |
| Old hindsight target in E1b | E5 | replaced by hindsight-free target |
| Older players gaining value with age (flat curve tails) | monotonicity, Kelce | **fixed** |
| Young TEs penalised by noisy hazard cells | monotonicity, Fannin | **fixed** |
| Dynasty full current season mid-season | logic | **fixed** |
| Dynasty IR rule independent of the week | logic | **fixed** |
| SoS double counting projections | E2 | **removed** |
| Fundamental age bias | E3 −.014 / +.012 | small, monitored |
| Finite horizon penalises the very young | monotonicity (−1.9%) | documented |
| Availability by tier (stars .87–.90, depth .72–.81) not modelled | E5 | **fixed in 2.3.0** (§21 E11): the 2.2.0 test scaled *points* before the replacement level was set (a functional-form error); the per-game form with a within-position shape improves E5 and E6 |
| ESPN projections less favourable to young QBs; FantasyCalc favours veteran TEs | `cur-source-bias.json` | not corrected (no evidence which is right) |

## 17. Data leakage findings

* E5–E8 use the same rules as E1–E4: rankings dated before the window, curves/σ/replacement fitted on earlier seasons,
  weekly start decisions use only earlier weeks (plus active status, which managers know before kickoff).
* The leak-free calibration refit (`calibrateBefore`) now applies exactly the production shape constraints, so the
  backtest evaluates what ships.
* E6 drafts and fixes rosters with one neutral preseason value so every candidate is scored on identical leagues; the
  trade outcome is measured on real weekly points the predictions never saw.
* The shipped calibration uses seasons through 2025 (appropriate for production; any backtest must refit, as E3 does).

## 18. Overfitting findings

2.2.0 adds **one** fitted number (the σ multiplier 0.4, chosen from a fold-to-fold range of 0–0.4 and a pooled optimum
of 0.4, confirmed by an independent experiment, E6) and **one** display-only number (the outcome slope 1.5, a single
logistic parameter on 5,000 trades). Everything else is a removal (SoS), a logic correction (current-season share,
injury rule) or a shape constraint (monotone hazard, unimodal aging) — constraints reduce degrees of freedom. Rejected
as overfit or unsupported: dynasty CV × 1.25 (best in 1 of 3 seasons), longer horizons, per-tier availability, β and
package-strength tweaks (±.006), volatility penalties.

## 19. Recommended changes (implemented unless marked)

| Priority | Change | Current methodology | Problem | Evidence | Benefit | Risk | Difficulty | Confidence |
|---|---|---|---|---|---|---|---|---|
| Critical | redraft σ × 0.4 | full forecast-error SD as option value | depth over-valued 24–57% (pre) / 2–4× deep (in season) vs stars | E5 (all robustness variants), E6 (5/5 seasons) | proportional values; better trade predictions | deep players fall a lot (they were inflated) | trivial (config) | high (preseason), medium (in season) |
| High | calibration shape constraints | flat default tails; partial monotonicity | non-monotone in age | monotonicity, E3 (equal ρ, better worst season and age bias) | sane age effects | tail decline is extrapolated | low | high |
| High | dynasty current-season share | full season at any week | mid-season over-statement; season-boundary jump | logic | time-consistent values | none measurable | low | high |
| Medium | dynasty injury = games lost | flat 35% IR | ignores week; inconsistent with redraft | logic | consistent injury handling | depends on the untested games-lost table | low | medium |
| Medium | SoS weight 0 | 0.5 strength on production | no gain; double counts | E2 17/20 | simpler | loses a small in-season signal if projections lag matchups | trivial | medium-high |
| Medium | trade outcome frequency (display) | verdict only | verdict over-read as certainty | E7 | honest communication | simulated managers are simple | low | medium |
| Done (2.3.0) | availability by tier | none in projections | stars miss fewer games than depth | §21 E11 | proportional depth values | small | low | medium-high |
| Done (2.3.0) | calibrated ± / verdicts | disagreement heuristic | ± covers 13% of outcomes; verdict and outcome line disagreed | §21 E10 | honest ranges, consistent verdicts | — | low | medium |
| Investigate | injury table, K/DEF | judgment | untestable | — | — | needs injury history | medium | — |

## 20. Remaining limitations

* **No archive for trade-market values**: their weight remains judgment. Projections and ADP turned out to have leak-free
  public archives (§21 E9). The app now keeps a daily signal archive (never pruned) and E13 backtests it — market
  included — once a season has been archived.
* **The ± range** is a source-disagreement heuristic. E7 shows the verdict levels are ordered correctly (53% / 58% / 71%
  won) but a "clear" edge is far from a sure thing; the displayed outcome frequency is from preseason redraft
  simulations and is only a rough guide in season.
* **E6 managers are simple** (start the best info-based lineup; one same-position waiver move a week; no further
  trades). Real managers differ; the comparison between candidates on identical leagues is what matters.
* **Dynasty outcomes beyond three seasons** cannot be validated with 2018–2025 data; horizon and discounts are
  partly preference.
* Contracts, coaching, college production and landing spot enter only through consensus/market; IDP, auction, best
  ball and custom K/DEF scoring are not modelled.
* **Most valuable future research:** all four items listed here in 2.2.0 were worked on in 2.3.0 (§21). Next: run E13
  after the 2026 season (market weight); dynasty verdict calibration (needs multi-season outcomes); bye weeks in the
  expected-lineup view; availability shape in dynasty.

Reproduce: `npm run audit-model` (everything, ≈2 min after the first benchmark download), `-- --only=e5,e6,e7,e8`,
`-- --rebuild`, `-- --freeze`, `-- --snapshot-before`, `-- --out=DIR` (see `scripts/audit-model.js`).

## 21. Research batch → model 2.3.0 (2026-10-03, later the same day)

Four open research items from §20, each with a walk-forward experiment in `npm run audit-model` (outputs
`reports/audit/e9…e13-*.json`, scorecard rows; the before/after in `before-after*.json` is now **2.2.0 → 2.3.0** on the
frozen `2026-10-03-f2898efc` dataset). E1–E4, E7 and E8 reproduced byte for byte; E5/E6 gained candidates only.

### E9 — signal weights from archives (projections, ADP)

**Finding: free, leak-free archives exist for two of the four untested groups** (`scripts/lib/signal-history.js`).
Sleeper (Rotowire) *weekly* projections for past weeks are frozen before each week (Aaron Rodgers, hurt in week 1 of
2023, keeps his week-1 projection and has none from week 2). Sleeper *season* projections and all of ESPN's past data
were revised after the fact (injured players stripped, Puka Nacua's 2023 projection raised to 1,004 yards; ESPN shows
his end-of-season ADP 44) — not usable. Preseason ADP: Sleeper 2020+ (`adp_*` in the season object) and
FantasyFootballCalculator 2019+ (final preseason window, dated before week 1). Trade-market values: no history.

| REAL HISTORICAL, walk-forward | ρ | MAE | note |
|---|---|---|---|
| Preseason 2021–25 (same sample, n ≈ 180/season): ECR | .478 | 56.8 | |
| week-1 projection | .472 | 58.0 | |
| ADP (Sleeper + FFC) | .486 | 57.0 | Sleeper alone .492, FFC alone .417 |
| **app weights** (consensus .40, projection .30, ADP .15, renormalised) | .490 | **56.6** | best MAE of every single signal and blend |
| weights fitted on earlier seasons (ADP .7–.9!) | .492 | 56.7 | no out-of-sample gain |
| In season (20 checkpoints, weeks 4–12, 2021–24): ROS ECR | .484 | 32.3 | |
| next-week projection × remaining games | .506 | 31.9 | projections out-rank ROS consensus |
| production (app formula) | .467 | 32.7 | |
| **app weights** | .511 | **31.5** | no fitted blend beat it on MAE overall; fitted production weight 0, consensus .6–.7, projection .3–.4 |

**Decision: weights unchanged** — they sit on a flat optimum; production's 0.10 makes no measurable difference either
way. The market weight still cannot be tested, so the app now writes a **daily signal archive**
(`server/archive.js`, `data/archive/signals-YYYY-MM-DD.json.gz`, ≈130 KB/day, never pruned, `FFTA_ARCHIVE=0` turns it
off) and **E13** (`scripts/audit/archive-backtest.js`) runs the same comparison with the market group once a completed
season is archived (skips with instructions until then; tested on a synthetic archive). Caveat: one projection source
(Rotowire) is testable, and the in-season projection proxy is a single week's projection × remaining games.

### E10 — is the ± range calibrated?

Signal disagreement rebuilt for past preseasons (consensus, projection, ADP; no market). Player level, 878 players
(2021–25, ≥60 projected points):

* The app's ± (median **5.5%** of value here) contained only **13%** of season outcomes — it measures how much the
  sources disagree about the *estimate*, not the season. Median absolute outcome error: **29%**.
* Disagreement does carry information: Spearman with the outcome error +.125 (positive for every position); median
  error 25% → 29% → 35% from the low to the high disagreement tercile.
* Realised ÷ predicted points by predicted points per game (preseason and in-season pooled, 4,719 player-windows):
  < 8 ppg 80% range 0.29–1.77, 8–12 0.36–1.62, 12–16 0.50–1.46, 16+ 0.47–1.36 (window length hardly matters).

Trade level (E6 trades, walk-forward one-parameter fits, test log-likelihood per trade): margin logistic −.595, z with
σ = 10% of value −.595, z with the app's disagreement σ −.591, disagreement-only σ −.641. The app's σ adds almost
nothing over the margin, and disagreement alone is worse. With the reconstructed σ, z put 74% of trades in "clear"
and "close"/"lean" won equally often (56% / 56%). On real data the app's σ is larger (market and in-season
disagreement; median 24% of value in redraft), but **23% of random redraft trades showed a verdict level that
contradicted the outcome frequency printed under it** (e.g. "Close — roughly fair" above "went B's way about 70%").

**Implemented (2.3.0):** redraft verdict levels come from the calibrated frequency itself — close < 60%, lean 60–70%,
clear ≥ 70% (`trade_outcome.levels`; classified on the rounded figure the user sees). Dynasty keeps the z levels (no
outcome data). The player view shows a **range of outcomes** from the table above (`redraft.outcome_range`, display
only); Help explains that the ± is source disagreement.

### E11 — stars miss fewer games than depth

Share of team games played by ECR positional rank (2019–2025, windows from weeks 1/5/9; `e11-availability-shape.json`):
RB 1–6 ≈ .86, RB 25–48 ≈ .76; WR .87 → .80; TE flat to rank 18; QB/TE beyond ~24 drop to .3–.7 because backups don't
play — a role, which projections already price in. Healthy-season projections (17 games for 609 of 641 Sleeper
projections) ignore all of it.

**The 2.2.0 test of availability was mis-specified**: it multiplied *points* by availability before the replacement
level was set, which also lowers the replacement level and shifts every surplus. A missed game costs that week's
*surplus* (the replacement plays), so the right form is `value = availability × healthy surplus`. Results:

| Candidate (σ × 0.4) | E5 loss pre / wk5 / wk9 / k2 / k8 | E6 corr | E6 per season 2021–25 |
|---|---|---|---|
| no availability (= 2.2.0 app) | .033 / .213 / .806 / .034 / .041 | .549 | .421 .695 .496 .519 .609 |
| 2.2.0 test: points × availability | — | .527 | lower in 5/5 |
| per-game, one share per position | — | .541 | lower in 5/5 |
| per-game, smooth curve (absolute) | — | .545 | lower in 5/5 |
| **per-game, within-position shape, flat beyond 2× starters (2.3.0)** | **.018 / .208 / .690 / .028 / .028** | **.552** | **.423 .697 .500 .522 .612** |

Paired bootstrap over trades: +.0035 (95% CI .0029–.0041). Absolute shares (QB .85 vs RB .81) hurt: cross-position
balance is already right, only the within-position shape helps. **Implemented** as `redraft.availability_shape`
(knots = the fitted curve rounded; component "Availability (games played)"; ± scaled with the value). Frozen-data
effect (12-team 1QB PPR, value ≥ 100): median −5.7%, depth down up to 18% (RB24 1,396 → 1,303; WR48 657 → 594),
top-10 unchanged, elite QB/TE −1…−5% relative to elite RB/WR; dynasty unchanged; monotonicity 1 failure (unchanged).

### E12 — roster-specific values (E6 simulator)

Each E6 trade re-predicted from preseason information with what it does to the two rosters:

| Predictor | corr with realised margin | corr with each team's own gain | seasons better than generic |
|---|---|---|---|
| generic values + package (the verdict) | .549 | .500 | — |
| Δ lineup value (My Team, generic values of the best lineup) | .562 | .526 | 3 of 5 (1 tied, 1 −.001) |
| Δ starters' projected points per game (My Team until 2.3.0) | .538 | .490 | 1 of 5 |
| **Δ expected lineup points** (availability, bench cover, waiver fill-in) | **.576** | **.547** | **5 of 5** |

Realised gain ≈ 0.80 × predicted; a team whose expected lineup rose 1 / 3 points per week gained 55% / 65% of the time
(4+: 81% observed). When generic and roster views disagree on the direction (8% of trades), the roster view was right
53% vs 46%. **Implemented:** My Team and the trade lineup block show **expected lineup points per week** before → after
with that historical frequency (`roster.js expectedLineupPoints`, `trade_outcome.roster_logit_slope_per_week` 0.2),
replacing the starters' points-per-game line. The verdict itself stays league-generic (the same trade means different
things to the two teams). Caveats: the simulator's outcome is also lineup points, so the expected view shares its
structure; byes are not modelled; simple managers (§20).

## 22. Trade finder audit (E14, 2026-10-03, third session)

**Feature.** My Team → "Trade finder: what could I offer?" (and on the Trade page when you are one side and have added
only the asset you want): for a target player or pick, packages of 1–3 assets from your saved team that the model calls
fair for **both** sides and that improve **your** team most, a few diverse options. `js/core/trade-finder.js`
`findTradePackages`. No value changes (asset values, verdicts and `model_version` 2.3.0 untouched); `analyzeTrade` gained
a per-run cache of its value curves (identical numbers, ~8× faster, which also speeds up "Even it out").

**Rules.** Every package of up to 3 of your 30 most valuable unprotected assets is scored exactly with `analyzeTrade`
(package adjustment included). *Fair*: the verdict calls it close ("even") and your value edge lies in
[−15%, +maxEdge], maxEdge = 5% by default ("Strict"; "Balanced" 10%, "Model's close" = the verdict band). *No
throw-ins*: a package is dropped when a smaller part of it would already be acceptable to the other side (they receive
at least as much, or the gap is inside the band and close). *Improves*: redraft = expected lineup points per week after −
before (E12's best predictor), ≥ +0.1; dynasty = value of the best starting lineup after − before. *Diverse*: each of
your assets in at most 2 of the (up to 5) options. *Owner known* (a saved roster of the league holds the target, e.g.
all teams imported from Sleeper): options are ranked by **your + their** gain; their roster is trimmed back to its size
after they receive extra players (they drop their lowest values). "Never offer" per team.

**Experiment E14** (`scripts/audit/trade-finder.js`, `npm run audit-model -- --only=e14`; REAL HISTORICAL outcomes,
SIMULATED leagues = the E6 simulator: 12-team 1QB PPR, 13-man rosters drafted on preseason values fitted on earlier
seasons, weekly lineups and waivers, real weekly points 2021–2025). 3,000 (my team, target on another roster) requests
on seed 14 and an independent 3,000 on seed 99; each strategy picks a package, the trade is applied after the draft (E6's
drop/sign step keeps rosters legal) and the season is replayed. Realised gain = season points with − without the trade.

| Strategy (seed 14) | found a package | my realised gain (95% CI) | my gain > 0 | their realised gain |
|---|---|---|---|---|
| **Finder (app): top option** | 21% | **+6.4 (0.1, 12.6)** | 52% | −18.7 |
| Finder: any option shown (mean) | 21% | +6.6 (0.8, 12.3) | 52% | −18.6 |
| Ranked by lineup value instead of expected points | 21% | +7.9 (1.7, 14.0) | 54% | −20.6 |
| Value only: most evenly valued fair package | 89% | −16.5 (−19.7, −13.3) | 42% | −16.3 |
| Random fair package | 89% | −19.8 (−23.0, −16.7) | 40% | −18.4 |
| maxEdge 0% / 10% / verdict band | 17% / 28% / 38% | +2.8 / +9.1 / +9.7 | — | −19.0 / −22.7 / −29.5 |
| Their roster known, ranked by my + their gain | 21% | +6.5 (0.2, 12.8) | 52% | **−12.2** |

Context: in this simulator any trade costs both teams on average (roster churn; the random fair package: −19.8 / −18.4),
so "their gain" is judged against the value-only baselines, not against zero.

**Paired on the same requests** (finder top − alternative; seed 14 / replication seed 99):

| Comparison | my team | their team |
|---|---|---|
| vs random fair package | **+13.4 (7.8, 19.0)** / **+11.5 (6.2, 16.7)** | +4.4 / +2.1 (n.s.) |
| vs most evenly valued package | +5.0 (−0.5, 10.4) / **+15.0 (9.9, 20.1)** | +2.7 / −2.1 (n.s.) |
| vs owner-aware ranking (my + their gain) | +0.2 / +1.6 (n.s.) | **−6.5 (−9.6, −3.3)** / **−5.9 (−9.4, −2.5)** |
| vs owner-aware ranking (smaller of the two) | −0.5 / **+4.6 (1.0, 8.3)** | −5.1 / −7.4 |
| vs maxEdge 0% | **+5.7 (1.7, 9.8)** / **+6.5 (2.9, 10.2)** | −0.8 / −3.3 (n.s.) |
| vs verdict band ("Model's close") | −6.1 (−10.7, −1.5) | **+7.1 (2.9, 11.3)** |
| vs packages of ≤ 2 assets | +1.0 / +2.1 (0.3, 3.9) | −2.6 (−4.0, −1.2) / −2.1 (−4.0, −0.1) |
| vs a size penalty (0.5 pts/wk per extra asset) | 0.0 | +0.4 (n.s.) |
| vs no throw-in rule | 0 (identical top option: giving more can never raise my lineup) | 0 |

**Decisions.** (1) Ship the finder: its packages help the team that makes them (+6.4 / +6.6 season points on the two
seeds) and beat value-only choices by 11–15 points without measurable harm to the other team. (2) Default fairness
Strict (5%): 0% cost the proposer ~6 points with no measurable benefit to the other side; the verdict band costs the
other side ~7 points; 10% is roughly neutral and offered as "Balanced". (3) Owner known → rank by the sum of both gains
(+6 points for the other team on both seeds, no measurable cost to the proposer); "smaller of the two" cost the proposer
4.6 on one seed. (4) Keep 3-asset packages (2-asset caps move ~2 points from proposer to the other side; a size
penalty does nothing). (5) The no-throw-in rule stays for the list (it never changes the top option). (6) Show the
calibration honestly: predicted gains (~14.6 season points) are ~2.3× the realised ones, and within the finder's own
options predicted gain does not separate better from worse ones (corr .01; all shown options are about equally good),
so the UI says "about 6–7 points over a season on average, with a lot of luck trade to trade".

**Current data** (`2026-10-03` dataset, every preset × redraft/dynasty, 60 requests each, 3 fairness presets; §E14
`currentData`): 0 rule violations (fair by an independent `analyzeTrade`, no throw-in, gain, roster membership,
diversity); coverage strict 50–95% (a value-drafted league has more fitting targets than random ones); p95 search time
23–71 ms (max 86). Redraft with the owner's roster known, their expected lineup change for the top option goes from
−2.5…+0.2 to −0.2…+1.6 pts/week. **Dynasty caveat:** ranked by starting-lineup value, top options are consolidation
trades that cost the other team 800–2,800 lineup value (value-fair overall, more depth for them); owner-aware ranking
halves that. No multi-season outcome test exists for dynasty — judgment, stated in the UI.

**Bugs found by the audit (fixed before release).** (a) With a wide band every superset of any single asset was
treated as having a throw-in (a lone asset that left the other side clearly short counted as "enough") — the "Model's
close" preset found *fewer* packages than Strict; "enough" now means acceptable to the other side. (b) Two identical
generic picks listed the same package twice. (c) The other team's predicted gain counted the players they would have
to drop as bench cover. Each has a regression test (`tests/trade-finder.test.js`).

**Limits.** E14 is redraft, 12-team 1QB PPR, trades right after the draft, simple simulated managers; it cannot test
whether a real manager accepts. The finder never sees the other team's roster unless it is saved.

## 23. Dynasty outcomes, byes and the ADP-only question → model 2.4.0 (2026-10-03, fourth session)

Three items left open by §20–22 and the handoff backlog: dynasty verdicts were z-score levels with no outcome check
(usability G-28: 3 in 4 random dynasty trades "clear"), the trade finder had no dynasty test (§22 "dynasty caveat"),
and expected lineup points ignored byes (§21 E12 caveat). Plus the decision on ADP-only players (handoff §35 item 4).

**E15 / E16 harness** (`scripts/audit/dynasty-league.js`, `npm run audit-model -- --only=e15,e16`; REAL HISTORICAL
outcomes, SIMULATED leagues). Start seasons 2020–2023 (outcomes through 2025). Values = the app's dynasty blend without
the market (no market history exists): the preseason FantasyPros dynasty ECR (archive snapshot before week 1) mapped by
positional rank onto the reduced fundamental curve, blended with the player's own fundamental at the app's weights
(consensus .40, fundamental .25, renormalised) — calibration refitted on seasons before the start (as E3/E8). 12 teams
snake-draft 20-man rosters (QB ≤ 3, RB ≤ 7, WR ≤ 8, TE ≤ 3; 393–452 ranked players per start season). Seasons Y, Y+1,
Y+2 are each replayed with E6's `simulate` (weekly best active lineup from preseason ranks + points so far, one waiver
pickup a week, real weekly points); later rookies reach rosters only via waivers, for every team alike. Outcome for a
team = Σ_k 0.82^k × (season k lineup points with the trade − without), 0.82 = the balanced dynasty discount. Not
covered: draft picks (no historical pick values or rookie drafts), Superflex, TE premium.

**E15 — dynasty verdict calibration.** 5,000 random trades (1-for-1 … 4-for-2) per seed, seeds 15 and 99; app margin
(difference / larger side) incl. the dynasty package adjustment.

| Margin | favoured side ahead after 3 seasons (seed 15 / 99) |
|---|---|
| 0–5% | 52% / 46% |
| 5–10% | 49% / 53% |
| 10–20% | 52% / 56% |
| 20–30% | 62% / 60% |
| 30–50% | 67% / 69% |
| 50–75% | 75% / 75% |
| 75–100% | 81% / 81% |

Logistic fit P = 1 / (1 + e^(−k·|margin|)): **k = 1.75 on both seeds** (per start season 1.5–2.0; redraft E7: 1.5).
With the app's levels (shown frequency < 60% close, 60–70% leans, ≥ 70% clear) that is close < ~17% margin, leans
17–42%, clear ≥ ~42%; in the simulation the favoured side came out ahead 51% / 64% / 77% (seed 15) and 51% / 64% / 78%
(seed 99) in those levels — each level means what it says. The dynasty package adjustment neither helped nor hurt
(corr with the outcome .618 vs plain sums .616; replication .616 vs .617) — kept as is (the backlog's "package
adjustment in dynasty" question: no evidence to change it).
**Implemented (2.4.0):** `trade_outcome.dynasty_logit_slope` 1.75; dynasty verdicts use the same outcome levels as
redraft (`assessment.basis = 'outcome'`), and the trade view shows "trades with this margin left Team X ahead over the
next three seasons about N% of the time". Removing the slope restores the z levels. On current data (frozen
`2026-10-03-27fa2592`, 3,000 random trades among the top 240 players): dynasty "clear" 73.6% → 66.3% (12-team 1QB),
70.4% → 61.9% (12-team SF); about one trade in five changes level, mostly clear → leans. Asset values are unchanged.

**E16 — the trade finder in dynasty.** Same leagues; 2,000 (my team, a target on another roster) requests per seed,
seeds 16 and 99; the app's finder (dynasty: ranked by starting-lineup value, Strict 5%, minimal, verdict = the new
dynasty levels) vs a random fair minimal package and the most evenly valued one; owner-aware ranking (my + their gain).

| Strategy | found a package | my 3-season gain (seed 16 / 99) | their 3-season gain |
|---|---|---|---|
| **Finder (app): top option** | 29% / 31% | −0.6 / **+14.2** | −40.9 / −41.0 |
| Most evenly valued fair package | 91% | −25.0 / −14.4 | −41.4 / −30.2 |
| Random fair package | 91% | −27.2 / −12.0 | −37.4 / −34.3 |
| Owner known: my + their gain | 29% / 31% | 0.0 / +9.7 | **−23.4 / −17.8** |

Paired on the same requests (finder top − alternative): vs random fair **+30.5 (16.9, 44.1) / +23.3 (11.6, 34.9)** for
me, their team −3.3 / −2.1 (n.s.); vs most even **+28.6 / +27.5** for me, theirs +6.0 / −7.7 (n.s.); owner-aware vs
finder: me +0.6 / −4.6 (n.s.), them **+17.5 (8.8, 26.1) / +23.2 (15.7, 30.6)**. As in E14, any trade costs both teams
on average in the simulator (roster churn), so the other team's number is judged against the baselines: the finder's
consolidation tilt (§22 caveat) costs the other team no more than a random fair trade, and the owner-aware ranking
removes about half of it. **Decision:** no code change — the dynasty finder's ranking and the owner-aware default are
confirmed; the UI caveat is replaced by these numbers. Picks remain untested.

**Byes in expected lineup points (E12 re-run).** `expectedBye` = the E12 predictor averaged over the season's weeks with
each player out in his team's bye week (same availability draws, so it differs by the byes only). Corr with the realised
margin .576 → **.577** (equal or better in all 5 seasons), own gain .547 → **.549**; `expected` reproduced exactly.
**Implemented (2.4.0):** `roster.js expectedLineupPoints({bye, weeks})`, `expectationInputs` passes the remaining weeks
(in season: current week → `phase.regular_season_weeks`; preseason: all; after the season none — next year's byes are
unknown) and each player's bye (`details.bye` on redraft assets). Two starters sharing a bye now cost more than a bench
that covers it.

**ADP-only players (handoff §35 item 4) — kept, decided on evidence.** 1,225 of 2,206 players (current data) have only
ADP. Pruning them shrinks `dataset.json` 4.85 → 3.77 MB (gzip as served 654 → 482 KB) and valuation time ~10–20%, but it
is **not value-neutral**: ADP is mapped by overall rank among the dataset's players, so removing them moved 1,706 other
redraft ranks and values by up to 12% (dynasty unchanged), and it would drop deep rookies/UDFAs from Sleeper roster
imports (1,224 of them carry a Sleeper id). No change to the dataset. The measurement exposed one real issue, fixed:
**an IR player's imputed zero projection counted as corroboration for ADP** (`redraft.adp_requires_corroboration`), so a
player out for the season kept about a third of his draft-position value (e.g. Jayden Higgins 94, Hayden Large 24 in
12-team SF). Since 2.4.0 the imputed zero does not corroborate; such a player is valued from the zero projection alone,
as without an ADP (0). Frozen-data diff (`2026-10-03-27fa2592`, all 7 presets × both modes): 40 of 12,425 asset values
change, all redraft, all to 0; nothing else moves.
