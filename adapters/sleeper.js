// Sleeper adapters.
//   sleeper              documented API: NFL state, player DB (IDs, bio, depth chart, injury status)
//   sleeper_projections  undocumented: weekly/season projections (Rotowire) + ADP fields
//   sleeper_stats        undocumented: weekly stats (fallback stats; only free source of red-zone usage + snaps)

import { BaseAdapter, receivedFields } from './base.js';
import { normalizeTeam } from '../js/core/util/teams.js';
import { normalizePosition } from '../js/core/util/positions.js';

const API = 'https://api.sleeper.app';
const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

const STAT_MAP = [
  'pass_att', 'pass_cmp', 'pass_inc', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'pass_fd', 'pass_sack',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt', 'rush_fd',
  'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'rec_2pt', 'rec_fd', 'fum_lost',
];

export function mapSleeperStats(st, position) {
  const out = {};
  for (const k of STAT_MAP) if (typeof st[k] === 'number') out[k] = st[k];
  if ((position === 'K' || position === 'DEF') && typeof st.pts_ppr === 'number') out.fp_src = st.pts_ppr;
  return out;
}

function playerIds(p) {
  return {
    sleeper: p.player_id, espn: p.espn_id, yahoo: p.yahoo_id, rotowire: p.rotowire_id, sportradar: p.sportradar_id,
    gsis: p.gsis_id ? String(p.gsis_id).trim() : null, fantasy_data: p.fantasy_data_id, pff: p.pff_id,
  };
}

export class SleeperAdapter extends BaseAdapter {
  async fetchState() {
    const s = await this.once('state', () => this.ctx.http.json(`${API}/v1/state/nfl`));
    await this.saveRaw('state', s);
    const required = ['season', 'week', 'season_type'];
    return { records: [{ season: Number(s.season), week: Number(s.week), display_week: s.display_week, season_type: s.season_type, league_season: s.league_season, previous_season: s.previous_season, season_start_date: s.season_start_date }], schema: { expected: { required }, received: Object.keys(s) }, minRecords: 1 };
  }

  async _players() {
    return this.once('players', async () => {
      const data = await this.ctx.http.json(`${API}/v1/players/nfl`);
      await this.saveRaw('players', data);
      return data;
    });
  }

  async fetchPlayers() {
    const data = await this._players();
    const all = Object.values(data);
    const records = [];
    for (const p of all) {
      const pos = normalizePosition(p.position);
      if (!FANTASY.has(pos)) continue;
      const team = normalizeTeam(p.team);
      // Keep active players, anyone on a team, and recent players (retired/FA within ~2 seasons are kept by the DB).
      if (!p.active && !p.team && (p.years_exp ?? 99) > 2) continue;
      if (/duplicate player|^player invalid/i.test(p.full_name || '')) continue; // Sleeper placeholder rows
      if (p.birth_date && Number(p.birth_date.slice(0, 4)) < this.season - 45) continue; // long-retired
      records.push({
        source_player_id: p.player_id,
        name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || (pos === 'DEF' ? `${p.team} Defense` : null),
        first_name: p.first_name, last_name: p.last_name,
        position: pos,
        positions: (p.fantasy_positions || [p.position]).map(normalizePosition).filter(Boolean),
        team: pos === 'DEF' ? normalizeTeam(p.player_id) : team,
        birth_date: p.birth_date || null,
        college: p.college || null,
        draft: { year: p.metadata?.rookie_year ? Number(p.metadata.rookie_year) : null, round: null, pick: null },
        status: p.status || (p.active ? 'Active' : 'Inactive'),
        years_exp: typeof p.years_exp === 'number' ? p.years_exp : null,
        depth_chart_order: p.depth_chart_order ?? null,
        depth_chart_position: p.depth_chart_position ?? null,
        height: p.height ? Number(p.height) : null, weight: p.weight ? Number(p.weight) : null,
        age: typeof p.age === 'number' ? p.age : null,
        ids: playerIds(p),
      });
    }
    return { records, schema: { expected: { required: ['player_id', 'position', 'full_name', 'team'], optional: ['birth_date', 'injury_status', 'espn_id', 'depth_chart_order'] }, received: receivedFields(all.slice(0, 200)) }, minRecords: 1500 };
  }

  async fetchInjuries() {
    const data = await this._players();
    const records = [];
    for (const p of Object.values(data)) {
      const pos = normalizePosition(p.position);
      if (!FANTASY.has(pos) || !p.injury_status) continue;
      records.push({
        source_player_id: p.player_id, name: p.full_name, position: pos, team: normalizeTeam(p.team), ids: { sleeper: p.player_id },
        status: p.injury_status, official: false, body_part: p.injury_body_part || null, practice: p.practice_participation || null,
        notes: p.injury_notes || null, start_date: p.injury_start_date || null,
        as_of: p.news_updated ? new Date(p.news_updated).toISOString() : null,
      });
    }
    return { records, minRecords: 0 };
  }
}

export class SleeperProjectionsAdapter extends BaseAdapter {
  _url(path) {
    return `${API}/projections/nfl/${path}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`;
  }

  async _season(season) {
    return this.once(`season:${season}`, async () => {
      const d = await this.ctx.http.json(this._url(String(season)));
      await this.saveRaw(`season-${season}`, d);
      return d;
    });
  }

  _rec(row, extra) {
    const pos = normalizePosition(row.player?.fantasy_positions?.[0] || row.player?.position);
    return {
      source_player_id: row.player_id,
      ids: { sleeper: row.player_id },
      name: [row.player?.first_name, row.player?.last_name].filter(Boolean).join(' '),
      position: pos,
      team: pos === 'DEF' ? normalizeTeam(row.player_id) : normalizeTeam(row.team || row.player?.team),
      ...extra,
    };
  }

  async fetchProjections() {
    const records = [];
    // Projection season: in the offseason/preseason project the upcoming season.
    const season = this.season;
    const seasonRows = await this._season(season);
    for (const row of seasonRows) {
      const r = this._rec(row, {});
      if (!r.position) continue;
      const stats = mapSleeperStats(row.stats || {}, r.position);
      if (!Object.keys(stats).length) continue;
      records.push({ ...r, scope: 'season', season, week: null, games: typeof row.stats?.gp === 'number' ? Math.min(row.stats.gp, this.regularSeasonWeeks - 1) : null, stats, as_of: row.updated_at ? new Date(row.updated_at).toISOString() : null });
    }
    if (this.inSeason) {
      for (let w = Math.max(1, this.week); w <= this.regularSeasonWeeks; w++) {
        let rows;
        try {
          rows = await this.ctx.http.json(this._url(`${season}/${w}`));
        } catch (e) {
          this.log(`week ${w} projections failed: ${e.message}`);
          if (w === this.week) throw e;
          continue;
        }
        if (w === this.week) await this.saveRaw(`week-${season}-${w}`, rows);
        for (const row of rows) {
          const r = this._rec(row, {});
          if (!r.position) continue;
          const stats = mapSleeperStats(row.stats || {}, r.position);
          if (!Object.keys(stats).length || !(row.stats?.gp > 0 || stats.fp_src)) continue;
          records.push({ ...r, scope: 'week', season, week: w, games: 1, stats, opponent: row.opponent || null, as_of: row.updated_at ? new Date(row.updated_at).toISOString() : null });
        }
      }
    }
    return { records, schema: { expected: { required: ['player_id', 'stats', 'player'], optional: ['team', 'opponent'] }, received: receivedFields(seasonRows) }, minRecords: 300, meta: { company: seasonRows[0]?.company || null } };
  }

  async fetchADP() {
    const season = this.season;
    const rows = await this._season(season);
    const FORMATS = { adp_ppr: 'redraft_ppr', adp_half_ppr: 'redraft_half', adp_std: 'redraft_std', adp_2qb: 'redraft_sf', adp_dynasty_ppr: 'dynasty', adp_dynasty_half_ppr: 'dynasty_half', adp_dynasty_2qb: 'dynasty_sf', adp_rookie: 'rookie' };
    const records = [];
    for (const row of rows) {
      const r = this._rec(row, {});
      if (!r.position) continue;
      for (const [k, format] of Object.entries(FORMATS)) {
        const v = row.stats?.[k];
        if (typeof v !== 'number' || v >= 500) continue; // 999 = not drafted
        records.push({ ...r, format, adp: v, pos_adp: null, platform: 'sleeper', as_of: row.updated_at ? new Date(row.updated_at).toISOString() : null });
      }
    }
    return { records, minRecords: 100 };
  }
}

export class SleeperStatsAdapter extends BaseAdapter {
  _url(path) {
    return `${API}/stats/nfl/${path}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`;
  }

  async fetchStats() {
    const records = [];
    const season = this.season;
    const lastWeek = this.inSeason ? this.week : 0;
    for (let w = 1; w <= lastWeek; w++) {
      const rows = await this.ctx.http.json(this._url(`${season}/${w}`));
      for (const row of rows) {
        const st = row.stats || {};
        if (!(st.gp > 0 || st.off_snp > 0)) continue;
        const pos = normalizePosition(row.player?.fantasy_positions?.[0] || row.player?.position);
        if (!pos) continue;
        const usage = {};
        if (st.off_snp > 0 && st.tm_off_snp > 0) { usage.off_snp = st.off_snp; usage.snap_pct = st.off_snp / st.tm_off_snp; }
        if (typeof st.rec_rz_tgt === 'number') usage.rz_tgt = st.rec_rz_tgt;
        if (typeof st.rush_rz_att === 'number') usage.rz_att = st.rush_rz_att;
        records.push({
          source_player_id: row.player_id, ids: { sleeper: row.player_id },
          name: [row.player?.first_name, row.player?.last_name].filter(Boolean).join(' '), position: pos,
          team: pos === 'DEF' ? normalizeTeam(row.player_id) : normalizeTeam(row.team), season, week: w,
          stats: mapSleeperStats(st, pos), usage,
        });
      }
    }
    // Previous season totals (fallback for nflverse season stats)
    const extra = {};
    try {
      const prev = await this.ctx.http.json(this._url(String(season - 1)));
      extra.stat_season = {
        records: prev.filter((r) => r.stats && r.stats.gp > 0).map((row) => {
          const pos = normalizePosition(row.player?.fantasy_positions?.[0] || row.player?.position);
          return { source_player_id: row.player_id, ids: { sleeper: row.player_id }, name: [row.player?.first_name, row.player?.last_name].filter(Boolean).join(' '), position: pos, team: normalizeTeam(row.team), season: season - 1, games: row.stats.gp, stats: mapSleeperStats(row.stats, pos) };
        }).filter((r) => r.position),
      };
    } catch (e) {
      this.log(`previous season stats unavailable: ${e.message}`);
    }
    return { records, minRecords: lastWeek ? 200 : 0, extra };
  }
}
