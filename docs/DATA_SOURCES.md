# Data Sources

Verified against live endpoints on **2026-10-02** (2026 season, week 4). Re-verify when something breaks — see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md). Source definitions live in [`config/sources.json`](../config/sources.json);
adapters in [`/adapters`](../adapters).

## Source matrix

| Source | Purpose | Automatic? | API? | File import? | Update frequency | Reliability | Fallback |
|---|---|:-:|:-:|:-:|---|---|---|
| **Sleeper** (`sleeper`) | Player DB, IDs, bio, depth chart, reported injury status, NFL season/week | ✅ | ✅ documented | — | Players: daily · state: live | High (official public API, CORS open) | DP crosswalk + nflverse players; cached state; calendar |
| **Sleeper Projections** (`sleeper_projections`) | Weekly & season projections (Rotowire), ADP (redraft, 2QB, dynasty, rookie) | ✅ | ⚠️ undocumented | via generic projections/ADP import | Daily in season | Medium (undocumented, used by Sleeper's app) | ESPN projections, manual projections |
| **Sleeper Weekly Stats** (`sleeper_stats`) | Weekly stats incl. snaps & red-zone usage; previous-season totals | ✅ | ⚠️ undocumented | — | After games | Medium | Secondary to nflverse (automatic failover) |
| **FantasyCalc** (`fantasycalc`) | Trade-derived market values, dynasty & redraft, 1QB/SF, PPR/half, team counts; pick values; 30-day trend | ✅ | ✅ public JSON | KTC/generic market import | Several times daily | High (stable for years, CORS open) | DynastyProcess values, KTC import |
| **DynastyProcess Values** (`dynastyprocess_values`) | DP values 1QB/2QB, slot-level & bucket pick values | ✅ | dataset (GitHub raw) | — | Weekly (GitHub Actions) | High | FantasyCalc |
| **DynastyProcess ID Crosswalk** (`dynastyprocess_ids`) | IDs across MFL, Sportradar, FantasyPros, GSIS, PFF, Sleeper, NFL, ESPN, Yahoo, Fleaflicker, CBS, PFR, Rotowire, **KTC**, FantasyData; bio & draft | ✅ | dataset | — | Weekly | High | Persisted local crosswalk keeps all learned IDs |
| **FantasyPros ECR via DynastyProcess** (`fantasypros_ecr`) | Expert consensus: ROS, weekly, redraft, dynasty (overall/SF/positional), rookies — with best/worst/SD | ✅ | dataset (mirror) | ✅ FantasyPros CSV export | Weekly | High (but up to a week behind FP) | Manual FantasyPros import |
| **nflverse** (`nflverse`) | Players (GSIS/PFR/ESPN IDs, birth date, draft), weekly + season stats (target share, air-yards share, WOPR), snap counts, **official injury reports**, schedule | ✅ | dataset (GitHub releases) | — | Daily in season | High (CC-BY open data) | Sleeper stats (automatic) |
| **Fantasy Football Calculator** (`ffc_adp`) | Redraft ADP (PPR, half, standard, 2QB) with high/low/stdev | ✅ | ✅ documented | generic ADP import | Daily during draft season | Medium (thin samples in-season; dynasty/rookie endpoints currently empty) | Sleeper & ESPN ADP |
| **ESPN** (`espn`) | Independent weekly/season projections, ADP (undrafted default ≈170 collapsed to exactly 170 and flagged `undrafted`), % owned, injury status | ✅ | ⚠️ undocumented | via generic projections import | Daily | Medium | Sleeper projections, manual |
| **KeepTradeCut** (`ktc`) | Crowd dynasty/redraft values incl. picks | ❌ **manual only** | — | ✅ | Whenever you import | n/a | FantasyCalc, DP |
| **FantasyPros (direct)** (`fantasypros_manual`) | Your own CSV exports of any FP rankings page | ❌ manual | partner key only | ✅ | Whenever you import | n/a | DP mirror (automatic) |
| **Manual: projections / market / rankings / ADP / picks** | Any table you're permitted to use (FFToday, an analyst, your own) | ❌ manual | — | ✅ | Whenever you import | n/a | — |
| Pro Football Reference | — | ❌ not used | — | — | — | Returns HTTP 403 to automated clients | nflverse carries PFR IDs & the same box-score data |
| Yahoo / CBS | — | ❌ not used | Yahoo: OAuth app; CBS: none | — | — | — | IDs still mapped via DP crosswalk |

## Verification notes (what was actually checked)

| Endpoint | Result on 2026-10-02 |
|---|---|
| `api.sleeper.app/v1/state/nfl` | 200, `{"season":"2026","week":4,"season_type":"regular"}`, `Access-Control-Allow-Origin: *` |
| `api.sleeper.app/v1/players/nfl` | 200, 14.7 MB, 12,229 players |
| `api.sleeper.app/projections/nfl/2026/5?...` | 200; `company: rotowire`; full stat lines (`rec_tgt`, `rec_fd`, …) and ADP fields (`adp_ppr`, `adp_dynasty_ppr`, `adp_rookie`, 999 = undrafted) |
| `api.sleeper.app/stats/nfl/2026/3?...` | 200; includes `off_snp`, `tm_off_snp`, `rec_rz_tgt`, `rush_rz_att` |
| `api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1` | 200, 421 assets incl. 24 picks, CORS `*`, `max-age=1200` |
| `raw.githubusercontent.com/dynastyprocess/data/master/files/*` | `values.csv`, `values-players.csv`, `values-picks.csv`, `db_playerids.csv` (12.5k rows, 35 columns), `db_fpecr_latest.csv` (35 FP pages), `db_fpecr.csv.gz` (2019-2025 archive, 105 MB) — all 200, CORS `*` |
| `github.com/nflverse/nflverse-data/releases/download/...` | `players/players.csv`, `stats_player/stats_player_week_2026.csv`, `stats_player/stats_player_reg_{1999..2025}.csv`, `snap_counts/snap_counts_2026.csv`, `injuries/injuries_2026.csv`, `schedules/games.csv` → 200 (redirect to object storage). `ff_opportunity_2026` → 404 (expected points therefore computed locally) |
| `fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=2026` | 200, 109 drafts, **no CORS header** → fetched by the local server |
| `lm-api-reads.fantasy.espn.com/.../kona_player_info` with `x-fantasy-filter` | 200; per-week projections (`statSourceId=1`); stat IDs mapped and verified against Rotowire lines |
| `keeptradecut.com/terms-and-conditions` | §2.1 prohibits "any form of automated data collection … web scraping … bots or crawlers" |
| `fantasypros.com/robots.txt` | `Disallow: /api/`, `/json/`, `Crawl-delay: 5`; terms restrict automated access |
| `pro-football-reference.com` | 403 to non-browser clients |

## Why each source is (or isn't) automated

* **Automated** only when the data is an official API, an open dataset, or a public endpoint used by the provider's own
  web app with no prohibition we found. Undocumented endpoints are marked as such, given lower priority, and their
  failure never breaks the app.
* **KeepTradeCut** explicitly forbids automated collection → manual import only. The app never contacts KTC.
* **FantasyPros**: automated access is disallowed on the site and the API needs a partner key. Their ECR reaches us via
  the DynastyProcess open dataset (a weekly snapshot that DP publishes for developers).
* **PFR**: blocks automated clients; nflverse provides the same underlying data under an open license.

## Independence and weighting

`independence_group` in `sources.json` marks sources that share an upstream: DynastyProcess values are **derived from
FantasyPros dynasty ECR**, so they share the `fantasypros` group and carry a low market weight (0.35). Sleeper
projections are Rotowire's. Confidence counts *independent groups*, not raw sources.

## What the sources do NOT give us (and how the app handles it)

| Gap | Handling |
|---|---|
| Historical trade values | Value history accrues from each sync; never back-filled |
| Expected points (2026) | Computed: targets/carries/attempts × league-average points per opportunity at the position |
| Red-zone / goal-line usage | Sleeper weekly stats only (`rec_rz_tgt`, `rush_rz_att`); shown, not separately weighted |
| College production metrics | Not available from these free sources → not modelled (documented in the Rookies view) |
| Contracts | nflverse `historical_contracts` exists; not used in v1 |
| Custom K/DST scoring | Source fantasy points used |
| Free historical projections | None found → projection accuracy is not backtested |
