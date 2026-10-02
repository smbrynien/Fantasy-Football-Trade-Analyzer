# Adding (or Replacing) a Data Source

The valuation engine never sees source-specific structures. It consumes typed, normalized records tagged with a source
id. Adding a source therefore touches three places — none of them in the engine or UI.

## 1. Write an adapter — `adapters/<name>.js`

```js
import { BaseAdapter, receivedFields } from './base.js';
import { normalizeTeam } from '../js/core/util/teams.js';
import { normalizePosition } from '../js/core/util/positions.js';

export class MyRankingsAdapter extends BaseAdapter {
  async fetchRankings() {
    const rows = await this.ctx.http.json('https://example.com/rankings.json'); // timeouts/retries/politeness built in
    await this.saveRaw('rankings', rows);                                      // raw cache (gzipped, last 3 runs kept)
    return {
      records: rows.map((r) => ({
        source_player_id: r.id, ids: { sleeper: r.sleeper_id },   // any known ID systems help identity resolution
        name: r.name, position: normalizePosition(r.pos), team: normalizeTeam(r.team),
        kind: 'ros', scope: 'overall', qb: '1qb', rank: r.rank, ecr: r.rank,
      })),
      schema: { expected: { required: ['id', 'name', 'pos', 'rank'] }, received: receivedFields(rows) }, // drift detection
      minRecords: 100,                                                  // fewer → batch quarantined, old data kept
    };
  }
}
```

Standard methods (implement what the source supports): `fetchState`, `fetchPlayers`, `fetchInjuries`, `fetchRankings`,
`fetchProjections`, `fetchStats`, `fetchTradeValues`, `fetchPickValues`, `fetchADP`, `fetchSchedule`. Record shapes are
documented in [DESIGN.md](DESIGN.md#normalized-record-types-schema-v1) and the existing adapters. Use canonical stat
keys from `js/core/scoring.js` (`CANONICAL_STATS`) for projections/stats so custom scoring works.

Return extra record types from one call via `extra: { stat_season: { records } }`.

## 2. Register it — `adapters/index.js`

```js
import { MyRankingsAdapter } from './my-rankings.js';
export const ADAPTERS = { ..., my_rankings: MyRankingsAdapter };
```

## 3. Configure it — `config/sources.json`

```json
{
  "id": "my_rankings", "name": "My Rankings", "adapter": "my_rankings", "enabled": true,
  "priority": "supplemental", "method": "api", "data_types": ["ranking"], "auth": null,
  "update_frequency_hours": 24, "url": "https://example.com", "docs_url": "https://example.com/docs",
  "terms": "Why automated access is permitted.", "independence_group": "my_rankings",
  "fallback": "What to use if this breaks."
}
```

Then give it a weight in `config/model.json → source_weights.<group>` (`consensus` for rankings, `market`,
`projection`, `adp`, `pick_market`). Unweighted sources default to 0.5. Done — sync it from the dashboard.

## Special roles

* **Authoritative player sources** (`authoritative_player_sources.order`) may create canonical players. Everything
  else only matches existing players.
* **Exclusive data types** (`exclusive_data_types`): stats, schedule, official injuries, reported injuries, NFL state —
  exactly one source is used, in priority order, with automatic failover and a reported substitution.
* **Auth**: read keys from `process.env` inside the adapter (document them in `.env.example`); never commit them.

## Replacing a source (e.g. FantasyPros → another rankings provider)

Add the new adapter + config, give it the consensus weight, set `"enabled": false` on the old one. No other change.

## Manual-only sources

Use `"adapter": "manual"` and a `manual_spec` pointing at a spec in `config/import-specs.json` (columns, aliases,
instructions, example). The import wizard picks it up automatically.

## Future formats

IDP (positions already recognised: DL/LB/DB), best-ball, auction and keeper support fit the same pattern: new record
kinds/formats in adapters, new signal selection in `js/core/valuation/signals.js`, and new roster slots in
`replacement.js`.
