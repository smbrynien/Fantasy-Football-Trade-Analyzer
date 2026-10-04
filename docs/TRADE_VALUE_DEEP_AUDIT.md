# Deep trade-value audit (2026-10-04) → model 2.5.0

Second-level quantitative review of the valuation engine, player values, pick values and the trade comparison. It
builds on the earlier audits (docs/MODEL_AUDIT.md: E1–E16) and asks the questions they did not: is the number a useful
measure of marginal fantasy value in *this* league, consistently across positions, ages, picks, formats and trade
structures — and where the evidence says no, what changes. Exact trade formulas: **docs/TRADE_ENGINE.md**.

Evidence kinds used (labelled in every report): **REAL HISTORICAL** (nflverse weekly stats 2006–2025, FantasyPros ECR
archive 2019–2025, walk-forward), **REAL outcomes / SIMULATED leagues** (E6/E14 one-season and E15/E16 three-season
league replays on real weekly points), **CURRENT DATA** structural checks (frozen dataset `2026-10-03-27fa2592`).
Reproduce: `npm run audit-model -- --only=e3,e15,e16,e17,e18,e19,deep` (≈15 min after the benchmark download).
Reports: `reports/audit/e17-format-translation.json`, `e18-value-scale.json`, `e19-survival.json`,
`deep-current.json`, `e3-dynasty.json` (new candidate columns), `e15-dynasty-verdict.json`, `e16-dynasty-finder.json`.

## 1. Current architecture (reconstructed from the code)

```text
Sources (Sleeper, FantasyCalc, FantasyPros ECR mirror, nflverse, FFC, ESPN, manual imports)
↓ adapters/*            normalized records per data type; raw kept; batches validated (quarantine on schema/
                        count/mass-change errors)
↓ identity.js           canonical player ids (external ids → name+position → disambiguation; ambiguous never merged)
↓ dataset-builder.js    per player: rankings, market values, ADP, projections (weekly projections summed to ROS),
                        weekly stats, last season, injuries, bye week, team schedule
↓ context.js            league scoring applied to projections, production rate (regressed to a prior), injury games
                        lost, remaining games
↓ replacement.js        league structure from the projection pool: starters per position (dedicated, then FLEX/SF
                        greedily by points), replacement r (last starter), waiver w (last rostered), displacement
↓ redraft.js            surplus S(points) = ES(X; r) + β·band; curves per position; consensus/market by positional
 / dynasty.js           rank and ADP by overall rank onto the curves; group blend; availability shape (redraft);
                        dynasty fundamental = discounted, survival-weighted multi-year surplus (§9)
↓ picks.js              class-position value: market (mapped through each source's player scale) + historical slot
                        shape + current class; future-year discount; isotonic per season
↓ engine.js             value = score × factor (top-12 reference mean = 7,000); components sum to the value; ranks
↓ trade.js              Σ values − package charge → diff, pct; verdict from the calibrated outcome frequency
↓ roster.js (optional)  lineup value and expected lineup points before → after (My Team)
↓ UI                    verdict, bars, market check, notes, Even it out, other formats, other assumptions (new),
                        source-disagreement badges (new), full breakdown, audit record
```

Every transformation is listed with its formula and parameters in docs/TRADE_ENGINE.md §1–§10.

## 2. Current value definition

The number **is** defined: expected surplus fantasy points above the league's replacement level (rest of season in
redraft; discounted, survival-weighted seasons in dynasty), in league scoring, times one constant shared by all leagues.
Consensus and market are not averaged in raw form; they are placed on this surplus scale by rank. So "player value"
is a fundamental roster-utility number informed by markets, not a market price and not a ranking. Trade value = Σ asset
values − package charge (roster economics of uneven trades). Roster-specific value (My Team) is kept separate and
shown beside the verdict. **Finding:** no target-variable problem; the architecture already separates fundamental
(projection/production/fundamental), market and consensus as groups that are shown separately ("Signals compared
separately", Model − Market column) and blended by evidence-based weights. A stricter "Fundamental + Market + Roster +
Risk = Trade value" split was **not** adopted: roster utility is already a separate layer (E12 showed it predicts a
team's own outcome better but must not be mixed into a league-generic verdict), and risk is not added as a value
adjustment (2.2.0 tested a volatility penalty: rejected; E10: the ± is source disagreement, not outcome risk).

## 3. Major mathematical weaknesses found

| # | Finding | Evidence | Action |
|---|---|---|---|
| W1 | Dynasty survival compounded the one-year exit hazard of *currently relevant* players: over-stated RB/WR/TE survival 3–4 seasons out, under-stated QB survival | E19: WR 27–29 active after 4 seasons 61% modelled vs 43% observed; RB 27–29 after 3: 51% vs 38%; QB overall after 4: 55% vs 63% | **Fixed (2.5.0)**: later-year hazard × per-position multiplier fitted on observed survival (QB .70, RB 1.35, WR 1.60, TE 1.25); E15 corr .618 → .636 / .616 → .641 on both seeds (survival fix alone) |
| W2 | The draft-capital prior weighs 20 games for every position; for WRs the data prefer half that | E3 within-position Spearman WR .554 (k 10) vs .532 (k 20), 4/4 seasons; QB best at 20–40 | **Fixed (2.5.0)**: WR k = 10 |
| W3 | Youth growth (aging power 2) over-rates young players who already produce well | E3 subgroup age < 24 and consensus top third: +8 percentile points over-rated (n = 77 player-seasons); young players overall calibrated (−1.5) | **Not changed**: a separate growth power (1.5 or 1) was inconsistent in E15 (worse on one seed each) and under-rates young players overall. Documented limitation (§20) |
| W4 | Linear surplus scale under-weights stars relative to mid/deep tiers in correlation terms | E18: exponential "chart" on the app's ranking corr .570/.557 vs app .552/.542 | **Not changed**: sign accuracy +0.4 pp (n.s.); the gain is about margin linearity, which the calibrated verdict already maps to frequencies; the surplus scale stays interpretable |
| W5 | Within-position order in standard/half/TE-premium leagues comes from PPR consensus lists | Every FP list is PPR; FantasyCalc only 0.5/1 PPR | **Not changed**: E17 — translating the PPR order with each player's own stat profile did not predict format outcomes better (standard .528 → .530, half .538 → .537, TEP equal) |
| W6 | The dynasty "contending/rebuilding" setting barely changes relative values | D11: young −16% vs old −13.5% under contending (≈ uniform rescaling, because consensus/market are mapped onto the curve) | **Documented**; the trade view's win-now vs future split and the per-year table are the horizon tools |
| W7 | Confidence (a data-quality heuristic) can rise when a dissenting source disappears | D9: removing projections raised confidence for 23% of sampled redraft players | **Documented limitation**; confidence is labelled a heuristic and does not enter values or verdicts |
| W8 | Calibrated aging curves zig-zag after the peak (WR yearly ratios 30: .933, 31: .914, 32: .941, 33: .903), so a synthetic WR with identical production was worth more one year older (D7: +1.7% at 30→31, +4.4% at 32→33) | D7 inversion check | **Fixed (2.5.0)** as a consistency constraint: log-concave **decline** (PAV on the yearly log-changes from the peak on). Predictive tests neutral: E3 .508 → .510; E15 corr .633 → .614 / .645 → .645, log-lik −21 / +54 (within the run-to-run noise of the simulation). Rejected: concave growth as well (E3 .513 but E15 worse on both seeds: .629 / .632) |

## 4. Data / source weaknesses

* Consensus is one provider (FantasyPros ECR; DynastyProcess player values have weight 0 as a near-copy, ρ .99).
  D8 ablation (current data): removing the consensus group moves redraft values most; removing any single other
  source moves median values ≤ a few percent; no top-100 asset loses its value when one source is removed.
* No market history exists (FantasyCalc is current-only): market weights are untested except via the app's own daily
  archive (E13, after the 2026 season). Dynasty tests (E3, E8, E15, E16) therefore run without the market group.
* All ranking lists are PPR; no Superflex-specific redraft ROS list beyond FP's overall SF list.

## 5. Double-counting findings

| Where it could double count | Finding |
|---|---|
| Scarcity: replacement level + positional multipliers | **No positional multiplier exists** (code reading; D3). Scarcity enters once, via the league replacement level. The bench band (β), option value (σ) and availability shape change the tier shape, not position weights: removing them changes positional shares of top-100 value by ≤ 1.5 points (D3) |
| Consensus/market mapped onto curves + curve already scarcity-based | Not a double count: rank mapping only orders players; magnitudes come from the curve once |
| Age: aging curve + attrition + discount | Aging is fitted on survivors (delta method), attrition on exits, the discount is time preference — three distinct things; W1 corrected how attrition compounds. No explicit age multiplier exists |
| Injury: availability share + games-lost table + IR zero projection | Availability = share of games played by players who stay active (excludes exit seasons, which are attrition); games-lost applies only to current designations; zero projection only to long-term lists. No overlap found; 2.4.0 removed the IR-zero/ADP leak |
| Correlated sources (ECR ↔ DynastyProcess, ADP lists) | Handled by source weights (DP 0) and ADP needing corroboration; D8 shows no single source controls values |

## 6. Replacement-level findings

Replacement is computed from the actual roster configuration each time (starters per position incl. FLEX/SF
allocation by projected points; waiver level from bench share) — no fixed ranks or baselines. D2 league sweep (current
data, both modes) checks directions: Superflex and 2QB raise QB12/QB20; TE premium raises TE1/6/12 monotonically in
0 → 0.25 → 0.5 → 0.75 → 1 and moves QB/RB values < 8% while WRs lose value because TEs take FLEX spots (TE starters
12 → 19 at +1/reception); a third WR starter raises WR36; removing one RB slot lowers RB24; 14 teams vs 8 raise RB24/
WR24. A higher replacement level ("average team's worst starter") was tested in E18 and predicted trade outcomes
slightly *worse* (replacement shifted ¼–1 team up: corr .554 → .526 with the package adjustment).

## 7. Positional findings

* QB value emerges from replacement only: in 1QB the 12th QB is worth ≈ 1,100 and QB24 ≈ 200; in Superflex QB12/QB20 rise
  (D2). No QB multiplier. 2.5.0's survival fix raises QBs ≈ 3% in dynasty (QB careers last longer than compounding said).
* TE premium works through scoring and replacement; no TE multiplier (D2, W5).
* Cross-format (D4): in standard scoring reception-heavy WRs lose relative value (Spearman of reception share with the
  value change −.55); RBs and TEs only weakly (−.12, −.06) because 60% of the redraft weight is PPR-ordered consensus
  and market; positional rank moves ≤ 8.

## 8. Redraft findings

* Remaining-season value: projections are rest-of-season (weekly projections for unplayed weeks summed), production is
  scaled to remaining games, consensus switches to ROS lists in season, ADP weight falls to 0 by week 8 (E2/E9 tested).
* Weekly utility / consistency: a volatility penalty was tested in 2.2.0 (E5/E6) and rejected; E5's volatility
  residual check found no reliable effect. Not added.
* Recent performance: E2 fitted recency weight 0; opportunity (expected fantasy points) is blended .25 into the
  production rate (E2 fit). Not changed.
* Sensitivity (D6): +1% projection moves values ≤ 5% (elasticity largest near replacement) and never lowers a value;
  +1% market ≤ 0.6%.
* Inversions (D5): **0** redraft dominance inversions among the top 80 per position (A better on projection, consensus
  and market yet worth > 5% less).

## 9. Dynasty findings

* Horizon (D11, share of the fundamental): under 24: year 1 23%, years 2–3 51%, years 4+ 27%; 30+: 51% / 42% / 5%.
  Distant years matter mostly for young players, as intended; the fundamental is 25% of the blend.
* Age adjacency (D6/D7): one year older costs a median 2.3% (max 10%); synthetic identical-production players show no
  cliffs > 30% per year after the position's peak window; before the peak young players are worth more (growth +
  longer career), strongly for TEs (aging curve 0.74 at 22 → 1.0 at 26) — see W3.
* Aging shape (W8, fixed): before the fix D7 found identical WR production worth more a year older after the peak —
  sampling noise in the yearly aging ratios. The decline is now log-concave. D7's separate size flag (no one-year cut
  > 30%) still fails for QBs and TEs at ages 21–24: that is the youth-growth premium (W3) on a near-replacement
  synthetic player (surplus is convex in points), not an inversion; it is left visible in the structural checks.
* Survival (W1, fixed) and WR prior (W2, fixed). Smoothing the career-year draft priors was tested and **rejected**
  (QB within-position Spearman .492 → .385: the career-year pattern is real — early QBs often sit their first year).
* Inversions (D5): 7 dynasty dominance inversions among the top 80 per position, all driven by the draft-capital prior
  of low-production young players (e.g. Travis Hunter, a two-way player: fundamental 2,860 vs market 960) or by
  near-zero TE values; the trade view now flags such assets ("sources disagree").

## 10. Rookie-pick findings (D10)

* Ordering is strictly monotone within each draft; 1.12 → 2.01 is a smooth step (126 vs a mean in-round gap of 339 in
  12-team 1QB) — class position is continuous, no artificial round cliff.
* Future years: generic 1st 2027 → 2028 → 2029 = 3,132 → 2,451 → 2,102 (1QB; ×0.78 then ×0.86). The model parts use a
  constant 0.88/year; the larger first step comes from market pick values (FantasyCalc prices the nearer class higher).
  Not changed (market information).
* Pick ↔ player (12-team 1QB): 1.01 ≈ the 25th most valuable player, 1.06 ≈ 67th, 1.12 ≈ 112th, a generic 2027 1st ≈
  66th; Superflex shifts these down the board (QBs enter the top). Player and pick values share one scale (picks are
  mapped through each market source's player values).
* League context: pick values move with league size (class position), scoring and QB format (through the player scale).

## 11. Trade-package findings

* Package arithmetic: Σ values − charges for the side receiving more players (formula in TRADE_ENGINE §4). E6 (redraft):
  better than plain sums in every season; E15 (dynasty): no measurable difference (.618 vs .616) — kept.
* Invariants (new `tests/trade-invariants.test.js`): A ↔ A exactly 0; order inside a side never matters; swapping sides
  negates; adding an asset never lowers the receiving side's adjusted total; A + small asset > A; share-link round
  trip identical; two generic picks count twice; components and side totals reconcile exactly.
* Consolidation premium / depth value: no hard-coded premium. E18 shows the remaining consolidation signal (stars vs
  mid-tier pairs) is at the margin-linearity level, not the ordering level (sign accuracy +0.4 pp, n.s.).

## 12. Uncertainty findings

The ± is a model uncertainty range from source disagreement and coverage (E10: covers 13% of season outcomes) — it is
labelled as such and does not drive the verdict, which uses the calibrated outcome frequency (redraft E7/E10, dynasty
E15). New: per-asset "sources disagree" badges listing the signal groups; "This trade under other model assumptions"
shows whether a conclusion depends on how the sources are weighted.

## 13. Backtesting

| Experiment | Question | Result |
|---|---|---|
| E17 | Translate PPR consensus order to standard/half/TEP with each player's stat profile? | standard .528 → .530 (8/12 windows), half .538 → .537, TEP .438 → .438 / .439 → .441: **no** |
| E18 | Which value scale predicts simulated trade outcomes? | ordinal rank .33/.31, raw points .38/.37, PAR .53/.53, app linear surplus .55/.54, power 1.25 .55/.54, exp chart (k 25–35) .57/.56; sign accuracy app .685/.691 vs chart .690/.694: **keep linear** |
| E19 | Does compounding the one-year hazard describe multi-year survival? | No: RB/WR/TE over-stated, QB under-stated (table in §3) |
| E3 (new columns) | Survival multiplier, prior weight by position, prior smoothing, growth power, log-concave aging | within-position: survival n/c; WR k 10 +.022 (4/4); smoothing −.024 overall (QB −.107); growth power 1 +.006 but young under-rated; log-concave aging: full +.005 (but E15 worse on both seeds), decline only +.002 |
| E15 (2.5.0 values) | 3-season dynasty trade outcomes | see §14 |
| E16 (2.5.0 values) | Dynasty trade finder (3 seasons, seeds 16 / 99) | top option vs random fair: proposer +26.1 / +24.6 (significant), other team +3.8 / +0.9 (n.s.); vs most even +31.1 / +23.6; owner-aware vs finder: other team +13.7 / +23.7 (significant), proposer +4.1 / −6.6 (n.s.) — same conclusions as 2.4.0 |

## 14. Baseline comparisons

* Redraft scale baselines (E18): consensus rank as value (ordinal) and raw projected points lose badly to the surplus
  scale; plain PAR loses to expected surplus. Earlier audits: ECR beats every single signal (E1/E2), the app blend is
  best on MAE (E9).
* Dynasty (E15, 3-season trade outcomes, seeds 15 / 99; corr = margin vs realised outcome, log-lik = logistic fit):
  | Model | corr | log-lik | levels close / lean / clear came out ahead |
  |---|---|---|---|
  | 2.4.0 | .618 / .616 | −2893 / −2861 | 51 / 64 / 77% · 51 / 64 / 78% |
  | survival fix only | .636 / .641 | — | — |
  | survival + WR prior | .633 / .645 | −2836 / −2813 | 55 / 63 / 78% · 53 / 63 / 79% |
  | + concave aging (growth and decline; rejected) | .629 / .632 | −2847 / −2868 | 52 / 61 / 78% · 52 / 62 / 78% |
  | **2.5.0 final** (+ log-concave decline) | .614 / .645 | −2857 / −2758 | 55 / 63 / 78% · 51 / 62 / 79% |

  Final 2.5.0 vs 2.4.0: log-likelihood better on both seeds (+36 / +103), mean hit rate .710 → .718; correlation mixed
  (−.004 / +.029). Small value changes re-draft the simulated rosters, so runs differ by roughly ±.015 in corr and ±50 in
  log-lik for changes that move values by ≈ 1% — differences below that are noise. (Report:
  `reports/audit/e15-dynasty-verdict.json`.)
* Dynasty trade finder (E16, final 2.5.0): its top option beats a random fair package by +26 / +25 discounted lineup
  points for the proposer, the other team not measurably worse; ranking by both teams' gains gives the other team
  +14 / +24 at no measurable cost to the proposer (+4 / −7, n.s.). An intermediate 2.5.0 run (before the aging fix)
  showed a significant proposer cost (−13 / −15) for the owner-aware ranking; the final run does not — another sign of
  the simulation's run-to-run noise, so that intermediate result is not acted on.

## 15. Ablation results (D8, current data)

Dropping each source or each signal group and re-valuing (median absolute change and Spearman of the top 200) —
`reports/audit/deep-current.json` → `D8_ablation`. Values degrade gracefully: no source removal makes a top-100 asset
vanish; the consensus group is the largest single influence (as E1/E9 found it should be).

## 16. Sensitivity results

D6 (+1% inputs) and D7 (age) above; D9 missing data: removing one input from a player never makes a valued top player
vanish; renormalisation can move a value up to ±28% when the removed signal was the outlier (by design: missing data
is never imputed); confidence falls in most cases (W7).

## 17. Weird / inverted values

D5 (inversions) and D12 (largest disagreement between model parts): dynasty outliers are young players valued mostly
by draft capital (fundamental ≫ market/consensus) and two-way or position-changing players; redraft outliers are
players whose ADP or consensus still ranks them while their projection is near zero. All are now visible as "sources
disagree" in trades and in the player's "Market & sources" tab.

## 18. Recommended redesign (and what the evidence supports today)

Keep the current architecture — it already is the "ideal" one the brief describes: a league-specific surplus target,
signals mapped by rank (no raw averaging), scarcity only through replacement, separate fundamental/market/consensus,
roster utility as a separate layer, package economics for uneven trades, outcome-calibrated verdicts, explicit model
version + data snapshot + settings hash. Changes supported now: W1, W2 (done). Future redesign candidates that need
data the project does not have yet: market weights (E13, daily archive), pick outcomes in the dynasty simulation,
Superflex/TE-premium historical outcome tests, a level-dependent growth term for young producers (W3).

## 19. Changes implemented (model 2.5.0)

1. Dynasty survival: later-year hazard multiplier (calibrate.js → attrition.json `later_year_multiplier`;
   settings.js; dynasty.js; config default 1).
2. Dynasty draft-capital prior: `rate_evidence.prior_pseudo_games_by_position` {WR: 10}.
2a. Aging decline log-concave (W8): `scripts/lib/calibration-shape.js` `concave: 'decline'`, used by `calibrate.js`
   and by the walk-forward audit harness (`backtests.js calibrateBefore`), so E3/E15/E16 test the shipped shape.
3. Trade view: "sources disagree" badge per asset; "This trade under other model assumptions" block.
4. Tests: `trade-invariants.test.js` (9), `model-2-5.test.js` (4), helper tests; E2E check for the new block.
5. Audit tooling: E17, E18, E19, structural checks D1–D12 (`--only=deep`), E3 candidate columns, E15/E16 on 2.5.0.
6. Docs: this report, TRADE_ENGINE.md, VALUATION_MODEL/DYNASTY_MODEL, handoff.

Before / after (12-team Superflex dynasty, frozen data; redraft values are unchanged):

| Asset | Pos | Age | 2.4.0 | 2.5.0 | Change | Primary reason |
|---|---|---|---|---|---|---|
| Josh Allen | QB | 30.4 | 10,449 | 10,714 | +2.5% | QB survival (E19) |
| Trevor Lawrence | QB | 27.0 | 6,664 | 6,863 | +3.0% | QB survival |
| Fernando Mendoza | QB (rookie) | 23.0 | 5,125 | 5,280 | +3.0% | QB survival |
| Geno Smith | QB | 36.0 | 3,440 | 3,544 | +3.0% | QB survival |
| Jahmyr Gibbs | RB | 24.5 | 11,663 | 11,393 | −2.3% | RB later-year attrition |
| Breece Hall | RB | 25.3 | 4,192 | 4,153 | −0.9% | RB attrition vs FLEX shift |
| Blake Corum | RB | 25.9 | 1,626 | 1,646 | +1.2% | one FLEX spot WR → RB |
| Tyjae Spears | RB | 25.3 | 539 | 576 | +6.9% | near replacement: FLEX shift |
| Jeremiyah Love | RB (rookie) | 21.3 | 8,173 | 8,013 | −2.0% | RB attrition |
| Jaxon Smith-Njigba | WR | 24.6 | 10,977 | 11,309 | +3.0% | WR prior 10 (production counts more) |
| George Pickens | WR | 25.6 | 5,738 | 5,431 | −5.3% | WR attrition + prior |
| Davante Adams | WR | 33.8 | 3,533 | 3,229 | −8.6% | WR later-year attrition + log-concave decline |
| Jayden Reed | WR | 26.4 | 1,521 | 1,372 | −9.8% | prior weight + FLEX shift |
| Odell Beckham (FA) | WR | 33.9 | 642 | 236 | −63% | near replacement at 34: later-year WR attrition (largest relative change) |
| Brock Bowers | TE | 23.8 | 8,139 | 7,973 | −2.0% | TE attrition |
| Dalton Kincaid | TE | 27.0 | 2,781 | 2,724 | −2.1% | TE attrition |
| Dalton Schultz | TE | 30.2 | 872 | 849 | −2.6% | TE attrition |
| 2027 1.01 / 1.06 / 1.12 | Pick | — | 5,807 / 3,511 / 2,047 | 5,709 / 3,450 / 2,003 | −2% | player scale they map onto |
| 2027 / 2028 / 2029 1st | Pick | — | 3,596 / 2,941 / 2,494 | 3,527 / 2,868 / 2,392 | −2% to −4% | same |

Dynasty top-50 Spearman .994 (1QB) / .987 (SF), top-50 changes −7.5% to +3.2%; 5,162 of 12,425 asset values change,
all dynasty (0 redraft). By group (12-team 1QB dynasty, values ≥ 500): QBs +2.5 to +3.1% (median), TEs −2%, WRs −3.5
to −5.4%, RBs +3 to +10% (one FLEX spot moved from WR to RB; deep RBs up to +20%), picks −1.3% median. The log-concave
decline alone (W8) moves WR values by at most ±3.5% and other positions by < 1.5%.

## 20. Remaining limitations

* Young players who already produce well are over-rated by the dynasty fundamental (W3, ≈ +8 percentile points; the
  fundamental is 25% of the value).
* Picks are not in any outcome simulation (no historical pick values); Superflex and TE premium have structural checks
  only (no historical outcome test).
* The dynasty strategy setting is almost a uniform rescaling (W6).
* Confidence is a heuristic and can rise when a dissenting source disappears (W7).
* Market weights remain untested until a season of the daily archive exists (E13).
* All simulations use simple simulated managers (no trades after the draft, one waiver move a week, 12 teams).
* Nothing here proves a single trade right or wrong: the outcome frequencies are calibration of the model's margins,
  not predictions of what a manager will accept or of one trade's result.
