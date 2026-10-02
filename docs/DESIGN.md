# Design Document — Research Findings & Architecture

_Written before implementation (2026-10-02, NFL week 4 of the 2026 season) and kept
up to date as the internal reference for "why is it built this way"._

---

## 1. Research summary (verified against live endpoints on 2026-10-02)

Every claim below was checked with a real HTTP request from the build environment.
"CORS" = whether a browser page on `localhost` may call the endpoint directly.

| Source | What it provides | Access method | Auth | CORS | Verdict |
|---|---|---|---|---|---|
| **Sleeper API** (`api.sleeper.app/v1`) | Player DB (12k players, IDs for ESPN/Yahoo/Rotowire/Sportradar…, injury status, depth chart, birth date, college), NFL state (season/week), trending adds/drops, league settings | Documented public REST API | None | `*` | **Automated, primary** for player metadata, injuries (reported), season state |
| Sleeper projections/stats (`api.sleeper.app/projections`, `/stats`) | Weekly & season projections (Rotowire-sourced, full stat lines), weekly stats incl. snaps & red-zone usage, ADP fields (`adp_ppr`, `adp_dynasty_ppr`, `adp_2qb`, `adp_rookie`) | **Undocumented** but public; used by Sleeper's own web app | None | `*` | **Automated, secondary/supplemental** — may change without notice |
| **FantasyCalc** (`api.fantasycalc.com/values/current`) | Trade-derived dynasty & redraft values, picks (`2027 1st (Early)`…), 30-day trend, tiers, roster %, cross IDs (Sleeper, ESPN, MFL, Fleaflicker) | Public JSON endpoint with query params `isDynasty,numQbs,numTeams,ppr` | None | `*` | **Automated, primary market source** |
| **DynastyProcess data repo** (`raw.githubusercontent.com/dynastyprocess/data`) | `values-players.csv`, `values-picks.csv` (DP trade values, 1QB/2QB, slot-level picks), `db_playerids.csv` (**ID crosswalk across 20+ systems incl. KTC, FantasyPros, PFR, ESPN, Yahoo, Sleeper, GSIS**), `db_fpecr_latest.csv` (FantasyPros ECR for ~35 ranking pages: ROS, weekly, dynasty overall/SF/positional, rookies), `db_fpecr.csv.gz` (ECR archive 2019-2025) | Public open dataset (GPL-3.0 repo), updated weekly by GitHub Actions | None | `*` | **Automated, primary** for ID crosswalk, FantasyPros ECR, DP values |
| **FantasyPros** (direct) | ECR, projections, ADP | Website; official API requires a partner key; `robots.txt` disallows `/api/`, `/json/` | Key for API | n/a | **Not scraped.** ECR consumed through the DynastyProcess mirror; direct CSV exports supported via **manual import** |
| **nflverse** (`github.com/nflverse/nflverse-data/releases`) | `players.csv` (GSIS/PFR/ESPN IDs, birth date, draft info), weekly player stats (`stats_player_week_YYYY.csv`, incl. target share, air-yards share, WOPR), season stats (`stats_player_reg_YYYY.csv`), snap counts, **official NFL injury reports**, schedules (`schedules/games.csv`), draft picks | Public open datasets (CC-BY 4.0 / MIT), GitHub release assets | None | Redirects to GitHub object storage (fetched server-side) | **Automated, primary** for actual statistics, official injury status, schedule |
| **Fantasy Football Calculator** (`fantasyfootballcalculator.com/api/v1/adp/{format}`) | Redraft ADP (ppr, half-ppr, standard, 2qb) with high/low/stdev and draft counts | Documented free API | None | **No** (server-side only) | **Automated, supplemental** (ADP); dynasty/rookie ADP endpoints currently return empty lists |
| **ESPN** (`lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/...kona_player_info`) | Weekly projections per stat (independent of Rotowire), ADP, % owned, injury status | **Undocumented** public endpoint | None | Echoes origin | **Automated, supplemental**, disabled-safe — a second *independent* projection source |
| **KeepTradeCut** | Crowd-sourced dynasty values | Values embedded in HTML | — | — | **Manual import only.** KTC Terms §2.1 explicitly prohibit "any form of automated data collection… web scraping… bots" |
| **Pro Football Reference** | Historical stats | Website | — | — | **Not used.** Returns 403 to automated clients; Sports-Reference restricts bots. nflverse provides the same underlying data (with PFR IDs) legally |
| **FFToday** | Projections / rankings HTML tables | Website, no API | — | — | **Manual import** via the generic projections template |
| **Yahoo / CBS** | League data | Yahoo requires OAuth app; CBS has no public API | OAuth | — | Not automated; IDs still carried via the DP crosswalk. Documented as future adapters |

### Which sources are automated vs manual

* **Automated (enabled by default):** Sleeper (players/state), Sleeper projections & stats,
  FantasyCalc, DynastyProcess values, DynastyProcess ID crosswalk, FantasyPros ECR (via DynastyProcess),
  nflverse (players, stats, snaps, injuries, schedule), Fantasy Football Calculator ADP, ESPN projections.
* **Manual import (first-class):** KeepTradeCut values, FantasyPros CSV exports (rankings/projections/ADP),
  generic projections (FFToday or any site), generic market values, generic rankings, generic ADP,
  rookie pick values.
* **Supplemental (lower default weight / never sole input):** ESPN projections, FFC ADP, Sleeper ADP,
  Sleeper trending.

### Known limitations & likely failure points

1. Undocumented endpoints (Sleeper projections/stats, ESPN) can change shape without notice →
   adapters declare expected fields and the quality system flags schema drift.
2. DynastyProcess updates weekly (not daily); its FantasyPros mirror lags FantasyPros by up to a week.
3. FantasyCalc values are trade-derived and thin for deep players (`maybeTradeFrequency`).
4. nflverse `ff_opportunity` (expected points) has no 2026 file yet → the app computes its own
   opportunity-based expected points from targets/carries/attempts.
5. Red-zone/goal-line usage only exists in Sleeper weekly stats (`rec_rz_tgt`, `rush_rz_att`).
6. No free source publishes historical market values via API → value history is built from this
   app's own sync snapshots going forward (never back-filled with invented data).
7. Contract data: nflverse `historical_contracts` exists (OverTheCap) but is not used in v1 valuation.

---

## 2. Architecture

```
            ┌────────────────────────── Node sync server (zero npm deps) ─────────────────────────┐
 sources →  │ adapters/*  →  raw cache  →  normalize  →  quality gate  →  identity resolution     │
            │   (one per source, standard methods)     data/raw   data/normalized   crosswalk     │
            │                                ↓                                                     │
            │                   dataset builder (merge per canonical player, failover)             │
            │                   data/calculated/dataset.json  +  data/snapshots/*.json.gz          │
            └──────────────────────────────────────┬───────────────────────────────────────────────┘
                                                   │ /api/*
            ┌──────────────────────────── Browser (vanilla ES modules) ────────────────────────────┐
            │ js/core/valuation (isomorphic, also used by Node tests)  ←  settings/profile         │
            │ js/ui/* views: Trade · Players · Compare · Rookies · Data · Settings · Diagnostics   │
            └──────────────────────────────────────────────────────────────────────────────────────┘
```

* **Valuation runs in the browser** from the cached dataset, so changing league settings or weights
  recalculates instantly with no network. The same modules run in Node for tests, snapshots and
  value-history.
* **Offline-first:** the app only needs `data/calculated/dataset.json`. If every source is down the
  last good dataset is served and stale warnings are shown.
* **No source names in the engine.** The engine sees typed *signals* (`ranking`, `projection`,
  `market`, `adp`, `stats`, `injury`, `pick_market`) tagged with a source id. Source weights live in
  `config/model.json`; source definitions in `config/sources.json`.

### Normalized record types (schema v1)

| Type | Key fields |
|---|---|
| `player` | ids{}, name, position, positions[], team, birth_date, college, draft{year,round,pick}, status, years_exp, depth_chart_order |
| `ranking` | kind (`ros`,`weekly`,`redraft`,`dynasty`,`rookie`), qb (`1qb`/`sf`), scope (`overall`/`position`), rank, ecr, sd, best, worst |
| `projection` | scope (`ros`,`season`,`week`), season, weeks[], games, stats{canonical stat keys} |
| `stat_week` | season, week, team, stats{canonical}, usage{snap_pct, target_share, wopr, rz_tgt, rz_att…} |
| `market_value` | dynasty bool, qb, ppr, teams, value, rank, pos_rank, trend_30d, tier |
| `adp` | format, adp, pos_adp, n_drafts |
| `injury` | status, official bool, body_part, practice, as_of |
| `pick_market` | season, round, slot\|null, bucket (`early`/`mid`/`late`/null), dynasty qb, value or ecr |

Canonical stat keys follow Sleeper's naming (`pass_yd`, `pass_td`, `pass_int`, `rush_att`, `rec`, `rec_tgt`, `rec_fd`…)
because it is the most complete public vocabulary; every adapter maps into it.

---

## 3. Valuation methodology (summary — full detail in VALUATION_MODEL.md / DYNASTY_MODEL.md / ROOKIE_PICK_MODEL.md)

**Common currency.** Every signal is converted into the same unit — *league-specific fantasy points
above replacement* (redraft: rest of season; dynasty: discounted multi-year) — before blending. This
avoids averaging unrelated scales.

* Projections/production → points via the league's scoring → minus position replacement level.
* Rankings (ECR, positional) → **position-rank mapping**: the k-th RB by experts receives the value of
  the k-th RB on the league's own value curve.
* Market values (FantasyCalc, DP, KTC) → position-rank mapping for players and a monotone
  value→value quantile map (fitted on players) for picks.
* ADP → overall-rank mapping.

**Blend.** `value = Σ wᵢ·signalᵢ / Σ wᵢ(available)` with phase-aware weights (preseason ↔ in-season
interpolated by week), then additive adjustments (trend, injury). Missing signals drop out and reduce
confidence; nothing is imputed.

**League adjustment.** Values are computed twice: once in a fixed *reference league* (12-team, 1QB,
PPR) and once in the user's league. Components are reported in the reference league and the
difference is the explicit "League-specific adjustment" line, so the breakdown always sums.

**Scale.** 10,000 = top asset in the reference league; the same scale factor is used for the user's
league so values are comparable across settings.

**Dynasty.** Year-by-year (default 5) projection of points per game using position aging curves,
draft-capital priors for young players, attrition (career survival) and growing uncertainty.
Per-year surplus is `E[max(0, X − replacement)]` for `X ~ Normal(μₜ, σₜ)` — this gives young,
uncertain players principled upside (breakout optionality) instead of an ad-hoc multiplier. Discounted
at a strategy-dependent rate. Market and consensus enter as separate signals.

**Rookie picks.** Value of class slot *p* blends (1) market pick values mapped to our scale,
(2) the historical slot-value shape (rookie ECR → realized 3-year production, 2019-2023 classes) anchored
to the current rookie class, (3) the current rookie class' model values by consensus rookie rank.
Unknown slots integrate over a slot distribution (uniform, projected range, or early/mid/late).
Future years are discounted.

**Packages.** Extra players received in uneven trades are charged (a) lineup displacement — the surplus of
the average team's worst starter at that position, derived from the league settings — and (b) a
roster-slot cost (value of the last rostered player). All parameters are configurable and shown in the
trade breakdown.

**Confidence.** From source coverage, cross-signal dispersion, sample size (games), and data age;
reported as High/Moderate/Low with reasons and an approximate fair-value range.
