# Rookie Draft Pick Model

Code: `js/core/valuation/picks.js`. Parameters: `picks` in `config/model.json`; Settings → Rookie Pick Model.

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
   rank, smoothed, isotonic, normalized (top-12 mean = 1), then scaled to the current class. Hit rates
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

## Uncertainty

* **Estimate range** (±): spread of V across the possible slots, disagreement between the three inputs, a growing
  future-year term, and a floor.
* **Outcome risk** (separate): what the drafted player becomes — historically very wide (outcome CV ≈ 0.75 for picks
  1–3, > 2 beyond pick 12). Shown, but not mixed into the fair-value estimate.

## Rounds and years

Rounds: 1–6 (league setting, default 4). Seasons: upcoming class + N (default 3). The "upcoming" class switches to next
year from September (`upcoming_class_switch_month`).
