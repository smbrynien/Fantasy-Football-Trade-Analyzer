# Trade engine — exactly how a trade is calculated

Model version **2.5.0** (config/model.json `model_version`). Code: `js/core/valuation/engine.js` (asset values),
`redraft.js`, `dynasty.js`, `picks.js`, `trade.js` (`analyzeTrade`, `packageAdjustment`), `js/core/roster.js` (roster
effects), `js/ui/trade-helpers.js` (wording). Every number below is a config value unless marked as code. The audit
behind each choice: docs/MODEL_AUDIT.md (E1–E16) and docs/TRADE_VALUE_DEEP_AUDIT.md (deep audit, E17–E19, D1–D12).

```text
Asset value (league-specific, one scale)            §1–§3
+ Package effect (side receiving more players)      §4
= Side totals → difference, margin                  §5
→ Verdict from the calibrated outcome frequency     §6
+ Roster effect (optional: My Team)                 §7      shown next to the verdict, never mixed into it
+ Uncertainty (± range, source disagreement)        §8
+ Sensitivity views (other formats, assumptions)    §9
```

## 0. What a value means (the target variable)

A value is **expected surplus fantasy points above the league's replacement level, in this league's scoring and roster,
times one constant**:

* **Redraft:** rest-of-season expected surplus `S = E[max(0, X − r)] + β · (E[max(0, X − w)] − E[max(0, X − r)])`,
  `X ~ Normal(points, σ)`, r = replacement (the league's last starter), w = waiver level (the last rostered player),
  β = 0.35 (bench band). It answers "how many scarce, hard-to-replace points does this player add to a lineup in this
  league for the rest of the season?".
* **Dynasty:** the same surplus for each future season, discounted and weighted by the chance the player is still
  fantasy-relevant (§2), blended with market and consensus signals mapped onto that fundamental scale.
* **Picks:** the expected value of the players drafted at that class position, on the same scale (§3).

Values are **ratio-scale** in surplus points: 8,000 vs 4,000 claims twice the expected surplus. The deep audit (E18)
tested the alternatives on 2 × 5,000 simulated trades with real outcomes: a ranking presented as a value (sign accuracy
62%) and raw points without replacement (63%) are far worse than the surplus scale (69%); a steeper "trade chart" curve
did not pick winners measurably better (+0.4 pp, within noise), so the interpretable surplus scale is kept.
Values are **league-specific**: the same player has a different value in Superflex, TE premium, 14 teams, etc.

## 1. Signals → one value (redraft and dynasty)

1. Every signal is put on the league's own value scale **by rank**, never by averaging raw source numbers:
   consensus (FantasyPros ECR) and market (FantasyCalc, imports) by **positional rank** onto the position's curve of
   model surplus values; ADP by **overall rank** onto the all-positions curve (`mapping.js`). Projections and
   production are scored with the league's scoring and turned into surplus directly.
2. Signals of one kind are averaged with source weights (`source_weights`); kinds ("groups") are blended:
   `score = Σ_g w_g · v_g / Σ_{g available} w_g`.
   * Redraft weights (preseason → in season, linear in week 1–8): consensus .40 → .45, projection .30, market .15,
     ADP .15 → 0, production 0 → .10. ADP alone never values a player (it must be corroborated; an imputed zero
     projection for a player out for the season does not corroborate, 2.4.0).
   * Dynasty weights: consensus .40, market .35, fundamental .25, ADP 0.
3. Redraft only: `score × availability shape(position, positional rank)` (stars miss fewer games than depth, E11).
4. **Scale:** `value = score × factor`, `factor = 7,000 / mean(score of the reference league's top 12)` (reference =
   12-team 1QB PPR). The same factor is used in every league, so values are comparable across settings in surplus
   points. `components` (market, consensus, projection, …) are the group contributions × factor and **sum exactly to
   the value** (regression test `tests/trade-invariants.test.js`).
5. Rank and positional rank are derived from the value (one ordering; no separate ranking system).

Scarcity enters **once**, through the replacement level computed from the league's actual starters (dedicated slots,
then FLEX and SUPERFLEX filled greedily by projected points). There is no positional multiplier anywhere (deep audit D3).

## 2. Dynasty fundamental (dynasty.js)

`F = Σ_t δ^{e_t} · S_t · share_t · [ES(X_t; r) + β · band]`, years t = 1..5 (+ a partial tail year in season):

* μ1 (points per game now) = weighted evidence: projection rate (w 1), current production (w min(1, games/8)), last
  season (w .8·min(1, games/8)), draft-capital prior for the career year (w k/(k + career games); k = 20, **WRs 10**
  since 2.5.0). After career year 1, prior-only evidence gives no fundamental.
* μ_t = (1 − π)·μ1·(A(age_t)/A(age_0))² + π·prior_t (A = calibrated aging curve — unimodal and, since 2.5.0,
  log-concave after the peak: the yearly decline never slows with age (deep audit W8); π = prior share).
* X_t ~ Normal(μ_t·17·availability, cv_t·μ_t·17·availability), cv_t = √(cv1² + (t−1)·g²) (+.2 for rookies).
* Survival `S_t = Π (1 − h(age))` with the calibrated hazard h for the first transition and **h × m_pos for every
  later one** (2.5.0, E19: m = QB .70, RB 1.35, WR 1.60, TE 1.25 — compounding the one-year hazard of relevant players
  over-stated RB/WR/TE survival and under-stated QB survival).
* δ = .70 contending / .82 balanced / .92 rebuilding; e_t = 0 for this season, t − 2 + f after it (f = share of this
  season left). Replacement r and waiver w from year-1 points with the league structure.
* Injury: expected games lost this season × year-1 contribution.

## 3. Draft picks (picks.js)

Class position p = (round − 1)·teams + slot. `V(p) = .45·M(p) + .30·H(p) + .25·C(p)` (renormalised over available
parts): M = market pick values mapped onto this league's player value scale through each source's own player values;
H = historical slot shape (least-squares exponential) × the current class's top-12 level; C = current rookie class
values by rookie consensus rank (isotonic). Future classes: model parts × 0.88^years; market parts from that year's
market values. Unknown slot = mean over all slots (uniform: the order is unknown); early/mid/late = the thirds; custom
ranges supported. Each season's curve is made non-increasing (a later pick is never worth more). Picks are league-aware
through the player scale they are mapped onto (Superflex, TE premium, league size) and through p (league size).

## 4. Package adjustment (trade.js `packageAdjustment`)

For the side receiving **more players** than it sends (picks never count as players and are never charged), the
lowest-valued extra players are charged:

```text
charge_i = min( strength · min(value_i, D_pos) + slot_cost · V_last ,  (1 − min_retained) · value_i )
D_pos  = value at positional rank round(starters_pos − teams/2 + 0.5)   (the average team's worst starter)
V_last = value at overall rank = total rostered players                  (the last rostered player)
redraft: strength 1.0, slot_cost 1, min_retained .25     dynasty: strength 0.6, slot_cost 1, min_retained .35
```

Adjusted side total = Σ values − Σ charges. Incomplete trades (one side empty) get no charge. An unvalued player still
counts as a player (so the other side is not charged for "consolidating"). Evidence: E6 (redraft, real outcomes) — with
the charge, predicted margins tracked realised outcomes better than plain sums in every season; E15 (dynasty, 3
seasons) — no measurable difference (.618 vs .616), kept.

## 5. Comparison

```text
diff = adjA − adjB        pct = diff / max(adjA, adjB)        σ_diff = √(Σσ_A² + Σσ_B²)        z = |diff| / σ_diff
```

Order inside a side never matters; swapping sides negates diff and pct; A ↔ A is exactly 0 (tests).

## 6. Verdict (never "good/bad trade")

`P(favoured side ends ahead) = 1 / (1 + e^(−k·|pct|))`, k = **1.5 redraft** (one season, E7: 5,000 simulated trades on
real 2020–2025 weekly points) and **1.75 dynasty** (next three seasons, discounted .82/year, E15: 2 × 5,000 trades).
The frequency is rounded to 5% as shown and sets the level:

| Shown frequency | Level | Redraft margin | Dynasty margin |
|---|---|---|---|
| < 60% | Close — roughly fair | < ≈ 27% | < ≈ 17% |
| 60–70% | Leans Team X | 27–56% | 17–42% |
| ≥ 70% | Team X clearly ahead | ≥ 56% | ≥ 42% |

In the simulations, redraft margins under 30% came out ahead 53–57% of the time, 30–50% 64%, 50–75% 72%, 75%+ 80%; dynasty trades in the three levels came out ahead 51–55% / 62–63% / 78–79% (2.5.0 values, two seeds; the slope fit is 1.75 on one seed and 2.0 on the other — 1.75, the more cautious, is kept). Without a
slope for the mode (config removed) the z levels are used (z < 1 close, 1–2 modest edge, > 2 clear).

## 7. Roster effect (optional, My Team — shown beside the verdict, never mixed into it)

With a saved roster and "Which side is you?": best starting lineup before → after (lineup value = Σ values of the
starters, dedicated → FLEX → SUPERFLEX), and **expected lineup points per week**: 400+ deterministic Monte Carlo draws
over who is available (position share × availability shape × current injury), spread evenly over the remaining weeks
with each player out in his **bye week** (2.4.0), best available lineup, empty slots at the waiver level. Its change is
shown with the historical frequency `1 / (1 + e^(−0.2·|Δ points per week|))` (E12: teams whose expected lineup rose 1
/ 3 points per week gained 55% / 65% of the time).

## 8. Uncertainty

Each asset's ± is `max(value × (0.05 + 0.10 · (1 − coverage) + model cv), SD of its signal groups)` — a **model
uncertainty range from source disagreement and coverage, not a statistical confidence interval** (E10: it contains
only ≈13% of season outcomes). The verdict therefore does not use it (it uses the calibrated outcome frequency); the
player view shows a calibrated range of outcomes for redraft. Since the deep audit the trade view marks assets whose
signal groups disagree strongly ("sources disagree", confidence cv ≥ .35) and lists the parts.

## 9. Sensitivity views and value-matching (read-only, never change values)

* **This trade in other league formats** — the same ids in each saved league/preset of the mode.
* **This trade under other model assumptions** (deep audit) — the same ids with one kind of information at a time
  (expert rankings only; trade market only; projections and production only / production model only), through the
  normal engine with weight overrides. When the rows agree the verdict does not hinge on weighting.
* **Even it out / Value matches / Two assets together** — exact `analyzeTrade` evaluation of the nearest single assets
  and two-asset combinations (bounded search: the 80 / 150 assets nearest the gap). Value math, not acceptance odds.
* **Trade finder** — every package of 1–3 of my 30 most valuable assets, kept when the verdict is close and my edge is
  within [−15%, +5%], without throw-ins, ranked by expected lineup gain (dynasty: lineup value; with the owner's roster:
  both teams' gains). E14 (redraft) and E16 (dynasty, 3 seasons) beat random fair packages on the same requests.

## 10. Reproducibility

Every analysis carries `model_version`, `data_version` (dataset snapshot), `settings_hash` (league + effective model),
league, phase and source timestamps (`analysis.audit`), and the CSV export repeats them. Values are a pure function of
(dataset, league, model): recomputation is identical (test). The UI caches one valuation per mode × data version ×
profile hash and clears the cache on every new dataset.
