# Manual Data Import

Some sources cannot (or must not) be fetched automatically. Manual import is a first-class path: imported data is
validated, identity-resolved, stored like any synced source, versioned in snapshots and weighted in the model.

Open **Data → Manual Import** in the app. Every template shows step-by-step instructions, expected columns, accepted
column aliases and a downloadable example CSV.

## Templates (`config/import-specs.json`)

| Template | Stored as source | Record type | Typical use |
|---|---|---|---|
| KeepTradeCut Values | `ktc` | market_value (+ picks) | Your own KTC value list (dynasty/redraft, 1QB/SF, TEP) |
| FantasyPros Rankings (CSV export) | `fantasypros_manual` | ranking | A FantasyPros export when the DP mirror is stale |
| Projections (FFToday or any site) | `manual_projections` | projection | Independent projections — re-scored with YOUR scoring |
| Trade Values (generic) | `manual_market` | market_value | Any value chart (scale doesn't matter) |
| Rankings (generic) | `manual_rankings` | ranking | An analyst's or your own rankings |
| ADP (generic) | `manual_adp` | adp | Underdog/other platform ADP |
| Rookie Pick Values (generic) | `manual_picks` | pick_market | A pick-value chart |

## Workflow

1. Choose the template.
2. Follow the source-specific steps (e.g. "Open the FantasyPros rankings page → choose scoring → export CSV").
3. Set the format options (ranking type, QB format, value type, projection scope…).
4. Choose a file (CSV/TSV/semicolon-separated, or JSON array / `{ "players": [...] }`), drag & drop, or paste text.
   Files may be UTF-8 (with or without a byte-order mark), UTF-16 (Excel "Unicode text") or Windows-1252/Latin-1;
   the encoding is detected. At most **20,000 rows** per import (split larger files). A file with no valid rows is
   refused and nothing is changed.
5. **Preview & validation** (nothing is saved yet):
   * detected column mapping (exact alias match, then whole-word match) — adjust with the dropdowns and re-validate
   * row errors (missing required values, non-numeric numbers)
   * duplicate players, unrecognised positions/teams, implausible ages, duplicated ranks
   * missing optional data counts
   * identity report: matched, **unmatched**, **ambiguous** (never auto-merged), fuzzy matches to review
   * how many existing records with the same format will be **replaced**
6. Click **Import**. If existing data would be replaced you must confirm. The dataset rebuilds immediately.

Unmatched and ambiguous rows are stored but not used until resolved under **Data → Data quality** (choose the right
player or ignore; stored in `data/players/overrides.json`).

## Column aliases (examples)

| Canonical | Accepted |
|---|---|
| `player_name` | Player, Name, Player Name, Full Name, PLAYER NAME |
| `rank` | Rank, RK, ECR, Overall, Overall Rank, # |
| `position` | Pos, Position (values like `RB12` → RB, rank 12) |
| `value` | Value, KTC Value, Trade Value, Val |
| `adp` | ADP, Avg, Average Pick, Average Draft Position |
| `pass_yd` | Pass Yds, Passing Yards, Pass Yd |

Pick labels recognised anywhere a player name is expected: `2027 1.04`, `2027 Pick 1.04`, `2027 Early 1st`,
`2027 1st (Late)`, `2028 1st`, `2027 Round 2 Pick 5`.

## Replacement semantics

An import replaces only the previous records **of the same format** from the same source, e.g. importing KTC
Superflex values keeps your KTC 1QB values. "Clear imported data" removes everything for that manual source.

## Example (KTC)

```csv
Player,Position,Team,Age,Value
Ja'Marr Chase,WR,CIN,26.6,9998
Bijan Robinson,RB,ATL,24.7,9750
2027 Early 1st,RDP,,,6400
2028 1st,RDP,,,5600
```
