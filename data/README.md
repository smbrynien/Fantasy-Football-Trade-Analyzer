# data/

Runtime data written by the sync server. Everything here except this file is git-ignored: third-party data is not
redistributed with the code, and your profiles/trades stay local.

Created by `npm run sync` / the **Sync All** button. Layout is documented in docs/TROUBLESHOOTING.md. Safe to delete
to start fresh (the next sync rebuilds everything; deleting `players/overrides.json` forgets manual identity fixes).

`archive/` holds one compact file of the day's signals per day (rankings, market values, ADP, projections, injuries;
≈130 KB). Unlike `snapshots/` it is never pruned: it is the history that free sources don't keep, used by
`npm run audit-model -- --only=e13` after a season. Set `FFTA_ARCHIVE=0` to stop writing it.
