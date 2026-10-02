// FantasyCalc — trade-derived market values (dynasty + redraft) and pick values.
// GET https://api.fantasycalc.com/values/current?isDynasty={bool}&numQbs={1|2}&numTeams={n}&ppr={0|0.5|1}

import { BaseAdapter, receivedFields } from './base.js';
import { normalizeTeam } from '../js/core/util/teams.js';
import { normalizePosition } from '../js/core/util/positions.js';
import { parsePickLabel } from '../js/core/pick-labels.js';

const URL = 'https://api.fantasycalc.com/values/current';

export class FantasyCalcAdapter extends BaseAdapter {
  variants() {
    const base = [];
    for (const dynasty of [true, false]) for (const qb of [1, 2]) for (const ppr of [1, 0.5]) base.push({ dynasty, qb, ppr, teams: 12 });
    // Add variants for the formats of saved league profiles (passed by the sync engine), deduplicated.
    for (const f of this.ctx.formats || []) {
      const v = { dynasty: Boolean(f.dynasty), qb: f.qb_format === '1qb' ? 1 : 2, ppr: f.ppr >= 0.75 ? 1 : f.ppr >= 0.25 ? 0.5 : 0, teams: Math.min(16, Math.max(8, f.teams || 12)) };
      if (!base.some((b) => b.dynasty === v.dynasty && b.qb === v.qb && b.ppr === v.ppr && b.teams === v.teams)) base.push(v);
    }
    return base;
  }

  async _all() {
    return this.once('all', async () => {
      const out = [];
      for (const v of this.variants()) {
        const url = `${URL}?isDynasty=${v.dynasty}&numQbs=${v.qb}&numTeams=${v.teams}&ppr=${v.ppr}`;
        const rows = await this.ctx.http.json(url);
        if (!Array.isArray(rows)) throw new Error(`Unexpected FantasyCalc response for ${url}`);
        await this.saveRaw(`values-${v.dynasty ? 'dyn' : 'red'}-${v.qb}qb-${v.ppr}ppr-${v.teams}t`, rows);
        out.push({ v, rows });
      }
      return out;
    });
  }

  async fetchTradeValues() {
    const all = await this._all();
    const records = [];
    const asOf = new Date().toISOString();
    for (const { v, rows } of all) {
      for (const r of rows) {
        const p = r.player || {};
        const pos = normalizePosition(p.position);
        if (!pos || pos === 'PICK') continue;
        records.push({
          source_player_id: String(p.id), name: p.name, position: pos, team: normalizeTeam(p.maybeTeam),
          age: typeof p.maybeAge === 'number' ? p.maybeAge : null, birth_date: p.maybeBirthday || null,
          ids: { fantasycalc: p.id, sleeper: p.sleeperId, espn: p.espnId, mfl: p.mflId, fleaflicker: p.fleaflickerId },
          draft_year: p.maybeDraftInfo?.year ?? null,
          dynasty: v.dynasty, qb: v.qb === 1 ? '1qb' : 'sf', ppr: v.ppr, teams: v.teams,
          value: r.value, rank: r.overallRank, pos_rank: r.positionRank, trend30: typeof r.trend30Day === 'number' ? r.trend30Day : null,
          tier: r.maybeTier ?? null, trade_frequency: r.maybeTradeFrequency ?? null, as_of: asOf,
        });
      }
    }
    const sample = all[0]?.rows || [];
    return {
      records,
      schema: { expected: { required: ['player', 'value', 'overallRank'], optional: ['trend30Day', 'positionRank', 'maybeTier'] }, received: receivedFields(sample) },
      minRecords: 200,
    };
  }

  async fetchPickValues() {
    const all = await this._all();
    const records = [];
    const asOf = new Date().toISOString();
    for (const { v, rows } of all) {
      if (!v.dynasty) continue;
      for (const r of rows) {
        const p = r.player || {};
        if (normalizePosition(p.position) !== 'PICK') continue;
        const d = parsePickLabel(p.name);
        if (!d) continue;
        records.push({ label: p.name, ...d, dynasty: true, qb: v.qb === 1 ? '1qb' : 'sf', ppr: v.ppr, teams: v.teams, value: r.value, trend30: r.trend30Day ?? null, as_of: asOf });
      }
    }
    return { records, minRecords: 4 };
  }
}
