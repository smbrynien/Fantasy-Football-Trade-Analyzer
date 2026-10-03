# Valuation Model (common framework + redraft)

Model version: see `model_version` in [`config/model.json`](../config/model.json) — **2.3.0** after the research batch
in [MODEL_AUDIT.md §21](MODEL_AUDIT.md) (2.2.0 was the second model audit, 2026-10-03; the first, 2.0.0, is
[MODEL_AUDIT_2.0.0.md](MODEL_AUDIT_2.0.0.md)). Every
parameter mentioned here is configurable there or in **Settings** (per league profile, stored as `overrides`).

Code: `js/core/valuation/` — `engine.js` (orchestration), `context.js` (inputs), `replacement.js` (scarcity),
`mapping.js` + `blend.js` (normalization/blending), `redraft.js`, `dynasty.js`, `picks.js`, `confidence.js`, `trade.js`.

## In plain English

**What is being measured?** How much a player (or pick) helps a team in *your* league win, compared with the free
player you could pick up instead. Redraft: points above that "replacement" player for the rest of this season.
Dynasty: the same idea over the next five seasons, with later seasons counting less.

**Why these inputs?** Each one sees something the others miss: expert rankings (the most accurate single input in
every historical test), projections (stat-level forecasts you can re-score for your league), trade markets (what real
managers pay), draft position (crowd opinion), and actual production (what has happened this season). Many sources
are copies of each other — e.g. DynastyProcess values are built from the FantasyPros rankings — so copies get no extra
weight.

**How are they normalised?** Sources speak different languages (rank 14, value 6,200, ADP 31.5, 210 points). We never
average those numbers. We only use each source's *order*: if experts rank a player as the 14th RB, he gets the value of
the 14th-best RB in your league. Your league's math sets how much the 14th RB is worth.

**How are they weighted?** By how well they predicted outcomes in walk-forward tests on 2018–2025 data: expert
consensus gets the most weight all season (it never stopped beating "just use his stats" even late in the year);
projections and market follow; actual production gets a small in-season weight. If a player lacks a source, the
weights are re-spread over what he has and his confidence drops — nothing is invented.

**Why does league format matter?** Value is points *above replacement*. In Superflex, 24+ QBs start, so the free QB is
bad and every startable QB is precious. TE premium makes good TEs score more than the free TE. More teams or starters
push replacement down and make depth more valuable.

**Why does age matter in dynasty?** Players improve, peak and decline at different ages by position (RBs peak earliest),
and some leave the league each year. We measured this on 20 years of data and discovered our first curves declined too
gently (players who collapse leave the data), so the decline is now steeper — which removed a bias that over-rated
27+-year-olds.

**How are picks valued?** A pick is worth the average value of whoever it will become: today's trade-market prices
for picks, how past rookie classes turned out by draft slot, and the strength of the current class. Unknown slots are
averaged; picks in later years are discounted.

**What does a value number mean?** Values are *points above replacement*, rescaled so the best players are near
10,000. The scale is cardinal, not just an order: 8,000 is about twice the expected lineup surplus of 4,000 in that
league. But two 4,000 players are not one 8,000 player in a trade — you can start only so many — which is what the
package adjustment handles. Values are estimates: the **±** shows how much the sources disagree, and the numbers are
rounded to 10 (the last digits mean little).

**How is uncertainty handled?** Three ways. (1) A little *option value* is part of the value: a player whose role
could grow is worth slightly more than his average forecast, because you can start him if it happens. In 2.2.0 this
is much smaller than before — tests on real seasons showed that only a player's lasting role uncertainty helps you;
week-to-week randomness and missed games don't, and counting them made bench players look too valuable next to stars.
(2) The **±** next to each value shows how much the sources disagree. Trades are judged by the difference *relative*
to that uncertainty ("close", "leans", "clearly ahead"), never by a raw number alone. (3) In redraft the trade view
also says how often trades with that margin actually worked out over a season in historical league simulations — even
a "clear" edge goes the other way about 3 times in 10, because a fantasy season is noisy.

## 1. One currency: surplus points in YOUR league

Different sources live on different scales (ranks, 0–10,000 values, ADP, projected stat lines). Nothing is averaged
raw. Every signal is converted to **league-scored fantasy points above the positional replacement level**:

* **Redraft:** rest-of-season points.
* **Dynasty:** discounted multi-year expected surplus (see DYNASTY_MODEL.md).

### Replacement levels (`replacement.js`)

From your settings: `teams × slots` starters per position, then FLEX and SUPERFLEX filled greedily with the best
remaining eligible players. For each position:

* **replacement** = midpoint of the last starter and first non-starter,
* **waiver** = first unrostered player (bench spots allocated to QB/RB/WR/TE in proportion to starters),
* **displacement** = the average team's worst starter (rank ≈ starters − teams/2), used by package adjustments.

Surplus is **expected surplus**: rest-of-season points are uncertain, X ~ Normal(projected points, σ), and

`surplus = E[max(0, X − replacement)] + bench_value_fraction × (E[max(0, X − waiver)] − E[max(0, X − replacement)])`

with σ = SD-per-game × remaining games (`redraft.uncertainty.sd_per_game`). **2.2.0: in season QB 2.2, RB 1.8,
WR 1.7, TE 1.5; preseason 2.0/1.7/1.5/1.2** — 0.4 × the 2.0–2.1 table (5.5/4.4/4.3/3.8 and 4.9/4.2/3.8/3.1). The old table
was the *total* forecast-error SD (weekly noise and missed games included) and was validated against a target with
hindsight (`max(0, season points − replacement)` assumes you knew whom to start). Measured against what players
actually added to lineups when start decisions were made before each week (audit E5), it over-valued ranks 13–72
relative to the top 12 by 24–57% preseason and up to 2–4× deep in season; 0.4× was best preseason and far better in
season, and predicted the outcomes of 5,000 simulated historical trades better in all five seasons (E6). Only the
option value of a player's persistent rate is real: you cannot sit a player before his bad weeks. A zero projection
(ruled out) has no option value; σ = 0 restores the deterministic formula. Bench players are worth something (depth),
starters much more. This is where positional scarcity, superflex QB
scarcity, TE premium and league depth come from — no generic positional multipliers.

### Scale

`value = surplus × factor`, `factor = 7,000 / mean(surplus of the top-12 assets in the reference league: 12-team 1QB
PPR)` — the best asset lands near 10,000. The same factor applies to your league, so a superflex QB can exceed 10,000
and values are comparable across leagues. (v1 divided by the single top asset's surplus, which made that asset's value
insensitive — even slightly non-monotone — in its own inputs.)
Values display rounded to 10 with an approximate fair-value range.

## 2. Signals and how each is normalized

| Signal | Inputs | Conversion |
|---|---|---|
| **Projection** | ROS projections from each projection source (Sleeper/Rotowire weekly, ESPN weekly, manual), summed over the remaining weeks (completed games excluded) | Re-scored with your scoring (TE premium, first downs, bonuses) → weighted mean of points → surplus |
| **Production** | Weekly actual stats (nflverse; Sleeper fallback) scored with your settings, blended 75/25 with **opportunity-based expected points** (targets/carries/attempts × league-average points per opportunity at the position), regressed toward last season's PPG with 2 pseudo-games (players without a last season: ≥3 games required, regressed to the positional median), × remaining games × **availability** (QB .80, RB .77, WR .83, TE .82), minus injury games. Strength of schedule: weight 0 since 2.2.0 (see below) | surplus |
| **Consensus** | ROS/redraft expert rankings (FantasyPros ECR, manual rankings) | **Positional-rank mapping**: k-th RB by experts → value of the k-th RB on your league's curve |
| **Market** | Redraft trade values in the best-matching format (FantasyCalc, manual): same QB format required (a source with only 1QB lists is **not used** in Superflex/2QB leagues and vice versa — shown on the player's Market & sources tab), then closest PPR, team count and **TE premium** (a list's `tep` vs your `bonus_rec_te`) | Positional-rank mapping |
| **ADP** | Redraft ADP (Sleeper, FFC, ESPN, manual) in the matching scoring/QB format | Overall-rank mapping. **Corroborating only** (2.1.0): a player whose only usable signal is ADP gets no value (N/A) |
| **Trend** | Market source's own 30-day trend | displayed only (weight 0 since 2.0: no evidence it predicts outcomes, and it is already in the market level) |

Positional-rank mapping keeps each source's *ordering and sentiment* while the *magnitudes* come from your league's
math — sources don't know your TE premium or bench size. Raw source values remain visible in the player view.

Source weights inside a group (`source_weights`): FantasyCalc 1.0 (real trades), KTC 1.0, **DynastyProcess player
values 0** (a transform of FantasyPros ECR: within-position ρ = 0.99 — counting it would double-count consensus; still
displayed; DP *pick* values keep 0.8), Sleeper/Rotowire projections 1.0, ESPN 0.8, manual 0.8–1.0. Apart from the DP
finding these are judgment defaults (no free history exists to fit them) and are user-adjustable.

## 3. Blending and phase awareness

`score = Σ wᵍ·signalᵍ / Σ wᵍ (available)` — weights renormalize over the signals a player actually has.
Missing signals are never imputed; they lower confidence instead.

**ADP needs corroboration** (`redraft.adp_requires_corroboration`, default true since 2.1.0). Long ADP lists rank
hundreds of undrafted and out-of-league players by placeholder or stale draft positions (one source assigns ≈170 to
every undrafted player; another runs to ADP ≈500). Mapped by overall rank onto the expected-surplus curve, those deep
positions still carry a small positive value, and renormalizing a lone ADP group to 100% turned it into real value
(e.g. a retired QB at 417 in 12-team 1QB). Redraft therefore values a player only if at least one other signal
(projection, production, consensus or market) exists; ADP then contributes at its normal weight. Players with ADP alone
are N/A, like players with no signal. Setting the flag to false restores the 2.0.0 behaviour.

Weights interpolate from the **preseason** set (consensus .40, projection .30, market .15, ADP .15, production 0) to the
**in-season** set (consensus .45, projection .30, market .15, production .10, ADP 0) linearly between week 1 and
week 8. Evidence (audit §5): expert consensus was the most accurate signal at every checkpoint (weeks 4–12, 2021–2024)
and its fitted weight stayed 0.8–1.0 all season; v1's in-season production weight of .30 was not supported. The
projection and market weights cannot be backtested (no archives) and are judgment. Offseason/preseason use full-season projections for the upcoming season.

The breakdown always sums to the final value: `contributionᵍ = wᵍ·signalᵍ / Σw`. Production is split into
"production" and "injury" (games lost × rate) so the injury effect is explicit.

### Injuries

Structured status only (no speculation). Official NFL report (nflverse) for game designations; reported roster
status (Sleeper, else ESPN) for IR/PUP/NFI/Suspended. Expected games lost: Out 1, Doubtful 0.8, Questionable 0.25,
IR/PUP/NFI 5, Suspended 3 (configurable). Players on a long-term list who are **absent** from in-season weekly
projections are treated as projected for zero (the projection sources ruled them out) rather than "missing".

### Strength of schedule (off since 2.2.0)

`redraft.production.sos_strength` scaled the production signal by remaining opponents' fantasy points allowed. In the
walk-forward in-season test (E2, 20 checkpoint-seasons 2021–2024) the production forecast *without* it was at least as
accurate in 17 of 20 and better overall (ρ .459 vs .453, MAE 35.6 vs 35.7). The projections it is blended with are
already built on weekly matchups, so a separate multiplier double counts. The default is 0 (configurable; the detail
is still shown in the player view).

### Availability (2.3.0: stars miss fewer games than depth players)

Production is scaled by measured availability per position (QB .80, RB .77, WR .83, TE .82). Projections assume a
healthy season (17 games), and availability differs more by *depth* than by position: from 2019–2025, top-12 RBs played
≈ 86% of their team's games, RBs ranked 25–48 ≈ 76% (`reports/audit/e11-availability-shape.json`). Since 2.3.0 each
redraft value is multiplied by `redraft.availability_shape`: the share of games played at the player's positional rank
**relative to the position's starters** (RB/WR stars ×1.05, depth down to ×0.91–0.93; QB ×1.04 → 0.86 at QB24; TE flat
to 18), linear between knots, flat beyond 2× 12-team starters (deeper, not playing is a backup's *role*, which
projections already contain). It shows as the "Availability (games played)" component. Why this form: a missed game
costs the player's *surplus* that week (the replacement plays), so value = availability × healthy surplus; only the
within-position shape helped — absolute position shares, and scaling projected *points* (the form 2.2.0 tested and
rejected), predicted trade outcomes worse (E6 .541 / .527 vs .549; 2.3.0 .552, better in all five seasons). Dynasty
is unchanged.

### Not modelled separately (deliberately)

Offensive environment, QB situation, coaching changes and depth-chart role are captured by projection and market
sources; adding hand-made adjustments would double count. Depth chart order is displayed.

## 4. Confidence (`confidence.js`)

Heuristic score 0–100 = coverage^0.6 × agreement × sample × freshness × independence:

* coverage: share of configured weight with available signals
* agreement: 1 − 0.6·min(1, CV/0.6) of the signal values (cross-signal dispersion)
* sample: games played this + last season (rookies capped)
* freshness: any stale source used → ×0.85
* independence: <2 independent source groups → ×0.75

High ≥ 65, Moderate ≥ 40. The **fair-value range** is ±max(floor%, signal SD), floor = 5% + 10%×(1 − coverage).
This is not a statistical confidence interval and is labelled as such: it measures how much the sources disagree. In
2.3.0's check (E10) the reconstructed ± contained only 13% of season outcomes (median miss 29%), though players with
more disagreement did miss by more (25% → 35% across terciles). The player view therefore also shows a **range of
outcomes** (redraft, display only, `redraft.outcome_range`): what players projected at the same points per game actually
scored, 2021–2025 — e.g. at 8–12 points per game half finished within 0.70–1.36× the projection and 8 in 10 within
0.36–1.62×.

## 5. Trades (`trade.js`)

* Totals, absolute and % difference, per-component differences, each signal compared separately (market vs model).
* Uncertainty: `σ_diff = √(Σσ_A² + Σσ_B²)` (independence assumed). **Verdict levels** — never "good/bad trade":
  redraft (2.3.0) from the historical outcome frequency below, rounded as shown: < 60% "close", 60–70% "leans", ≥ 70%
  "clearly ahead" (`trade_outcome.levels`; ≈ margins < 27%, 27–56%, ≥ 56%). Before 2.3.0 redraft used z, and 23% of
  random trades showed a level that contradicted the frequency printed under it (E10). Dynasty: `z = |diff|/σ_diff`,
  < 1 "close", 1–2 "modest edge", > 2 "clear" (no outcome data to calibrate against).
* **How often it works out** (2.2.0, redraft only, display only): `P = 1 / (1 + e^(−1.5·|margin|))`, margin =
  difference / larger side (`trade_outcome.redraft_logit_slope`). Fitted on 5,000 random trades in historical league
  simulations (E7, 2020–2025 seasons, real weekly points): margins of 10% / 30% / 50% came out ahead 54% / 61% / 68%
  of the time; the verdict levels (with typical ±10% asset ranges) won 53% ("close"), 58% ("modest edge") and 71%
  ("clear"). It describes season-long luck; it does not change any value. Dynasty outcomes cannot be validated, so
  dynasty trades don't show it.
* **Package adjustment** for the side receiving more players: each extra (lowest-valued) player is charged
  `strength × min(its value, value of the average team's worst starter at that position) + cost × value of the last
  rostered player`, keeping at least `min_retained_fraction` of its value. Picks are exempt. Redraft strength 1.0;
  dynasty 0.6 (rosters evolve, future value is partly liquid). The arithmetic is shown on screen. Tested against real
  outcomes in 2.2.0's audit (E6): with it, predicted margins tracked realised season outcomes better than plain sums in
  every season (corr .542 vs .523; uneven trades .540 vs .522); strengths 0.5–1.5 and a doubled roster-slot cost were
  within ±.006 — kept.
* Dynasty extras: value-weighted age; win-now vs future split.
* **Your team** (My Team, 2.3.0, `roster.js expectedLineupPoints`): expected lineup points per week before → after —
  every rostered player available with his availability (position share × availability shape × current injury), the
  best available lineup starts, empty slots at the league's waiver level (Monte Carlo, deterministic). In historical
  league simulations it predicted what a trade did to a team better than generic values (E12: .576 vs .549, 5/5
  seasons) and replaced the starters' points per game (.538). Shown with how often teams with that change gained
  (`trade_outcome.roster_logit_slope_per_week` 0.2: +1 / +3 points per week → 55% / 65%). It is roster context, not a
  value change; the verdict stays league-generic.
* Every calculation carries model version, data version, settings hash, league and source timestamps; saved trades
  can be re-checked later ("Why changed?").

## 6. Backtesting (`npm run backtest` → reports/backtest.json; full audit: `npm run audit-model`)

Spearman correlation of preseason orderings with realised PPR points (2019–2025, FantasyPros ECR archive + nflverse):

| Position | ECR ρ | Last-season PPG ρ (same players) |
|---|---|---|
| QB | 0.37 | 0.31 |
| RB | 0.53 | 0.44 |
| WR | 0.51 | 0.38 |
| TE | 0.40 | 0.31 |

Dynasty ECR vs realised 3-season surplus (2020–2023): ρ ≈ 0.56–0.62 vs 0.37–0.45 for last-season PPG.
Consensus clearly adds information beyond production — and correlations far below 1 are why the app shows ranges
and never claims precision. Projections, ADP and trade markets could not be backtested (no free history). The
walk-forward audit (in-season checkpoints, dynasty with leak-free recalibration, rookie curve forms, value-scale bias)
is in [MODEL_AUDIT.md](MODEL_AUDIT.md); candidate models are compared in [MODEL_COMPARISON.md](MODEL_COMPARISON.md).

## 7. Versioning

| Version | Changes |
|---|---|
| 1.0.0 | initial model |
| 2.0.0 | audit: expected surplus; consensus-dominant redraft weights; production x .25 / k 2 / availability / median prior with ≥3 games; trend display-only; DP player values weight 0; dynasty weights .25/.35/.40/0, aging power 2, prior k 20, evidence gate; least-squares exponential rookie slot curve; top-12 scale anchor |
| 2.1.0 | redraft: ADP is corroborating only (`redraft.adp_requires_corroboration`); ADP-only players are N/A instead of being valued from deep ADP ranks. No other value changes (verified on the frozen 2026-10-02 dataset: all 7 presets × both modes × in-season/preseason, only ADP-only assets removed) |
| 2.1.2 | picks: each season's slot curve made non-increasing (isotonic) — future classes inverted at round boundaries; impossible picks (drafted class, > 5 years out, round > league rounds, slot outside 1..teams) are unavailable. 0 player values changed; only future-class picks next to former inversions moved (frozen 2026-10-02 dataset, all presets). Identity: contradicting birth date/age/draft year blocks a name match (no real-data change) |
| 2.2.0 | second audit (docs/MODEL_AUDIT.md): redraft option-value σ × 0.4 (E5/E6); schedule strength 0 (E2); dynasty counts only the remaining games of the current season (later seasons discounted from now, partial final season keeps a 5-season horizon) and injuries as expected games lost (shared redraft table; out for the season = rest of the season), replacing the flat 35%-of-a-season IR rule; calibration shape constraints (aging curves unimodal and still declining past the data, exit hazard monotone in age) fixed two age-monotonicity failures; trade view shows the historical outcome frequency (redraft). Frozen 2026-10-03 data: redraft top-10 within ±1%, median change 0.7%, deep/bench players down (e.g. 12-team 1QB #150 972 → 447); dynasty Spearman 0.999, median change 2.9% |
| 2.3.0 | research batch (docs/MODEL_AUDIT.md §21): redraft availability shape by positional rank (E11; per-game form, within-position, flat beyond 2× starters); redraft verdict levels from the calibrated outcome frequency (E10) and a range-of-outcomes line in the player view; My Team expected lineup points with bench cover (E12); signal weights confirmed on leak-free projection/ADP archives (E9, unchanged) and a daily signal archive + E13 backtest for the market weight. Frozen 2026-10-03 data (`2026-10-03-f2898efc`): redraft Spearman 1.0, median change 6.3% (1QB) / 8.8% (SF), top-10 unchanged, depth down up to 18%; dynasty unchanged |
| 2.1.1 | market list selection: lists in the wrong QB format are excluded (were used silently when a source had nothing else) and reported in `meta.excluded_market_lists`; TE-premium lists matched to the league's `bonus_rec_te` (always preferred `tep: 0` before). No value change on current data (no source lacks a format; no TEP lists): verified 0 changes across all presets/modes/phases |

`model_version` (config/model.json) changes whenever formulas/defaults change; `data_version` identifies the data
snapshot; `settings_hash` the league + effective model. All three are stored with every calculation and export.
