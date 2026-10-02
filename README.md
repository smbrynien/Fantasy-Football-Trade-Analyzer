# Fantasy Football Trade Analyzer

A locally run **redraft + dynasty** trade analyzer that builds its own transparent valuation from many independent free
sources (projections, expert consensus, trade markets, ADP, statistics, injuries, schedule) instead of copying one
website's trade values — tuned to **your** league's scoring, roster and size.

* One-button **Sync All** with a sync dashboard, per-source status, retries, stale-data warnings and automatic failover
* Works offline from the last good dataset; one broken source never breaks the app
* Manual CSV/JSON import as a first-class path (KeepTradeCut, FantasyPros exports, any projections/rankings/ADP/values)
* Canonical player identity resolution across 15+ ID systems; ambiguous players are never silently merged
* Every value explains itself: **"Why this value?"**, **"Why did this value change?"**, uncertainty ranges, confidence
* Dynasty: calibrated aging curves, attrition and draft-capital priors, multi-year projections, rookie pick model with
  future and unknown-slot picks
* Zero npm dependencies. Node 18+ only.

![Trade calculator](docs/img/trade-redraft.png)

More screenshots: [dynasty trade with picks](docs/img/trade-dynasty.png) · ["Why this value?"](docs/img/modal-why.png) · [sync dashboard](docs/img/data.png) · [mobile](docs/img/mobile-trade.png)

## Quick start

```bash
git clone <this repo> && cd Fantasy-Football-Trade-Analyzer
npm start                     # → http://127.0.0.1:5177
```

Open the URL, click **Sync All** (first sync ≈ 10–30 s, ≈ 90 MB). That's it.

Other commands:

| Command | What it does |
|---|---|
| `npm start` | Start the local server + app (port `PORT`, default 5177) |
| `npm run sync` | Sync all sources from the terminal (prints a status table) |
| `npm run sync -- --force` | Re-download everything |
| `npm run sync -- --failed` | Retry only failed/partial sources |
| `npm run sync -- --source fantasycalc,espn` | Sync specific sources |
| `npm run rebuild` | Rebuild dataset/values from cached data (no network) |
| `npm run calibrate` | Re-derive aging curves, attrition, draft priors, rookie slot curve from historical data |
| `npm run backtest` | Evaluate consensus rankings vs actual production → `reports/backtest.json` |
| `npm test` | Run the automated test suite (offline) |

Optional settings: copy `.env.example` to `.env` (port, bind address, user agent, timeouts). No default source needs
an API key. Keep `HOST=127.0.0.1` unless you deliberately want to open it to your phone on the LAN (`HOST=0.0.0.0`).

## Using it

* **REDRAFT / DYNASTY** toggle (top) switches the valuation engine, columns, settings and tools.
* **League profile** dropdown: presets (10/12/14-team, 1QB/Superflex, PPR/half, dynasty) or your own. Edit anything in
  **Settings** (a preset is copied to a custom profile automatically), import/export profiles as JSON, or **Import from
  Sleeper league** (league ID → scoring + roster).
* **Trade**: search players by name/team/position ("jef", "det rb", "wr min"); in dynasty add picks ("2027 1st",
  "1.04") or use the pick adder (known slot, early/mid/late, unknown, custom range). The analysis shows totals,
  difference and %, uncertainty, component drivers, market vs model signals, the package (consolidation) math,
  win-now vs future and age. Save trades for later re-checking; export CSV/JSON; print.
* **Players**: searchable, filterable (position, team, age, value, injured, rookies), sortable, custom columns, CSV
  exports (all/redraft/dynasty).
* **Compare**: up to 8 players/picks side by side, dynasty age-curve overlay.
* **Rookies & Picks** (dynasty): rookie *prospect* values vs rookie *pick* values (separate tabs), pick grid by
  season/round/slot, methodology.
* **Data**: sync dashboard, source health (click a source for URLs, schema, frequency, fallback), manual import,
  data quality (validation, identity resolution UI, player events), snapshots.
* **Model**: methodology, your league's replacement levels, calibration charts, backtest results.

### Sync

1. Click **Sync All** (sources fetched in the last 30 min are skipped; **Force full refresh** re-downloads).
2. Each enabled adapter runs independently (3 in parallel). Raw responses are cached (gzipped).
3. Each batch is validated (schema drift, duplicates, invalid teams/positions/ages, duplicated ranks, record-count
   drops, mass value changes). Failing batches are **quarantined** and the previous good data is kept.
4. Authoritative player sources update the canonical player DB; every other record is resolved to a player.
5. The merged dataset is built (with failover for statistics/schedule/injuries), snapshotted, and value history is
   recorded. The UI reloads and shows exactly what succeeded, failed or is stale.

### Manual import

**Data → Manual Import** → choose a template → follow the source-specific steps → choose file → confirm column
mapping → review preview, validation, unmatched/ambiguous players and overwrite impact → **Import**.
Details: [docs/DATA_IMPORT.md](docs/DATA_IMPORT.md).

## Sources (verified 2026-10-02)

| Source | Automated | Used for |
|---|:-:|---|
| Sleeper API | ✅ | players, IDs, depth chart, reported injuries, season/week |
| Sleeper projections & stats (undocumented) | ✅ | Rotowire projections, ADP; weekly stats fallback, red-zone & snaps |
| FantasyCalc | ✅ | trade-derived market values & pick values, 30-day trends |
| DynastyProcess | ✅ | ID crosswalk, FantasyPros ECR mirror, DP values & picks |
| nflverse | ✅ | stats, target share/WOPR, snaps, official injury reports, schedule, player bio/draft |
| Fantasy Football Calculator | ✅ | redraft ADP |
| ESPN (undocumented) | ✅ | independent projections, ADP, injury status |
| KeepTradeCut | ❌ manual only | its Terms prohibit automated collection |
| FantasyPros direct | ❌ manual | site disallows automated access; ECR arrives via DynastyProcess |

Full matrix, terms notes and verification log: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Architecture

```
adapters/          one module per source → normalized records (no valuation logic)
server/            zero-dependency Node server: API, sync engine, quality gate, dataset builder, history
js/core/           isomorphic (browser + Node): identity, scoring, quality, import mapper, valuation engine
js/ui/             vanilla ES-module UI (views, search, charts, state)
config/            sources registry, model parameters, league defaults/presets, import specs, calibration
scripts/           sync CLI, calibration, backtest
data/              runtime cache (git-ignored)
tests/             node:test suites with a synthetic fixture and fake adapters
docs/              design + model + operations documentation
```

The valuation runs **in the browser** from `data/calculated/dataset.json`, so changing league settings or weights
recalculates instantly (≈0.2 s) without network. The same engine runs in Node for tests and value history.
Nothing outside `/adapters` knows any source's raw format; sources are referenced by id only through
`config/sources.json`. See [docs/DESIGN.md](docs/DESIGN.md).

## How values are calculated (short version)

1. Every signal is converted to **league-specific fantasy points above positional replacement level** (replacement
   levels come from your teams × starters, FLEX/SUPERFLEX allocation and bench depth).
2. Rankings and market values are mapped by **positional rank** onto your league's value curve — raw scales are never
   averaged.
3. Signals are blended with transparent, phase-aware weights (preseason ↔ in-season) that renormalize over available
   signals; the breakdown always sums to the value.
4. Dynasty projects 5 seasons with calibrated aging curves, attrition and draft-capital priors and values each season
   as E[max(0, X − replacement)] (uncertainty = upside for young players), discounted by team strategy.
5. Rookie picks blend market pick values, a historical slot-value curve and the current rookie class; unknown slots
   integrate over possible slots; future classes are discounted.
6. 10,000 = top asset in a 12-team 1QB PPR reference league; the same scale applies to every league.

Full detail: [VALUATION_MODEL](docs/VALUATION_MODEL.md) · [DYNASTY_MODEL](docs/DYNASTY_MODEL.md) ·
[ROOKIE_PICK_MODEL](docs/ROOKIE_PICK_MODEL.md).

## Configuration

| File | Contents |
|---|---|
| `config/sources.json` | enable/disable, priority, refresh frequency, freshness targets, exclusive-type failover order, authoritative player sources |
| `config/model.json` | all model weights and parameters (`model_version`) |
| `config/league-defaults.json` | scoring presets, default league |
| `config/profiles.json` | built-in league presets |
| `config/import-specs.json` | manual import templates |
| `config/calibration/*.json` | derived from history by `npm run calibrate` |

Per-league overrides of any model parameter are stored in the profile (`overrides`), editable in Settings.

## Extending

Add a source in three steps (adapter, registry line, config entry) — [docs/ADDING_A_SOURCE.md](docs/ADDING_A_SOURCE.md).
IDP positions are already recognised by the normalizers; best-ball/auction/keeper fit the same signal pattern.

## Known limitations

* Undocumented endpoints (Sleeper projections/stats, ESPN) can change without notice — they are lower-priority,
  validated, and replaceable.
* The FantasyPros ECR mirror updates weekly; DynastyProcess values are derived from that ECR (weighted accordingly).
* No free historical trade-value or projection archives → value history starts with your first sync; projections are
  not backtested.
* Custom K/DST scoring is not modelled (source fantasy points are used).
* College production, contracts and coaching changes are not modelled directly.
* Confidence is a data-quality heuristic, not a statistical interval. Multi-year dynasty projections are uncertain by
  nature; the UI shows ranges.

## Troubleshooting

[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## License

MIT for this code. Data belongs to its respective providers; it is downloaded to your machine for personal use and is
not redistributed in this repository.
