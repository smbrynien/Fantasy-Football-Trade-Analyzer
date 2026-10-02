// Fantasy Football Calculator ADP API (documented, free). No CORS → fetched by the local server.
// https://fantasyfootballcalculator.com/api/v1/adp/{format}?teams={n}&year={season}

import { BaseAdapter, receivedFields } from './base.js';
import { normalizeTeam } from '../js/core/util/teams.js';
import { normalizePosition } from '../js/core/util/positions.js';

const FORMATS = { ppr: 'redraft_ppr', 'half-ppr': 'redraft_half', standard: 'redraft_std', '2qb': 'redraft_sf', dynasty: 'dynasty', rookie: 'rookie' };

export class FFCAdapter extends BaseAdapter {
  async fetchADP() {
    const records = [];
    let sample = [];
    const meta = {};
    for (const [fmt, format] of Object.entries(FORMATS)) {
      const url = `https://fantasyfootballcalculator.com/api/v1/adp/${fmt}?teams=12&year=${this.season}`;
      let data;
      try { data = await this.ctx.http.json(url); } catch (e) { this.log(`${fmt}: ${e.message}`); meta[fmt] = { error: e.message }; continue; }
      await this.saveRaw(`adp-${fmt}`, data);
      if (data.status !== 'Success' || !Array.isArray(data.players)) { meta[fmt] = { error: 'unexpected response' }; continue; }
      meta[fmt] = { players: data.players.length, total_drafts: data.meta?.total_drafts, start_date: data.meta?.start_date, end_date: data.meta?.end_date };
      if (!sample.length && data.players.length) sample = data.players;
      for (const p of data.players) {
        const pos = normalizePosition(p.position);
        if (!pos) continue;
        records.push({
          source_player_id: String(p.player_id), ids: { ffc: p.player_id }, name: pos === 'DEF' ? `${p.team} Defense` : p.name,
          position: pos, team: normalizeTeam(p.team), format, adp: p.adp, pos_adp: null, adp_high: p.high, adp_low: p.low, adp_sd: p.stdev,
          n_drafts: p.times_drafted, platform: 'ffc', as_of: data.meta?.end_date || null, bye: p.bye,
        });
      }
    }
    if (!records.length) throw new Error(`No ADP data returned (${Object.entries(meta).map(([k, v]) => `${k}: ${v.error || v.players}`).join(', ')})`);
    return { records, schema: { expected: { required: ['player_id', 'name', 'position', 'adp'], optional: ['team', 'stdev', 'times_drafted'] }, received: receivedFields(sample) }, meta };
  }
}
