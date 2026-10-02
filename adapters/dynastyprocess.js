// DynastyProcess open data (github.com/dynastyprocess/data), three logical sources:
//   dynastyprocess_values  values.csv          — DP trade values (1QB & 2QB) for players and picks
//   dynastyprocess_ids     db_playerids.csv    — cross-platform ID crosswalk (authoritative player source)
//   fantasypros_ecr        db_fpecr_latest.csv — weekly snapshot of FantasyPros ECR across ranking pages

import { BaseAdapter } from './base.js';
import { parseCSV, toNumber } from '../js/core/util/csv.js';
import { normalizeTeam } from '../js/core/util/teams.js';
import { normalizePosition } from '../js/core/util/positions.js';
import { parsePickLabel } from '../js/core/pick-labels.js';

const BASE = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files';

async function getCSV(adapter, file) {
  return adapter.once(file, async () => {
    const text = await adapter.ctx.http.text(`${BASE}/${file}`);
    await adapter.saveRaw(file.replace(/\.csv$/, ''), text, 'csv');
    return parseCSV(text);
  });
}

export class DynastyProcessValuesAdapter extends BaseAdapter {
  async fetchTradeValues() {
    const { headers, records: rows } = await getCSV(this, 'values.csv');
    const records = [];
    for (const r of rows) {
      const pos = normalizePosition(r.pos);
      if (!pos || pos === 'PICK') continue;
      for (const [qb, col] of [['1qb', 'value_1qb'], ['sf', 'value_2qb']]) {
        const value = toNumber(r[col]);
        if (value === null) continue;
        records.push({
          source_player_id: r.fp_id || null, name: r.player, position: pos, team: normalizeTeam(r.team), age: toNumber(r.age),
          draft_year: toNumber(r.draft_year), ids: { fantasypros: r.fp_id },
          dynasty: true, qb, ppr: 1, teams: 12, value, rank: null, pos_rank: null, trend30: null, as_of: r.scrape_date || null,
        });
      }
    }
    return { records, schema: { expected: { required: ['player', 'pos', 'value_1qb', 'value_2qb'], optional: ['fp_id', 'age', 'team', 'scrape_date'] }, received: headers }, minRecords: 300 };
  }

  async fetchPickValues() {
    const { records: rows } = await getCSV(this, 'values.csv');
    const records = [];
    for (const r of rows) {
      if (normalizePosition(r.pos) !== 'PICK') continue;
      const d = parsePickLabel(r.player);
      if (!d) continue;
      for (const [qb, col] of [['1qb', 'value_1qb'], ['sf', 'value_2qb']]) {
        const value = toNumber(r[col]);
        if (value === null) continue;
        records.push({ label: r.player, ...d, dynasty: true, qb, ppr: 1, teams: 12, value, as_of: r.scrape_date || null });
      }
    }
    return { records, minRecords: 4 };
  }
}

const ID_COLS = {
  mfl_id: 'mfl', sportradar_id: 'sportradar', fantasypros_id: 'fantasypros', gsis_id: 'gsis', pff_id: 'pff', sleeper_id: 'sleeper',
  nfl_id: 'nfl', espn_id: 'espn', yahoo_id: 'yahoo', fleaflicker_id: 'fleaflicker', cbs_id: 'cbs', pfr_id: 'pfr', rotowire_id: 'rotowire',
  ktc_id: 'ktc', fantasy_data_id: 'fantasy_data',
};

export class DynastyProcessIdsAdapter extends BaseAdapter {
  async fetchPlayers() {
    const { headers, records: rows } = await getCSV(this, 'db_playerids.csv');
    const minSeason = this.season - 2;
    const records = [];
    for (const r of rows) {
      const pos = normalizePosition(r.position);
      if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue;
      const dbSeason = toNumber(r.db_season);
      if (dbSeason !== null && dbSeason < minSeason) continue;
      if (r.birthdate && Number(r.birthdate.slice(0, 4)) < this.season - 45) continue; // long-retired (stale crosswalk rows)
      const ids = {};
      for (const [col, t] of Object.entries(ID_COLS)) if (r[col]) ids[t] = r[col];
      records.push({
        source_player_id: r.mfl_id || r.sleeper_id || r.gsis_id, name: r.name, position: pos, positions: [pos], team: normalizeTeam(r.team),
        birth_date: r.birthdate || null, college: r.college || null,
        draft: { year: toNumber(r.draft_year), round: toNumber(r.draft_round), pick: toNumber(r.draft_pick) },
        height: toNumber(r.height), weight: toNumber(r.weight), ids,
      });
    }
    return { records, schema: { expected: { required: ['name', 'position', 'sleeper_id', 'gsis_id', 'fantasypros_id', 'birthdate'], optional: ['ktc_id', 'pfr_id', 'espn_id', 'yahoo_id', 'draft_year', 'db_season'] }, received: headers }, minRecords: 1000 };
  }
}

/** Map a FantasyPros page/ecr_type to our ranking descriptor, or null for unsupported (IDP/best-ball) pages. */
export function classifyFPPage(page, ecrType) {
  const p = String(page || '').toLowerCase();
  const t = String(ecrType || '').toLowerCase();
  if (/(^|[/-])(idp|dl|lb|db)(\.php|-|$)/.test(p.replace(/^\/nfl\/rankings\//, '')) || /best-?ball/.test(p)) return null;
  let kind;
  if (p.includes('rookies')) kind = 'rookie';
  else if (p.includes('dynasty')) kind = 'dynasty';
  else if (p.includes('ros-')) kind = 'ros';
  else if (p.includes('cheatsheets') || p.includes('draft')) kind = 'redraft';
  else if (t.startsWith('w')) kind = 'weekly';
  else kind = 'redraft';
  const qb = p.includes('superflex') || t.endsWith('sf') ? 'sf' : '1qb';
  const scope = t.endsWith('p') && kind !== 'rookie' ? 'position' : 'overall';
  return { kind, qb, scope };
}

export class FantasyProsECRAdapter extends BaseAdapter {
  async fetchRankings() {
    const { headers, records: rows } = await getCSV(this, 'db_fpecr_latest.csv');
    const records = [];
    for (const r of rows) {
      const c = classifyFPPage(r.fp_page, r.ecr_type);
      if (!c) continue;
      const pos = normalizePosition(r.pos);
      if (!pos || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pos)) continue;
      const ecr = toNumber(r.ecr);
      if (ecr === null) continue;
      records.push({
        source_player_id: r.id, ids: { fantasypros: pos === 'DEF' ? null : r.id, yahoo: r.yahoo_id, cbs: r.cbs_id },
        name: r.player, position: pos, team: normalizeTeam(r.team || r.tm),
        ...c, pos: c.scope === 'position' ? pos : null, page: r.fp_page,
        rank: ecr, ecr, sd: toNumber(r.sd), best: toNumber(r.best), worst: toNumber(r.worst),
        owned: toNumber(r.player_owned_avg), bye: toNumber(r.bye), as_of: r.scrape_date || null,
      });
    }
    return { records, schema: { expected: { required: ['fp_page', 'ecr_type', 'player', 'id', 'pos', 'ecr'], optional: ['sd', 'best', 'worst', 'team', 'scrape_date'] }, received: headers }, minRecords: 500 };
  }
}
