# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Double-clicking "Start Trade Analyzer" does nothing (Mac) | macOS blocks unsigned scripts from the internet: System Settings → Privacy & Security → *Open Anyway*, or right-click → *Open*. |
| Windows "protected your PC" | *More info* → *Run anyway* (shown for any downloaded script). |
| Launcher says "Download failed" | Only when the bundled engine is missing (source ZIP): it fetches Node.js from nodejs.org once. Check the connection; or install Node 18+ yourself. |
| "Almost there!" page | `index.html` was opened directly; use the Start file instead (browsers block the app's modules on `file://`). |
| App already running | Starting it again just opens the existing window's address. A busy port makes the server try the next 10 ports. |
| Page says "No data yet" | First run: click **Sync All** (or `npm run sync`). Takes ~10–30 s and ~90 MB. |
| Banner "Read-only mode" | You opened the files without the server. Run `npm start` and use the printed URL. |
| "Port 5177 in use" | `PORT=5180 npm start` (or set PORT in `.env`). |
| "PORT … is not a valid port" warning | PORT must be a whole number 1–65535; the app falls back to 5177. Invalid `FFTA_AUTO_REFRESH_HOURS` falls back to 12 and `FFTA_FETCH_TIMEOUT_MS` below 1000 is ignored. |
| "config/<file> is missing or empty" / "is not valid JSON" | A config file was deleted or mistyped. Restore it from the app download (or `git checkout config/<file>`). |
| A model setting was cleared | An empty model field goes back to its default value (shown after the change). Out-of-range values are clamped to the field's limits. |
| A source shows ✕ error | Open Data → Sync dashboard & sources → click its name for the error. The rest of the app keeps working with that source's last good data. Click **Retry**. |
| Source shows ⛔ quarantined | The batch failed validation (schema change, too few records, mass value change). Previous data is kept. Check Data → Data quality for "Expected / Received" fields; update the adapter's field mapping. |
| ⚠ stale | Last success older than 2× the freshness target. Sync again; if it keeps failing, see the source's fallback. |
| `HTTP 404` from nflverse in the offseason | Current-season files don't exist yet (e.g. `stats_player_week_2027.csv` in August). Expected; statistics fall back to previous-season totals. |
| ESPN/Sleeper projections suddenly empty | Undocumented endpoints changed. Disable the source in `config/sources.json` (`"enabled": false`) or fix `adapters/espn.js` / `adapters/sleeper.js`. Projections from the other source (or manual import) keep working. |
| FantasyCalc changed format | Quarantine will catch it. Fix `adapters/fantasycalc.js`; DP values and KTC import remain as market inputs. |
| A player is missing a value | Player detail → Market & sources shows which signals exist. Check Data → Data quality → unmatched/ambiguous; resolve identity there. |
| Two players merged/split incorrectly | Data quality → Ambiguous: choose the right player (stored in `data/players/overrides.json`). Edit that file to undo. |
| Values changed a lot after an update | Player → Trends marks each model upgrade with a dashed line, breaks the model-value line there, and counts the 7/30-day/season changes only since the current model version. "Why did this value change?" re-runs the model on an older snapshot with your current settings and lists the drivers. Check `model_version` in saved trades. |
| Dynasty values ignore aging curves | `config/calibration/` missing → run `npm run calibrate`. The Model page lists active calibration files. |
| Want a clean slate | Stop the server, delete `data/` (except README.md), run `npm run sync`. Your profiles survive in browser storage; `data/user/` holds the server copy. |
| Sync behind a proxy / TLS errors | Node's fetch honours the system CA bundle via `NODE_EXTRA_CA_CERTS=/path/ca.pem`. |
| Tests | `npm test` (no network needed; uses a synthetic fixture and fake adapters). |

## Where things live

```
config/                 sources, model parameters, league defaults, presets, import specs, calibration
data/raw/<source>/      gzipped raw responses, last 3 runs per source
data/normalized/<src>/  validated normalized records per data type (schema_version'd envelopes)
data/players/           canonical player DB, overrides, identity events, unresolved report
data/calculated/        dataset.json (what the app loads), history.json (value history)
data/snapshots/         dataset snapshot per build (last 90)
data/archive/           daily signal archive, one file per day, never pruned (≈130 KB/day; FFTA_ARCHIVE=0 = off)
data/state/             source status, last sync summary, sync log, quality report, NFL state
data/user/              profiles and saved trades (server copy)
```

## Logs

`data/state/sync-log.json` keeps the last 50 sync runs with per-source results and log lines.
`npm run sync` prints a source table; add `--source fantasycalc,espn` to test single adapters.
