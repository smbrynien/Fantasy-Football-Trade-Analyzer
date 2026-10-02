# Rookie Draft Pick Model

Code: `js/core/valuation/picks.js`. Parameters: `picks` in `config/model.json`; Settings → Rookie Pick Model.

**In plain English:** a pick is worth the average value of whoever it will select. We combine what the trade market
pays for picks, how past rookie classes actually turned out by draft position, and how good this year's class looks.
If the exact slot isn't known yet, we average over the slots it could be; picks further in the future are worth a bit
less because they take longer to pay off and are less certain.

**Rookie pick value ≠ rookie prospect value.** A prospect is a specific drafted player (valued by the dynasty model).
A pick is the expected value of *whoever it selects*. The Rookies & Picks view keeps them on separate tabs.

## Class position

A pick is valued by its position p in the rookie class: `p = (round − 1) × teams + slot`. In a 14-team league 2.01 is
rookie #15; in a 12-team league it is #13. League size is therefore handled without special cases.

## Three inputs

`V(p) = w_m·M(p) + w_h·H(p) + w_c·C(p)` (default 0.45 / 0.30 / 0.25; renormalized over available parts)

1. **Market M(p)** — pick values from FantasyCalc, DynastyProcess, KTC/manual imports. Each source's pick values are
   mapped to our scale through **that same source's player values** (value-function mapping: a pick the market prices
   like its 40th player is worth our 40th player). Bucket anchors (early/mid/late = first/middle/last third of a
   12-team round) and slot labels are interpolated across p. Future seasons with only round-level values ("2028 1st")
   reuse the upcoming season's slot shape scaled to that round value.
2. **Historical slot curve H(p)** — FantasyPros rookie ECR (last summer scrape of the draft year) for the 2020–2023
   classes matched to nflverse production: discounted 3-season PPR surplus over 12-team replacement, averaged by class
   rank, fitted with a **least-squares exponential** `a·e^(−b(p−1))` (b ≈ 0.118: each class position is worth ~11% less
   than the one before), normalized (top-12 mean = 1), then scaled to the current class.
   Why (audit E4, leave-one-class-out): the v1 smoothed-isotonic curve had the worst out-of-sample error (MAE 40.7);
   least-squares exponential 37.9 with no level bias (+1.7 on top-12 picks). Curves fitted to minimise absolute error
   looked better (32–35) but were biased low by 34–74 points on top-12 picks — they fit the *median* rookie (most bust),
   while a pick's trade value must be its *mean*. Known trade-off: the smooth curve understates the historical cliff
   after pick 2 (1.01–1.02 averaged 228 vs 177 fitted); market and current-class inputs (70% of the weight) keep it. Hit rates
   (top-24 season within 3 years): ranks 1–3 100%, 4–6 75%, 7–12 58%, 13–24 25%, 25–36 19%, 37+ 10% (small samples).
3. **Current class C(p)** — model values of the most recent rookie class (by consensus rookie rank, isotonic).
   If that class is already drafted (e.g. pricing 2027 picks with 2026 rookies), its values are multiplied by
   `prior_class_adjustment` (0.8): today's rookie ranks favour players who already hit (hindsight), and landing spots
   are resolved — an unresolved pick is worth less.

## Known vs unknown picks

| Descriptor | Valuation |
|---|---|
| Known slot `2027 1.04` | V(p) |
| Projected bucket `2027 Early 1st` | mean of V over the first third of slots |
| Custom range `1.03–1.07` | mean over those slots |
| Unknown `2028 1st` | mean over all slots (uniform) |

Future seasons are discounted `future_year_discount^Δ` (0.88/yr) on the model parts; market parts use that season's own
market prices. `class_strength` (default 1.0) lets you mark a strong/weak class.

**Monotonic by construction (model 2.1.2).** Within each season, V over class positions 1..rounds·teams is made
non-increasing by isotonic regression (pool-adjacent violators), with each component rescaled so the breakdown still
sums to the value. Before 2.1.2, future classes could invert at round boundaries (2028 3.01 > 2028 2.12 on 2026-10-02
data) because round-level market values scale each round's segment separately. The upcoming class was already
monotone and is unchanged; only future-class picks next to an inversion moved (by a few to ~10%).

**Picks that cannot exist are unavailable** (2.1.2): an already-drafted class, more than 5 years out, a round beyond the
league's rookie rounds, or a slot/range outside 1..teams (they used to be valued — a "1.13" in a 12-team league as
1.12). Labels with round or slot 0 are not parsed as picks.

## Uncertainty

* **Estimate range** (±): spread of V across the possible slots, disagreement between the three inputs, a growing
  future-year term, and a floor.
* **Outcome risk** (separate): what the drafted player becomes — historically very wide (outcome CV ≈ 0.75 for picks
  1–3, > 2 beyond pick 12). Shown, but not mixed into the fair-value estimate.

## Rounds and years

Rounds: 1–6 (league setting, default 4). Seasons: upcoming class + N (default 3). The "upcoming" class switches to next
year from September (`upcoming_class_switch_month`).
