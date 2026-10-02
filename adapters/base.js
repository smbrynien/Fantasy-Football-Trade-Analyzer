// Source adapter interface.
//
// An adapter knows how to talk to ONE source and how to translate its data into normalized record types.
// It never touches valuation logic, and nothing outside /adapters knows any source's raw format.
//
// Standard methods (implement the ones your source supports; the sync engine calls them according to
// `data_types` in config/sources.json):
//
//   fetchState()        → NFL season/week state                    (type 'state')
//   fetchPlayers()      → player metadata + external IDs           (type 'player')
//   fetchInjuries()     → injury/status designations               (type 'injury')
//   fetchRankings()     → expert rankings                          (type 'ranking')
//   fetchProjections()  → projected stat lines                     (type 'projection')
//   fetchStats()        → actual weekly stat lines (+ season totals as 'stat_season')
//   fetchTradeValues()  → market trade values                      (type 'market_value')
//   fetchPickValues()   → rookie draft pick market values          (type 'pick_market')
//   fetchADP()          → average draft position                   (type 'adp')
//   fetchSchedule()     → schedule / results                       (type 'schedule')
//
// Each returns { records: [...], schema?: { expected: {required, optional}, received: [...] },
//                minRecords?: number, meta?: {...}, extra?: { <type>: {records, ...} } }
// Throw an Error for failures; the engine records it and keeps the previous good data.

export const METHOD_FOR_TYPE = {
  state: 'fetchState',
  player: 'fetchPlayers',
  injury: 'fetchInjuries',
  ranking: 'fetchRankings',
  projection: 'fetchProjections',
  stat_week: 'fetchStats',
  market_value: 'fetchTradeValues',
  pick_market: 'fetchPickValues',
  adp: 'fetchADP',
  schedule: 'fetchSchedule',
};

export class BaseAdapter {
  /**
   * @param source  source definition from config/sources.json
   * @param ctx     { http, state:{season, week, season_type}, saveRaw(name, data, ext), log(msg), formats:[...], env }
   */
  constructor(source, ctx) {
    this.source = source;
    this.ctx = ctx;
    this._memo = new Map();
  }

  /** Memoize a fetch within a single sync run (e.g. one response feeding several record types). */
  once(key, fn) {
    if (!this._memo.has(key)) this._memo.set(key, fn().catch((e) => { this._memo.delete(key); throw e; }));
    return this._memo.get(key);
  }

  async saveRaw(name, data, ext = 'json') {
    if (this.ctx.saveRaw) await this.ctx.saveRaw(this.source.id, name, data, ext);
  }

  log(msg) { if (this.ctx.log) this.ctx.log(`[${this.source.id}] ${msg}`); }

  get season() { return Number(this.ctx.state?.season) || new Date().getFullYear(); }
  get week() { return Number(this.ctx.state?.week) || 0; }
  get seasonType() { return this.ctx.state?.season_type || 'regular'; }
  get inSeason() { return this.seasonType === 'regular' && this.week >= 1; }
  get regularSeasonWeeks() { return this.ctx.regularSeasonWeeks || 18; }
}

/** Helper: keys of the first N rows/objects (for schema checks). */
export function receivedFields(rows, n = 25) {
  const s = new Set();
  for (const r of (rows || []).slice(0, n)) for (const k of Object.keys(r || {})) s.add(k);
  return [...s];
}
