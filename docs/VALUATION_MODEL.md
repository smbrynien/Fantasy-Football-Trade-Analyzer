# Valuation Model (common framework + redraft)

Model version: see `model_version` in [`config/model.json`](../config/model.json). Every parameter mentioned here
is configurable there or in **Settings** (per league profile, stored as `overrides`).

Code: `js/core/valuation/` — `engine.js` (orchestration), `context.js` (inputs), `replacement.js` (scarcity),
`mapping.js` + `blend.js` (normalization/blending), `redraft.js`, `dynasty.js`, `picks.js`, `confidence.js`, `trade.js`.

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

Surplus is continuous: `max(0, pts − replacement) + bench_value_fraction × clamp(pts − waiver, 0, replacement − waiver)`.
Bench players are worth something (depth), starters much more. This is where positional scarcity, superflex QB
scarcity, TE premium and league depth come from — no generic positional multipliers.

### Scale

`value = surplus × factor`, `factor = 10,000 / (top surplus in the reference league: 12-team 1QB PPR)`. The same
factor applies to your league, so a 14-team superflex QB can exceed 10,000 and values are comparable across leagues.
Values display rounded to 10 with an approximate fair-value range.

## 2. Signals and how each is normalized

| Signal | Inputs | Conversion |
|---|---|---|
| **Projection** | ROS projections from each projection source (Sleeper/Rotowire weekly, ESPN weekly, manual), summed over the remaining weeks (completed games excluded) | Re-scored with your scoring (TE premium, first downs, bonuses) → weighted mean of points → surplus |
| **Production** | Weekly actual stats (nflverse; Sleeper fallback) scored with your settings, blended 60/40 with **opportunity-based expected points** (targets/carries/attempts × league-average points per opportunity at the position), regressed toward last season's PPG (or positional average) with 4 pseudo-games, × remaining games × strength-of-schedule, minus injury games | surplus |
| **Consensus** | ROS/redraft expert rankings (FantasyPros ECR, manual rankings) | **Positional-rank mapping**: k-th RB by experts → value of the k-th RB on your league's curve |
| **Market** | Redraft trade values in the best-matching format (FantasyCalc, manual) | Positional-rank mapping |
| **ADP** | Redraft ADP (Sleeper, FFC, ESPN, manual) in the matching scoring/QB format | Overall-rank mapping |
| **Trend** | Market source's own 30-day trend | `weight × trend% × value`, capped (±5%) |

Positional-rank mapping keeps each source's *ordering and sentiment* while the *magnitudes* come from your league's
math — sources don't know your TE premium or bench size. Raw source values remain visible in the player view.

Source weights inside a group (`source_weights`): FantasyCalc 1.0 (real trades), KTC 1.0, DynastyProcess 0.35 (derived
from FantasyPros ECR → not independent), Sleeper/Rotowire projections 1.0, ESPN 0.8, manual 0.8–1.0. They are judgment
defaults (no free history exists to fit them) and are user-adjustable.

## 3. Blending and phase awareness

`score = Σ wᵍ·signalᵍ / Σ wᵍ (available)` — weights renormalize over the signals a player actually has.
Missing signals are never imputed; they lower confidence instead.

Weights interpolate from the **preseason** set (projection .35, consensus .30, ADP .20, market .15, production 0) to the
**in-season** set (projection .30, production .30, consensus .25, market .15, ADP 0) linearly between week 1 and
week 8. Offseason/preseason use full-season projections for the upcoming season.

The breakdown always sums to the final value: `contributionᵍ = wᵍ·signalᵍ / Σw`. Production is split into
"production" and "injury" (games lost × rate) so the injury effect is explicit.

### Injuries

Structured status only (no speculation). Official NFL report (nflverse) for game designations; reported roster
status (Sleeper, else ESPN) for IR/PUP/NFI/Suspended. Expected games lost: Out 1, Doubtful 0.8, Questionable 0.25,
IR/PUP/NFI 5, Suspended 3 (configurable). Players on a long-term list who are **absent** from in-season weekly
projections are treated as projected for zero (the projection sources ruled them out) rather than "missing".

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
This is not a statistical confidence interval and is labelled as such.

## 5. Trades (`trade.js`)

* Totals, absolute and % difference, per-component differences, each signal compared separately (market vs model).
* Uncertainty: `σ_diff = √(Σσ_A² + Σσ_B²)` (independence assumed). Interpretation by `z = |diff|/σ_diff`:
  < 1 "close", 1–2 "modest edge", > 2 "clear" — never "good/bad trade" from raw numbers alone.
* **Package adjustment** for the side receiving more players: each extra (lowest-valued) player is charged
  `strength × min(its value, value of the average team's worst starter at that position) + cost × value of the last
  rostered player`, keeping at least `min_retained_fraction` of its value. Picks are exempt. Redraft strength 1.0;
  dynasty 0.6 (rosters evolve, future value is partly liquid). The arithmetic is shown on screen.
* Dynasty extras: value-weighted age; win-now vs future split.
* Every calculation carries model version, data version, settings hash, league and source timestamps; saved trades
  can be re-checked later ("Why changed?").

## 6. Backtesting (`npm run backtest` → reports/backtest.json)

Spearman correlation of preseason orderings with realised PPR points (2019–2025, FantasyPros ECR archive + nflverse):

| Position | ECR ρ | Last-season PPG ρ (same players) |
|---|---|---|
| QB | 0.37 | 0.31 |
| RB | 0.53 | 0.44 |
| WR | 0.51 | 0.38 |
| TE | 0.40 | 0.31 |

Dynasty ECR vs realised 3-season surplus (2020–2023): ρ ≈ 0.56–0.62 vs 0.37–0.45 for last-season PPG.
Consensus clearly adds information beyond production — and correlations far below 1 are why the app shows ranges
and never claims precision. Projections, ADP and trade markets could not be backtested (no free history).

## 7. Versioning

`model_version` (config/model.json) changes whenever formulas/defaults change; `data_version` identifies the data
snapshot; `settings_hash` the league + effective model. All three are stored with every calculation and export.
