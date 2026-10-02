# Model Comparison

The current production model (v1.0.0, before the audit) against three candidates, using only the validation that is
actually available. Details and methods: [MODEL_AUDIT.md](MODEL_AUDIT.md). All historical figures are
**REAL HISTORICAL DATA, walk-forward** (parameters fitted on earlier seasons only); current-data figures are
**CURRENT DATA** (frozen 2026-10-02 snapshot) or **SIMULATION**, as labelled.

| Model | Definition |
|---|---|
| **Current (v1.0.0)** | deterministic surplus; redraft weights ramp to production .30 in season; production x .40, k 4, no availability, top-third prior; dynasty fundamental .40 / market .30 / consensus .25 / ADP .05, aging power 1, prior k 10, prior-only veterans valued; DP values in market (.35); trend ±5–6%; isotonic slot curve; scale = single top asset |
| **Candidate A — "consensus only"** | values = rank mapping of FantasyPros ECR onto the league curve, nothing else (the simplest defensible model) |
| **Candidate B — "fundamentals only"** | projections + production (redraft) / fundamental multi-year model (dynasty) — no expert or market signals |
| **Candidate C — v2.0.0 (adopted)** | expected surplus; consensus-dominant weights (in season: consensus .45, projection .30, market .15, production .10); production x .25, k 2, × availability, median prior with ≥3 games; dynasty fundamental .25 / market .35 / consensus .40, aging power 2, prior k 20, evidence gate; DP and dynasty ADP weight 0; trend display-only; least-squares exponential slot curve; top-12 scale anchor |

## Ordering accuracy (Spearman ρ within position; higher is better)

| Task | Current v1 | A: consensus only | B: fundamentals only | C: v2 |
|---|---|---|---|---|
| Preseason redraft (E1, 2021–25) | 0.505¹ | **0.505** | 0.410–0.433 | 0.505¹ |
| In-season ROS (E2, 2021–24) | 0.487 | 0.490 | 0.427 (v1 prod.) / 0.453 (fitted) | **≈0.512**² |
| Dynasty 3-season (E3, 2020–23) | ≈0.571³ | 0.581 | 0.502 (v1) / 0.506 (v2 fundamental) | **≈0.583**³ |

¹ Production has weight 0 preseason in both versions, and the fitted ECR blend weight was 1.0; projections, ADP and
market could not be backtested, so the full preseason blend is not measurable.
² Fitted consensus+production blend (consensus weight 0.8–1.0), the historical analogue of v2's in-season weights.
³ ECR/fundamental blends at 50/50 (v1's 40% fundamental with 60% consensus-like signals) and 75/25 (v2).

## Level accuracy and additivity

| Metric | Current v1 | A | B | C: v2 |
|---|---|---|---|---|
| In-season ROS MAE (points) | 35.5 | **32.5** | 36.1 / 35.7 | ≈34.5 |
| Value-scale bias by preseason tier (E1b: 1–6 / 7–18 / 19–36 / 37–99) | −14.5 / −12.3 / −14.0 / −13.8 | (same scale as v1) | (same) | **−8.4 / −0.2 / −2.0 / +1.9** |
| Dynasty fundamental age bias (≤23 / 30+) | −0.110 / +0.094 | ≈0 (ECR unbiased) | −0.110 / +0.094 | **−0.018 / +0.020** (fundamental part) |
| Rookie slot curve LOO MAE / top-12 bias (E4) | 40.7 / +0.1 | — | — | **37.9 / +1.7** |

Consensus-only has the best ROS MAE, but it is a rank list: it cannot price league scoring, roster size, TE premium,
packages or picks, and it disappears when the source does. v2 keeps consensus as the dominant ordering signal and adds
the league-specific value structure.

## Robustness and internal consistency (CURRENT DATA / SIMULATION)

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

## Decision

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
"before" baseline for a future model change: `npm run audit-model -- --snapshot-before` on the old model, then
`npm run audit-model -- --only=compare` on the new one (same frozen dataset).

## Before / after — representative players (12-team, CURRENT DATA)

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
