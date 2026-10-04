# Dynasty Model

Question answered: *"What is this player's expected long-term fantasy asset value in THIS league, accounting for current
production, age, future production, market value, scarcity and uncertainty?"* It is **not** redraft × age multiplier.

Code: `js/core/valuation/dynasty.js`. Calibration: `scripts/calibrate.js` → `config/calibration/*.json`.
Audit evidence: [MODEL_AUDIT.md §6](MODEL_AUDIT.md#6-dynasty-audit).

**In plain English:** a dynasty value is the sum of what the player should add above a replacement-level player over
the next five seasons of football — during the season, only the games still left this year count, plus the matching
part of a sixth season. Each season counts less than the one before (more for contending teams), shrinks with the
chance he is out of the league, and includes upside: an uncertain young player who *might* become a starter is worth
more than his average forecast alone suggests. Age enters through measured position-specific growth and decline curves,
not a flat multiplier. Because expert dynasty rankings proved more accurate than any formula, they carry the most
weight; the formula supplies the league-specific magnitudes.

## 1. Current scoring rate μ₁ (league points per game)

Evidence-weighted average of:

| Evidence | Weight |
|---|---|
| Projection rate (ROS in season, season projection otherwise) | 1.0 |
| Current-season production (actual blended with expected points) | min(1, games/8) |
| Last season PPG (≥4 games) | 0.8 × min(1, games/8) |
| **Draft-capital prior** for this career year | k / (k + career games); k = 20, WRs 10 (2.5.0: within-position dynasty Spearman .554 vs .532, 4 of 4 seasons; smoothing the career-year priors was tested and rejected — it cost QBs .492 → .385) |

Priors are calibrated in PPR points and rescaled to your scoring by the league/PPR ratio of last-season points at the
position.

**Evidence gate (2.0):** after career year 1 a player needs at least one piece of current evidence (projection,
current-season or last-season production). The draft prior alone no longer creates value: in 1.x about 40 retired or
out-of-league veterans (John Ross, Todd Gurley, Larry Fitzgerald at 43) carried 1,000–4,300 dynasty value from their
draft slot. Such players show N/A unless a market or ranking source still lists them. Incoming rookies (year 1) keep
the prior.

## 2. Multi-year projection (default 5 seasons)

For season t (age a+t−1):

* **μₜ** = μ₁ × (A(age)/A(age₀))^γ, γ = `aging_power` = 2 — calibrated aging curve — blended toward the draft-capital trajectory
  (career year k+t−1) with the prior's evidence share (young players develop toward what their draft slot historically
  produced).
* **σₜ** = μₜ × √(cv₁² + (t−1)·g²) (+ rookie extra cv) — uncertainty grows every year.
* **Sₜ** = Π(1 − hazard(age)·mⱼ) — probability the player is still fantasy-relevant (attrition); mⱼ = 1 for the first
  transition and the per-position later-year multiplier after it (2.5.0, audit E19: QB .70, RB 1.35, WR 1.60, TE 1.25).
  The one-year hazard is measured on currently relevant players; compounding it as-is over-stated the share of
  RB/WR/TE still active 3–4 seasons later (e.g. WRs aged 27–29: 61% modelled vs 43% observed after 4 seasons) and
  under-stated it for QBs (55% vs 63%). Fitted walk-forward the multipliers were stable (QB .65–.70, RB 1.45–1.50, WR
  1.45, TE 1.15–1.25); in 3-season dynasty league simulations (E15) trade outcomes were predicted better on both seeds
  (corr .618 → .636, .616 → .641).
* Season points X ~ Normal(μₜ·17·availability, σₜ·17·availability).
* **Expected surplus** = E[max(0, X − replacement)] + bench fraction × E[band between waiver and replacement].

`Fundamental = Σ δ^(t−1) · Sₜ · E[surplus]`, δ = strategy discount: contending 0.70, balanced 0.82, rebuilding 0.92.

**In season (2.2.0).** Only the share `f = remaining team games / 17` of the current season is left to play, so year 1
counts `f × E[surplus]` (expected surplus scales linearly with a share of a season), later seasons are discounted from
now (`δ^(t−2+f)`), and a final partial season `(1 − f)` keeps the horizon at five full seasons. Before 2.2.0 the current
season counted in full at any week, which over-stated players whose value is concentrated in this season (veterans)
mid-season and made values jump when the season rolled over. In the offseason f = 1 and nothing changes.

Why E[max(0, X − r)]: surplus is convex. A young, uncertain player projected just below replacement still has a real
chance of a startable season — breakout optionality falls out of the math instead of an ad-hoc bonus. The UI shows
P(startable next season), decline risk P(Y2 PPG < 85% of now), and career horizon (seasons with ≥25% chance of being
startable).

## 3. Calibrated inputs (nflverse 2006–2025, `npm run calibrate`)

* **Aging curves** — delta method on PPR PPG for consecutive seasons (≥6 games), *symmetric* selection (either season
  ≥5 PPG; selecting on year-1 performance would build regression to the mean into every age step), anchored at ages
  24–28, shrunk toward the default curve where samples are thin (n/(n+80)). Result: RB peak ≈24 → 0.82 at 28, 0.67
  at 30; WR peak ≈26 → 0.79 at 30; TE peak ≈26; QB flat to ~32.
* **Later-year multiplier** (2.5.0) — `later_year_multiplier` in attrition.json: least squares of the observed share
  of relevant players with ≥ 4 games 2–4 seasons later against Π(1 − h·m) (see §2).
* **Attrition** — P(<4 games next season | top-N finish), pooled ±1 age (±2 when sparse), then a weighted **monotone
  (non-decreasing) fit** in age (2.2.0), +6 points a year beyond the data (RB 24% at 30; WR 13% at 30; TE 15% at 30;
  QB ~12% through 34). The former rule only enforced monotonicity after the minimum, so one noisy TE cell (9 exits of
  36 at age 22) gave 21–22-year-old TEs a 12–20% exit hazard — higher than 24-year-olds' 4.5% — and made a player
  worth *less* if he were two years younger.
* **Aging-curve tails (2.2.0)** — curves are unimodal, and beyond the last age with ≥15 season pairs the decline never
  slows down (each year's ratio is capped by the previous year's). The former curves copied a flat default tail past
  ages 35–37, so a 37-year-old TE stopped declining while a 35-year-old declined 12–14% a year (Travis Kelce was worth
  more at 37 than he would have been at 35). Values inside the data range are unchanged.
* **Log-concave decline (2.5.0, deep audit W8)** — from the peak on, the yearly decline of each curve must not slow
  with age, fitted with pool-adjacent-violators on the yearly log-changes (`unimodalAgeCurve(…, { concave: 'decline' })`;
  growth before the peak stays as fitted). The sampled curves zig-zagged (WR 30→31 −6.7%, 31→32 −8.6%, 32→33 −5.9%), so
  identical WR production was worth *more* a year older after the peak (structural check D7: +1.7% at 30→31, +4.4% at
  32→33). A consistency constraint, not a fitted improvement: walk-forward E3 .508 → .510, E15 trade outcomes neutral
  within the simulation's noise (corr .633 → .614 on one seed, .645 → .645 on the other; log-likelihood −21 / +54).
  Making the growth side concave too (E3 .513) was worse in E15 on both seeds and is not used.
* **Availability** — ~81–83% of games for relevant players who stay active.
* **Year-1 CV** — SD of next-season PPG change / PPG: QB .23, RB .32, WR .29, TE .28.
* **Draft-capital priors** — PPR PPG by position × bucket (R1 picks 1–16, R1 17–32, R2, R3, R4–5, R6–7, UDFA) × career
  year 1–5, scaled by participation.

Survivorship bias remains in the delta-method curves (players who collapse leave the sample, so measured declines are
too gentle). The audit measured it directly (walk-forward, curves re-fitted each season on earlier data only): with
γ = 1 the fundamental model under-rated players ≤23 by 11 and over-rated 30+ by 9 percentile points; **γ = 2 removed
the bias** (−2 / +2) without lowering rank accuracy. Hence `aging_power: 2`. Treat curves as reasonable priors, not
truths.

## 4. Other signals

| Signal | Source | Conversion |
|---|---|---|
| Consensus (0.40) | FantasyPros dynasty positional ECR | positional-rank mapping onto the fundamental curve |
| Market (0.35) | FantasyCalc dynasty (format-matched), KTC import; DynastyProcess values weight 0 (ρ 0.99 with FP ECR) | positional-rank mapping |
| Fundamental (0.25) | sections 1–3 | — |
| ADP (0) | Sleeper dynasty startup ADP — ρ 0.96 with ECR, so redundant; shown, adjustable | overall-rank mapping |
| Trend | FantasyCalc 30-day trend | displayed only (weight 0) |

Why .25 for the fundamental model: on 2020–2023 dynasty rankings scored against realised three-season surplus,
FantasyPros dynasty ECR reached ρ 0.581, the fundamental model 0.502–0.506, and a 75/25 consensus/fundamental blend
0.583 (best). The fundamental model still matters: it sets the *magnitudes* (league scoring, scarcity, horizon) that
every ranking is mapped onto, it is the only signal for players no list covers, and it explains the value.
| Injury | expected games lost (redraft table: Out 1, Doubtful .8, Questionable .25, IR/PUP/NFI 5, Suspended 3) as a share of the games left this season; on IR/PUP/NFI/Suspended with no rest-of-season projection = the whole remaining season (as in redraft). Replaced the flat "IR = 35% of a season" rule in 2.2.0 | explicit component |

Components shown: Market, Consensus, Projection / Production / Prospect (year-1 fundamental split by evidence share),
Age/longevity (seasons 2+), ADP, Trend, Injury — they sum to the value. The league-specific adjustment vs the
reference league is shown separately.

## 5. Audit evidence (2.2.0)

* **Value spacing (E8).** Dynasty values are mostly rankings mapped onto the fundamental curve, so the curve's shape
  sets how much a star is worth relative to a mid-tier player. Scored against hindsight-free three-season lineup value
  (2021–2023 rankings), the current uncertainty gives proportional spacing (value ratio relative to the top 12:
  ranks 13–24 1.01, 25–36 0.87, 37–72 0.86); removing the option value (cv × 0) under-values depth badly (0.57 / 0.26 /
  0.04), and cv × 1.25 was best in only one of three seasons — **kept** (unlike redraft, where the option value was
  too large: over several seasons a manager can act on how a role develops).
* **Horizon.** 5 seasons (ρ .518; age bias −.014 young / +.012 old) beat 8 (ρ .513, over-rates youth by .027) and
  12 (ρ .508, .040) against realised three-season value — **kept**. Known limitation: a finite horizon slightly
  penalises players more than ~4 years before their peak (a TE made two years younger at 20 loses ~2%).
* **Calibration constraints** (above) left rank accuracy unchanged (ρ .513 → .518) and improved the worst season
  (.471 → .494) and age bias (−.016/+.015 → −.014/+.012) in the leak-free walk-forward test (E3).

## 6. Contracts, team situation, trade liquidity

Not modelled directly: free sources don't provide reliable contract data in a stable form, and team situation is
already priced by market/consensus/projections. FantasyCalc's trade frequency is stored for future use.
