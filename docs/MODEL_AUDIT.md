# Model Audit (model 1.0.0 → 2.0.0)

An adversarial, quantitative review of the valuation system: what each formula does, whether it is supported by
evidence, where it breaks, and what was changed. Every number below is reproducible with `npm run audit-model`
(outputs in `reports/audit/`; a one-line-per-metric summary is `reports/audit/scorecard.csv`).

**Data labels used throughout** (never mixed without saying so):

| Label | What it is | Where |
|---|---|---|
| **REAL HISTORICAL DATA** | nflverse weekly stats 2018–2025, players, schedules; FantasyPros ECR archive (preseason, ROS, dynasty, rookie) as republished by DynastyProcess | `data/benchmark/benchmark.json` (built by `scripts/audit/benchmark.js`, git-ignored) |
| **BACKTESTED** | walk-forward experiments E1–E4 on the real historical data; parameters fitted only on seasons before the test season | `reports/audit/e1…e4-*.json` |
| **CURRENT DATA** | the synced dataset of 2026-10-02 (data_version `2026-10-02-77e3c35d`), frozen so before/after comparisons isolate model changes | `data/benchmark/dataset-frozen.json`, `reports/audit/cur-*.json`, `before-after*.json/csv` |
| **SIMULATION** | roster-economics simulation built from current values (draft + weekly lineups) | `reports/audit/cur-package-simulation.json` |
| **SYNTHETIC** | fake players for tests and positional-equity probes | `tests/fixtures/`, `cur-positional-equity.json` |

---

## 1. Executive summary

The v1 model was structurally sound — league-specific surplus over replacement, rank mapping instead of raw-scale
averaging, transparent blending — but the audit found **four defects that materially distorted values** and several
weights that the evidence does not support.

**Critical defects (fixed in 2.0.0):**

1. **Out-of-league veterans valued from draft capital alone.** In dynasty, a player with no projection, no current or
   last-season games still received the draft-capital prior with full weight. About 40 retired/free-agent veterans had
   1,000–4,300 dynasty value (John Ross 4,042, Henry Ruggs 4,316, Larry Fitzgerald at 43 years old 1,846; Todd Gurley
   3,871). John Ross was the model's most valuable 30+ WR. → Fundamental value now requires current evidence after
   career year 1.
2. **One-game backups priced as starters.** Players without last-season data regressed to the mean PPG of the *top
   third* of the position with only 2–4 pseudo-games. A QB who threw 15 passes for 59 yards in one game was valued at
   **5,693 in 12-team Superflex redraft — rank 20 overall**, above every RB except the top 7; non-touch fullbacks reached 1,400.
   → No-history players need ≥3 games and regress to the positional median.
3. **Non-monotone values.** Raising a player's projection by 15% lowered his value (2 cases), and making the #1 dynasty
   asset two years younger lowered his value (11,968 → 11,754), because the scale was normalised by the single top
   asset's own score. → Scale anchored on the mean of the top-12 reference assets; 75/75 monotonicity checks now pass.
4. **Deterministic surplus is biased low by ~14 points in every tier** (E1b). Surplus is convex in points; plugging a
   point forecast into `max(0, pts − r)` ignores the probability of beating replacement. → Expected surplus
   `E[max(0, X − r)]` with an empirically measured outcome SD.

**Evidence-driven re-weighting:**

* Expert consensus (FantasyPros ECR) was the best single signal in every walk-forward test — preseason, every
  in-season checkpoint, and dynasty. The fitted consensus weight did **not** fall as the season progressed
  (0.8–1.0 at weeks 4–12), contradicting v1's ramp from consensus .25 → production .30. Production now gets .10.
* The dynasty "fundamental" projection (ρ .502) was beaten by dynasty ECR (ρ .581); a 75/25 consensus/fundamental
  blend was best (.583). Fundamental weight .40 → .25.
* DynastyProcess player values are a transform of FantasyPros ECR (within-position ρ = 0.99) — counting them as an
  independent market double-counts consensus. Weight 0 (still displayed).
* The 30-day market trend has no demonstrated predictive value and is already in the market level → display only.
* The rookie slot curve's isotonic shape was the worst of five functional forms out of sample; replaced by a
  least-squares exponential (unbiased in level).

**Result on current data:** in a simulated 12-team league, the correlation between the model's trade margins and the
simulated change in lineup points rose from **0.25 to 0.63** (0.24 → 0.66 with the package adjustment), mostly because
the absurd values above are gone. Values of established players moved modestly (dynasty Spearman v1 vs v2 = 0.97;
median change 14%).

**What the audit could not establish:** the historical accuracy of projections, ADP and trade-market values (no free
historical archives), the calibration of the ± ranges, and whether the dynasty discount rates reflect real managers.
These remain judgment parameters and are labelled as such.

## 2. Current model architecture

```
dataset.json (per player: projections[], weekly[], last_season, rankings[], market[], adp[], injury, draft, bio)
   │
   ├─ context.js      league-scored inputs: projection points/rate, production rate, last season, usage,
   │                  injury → games lost, remaining games, strength of schedule
   ├─ replacement.js  league structure: starters (incl. greedy FLEX/SF), replacement, waiver, displacement levels
   │
   ├─ REDRAFT  redraft.js
   │     projection, production → surplus points (expected surplus in v2)
   │     curves = sorted surplus by position → consensus / market (positional rank) and ADP (overall rank) mapped onto them
   │     blendGroups(phase-weighted) → score
   │
   ├─ DYNASTY  dynasty.js
   │     μ1 (evidence-weighted rate) → 5-season projection with aging, attrition, uncertainty, discount
   │     → fundamental F; curves from F; market / consensus / ADP mapped; blendGroups → score
   │
   ├─ PICKS    picks.js   market pick values (value-function mapped) + historical slot curve + current class
   ├─ engine.js           reference-league run → scale factor → value, σ, components, ranks
   ├─ confidence.js       heuristic score + signal-disagreement σ
   └─ trade.js            totals, package (consolidation) adjustment, z = diff/σ_diff interpretation
```

Dependency map of the parameters (what feeds what):

| Parameter | Feeds | Affects |
|---|---|---|
| league teams/roster/flex | replacement, waiver, displacement | every value (scarcity), package charges |
| scoring (incl. TE premium) | projection & production points, priors' PPR ratio | redraft and dynasty fundamentals, curves |
| `redraft.uncertainty.sd_per_game` (v2) | expected surplus | redraft values near/below replacement |
| `redraft.production.*` | production signal | redraft (in-season) and dynasty μ1 (production evidence) |
| `redraft.weights` | blend | redraft |
| `dynasty.rate_evidence`, priors | μ1 | dynasty fundamental |
| aging curves, `aging_power` (v2), attrition, cv | μt, St, σt | dynasty fundamental → curves → mapped signals |
| `dynasty.weights` | blend | dynasty |
| `scale.*` | factor | all values (single multiplicative constant) |
| `picks.*`, slot curve | pick values | dynasty picks |
| `package.*` | trade adjustment | multi-player trades only |

Note the indirect channel: in both modes the **curves** that consensus/market/ADP are mapped onto are built from the
model's own point estimates. A source's *ordering* is used; the *magnitude* comes from the league math. This is why
positional scarcity is consistent across signals, and also why a bad fundamental curve leaks into every mapped signal.

## 3. Formula inventory

Formal specification (v2). Notation: i player, pos position, G remaining games, r_pos replacement, w_pos waiver level,
β bench fraction (0.35), Φ/φ standard normal cdf/pdf.

**Expected surplus** (replacement.js)
`ES(μ, σ; r) = (μ − r)Φ(z) + σφ(z)`, `z = (μ − r)/σ` (= max(0, μ − r) when σ = 0)
`S(μ) = ES(μ,σ;r) + β·max(0, ES(μ,σ;w) − ES(μ,σ;r))`; redraft σ_pos = c_pos(phase) × G.

**Replacement** — starters s_pos = teams × slots, FLEX/SF filled greedily by points; r = mean(points of s-th, (s+1)-th);
w = points of the first unrostered player (bench allocated pro rata to starters); displacement = points at rank
s − teams/2.

**Redraft production** (context.js)
`blend = (1 − x)·ppg + x·xppg`, `xppg = Σ opportunities × league points per opportunity`
`rate = (gp·blend + k·prior)/(gp + k)`, prior = last-season PPG (≥4 g) else positional median (gp ≥ 3 required)
`ROS = rate × max(0, G − games lost) × availability_pos × SoS`, `SoS = 1 + s·reliability·(opp ratio − 1)`.
v2: x = 0.25, k = 2, availability QB .80 / RB .77 / WR .83 / TE .82, s = 0.5.

**Mapping** — curve_pos[k] = k-th best model score at pos; a source ranking a player k-th at pos maps to curve_pos[k]
(interpolated); ADP maps by overall rank; market values via positional rank of the source's own values.

**Blend** — `score = Σ_g w_g v_g / Σ_{g available} w_g`; contributions `w_g v_g / Σw` sum to the score.
Redraft weights interpolate preseason → in-season by α = clamp((week − 1)/(full_week − 1), 0, 1).

**Dynasty fundamental**
`μ1 = Σ_e w_e v_e / Σ w_e` over projection (1.0), production (min(1, gp/8)), last season (0.8·min(1, gp/8)),
draft prior (20/(20 + career games)); v2: prior-only evidence after career year 1 → no fundamental.
`μ_t = [(1 − π)·μ1·(A(age_t)/A(age_0))^γ + π·prior_t]`, π = prior share, γ = 2 (v2; 1 in v1)
`σ_t = μ_t·√(cv1² + (t−1)g²)` (+ rookie cv), `S_t = Π(1 − hazard)`
`F = Σ_{t=1..5} δ^{t−1} S_t [ES(μ_t·17·a, σ_t·17·a; r) + β·band]`, δ = .70/.82/.92 by strategy.

**Picks** — class position p = (round − 1)·T + slot; `V(p) = Σ w_j part_j(p)` over market (.45), historical
(.30, = anchor × shape(p) × discount^Δ), current class (.25); unknown slots average V over slots.
Historical shape (v2) = least-squares fit of a·e^{−b(p−1)} (b = 0.118), normalised to a top-12 mean of 1.

**Scale** (v2) — `factor = 7,000 / mean(top-12 reference scores)`; value = score × factor.

**Confidence** — `score = cov^0.6 × agreement × sample × freshness × independence`;
`σ_value = max(floor% × value, SD of group values)`. Heuristic (see §16).

**Trade** — `σ_diff = √(Σσ²)`, z = |diff|/σ_diff (<1 close, 1–2 modest edge, >2 clear); package charge for each extra
player = strength·min(v, displacement value) + slot cost·waiver value, ≥ min_retained kept.

## 4. Input / source audit

Within-position Spearman correlations between raw signals (CURRENT DATA, `cur-correlations.json`):

| Pair | ρ | Interpretation |
|---|---|---|
| DynastyProcess values ↔ FantasyPros dynasty ECR | **0.99** | DP is a transform of ECR → **redundant** |
| Sleeper dynasty ADP ↔ FP dynasty ECR | 0.96 | near-redundant |
| FantasyCalc dynasty ↔ FP dynasty ECR | 0.945 | the only partly independent dynasty market |
| FantasyCalc redraft ↔ FP ROS ECR | 0.949 | |
| Sleeper/Rotowire ↔ ESPN projections | 0.93 | two genuinely different projection systems, highly agreeing |
| Projections ↔ FP ROS ECR | 0.93 | |
| Season PPG ↔ FP ROS ECR | 0.76 | production is the most independent signal (and the noisiest) |
| Sleeper ADP ↔ ESPN ADP | 0.89 | |

PCA per position (signals: FC dyn/redraft, DP, FP dyn/ROS, Sleeper ADP, both projections, season PPG):
the first component explains **74–92%** of variance; the effective number of independent signals is only
**1.2 (RB) – 1.7 (TE)**. The second component contrasts *current production/projections* against *dynasty
consensus/ADP* — i.e. "now vs future", which is exactly the redraft/dynasty distinction, not an independent
quality signal. Conclusion: adding more highly correlated sources adds almost no information and silently increases
the weight of whatever they are derived from. Source weights should reflect independence, not count.

Source reliability: sources were not historically testable except FantasyPros ECR (archive available) and nflverse
stats. Projections, ADP, FantasyCalc and DynastyProcess have no free history. Weights for them stay judgment-based and
are marked so in config.

Source age bias (`cur-source-bias.json`, premium = percentile points within position): FantasyCalc dynasty ranks
veteran TEs 7.6 points better than ECR; ESPN projections are 13.5 points less favourable to young QBs than
Sleeper/Rotowire; current-season PPG ranks veteran TEs 11.6 points higher than ROS ECR (experts discount aging TEs'
production). No other premium exceeds 5 points.

## 5. Redraft audit

**E1 — preseason (REAL HISTORICAL, walk-forward, test seasons 2021–2025):** preseason rank/forecast → realised season
PPR points, within position, top-N (QB32/RB60/WR72/TE32).

| Predictor | Spearman ρ | MAE (pts) |
|---|---|---|
| FantasyPros preseason ECR (rank → points curve fitted on prior seasons) | **0.505** | **57.2** |
| Last-season PPG (linear map fitted on prior seasons) | 0.410 | 61.7 |
| Last-season PPG + usage (opportunity-based expected points) | 0.433 | 61.6 |
| Fitted blend ECR + production | 0.505 (blend weight on ECR = **1.0 in every fold**) | 57.2 |

Production adds nothing preseason once consensus is known. v1 already gave production 0 preseason (KEEP).

**E2 — in-season rest-of-season (REAL HISTORICAL, 2021–2024 tests, checkpoints weeks 4/6/8/10/12):** ROS ECR snapshot
taken the Friday after week W−1 games; stats through week W−1; target = realised points weeks ≥ W+1.

| Predictor | ρ | MAE |
|---|---|---|
| ROS ECR | 0.490 | **32.5** |
| Season PPG × games | 0.443 | 37.3 |
| Last-4 PPG | 0.416 | 38.5 |
| Usage only (expected points) | 0.373 | 37.6 |
| v1 production formula | 0.427 | 36.1 |
| Fitted production (x, k, recency, SoS fitted per fold) | 0.453 | 35.7 |
| v1 blend (production .30 / consensus .25 normalised) | 0.487 | 35.5 |
| **Fitted blend (consensus weight fitted per checkpoint)** | **0.512** | 34.5 |

Fitted production parameters were stable: expected-points share x = 0–0.25 (v1 0.40), regression k = 2 (v1 4),
recency weight 0 (recent-games weighting does not help), SoS 0.5 in 3 of 4 folds (removing it slightly improved ρ:
**inconclusive**). The fitted consensus weight was 0.8–1.0 at every checkpoint from week 4 to week 12: **there is no
point in the season where production overtakes consensus.** Players played 75–86% of remaining team games
(RB .74–.79, WR .82–.86), which v1 ignored (it assumed every remaining game is played).

**E1b — what should the value measure?** Realised surplus over the realised replacement level, predicted from the
preseason rank:

| Value definition | MAE | Bias ranks 1–6 | 7–18 | 19–36 | 37–99 |
|---|---|---|---|---|---|
| Deterministic surplus max(0, pts − r) (v1) | **27.2** | −14.5 | −12.3 | −14.0 | −13.8 |
| Expected surplus E[max(0, X − r)] (v2) | 30.4 | −8.4 | **−0.2** | **−2.0** | +1.9 |
| Empirical surplus curve by rank | 30.0 | −2.5 | −1.1 | −1.2 | +0.2 |

The deterministic version wins on MAE only because realised surplus is zero-inflated (MAE rewards predicting the
median, which is 0 for most mid-tier players). Trade values are **added** across players, so they must be unbiased in
expectation; deterministic surplus systematically undervalues every tier by ~14 points. Expected surplus is the
principled fix (the empirical curve can't be used directly — it ignores your league settings).
Caveat: realised season surplus contains some hindsight (a manager captures a breakout only after recognising it),
so expected surplus slightly flatters deep bench players; the lowest tier's +1.9 bias is consistent with that.

Outcome SD per remaining game (E2 residuals, linear in games): QB 5.9, RB 4.5, WR 4.6, TE 4.0; v2 uses 5.5/4.4/4.3/3.8
in season and the E1b preseason σ (QB 84, RB 72, WR 65, TE 53 points per season → 4.9/4.2/3.8/3.1 per game).

**Injury:** the games-lost table cannot be backtested (no historical injury designations in the benchmark); influence
on current values is small (median 1%, p90 6%). KEEP, INVESTIGATE.
**Trend:** median influence 4% but no evidence it predicts outcomes; momentum is already in the market *level* →
REMOVE from value (display only).
**Recency:** fitted recency weight 0 → v1 does not over-weight recent games (KEEP the season-long rate).

## 6. Dynasty audit

**E3 — dynasty (REAL HISTORICAL, preseason 2020–2023 → realised discounted 3-season surplus, n ≈ 196 per season).**
Aging curves, attrition and draft priors are **re-calibrated each season using only earlier data** (an earlier draft
of this audit used the shipped curves calibrated on 2006–2025, which would have leaked the outcome period).

| Predictor | mean ρ |
|---|---|
| FantasyPros dynasty ECR | **0.581** |
| Fundamental (v1 structure) | 0.502 |
| … without aging curve | 0.475 |
| … without attrition | 0.497 |
| … without draft prior | 0.479 |
| … deterministic surplus | 0.489 |
| … year 1 only (no multi-year) | 0.468 |
| Blend 25% ECR / 75% fundamental | 0.542 |
| Blend 50/50 | 0.571 |
| **Blend 75% ECR / 25% fundamental** | **0.583** |

Every fundamental component earns its place (each ablation lowers ρ), and the multi-year structure beats year-1-only —
**dynasty is not redraft × age** in this code (§12). But the fundamental model is worse than consensus and has a
**systematic age bias**: it under-rated players ≤23 by 11 percentile points and over-rated 27–29 (+10) and 30+ (+9),
while ECR was unbiased. Cause: delta-method aging curves suffer survivorship bias (players who decline sharply leave
the sample, so the measured decline is too gentle). Grid over aging power γ ∈ {1, 1.5, 2} × prior pseudo-games
k ∈ {10, 20, 40}:

| Variant | ρ | age bias ≤23 | age bias 30+ |
|---|---|---|---|
| k10 γ1 (v1) | 0.502 | −0.110 | +0.094 |
| **k20 γ2 (v2)** | **0.506** | **−0.018** | **+0.020** |
| k40 γ2 | 0.499 | +0.006 | −0.002 |

γ = 2 removes the age bias without hurting rank accuracy; k = 20 and 40 are equivalent (20 chosen, nearer v1).

Career horizon / youth bias: with γ = 2 the fundamental no longer under-values youth; the convex
`E[max(0, X − r)]` creates option value for uncertain young players (deterministic ablation .489 < .502).
Strategy discounts (.70/.82/.92): not identifiable from data (they express preferences) → KEEP as user settings.

## 7. Rookie-pick audit

**E4 — slot curve functional form (REAL HISTORICAL, 2020–2023 rookie classes, leave-one-class-out):** class rank by
summer rookie ECR → realised 3-season discounted surplus.

| Form | LOO MAE | LOO bias | bias top-12 picks |
|---|---|---|---|
| Smoothed isotonic (v1) | 40.7 | 0.0 | +0.1 |
| Linear (MAE fit) | 32.3 | −25.1 | −47.7 |
| Exponential (MAE fit) | 34.1 | −21.5 | −34.4 |
| Power / logarithmic (MAE fit) | 35.0 / 34.7 | −23 / −31 | −49 / −74 |
| **Exponential (least squares) — v2** | 37.9 | −5.2 | **+1.7** |
| Linear (least squares) | 36.7 | −10.1 | −2.7 |

A first draft of this audit picked the MAE-fitted curves; they are badly **biased low** (they fit the median of a
right-skewed outcome — most picks bust). Least-squares exponential is unbiased and beats isotonic out of sample.
Class strength varies a lot (top-12 mean CV 0.28), so the curve's level is anchored to the current class each year.
Known limitation: the exponential smooths the historical cliff after pick 2 (pooled 1.01–1.02 mean 228 vs fit 177);
market and current-class inputs (70% of weight) retain that premium.

Pick monotonicity (1.01 > … > 1.12 > 2.01; this year > next year): all pass.

## 8. Positional scarcity audit

Synthetic equal players (250 PPR points over 14 games, label SYNTHETIC) in each league (`cur-positional-equity.json`,
v2 values):

| League | QB | RB | WR | TE |
|---|---|---|---|---|
| 10-team 1QB | 2,128 | 5,453 | 5,005 | 5,580 |
| 12-team 1QB | 2,233 | 6,019 | 5,997 | 5,869 |
| 16-team 1QB | 3,116 | 7,171 | 7,022 | 6,810 |
| 12-team Superflex | **6,112** | 6,839 | 6,473 | 6,101 |
| 12-team TE premium +1.0 | 2,233 | 5,704 | 5,101 | **10,024** |
| 12-team 3WR 2FLEX | 2,174 | 6,976 | 6,781 | 6,756 |

Scarcity comes only from replacement levels — no position multipliers. Superflex nearly triples a QB; TE premium
raises TE (the same player scores more *and* the replacement TE also scores more, so the increase is in surplus, not
raw points). 2QB and Superflex are identical here because the greedy allocation fills every Superflex slot with a QB
when QB points exceed the alternatives — correct for 12 teams. **KEEP.**

## 9. Market-value audit

Market values are used for their **ordering** (positional-rank mapping), not their scale, so market inflation or a
source's 0–10,000 scale cannot distort values. FantasyCalc is the only partly independent dynasty market (ρ .945
with ECR); DynastyProcess is ECR (ρ .99). The market cannot be backtested (no archive). Disagreements between
fundamental and market on current data (`cur-extremes.json`) are dominated by rookies/second-year players where the
model has only draft-capital evidence (e.g. a 2026 Day-2 RB: market 1,882 vs fundamental 338) and by veterans the
market discounts for situation (e.g. Courtland Sutton, 31: fundamental 2,099 vs market 1,255). Both are cases where
the market plausibly has information the model lacks (landing spot, college production, depth chart). The model is
**not** forced toward the market; the blend weight reflects the backtest (consensus/market .75).

## 10. Correlation analysis

See §4. Key conclusions: (1) one dominant factor (overall player quality) explains 74–92% of signal variance;
(2) the main secondary factor is now-vs-future; (3) the derived sources (DP values, dynasty ADP) are near-copies of
ECR. Decisions: DP market weight 0; dynasty ADP weight 0; redraft ADP kept preseason only (.15; ρ .89 with other ADP,
it is a crowd signal with no in-season role).

## 11. Backtesting results

Summarised in §5–7. Method: strict walk-forward (train on seasons < test season; rankings taken from scrapes dated
before the first game of the target window; weekly stats cut at the checkpoint). Metrics: within-position Spearman ρ
(ordering), MAE in points (level), bias by tier (additivity). Sample sizes: E1 5 test seasons × ~196 players;
E2 24 checkpoint-seasons; E3 4 seasons × 196; E4 4 classes × 74–91.

## 12. Baseline comparisons

| Task | Naive baseline | Consensus | v1 | v2 |
|---|---|---|---|---|
| Preseason redraft (ρ) | last-season PPG .410 | .505 | .505 (production weight 0 preseason) | .505 |
| In-season ROS (ρ / MAE) | season PPG .443 / 37.3 | .490 / 32.5 | .487 / 35.5 | ≈ fitted blend .512 / 34.5 |
| Dynasty (ρ) | last-season PPG .37–.45 (earlier backtest) | .581 | ≈ .571 (50/50 blend proxy; v1 = 40% fundamental) | ≈ .583 (75/25 blend proxy; v2 = 25% fundamental, γ2) |
| Rookie curve (LOO MAE / top-12 bias) | — | — | 40.7 / +0.1 | 37.9 / +1.7 |

v2 does not beat consensus by much on ordering — the honest finding is that **consensus is hard to beat on rank
accuracy**. The model's value is elsewhere: converting orderings into league-specific, additive values (scarcity,
scoring, roster size), handling picks and packages, and remaining usable when a source disappears.
Dynasty-vs-redraft separation: dynasty uses its own μ1, multi-year projection, aging, attrition, discount and its own
curves; ablating the multi-year structure costs .034 ρ. Redraft uses no dynasty assumptions (age appears nowhere in
redraft). **Distinct models, shared infrastructure.**

## 13. Ablation results

Historical ablations: §5 (production, usage, SoS, recency), §6 (age, attrition, prior, uncertainty, horizon).
Current-data influence (how much values move when a component is removed — influence, not accuracy;
`cur-influence.json`, v2):

| Mode | Removed | ρ with full model | median |Δ| | p90 |Δ| |
|---|---|---|---|---|
| redraft | projection | 0.962 | 5.5% | 12.6% |
| redraft | consensus | 0.989 | 3.6% | 10.3% |
| redraft | production | 0.999 | 1.0% | 2.0% |
| dynasty | fundamental | 0.991 | 4.6% | 13.6% |
| dynasty | consensus | 0.983 | 4.9% | 15.0% |
| dynasty | market | 0.991 | 3.2% | 11.5% |

In v1 removing *production* moved redraft values by up to 100% (p90) — the one-game-backup defect; in v2 it moves
them 1%.

## 14. Sensitivity analysis

Single-player sensitivity (`cur-sensitivity.json`, v2): +10% projection raises redraft value 5–19% (more for players
near replacement — surplus is leveraged). In v1 the #1 player (Gibbs) moved **0%** because the scale was normalised by
his own score; in v2 he moves +11%. +1 year of age lowers dynasty value 0–8% (most for RBs/TEs and the elite young,
whose value is mostly future); +10% market moves dynasty values ≤16% and redraft ≤3%. League grid
(`cur-league-grid.json`, 10–16 teams × 1QB/SF/2QB × TEP 0/0.5): Josh Allen 5,308 (1QB) → 9,479 (SF) in 12-team
redraft; TEP raises TEs; deeper leagues raise every starter because replacement falls. Monotonicity (`cur-monotonicity.json`): 75 checks — projection up, younger, pick slot order,
SF raises QBs, TEP monotone, top-24 positive. **v1: 3 failures; v2: 0.**

## 15. Stability analysis

`cur-stability.json`, `cur-missing-sources.json` (v2):

| Perturbation | ρ vs base | median |Δ| | p90 |Δ| |
|---|---|---|---|
| market ±5% noise (redraft / dynasty) | 1.000 / 0.999 | 0% / 0.2% | 0.5% / 3.9% |
| ECR ±1 rank noise | 0.999 / 0.999 | 0% | 4.4% / 3.2% |
| projections ±5% noise | 0.999 / 1.000 | 1.1% / 0.7% | 2.9% / 1.6% |
| remove FantasyCalc | 0.998 / 0.991 | 1.1% / 3.2% | 3.8% / 11.5% |
| remove FantasyPros ECR | 0.989 / 0.983 | 3.6% / 4.9% | 10% / 15% |
| remove both projection sources | 0.949 / 0.986 | 10% / 8.3% | 27% / 18% |
| remove ECR + FantasyCalc (dynasty) | 0.933 | 15% | 40% |

The model does not oscillate with ordinary noise and survives the loss of any single source. Losing both consensus
and the main market in dynasty is the largest risk (values then rest on the fundamental model, whose age bias was
fixed but whose accuracy is lower).

## 16. Identified biases

| Bias | Evidence | Status |
|---|---|---|
| Deterministic surplus under-values every tier by ~14 pts | E1b | fixed (expected surplus) |
| Fundamental under-rates ≤23, over-rates 27+ | E3 age bias | fixed (γ = 2) |
| Draft prior values out-of-league veterans | current data | fixed (evidence gate) |
| Starter-level prior for no-history backups | current data | fixed (median prior, ≥3 games) |
| Production assumes 100% availability | E2 (75–86%) | fixed |
| Over-weighting production in season | E2 fitted weights | fixed |
| Double-counting ECR via DP values | ρ .99 | fixed (weight 0) |
| MAE-fitted curves biased low | E4 | avoided (least squares) |
| ESPN projections less favourable to young QBs (−13.5 pct pts) | source bias | INVESTIGATE (two QB samples are small) |
| Hindsight optimism of realised-surplus targets for deep players | reasoning | documented; small |
| σ (fair-value range) is signal disagreement, not outcome risk | design | documented; not calibrated |

## 17. Data leakage findings

* Dynasty backtest initially used aging curves calibrated on data that overlapped the outcome window → replaced by
  per-season leak-free recalibration (`calibrateBefore`).
* ROS ECR "week W" scrapes are Fridays after Thursday games: stats are cut at week W−1 and the target starts at W+1,
  so Thursday-game information never leaks.
* Rookie curve classes are evaluated leave-one-class-out; the rookie ECR snapshot is the last summer scrape of the
  draft year (after the NFL draft, before games).
* The shipped calibration (`npm run calibrate`) uses all seasons through 2025 — appropriate for production use, but
  any future backtest must refit as E3 does.
* `prior_class_adjustment` (0.8) exists precisely because pricing next year's picks with an already-drafted class
  leaks outcome information (today's rookie ranks favour players who already hit).

## 18. Overfitting findings

Fitted parameters were kept only when they were (a) stable across folds and (b) moved in the direction of a known
bias: x = 0.25 and k = 2 (3–4 of 4 folds), consensus weight 0.8–1.0 (all folds), γ = 2 (best age bias in all 4
seasons). Rejected as overfit or inconclusive: SoS strength (fold-dependent), recency weighting (0 everywhere),
season-phase–specific weights (no consistent pattern by week), per-season class strength. Weights were rounded to
round numbers, and production/projection/market weights that cannot be tested were left at judgment values rather than
tuned to make consensus match. Parameters added in v2: 1 SD table (from residuals, not tuned), availability (measured),
γ (one parameter), evidence gate and min games (rules, not fitted).

## 19. Recommended changes

Classification of every component (implemented in 2.0.0 unless marked):

| Component | Class | Evidence | v2 action |
|---|---|---|---|
| League-specific surplus over replacement | KEEP | positional equity behaves correctly; E1b | — |
| Greedy FLEX/SF allocation | KEEP | §8 | — |
| Deterministic surplus | **REPLACE** | E1b bias −14 all tiers | expected surplus, σ = c_pos × G |
| Positional-rank mapping | KEEP | prevents raw-scale mixing; stability §15 | — |
| Redraft weights | **MODIFY** | E1/E2: consensus best at every week | pre: proj .30 / cons .40 / mkt .15 / ADP .15; in: proj .30 / cons .45 / mkt .15 / prod .10 |
| Phase ramp to production | **MODIFY** | fitted consensus weight constant | ramp kept but production capped at .10 |
| Production rate (x, k) | **MODIFY** | E2 fitted x .25, k 2 | x .40 → .25, k 4 → 2 |
| Production availability | **ADD** | E2 75–86% | × availability |
| Positional prior (top third) | **REPLACE** | one-game backups at QB1 values | median, ≥3 games |
| SoS | KEEP / INVESTIGATE | inconclusive | unchanged (.5) |
| Recency weighting | KEEP (none) | fitted 0 | — |
| Injury games lost | KEEP / INVESTIGATE | not testable; small influence | — |
| Market trend | **REMOVE** (from value) | no predictive evidence | weight 0, displayed |
| Dynasty weights | **MODIFY** | E3 | fundamental .25 / market .35 / consensus .40 / ADP 0 |
| Aging curves (delta method) | **MODIFY** | E3 age bias | power γ = 2 |
| Draft prior weight | **MODIFY** | E3 grid | 10 → 20 pseudo-games |
| Draft prior without evidence | **REMOVE** (after year 1) | ~40 retired players valued | evidence gate |
| Attrition, multi-year horizon, E[max] | KEEP | E3 ablations | — |
| Strategy discount | KEEP (preference) | not identifiable | — |
| DP player values in market | **REMOVE** | ρ .99 with ECR | weight 0 |
| Dynasty ADP | **REMOVE** (weight) | ρ .96 with ECR | weight 0 |
| Isotonic slot curve | **REPLACE** | E4 worst LOO MAE | least-squares exponential |
| Pick market / class / prior-class adjustment | KEEP | no history; logic sound | — |
| Single-top-asset scale | **REPLACE** | non-monotone | top-12 mean anchor |
| Package adjustment | KEEP | simulation: moves 2-for-1 and 3-for-1 means toward simulated gains (2-for-1 model 46 → 24 vs simulated 19; 3-for-1 117 → 60 vs 44) | — (mild under-correction for 3+ players: INVESTIGATE) |
| Confidence heuristic / σ | KEEP / INVESTIGATE | not calibratable without value history | documented as disagreement range |
| z-score trade interpretation | KEEP | §49 of the brief; avoids labels | — |
| Generic vs roster-adjusted value | KEEP generic | no evidence a roster-specific base model is better; package adjustment covers consolidation | — |

Prioritised (severity → change):

| Priority | Change | Problem | Benefit | Risk | Difficulty | Confidence |
|---|---|---|---|---|---|---|
| Critical | evidence gate for prior-only veterans | retired players worth up to 4,300 | removes ~40 phantom assets | a genuine comeback player without data is N/A until he plays/gets projected | low | high |
| Critical | no-history production rule | one-game QB at 5,693 | removes production artefacts | slower to value true breakouts with no projection or ranking (rare in practice) | low | high |
| Critical | top-12 scale anchor | non-monotone top values | monotone | scale label changes ("≈10,000") | low | high |
| High | expected surplus | −14 bias | additive values | deep bench values rise | low | medium-high |
| High | consensus-dominant weights | over-weighted noisy production | ρ +.025 in season | depends on ECR availability | low | high |
| High | dynasty γ = 2, k = 20, weights | age bias | removes ~10 pt age bias | relies on ECR | low | medium-high |
| Medium | DP / dynasty ADP weight 0 | double counting | honest independence | none measurable | trivial | high |
| Medium | slot curve LS exponential | worst-fitting curve | lower LOO error | smooths 1.01/1.02 premium | low | medium |
| Medium | production availability, x, k | over-projection | MAE −1 to −2 | — | trivial | high |
| Low | trend display-only | unproven | simpler | loses short-term news reactivity (market level still reacts) | trivial | medium |

## 20. Remaining limitations

* **Found after release, fixed in 2.1.0:** in redraft, players whose only signal was ADP received value
  (63 free agents ≥ 100 in 12-team 1QB on 2026-10-02, e.g. Philip Rivers 417; 70 incl. rostered backups; up to 159
  in 14-team SF). Cause: long ADP lists rank undrafted players by placeholder/stale draft positions (one source gives
  ≈170 to every undrafted player), expected surplus gives those deep overall ranks a positive tail, and a lone ADP
  group is renormalized to full weight. The audit's checks covered top players and extremes, not deep free agents.
  Fix: ADP is corroborating only (`redraft.adp_requires_corroboration`); before/after on the frozen dataset changed
  no other value (monotonicity 75 checks, 0 failures). See `docs/CLAUDE_CODE_HANDOFF.md` §19.
* No free historical archives for projections, ADP or trade-market values → their weights are judgment.
* The fair-value range (σ) is a signal-disagreement heuristic, not a calibrated interval; trade z-scores inherit that.
* Dynasty backtests cover only four seasons (2020–2023) with three-season outcomes; ρ differences < 0.01 are noise.
* Injury handling, SoS and kicker/defense values are not validated.
* Contracts, coaching, college production and landing spot enter only through consensus/market.
* The package simulation drafts by model value and samples availability; it tests internal consistency of roster
  economics, not real manager behaviour. Multi-player trades still show low correlation (0.49–0.70) with simulated
  lineup gains.
* Superflex/TE-premium dynasty consensus is only partly format-specific (FantasyPros SF list; no TEP list).

Reproduce: `npm run audit-model` (all), `-- --only=e1,e2,e3,e4,current,compare`, `-- --rebuild` (re-download the
benchmark), `-- --freeze` (copy the synced dataset to `data/benchmark/dataset-frozen.json`), `-- --snapshot-before`
(save current-model values on the frozen dataset as the "before" baseline; freezes first if needed), `-- --out=DIR`
(write everything to DIR instead of the committed `reports/audit/`). The frozen dataset is git-ignored, so on a fresh
clone the current-data numbers come from your own sync and a before/after comparison against the committed baseline
is skipped with instructions. Model comparison: [MODEL_COMPARISON.md](MODEL_COMPARISON.md).
