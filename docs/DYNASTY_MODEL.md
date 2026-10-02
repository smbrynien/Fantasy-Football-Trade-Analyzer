# Dynasty Model

Question answered: *"What is this player's expected long-term fantasy asset value in THIS league, accounting for current
production, age, future production, market value, scarcity and uncertainty?"* It is **not** redraft × age multiplier.

Code: `js/core/valuation/dynasty.js`. Calibration: `scripts/calibrate.js` → `config/calibration/*.json`.
Audit evidence: [MODEL_AUDIT.md §6](MODEL_AUDIT.md#6-dynasty-audit).

**In plain English:** a dynasty value is the sum of what the player should add above a replacement-level player in each
of the next five seasons. Each season counts less than the one before (more for contending teams), shrinks with the
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
| **Draft-capital prior** for this career year | 20 / (20 + career games) |

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
* **Sₜ** = Π(1 − hazard(age)) — probability the player is still fantasy-relevant (attrition).
* Season points X ~ Normal(μₜ·17·availability, σₜ·17·availability).
* **Expected surplus** = E[max(0, X − replacement)] + bench fraction × E[band between waiver and replacement].

`Fundamental = Σ δ^(t−1) · Sₜ · E[surplus]`, δ = strategy discount: contending 0.70, balanced 0.82, rebuilding 0.92.

Why E[max(0, X − r)]: surplus is convex. A young, uncertain player projected just below replacement still has a real
chance of a startable season — breakout optionality falls out of the math instead of an ad-hoc bonus. The UI shows
P(startable next season), decline risk P(Y2 PPG < 85% of now), and career horizon (seasons with ≥25% chance of being
startable).

## 3. Calibrated inputs (nflverse 2006–2025, `npm run calibrate`)

* **Aging curves** — delta method on PPR PPG for consecutive seasons (≥6 games), *symmetric* selection (either season
  ≥5 PPG; selecting on year-1 performance would build regression to the mean into every age step), anchored at ages
  24–28, shrunk toward the default curve where samples are thin (n/(n+80)). Result: RB peak ≈24 → 0.82 at 28, 0.67
  at 30; WR peak ≈26 → 0.79 at 30; TE peak ≈26; QB flat to ~32.
* **Attrition** — P(<4 games next season | top-N finish), pooled ±1 age, non-decreasing past the minimum
  (RB 26% at 30; WR 13% at 30; QB ~14% through 34).
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
| Injury | IR/PUP/NFI: −35% of year-1 contribution; Suspended −15% | explicit component |

Components shown: Market, Consensus, Projection / Production / Prospect (year-1 fundamental split by evidence share),
Age/longevity (seasons 2+), ADP, Trend, Injury — they sum to the value. The league-specific adjustment vs the
reference league is shown separately.

## 5. Contracts, team situation, trade liquidity

Not modelled directly: free sources don't provide reliable contract data in a stable form, and team situation is
already priced by market/consensus/projections. FantasyCalc's trade frequency is stored for future use.
