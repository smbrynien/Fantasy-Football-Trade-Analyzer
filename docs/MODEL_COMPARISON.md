# Model Comparison

Candidate models compared on the validation that is actually available. Methods and caveats:
[MODEL_AUDIT.md](MODEL_AUDIT.md) (2026-10-03 audit, model 2.2.0) and [MODEL_AUDIT_2.0.0.md](MODEL_AUDIT_2.0.0.md).
Historical figures are **REAL HISTORICAL DATA, walk-forward**; E6/E7 are **SIMULATED leagues on real weekly points**;
current-data figures are **CURRENT DATA** (frozen 2026-10-03 snapshot). Reproduce with `npm run audit-model`.

## 2.1.2 → 2.2.0 (second audit)

| Model | Definition |
|---|---|
| **Current (2.1.2)** | 2.0.0 structure; redraft option value σ = full forecast-error SD (in season QB 5.5 / RB 4.4 / WR 4.3 / TE 3.8); SoS 0.5 on production; dynasty year 1 = full season at any week; dynasty IR = −35% of year 1; calibration with flat tails and partial hazard monotonicity |
| **Candidate A — 2.2.0 (adopted)** | σ × 0.4; SoS 0; dynasty current season = remaining games only (later seasons discounted from now, partial sixth season); injuries = expected games lost; monotone hazard, unimodal aging curves that keep declining; trade view shows historical outcome frequency |
| **Candidate B — deterministic surplus** | A with σ = 0 (the 1.x surplus) |
| **Candidate C — availability-scaled projections** | A with projections × measured availability (expected games instead of all remaining games) |
| **Candidate D — no package adjustment** | plain sums of values in trades |
| Dynasty variants | uncertainty CV × 0 / 0.5 / 1 (kept) / 1.25; horizon 5 (kept) / 8 / 12 |

### Redraft value proportionality (E5: hindsight-free lineup value; tier value ÷ value of ranks 1–12, 1.0 = right)

| Window | Current 2.1.2 | **A (2.2.0)** | B (σ = 0) | σ fitted per fold |
|---|---|---|---|---|
| Preseason, ranks 13–24 / 25–36 / 37–72 | 1.28 / 1.20 / 1.57 | **1.14 / 0.98 / 0.95** | 1.09 / 0.95 / 0.71 | 1.10 / 0.96 / 0.78 |
| Preseason loss (Σ log ratio²) | 0.306 | **0.020** | 0.132 | 0.073 |
| … prior weight 2 / 8 games (robustness) | 0.347 / 0.436 | **0.036 / 0.034** | 0.211 / 0.183 | 0.090 / 0.086 |
| In season from week 5 (loss) | 0.579 | **0.160** | 0.249 | 0.249 |
| In season from week 9 (loss) | 1.810 | 0.665 | **0.388** | 0.388 |

### Trade outcomes (E6: 5,000 random trades, 12-team leagues 2021–2025; correlation of the preseason margin with the realised change in season points)

| Model | all | uneven player counts | seasons better than Current |
|---|---|---|---|
| Current 2.1.2 | 0.542 | 0.540 | — |
| **A (2.2.0 values)** | **0.549** | **0.547** | **5 / 5** |
| B (σ = 0) + availability | 0.527 | 0.527 | 0 / 5 |
| C (availability-scaled) | 0.527 | 0.527 | 0 / 5 |
| D (no package adjustment, 2.1.2 values) | 0.523 | 0.522 | 0 / 5 (worse than Current in 4, equal in 1) |
| bench fraction 0 / 0.7; package strength 0.5 / 1.5; slot cost × 2 | 0.521–0.530 | | within ±.006 of their base |

### Verdict calibration (E7, same trades): share won by the favoured side

| Margin (% of larger side) | 0–5 | 5–10 | 10–20 | 20–30 | 30–50 | 50–75 | 75–100 |
|---|---|---|---|---|---|---|---|
| won | 55% | 53% | 57% | 55% | 64% | 72% | 80% |

Verdict levels (asset ranges ±10% of value): close 53%, modest edge 58%, clear 71%. Logistic fit
P = 1/(1 + e^(−1.5·margin)) → shown in the trade view (redraft).

### Dynasty

| Check | Current 2.1.2 | **A (2.2.0)** |
|---|---|---|
| E3 ρ at model settings / worst season | 0.513 / 0.471 | **0.518 / 0.494** |
| E3 age bias (young / old, percentile points) | −0.016 / +0.015 | **−0.014 / +0.012** |
| Monotonicity failures on current data (75 checks) | 2 | **1** (horizon edge case, documented) |
| E8 spacing loss (CV × 1) | 0.041 | 0.043 (unchanged within noise) |

| Dynasty variant | E8 loss | E3 ρ | Decision |
|---|---|---|---|
| CV × 0 / 0.5 / **1** / 1.25 | 13.4 / 1.40 / **0.043** / 0.015 (best in 1 of 3 seasons) | — | keep 1 |
| Horizon **5** / 8 / 12 | — | **.518** / .513 / .508 (young over-rated .000 / +.027 / +.040 vs 5) | keep 5 |

### Current data, before → after (frozen 2026-10-03, `reports/audit/before-after*.json/csv`)

| Set | Spearman | median abs. change | notes |
|---|---|---|---|
| Redraft 12-team 1QB | 0.993 | 0.7% | top 10 within ±1%; bench QBs fall (Geno Smith 972 → 251); #150 972 → 447; #12 ÷ (#60 + #100) 1.40 → 1.84 |
| Redraft 12-team SF | 0.994 | 0.6% | depth WR/TE fall (Tre Tucker 1,246 → 679) |
| Dynasty 12-team 1QB | 0.999 | 2.9% | young TEs up (Tyler Warren 4,580 → 4,999; Fannin 3,677 → 3,958), old TEs down (Kittle 2,345 → 1,936); IR without ROS projection loses the rest of the season (Achane 4,475 → 4,085) |
| Dynasty 12-team SF | 0.999 | 3.2% | same pattern; picks ±1% |

The 2.0.0 audit's internal package simulation (draft and lineups by model values) also improved:
corr(model margin, simulated lineup gain) 0.593 → 0.699 (plain sums 0.565 → 0.677).

**Choice:** A — the only candidate that is better than Current on every redraft tier test and in every season of the
trade simulation, with dynasty accuracy unchanged or better and fewer monotonicity failures. B is simpler but
under-values depth (ratio 0.71 for ranks 37–72) and predicted trades worse.

## Earlier comparison: 1.0.0 → 2.0.0 (first audit)

| Model | Definition |
|---|---|
| **Current (v1.0.0)** | deterministic surplus; redraft weights ramp to production .30 in season; production x .40, k 4, no availability, top-third prior; dynasty fundamental .40 / market .30 / consensus .25 / ADP .05, aging power 1, prior k 10, prior-only veterans valued; DP values in market (.35); trend ±5–6%; isotonic slot curve; scale = single top asset |
| **Candidate A — "consensus only"** | values = rank mapping of FantasyPros ECR onto the league curve, nothing else (the simplest defensible model) |
| **Candidate B — "fundamentals only"** | projections + production (redraft) / fundamental multi-year model (dynasty) — no expert or market signals |
| **Candidate C — v2.0.0 (adopted)** | expected surplus; consensus-dominant weights (in season: consensus .45, projection .30, market .15, production .10); production x .25, k 2, × availability, median prior with ≥3 games; dynasty fundamental .25 / market .35 / consensus .40, aging power 2, prior k 20, evidence gate; DP and dynasty ADP weight 0; trend display-only; least-squares exponential slot curve; top-12 scale anchor |

### Ordering accuracy (Spearman ρ within position; higher is better)

| Task | Current v1 | A: consensus only | B: fundamentals only | C: v2 |
|---|---|---|---|---|
| Preseason redraft (E1, 2021–25) | 0.505¹ | **0.505** | 0.410–0.433 | 0.505¹ |
| In-season ROS (E2, 2021–24) | 0.487 | 0.490 | 0.427 (v1 prod.) / 0.453 (fitted) | **≈0.512**² |
| Dynasty 3-season (E3, 2020–23) | ≈0.571³ | 0.581 | 0.502 (v1) / 0.506 (v2 fundamental) | **≈0.583**³ |

¹ Production has weight 0 preseason in both versions, and the fitted ECR blend weight was 1.0; projections, ADP and
market could not be backtested, so the full preseason blend is not measurable.
² Fitted consensus+production blend (consensus weight 0.8–1.0), the historical analogue of v2's in-season weights.
³ ECR/fundamental blends at 50/50 (v1's 40% fundamental with 60% consensus-like signals) and 75/25 (v2).

### Level accuracy and additivity

| Metric | Current v1 | A | B | C: v2 |
|---|---|---|---|---|
| In-season ROS MAE (points) | 35.5 | **32.5** | 36.1 / 35.7 | ≈34.5 |
| Value-scale bias by preseason tier (E1b: 1–6 / 7–18 / 19–36 / 37–99) | −14.5 / −12.3 / −14.0 / −13.8 | (same scale as v1) | (same) | **−8.4 / −0.2 / −2.0 / +1.9** |
| Dynasty fundamental age bias (≤23 / 30+) | −0.110 / +0.094 | ≈0 (ECR unbiased) | −0.110 / +0.094 | **−0.018 / +0.020** (fundamental part) |
| Rookie slot curve LOO MAE / top-12 bias (E4) | 40.7 / +0.1 | — | — | **37.9 / +1.7** |

Consensus-only has the best ROS MAE, but it is a rank list: it cannot price league scoring, roster size, TE premium,
packages or picks, and it disappears when the source does. v2 keeps consensus as the dominant ordering signal and adds
the league-specific value structure.

### Robustness and internal consistency (CURRENT DATA / SIMULATION)

| Check | Current v1 | A | B | C: v2 |
|---|---|---|---|---|
| Monotonicity failures (75 checks) | 3 | n/a | n/a | **0** |
| Phantom values: out-of-league veterans ≥ 500 (dynasty 1QB) | **~36 players**, up to 4,316 | 0 | ~36 | **0** |
| One-game backups in Superflex redraft top 100 | yes (5,693, rank 20) | no | yes | **no** |
| Package simulation: corr(model trade margin, simulated lineup-point gain), all shapes | 0.253 (0.241 adjusted) | — | — | **0.634 (0.657 adjusted)** |
| … 1-for-1 / 2-for-1 / 3-for-1 / 4-for-2 | .61 / .28 / .12 / −.04 | — | — | **.77 / .70 / .54 / .49** |
| Remove FantasyPros ECR: dynasty ρ vs full | 0.990 | model gone | unaffected | 0.983 |
| Remove both projection sources: redraft ρ vs full | 0.800 | unaffected | model gone | **0.949** |
| Ordinary noise (±1 ECR rank, ±5% market/projections): ρ | ≥0.998 | — | — | ≥0.999 |

### Decision

C (v2) is adopted because it is **at least as accurate as consensus on ordering where that can be tested, unbiased
where v1 was biased, monotone, and internally consistent** with the roster-economics simulation, while remaining
usable if any single source disappears. It was not chosen for complexity: v2 removes three components from the
value (trend, DP market, dynasty ADP) and adds one parameter that was fitted (aging power) plus measured constants
(outcome SD, availability).

Not adopted: an ensemble with weights fitted to every source (only ECR has history — fitting the rest would be
invented confidence), week-specific weight schedules (no consistent pattern), per-season class strength (CV 0.28 with
four classes is noise-dominated), and MAE-optimal curves (biased low).

Compare old and new values yourself: `reports/audit/before-after.csv` (every player in four leagues) and
`before-after-sample.json` (representative players with the component that drove each change). To re-create the
"before" baseline for a future model change: `npm run sync`, then `npm run audit-model -- --freeze --snapshot-before
--out=DIR` on the old model, then `npm run audit-model -- --only=compare --out=DIR` on the new one (same frozen
dataset; `--out` keeps the committed reports untouched). The committed baseline `reports/audit/values-v1.json` was made
on the 2026-10-02 frozen dataset, which is not in the repository, so on any other dataset `--only=compare` skips with
these instructions.

### Before / after — representative players (12-team, CURRENT DATA)

| Player | Category | Redraft 1QB v1 → v2 | Dynasty 1QB v1 → v2 | Main mathematical reason |
|---|---|---|---|---|
| Jahmyr Gibbs | elite young RB | 10,000 → 9,910 | 11,968 → 11,936 | scale anchor changed (top-12 mean); otherwise unchanged |
| Jaxon Smith-Njigba | elite WR | 7,987 → 8,440 | 11,273 → 10,984 | consensus weight up, production down |
| Josh Allen | elite QB | 4,592 → 5,308 | 6,477 → 5,951 | redraft: expected surplus + consensus; dynasty: γ = 2 steeper post-30 decline |
| Christian McCaffrey | aging elite RB | 6,302 → 6,503 | 5,603 → 5,188 | dynasty longevity −665 (aging power 2 at age 30) |
| Davante Adams | aging WR | 3,260 → 3,821 | 3,797 → 3,727 | redraft: consensus weight up, expected surplus; dynasty: longevity lower (γ = 2 at 33) |
| Travis Kelce | aging TE | 1,413 → 2,021 | 1,383 → 1,451 | expected surplus near TE replacement |
| Brock Bowers | elite TE | 4,941 → 5,227 | 7,244 → 8,118 | consensus/market weight .75 (both rank him TE1) |
| Colston Loveland | young TE | 882 → 1,785 | 2,507 → 4,079 | dynasty: youth no longer under-rated; redraft: expected surplus |
| Geno Smith | mediocre QB | 3 → 986 | 513 → 581 | expected surplus: P(top-12 QB ROS) > 0 |
| Tre Tucker | mediocre WR | 171 → 1,093 | 1,139 → 1,239 | expected surplus below replacement |
| D'Andre Swift | mediocre veteran RB | 3,426 → 3,631 | 3,746 → 3,290 | dynasty longevity (age 27, RB) |
| Jack Strand | one-game backup QB | 661 → 0 (SF: 5,693 → 0) | — | no history + 1 game → no production signal; no other signal → N/A |
| A.J. Brown | injured (IR) WR | 1,130 → 2,391 | 3,394 → 4,062 | ROS consensus already prices the injury; production (which double-counted it) down-weighted |
| Jeremiyah Love | top rookie RB | 3,611 → 3,718 | 6,882 → 8,278 | dynasty consensus/market weight; fundamental no longer age-biased |
| Carnell Tate / Jordyn Tyson | rookie WRs | 838 → 1,828 / 205 → 1,110 | 3,958 → 5,149 / 3,652 → 4,600 | same |
| John Ross / Ezekiel Elliott | out of league | 0 → 0 / 0 → 269 | 4,042 → 0 / 3,605 → 0 | evidence gate (draft prior alone no longer counts); Elliott's 269 is a stale ADP signal |
| 2027 1.01 | pick | — | 4,968 → 5,456 | current-class and market mapped onto the new player curve |
| 2027 1.06 | pick | — | 2,580 → 3,098 | exponential curve removes the isotonic plateau/drop at 5–7 |
| 2027 1.12 / 2.01 | picks | — | 1,594 → 1,707 / 1,466 → 1,593 | — |
| 2028 1st | future pick | — | 2,189 → 2,458 | historical curve level |

Values are in the shared scale; a v2 value of 5,000 means the same thing in every league. Top-100 positional mix
(12-team 1QB redraft) moved from QB 13 / RB 35 / WR 36 / TE 11 to 16 / 29 / 43 / 12; in Superflex dynasty from
26 / 26 / 43 / 5 to 33 / 22 / 36 / 9 (QBs and TEs gain from consensus weight, aging RBs lose from γ = 2).
