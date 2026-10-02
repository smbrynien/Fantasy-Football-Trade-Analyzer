// nflverse open data (github.com/nflverse/nflverse-data releases).
// Players (bio, draft, IDs), weekly + season stats, snap counts, official injury reports, schedule.

import { BaseAdapter } from './base.js';
import { parseCSV, toNumber } from '../js/core/util/csv.js';
import { normalizeTeam } from '../js/core/util/teams.js';
import { normalizePosition } from '../js/core/util/positions.js';
import { HttpError } from '../server/lib/http.js';

const REL = 'https://github.com/nflverse/nflverse-data/releases/download';

const WEEK_STAT_MAP = {
  completions: 'pass_cmp', attempts: 'pass_att', passing_yards: 'pass_yd', passing_tds: 'pass_td', passing_interceptions: 'pass_int',
  sacks_suffered: 'pass_sack', passing_first_downs: 'pass_fd', passing_2pt_conversions: 'pass_2pt',
  carries: 'rush_att', rushing_yards: 'rush_yd', rushing_tds: 'rush_td', rushing_first_downs: 'rush_fd', rushing_2pt_conversions: 'rush_2pt',
  receptions: 'rec', targets: 'rec_tgt', receiving_yards: 'rec_yd', receiving_tds: 'rec_td', receiving_first_downs: 'rec_fd', receiving_2pt_conversions: 'rec_2pt',
};

export function mapNflverseStats(r) {
  const st = {};
  for (const [src, dst] of Object.entries(WEEK_STAT_MAP)) {
    const v = toNumber(r[src]);
    if (v !== null) st[dst] = v;
  }
  if (typeof st.pass_att === 'number' && typeof st.pass_cmp === 'number') st.pass_inc = st.pass_att - st.pass_cmp;
  const fl = ['sack_fumbles_lost', 'rushing_fumbles_lost', 'receiving_fumbles_lost'].map((k) => toNumber(r[k]) || 0).reduce((a, b) => a + b, 0);
  st.fum_lost = fl;
  return st;
}

export class NflverseAdapter extends BaseAdapter {
  async _csv(asset, { optional = false } = {}) {
    return this.once(asset, async () => {
      try {
        const text = await this.ctx.http.text(`${REL}/${asset}`);
        await this.saveRaw(asset.replace(/[/.]/g, '_'), text, 'csv');
        return parseCSV(text);
      } catch (e) {
        if (optional && e instanceof HttpError && e.status === 404) return { headers: [], records: [], missing: true };
        throw e;
      }
    });
  }

  async fetchPlayers() {
    const { headers, records: rows } = await this._csv('players/players.csv');
    const minSeason = this.season - 2;
    const records = [];
    for (const r of rows) {
      const pos = normalizePosition(r.position);
      if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue;
      const last = toNumber(r.last_season), rookie = toNumber(r.rookie_season), dy = toNumber(r.draft_year);
      if (!((last !== null && last >= minSeason) || (rookie !== null && rookie >= minSeason) || (dy !== null && dy >= minSeason))) continue;
      records.push({
        source_player_id: r.gsis_id, name: r.display_name, first_name: r.first_name, last_name: r.last_name, position: pos, positions: [pos],
        team: normalizeTeam(r.latest_team), birth_date: r.birth_date || null, college: r.college_name || null,
        draft: { year: dy, round: toNumber(r.draft_round), pick: toNumber(r.draft_pick) },
        years_exp: toNumber(r.years_of_experience), height: toNumber(r.height), weight: toNumber(r.weight),
        nfl_status: r.status || null,
        ids: { gsis: r.gsis_id, pfr: r.pfr_id, espn: r.espn_id, pff: r.pff_id, nfl: r.nfl_id, otc: r.otc_id },
      });
    }
    return { records, schema: { expected: { required: ['gsis_id', 'display_name', 'position', 'birth_date', 'latest_team'], optional: ['pfr_id', 'espn_id', 'draft_round', 'draft_pick'] }, received: headers }, minRecords: 1000 };
  }

  async fetchStats() {
    const season = this.season;
    const week = await this._csv(`stats_player/stats_player_week_${season}.csv`, { optional: true });
    const snaps = await this._csv(`snap_counts/snap_counts_${season}.csv`, { optional: true });
    const players = await this._csv('players/players.csv');
    const pfrToGsis = new Map(players.records.filter((p) => p.pfr_id && p.gsis_id).map((p) => [p.pfr_id, p.gsis_id]));
    const snapBy = new Map();
    for (const s of snaps.records) {
      if (s.game_type && s.game_type !== 'REG') continue;
      const g = pfrToGsis.get(s.pfr_player_id);
      if (!g) continue;
      snapBy.set(`${g}|${s.week}`, { off_snp: toNumber(s.offense_snaps), snap_pct: toNumber(s.offense_pct) });
    }
    const records = [];
    for (const r of week.records) {
      if (r.season_type && r.season_type !== 'REG') continue;
      const pos = normalizePosition(r.position);
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      const usage = {};
      for (const [src, dst] of [['target_share', 'target_share'], ['air_yards_share', 'air_yards_share'], ['wopr', 'wopr']]) {
        const v = toNumber(r[src]);
        if (v !== null) usage[dst] = v;
      }
      const sn = snapBy.get(`${r.player_id}|${r.week}`);
      if (sn) Object.assign(usage, sn);
      records.push({
        source_player_id: r.player_id, ids: { gsis: r.player_id }, name: r.player_display_name || r.player_name, position: pos,
        team: normalizeTeam(r.team), opp: normalizeTeam(r.opponent_team), season: toNumber(r.season), week: toNumber(r.week),
        stats: mapNflverseStats(r), usage,
      });
    }
    const extra = {};
    const prev = await this._csv(`stats_player/stats_player_reg_${season - 1}.csv`, { optional: true });
    if (!prev.missing) {
      extra.stat_season = {
        records: prev.records.filter((r) => ['QB', 'RB', 'WR', 'TE'].includes(normalizePosition(r.position))).map((r) => ({
          source_player_id: r.player_id, ids: { gsis: r.player_id }, name: r.player_display_name || r.player_name, position: normalizePosition(r.position),
          team: normalizeTeam(r.recent_team), season: season - 1, games: toNumber(r.games), stats: mapNflverseStats(r),
        })),
      };
    }
    return {
      records,
      schema: week.missing ? undefined : { expected: { required: ['player_id', 'position', 'week', 'team', 'receptions', 'targets', 'carries', 'passing_yards'], optional: ['target_share', 'wopr', 'opponent_team'] }, received: week.headers },
      minRecords: this.inSeason && this.week > 1 ? 200 : 0,
      meta: { weekly_file_missing: Boolean(week.missing), snaps_missing: Boolean(snaps.missing), previous_season_missing: Boolean(prev.missing) },
      extra,
    };
  }

  async fetchInjuries() {
    const season = this.season;
    const inj = await this._csv(`injuries/injuries_${season}.csv`, { optional: true });
    if (inj.missing) return { records: [], meta: { file_missing: true } };
    const latestWeek = Math.max(0, ...inj.records.map((r) => toNumber(r.week) || 0));
    const records = [];
    for (const r of inj.records) {
      if (toNumber(r.week) !== latestWeek) continue;
      const pos = normalizePosition(r.position);
      if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue;
      records.push({
        source_player_id: r.gsis_id, ids: { gsis: r.gsis_id }, name: r.full_name, position: pos, team: normalizeTeam(r.team),
        status: r.report_status || null, official: true, body_part: r.report_primary_injury || r.practice_primary_injury || null,
        practice: r.practice_status || null, week: latestWeek, as_of: null,
      });
    }
    return { records, schema: { expected: { required: ['gsis_id', 'week', 'report_status', 'practice_status'], optional: ['report_primary_injury'] }, received: inj.headers }, meta: { week: latestWeek } };
  }

  async fetchSchedule() {
    const { headers, records: rows } = await this._csv('schedules/games.csv');
    const season = this.season;
    const records = rows.filter((r) => toNumber(r.season) === season && r.game_type === 'REG').map((r) => ({
      game_id: r.game_id, season, week: toNumber(r.week), gameday: r.gameday, gametime: r.gametime,
      home: normalizeTeam(r.home_team), away: normalizeTeam(r.away_team),
      home_score: toNumber(r.home_score), away_score: toNumber(r.away_score),
      completed: toNumber(r.home_score) !== null && toNumber(r.away_score) !== null,
    }));
    return { records, schema: { expected: { required: ['game_id', 'season', 'week', 'home_team', 'away_team', 'home_score', 'away_score'], optional: ['gameday'] }, received: headers }, minRecords: 200 };
  }
}
