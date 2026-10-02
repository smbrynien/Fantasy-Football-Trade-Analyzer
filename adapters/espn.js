// ESPN fantasy projections (undocumented public endpoint). Independent projection methodology.
// Stat IDs verified 2026-10-02 against Sleeper/Rotowire lines for the same players.

import { BaseAdapter, receivedFields } from './base.js';
import { ESPN_TEAM_IDS } from '../js/core/util/teams.js';

const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
export const ESPN_STAT_IDS = {
  0: 'pass_att', 1: 'pass_cmp', 2: 'pass_inc', 3: 'pass_yd', 4: 'pass_td', 19: 'pass_2pt', 20: 'pass_int', 64: 'pass_sack',
  23: 'rush_att', 24: 'rush_yd', 25: 'rush_td', 26: 'rush_2pt',
  53: 'rec', 42: 'rec_yd', 43: 'rec_td', 44: 'rec_2pt', 58: 'rec_tgt', 72: 'fum_lost',
};
// ESPN counts a player who goes undrafted as pick 170, so ADP within one pick of that default means "drafted in few or
// no leagues" (2026-10-02: 815 of 1,050 entries ≥ 169, median ownership ≈0–4%). The decimals there are noise, not a
// draft order, so these entries are collapsed to exactly the default: they tie (shared average rank) instead of being
// ranked arbitrarily, and still say "undrafted" (dropping them would lose that information).
export const ESPN_UNDRAFTED_ADP = 170;
export const ESPN_UNDRAFTED_MARGIN = 1;

const INJ = { QUESTIONABLE: 'Questionable', OUT: 'Out', DOUBTFUL: 'Doubtful', INJURY_RESERVE: 'IR', SUSPENSION: 'Suspended', ACTIVE: null, NORMAL: null, PROBABLE: null, DAY_TO_DAY: 'Questionable' };

export function mapEspnStats(stats, pos, appliedTotal) {
  const out = {};
  for (const [id, key] of Object.entries(ESPN_STAT_IDS)) if (typeof stats[id] === 'number') out[key] = stats[id];
  if ((pos === 'K' || pos === 'DEF') && typeof appliedTotal === 'number') out.fp_src = appliedTotal;
  return out;
}

export class EspnAdapter extends BaseAdapter {
  async _players() {
    return this.once('players', async () => {
      const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${this.season}/segments/0/leaguedefaults/3?view=kona_player_info`;
      const filter = { players: { limit: 1100, sortPercOwned: { sortPriority: 1, sortAsc: false }, filterSlotIds: { value: [0, 2, 4, 6, 17, 16] } } };
      const data = await this.ctx.http.json(url, { headers: { 'x-fantasy-filter': JSON.stringify(filter) } });
      if (!data || !Array.isArray(data.players)) throw new Error('Unexpected ESPN response (no players array)');
      await this.saveRaw('players', data);
      return data.players;
    });
  }

  _base(pl) {
    const p = pl.player || {};
    const pos = POS[p.defaultPositionId];
    const team = ESPN_TEAM_IDS[p.proTeamId] || 'FA';
    return { pos, rec: { source_player_id: String(p.id), ids: pos === 'DEF' ? {} : { espn: p.id }, name: pos === 'DEF' ? `${team} Defense` : p.fullName, position: pos, team } };
  }

  async fetchProjections() {
    const players = await this._players();
    const season = this.season;
    const records = [];
    const asOf = new Date().toISOString();
    for (const pl of players) {
      const { pos, rec } = this._base(pl);
      if (!pos) continue;
      for (const s of pl.player.stats || []) {
        if (s.seasonId !== season || s.statSourceId !== 1) continue;
        if (s.statSplitTypeId === 0 && s.scoringPeriodId === 0) {
          const stats = mapEspnStats(s.stats || {}, pos, s.appliedTotal);
          if (Object.keys(stats).length) records.push({ ...rec, scope: 'season', season, week: null, games: null, stats, as_of: asOf });
        } else if (s.statSplitTypeId === 1 && this.inSeason && s.scoringPeriodId >= this.week) {
          const stats = mapEspnStats(s.stats || {}, pos, s.appliedTotal);
          if (Object.keys(stats).length) records.push({ ...rec, scope: 'week', season, week: s.scoringPeriodId, games: 1, stats, as_of: asOf });
        }
      }
    }
    return { records, schema: { expected: { required: ['player'] }, received: receivedFields(players) }, minRecords: 200 };
  }

  async fetchADP() {
    const players = await this._players();
    const records = [];
    for (const pl of players) {
      const { pos, rec } = this._base(pl);
      const adp = pl.player?.ownership?.averageDraftPosition;
      if (!pos || typeof adp !== 'number' || adp <= 0 || adp >= 300) continue;
      const undrafted = adp >= ESPN_UNDRAFTED_ADP - ESPN_UNDRAFTED_MARGIN;
      records.push({ ...rec, format: 'redraft_ppr', adp: undrafted ? ESPN_UNDRAFTED_ADP : adp, undrafted, pos_adp: null, platform: 'espn', owned_pct: pl.player.ownership.percentOwned ?? null, as_of: new Date().toISOString() });
    }
    return { records, minRecords: 50 };
  }

  async fetchInjuries() {
    const players = await this._players();
    const records = [];
    for (const pl of players) {
      const { pos, rec } = this._base(pl);
      const s = pl.player?.injuryStatus;
      if (!pos || !s || INJ[s] === null || INJ[s] === undefined) continue;
      records.push({ ...rec, status: INJ[s], official: false, body_part: null, practice: null, as_of: pl.player.lastNewsDate ? new Date(pl.player.lastNewsDate).toISOString() : null });
    }
    return { records };
  }
}
