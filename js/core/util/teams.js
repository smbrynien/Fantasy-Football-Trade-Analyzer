// Canonical NFL team abbreviations and aliases used by different sources.

export const TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
];

const TEAM_SET = new Set(TEAMS);

export const TEAM_ALIASES = {
  JAC: 'JAX', LVR: 'LV', OAK: 'LV', LA: 'LAR', STL: 'LAR', SD: 'LAC', SDG: 'LAC', WSH: 'WAS', WFT: 'WAS',
  GNB: 'GB', KAN: 'KC', KCC: 'KC', NWE: 'NE', NEP: 'NE', NOR: 'NO', NOS: 'NO', SFO: 'SF', SF49: 'SF', TAM: 'TB',
  TBB: 'TB', HST: 'HOU', CLV: 'CLE', BLT: 'BAL', ARZ: 'ARI', CRD: 'ARI', RAV: 'BAL', HTX: 'HOU', OTI: 'TEN', CLT: 'IND',
  RAI: 'LV', RAM: 'LAR', SDO: 'LAC',
};

// ESPN proTeamId → abbreviation (stable since 2002; 34 = HOU)
export const ESPN_TEAM_IDS = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC',
  13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
  24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

const FREE_AGENT = new Set(['FA', 'FREE AGENT', 'NONE', 'UFA', 'RFA', '', 'NULL', 'N/A', 'NA', '--', '0']);

/** Returns canonical abbreviation, 'FA' for free agents, or null if unrecognised. */
export function normalizeTeam(t) {
  if (t === null || t === undefined) return 'FA';
  const s = String(t).trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
  if (FREE_AGENT.has(s)) return 'FA';
  if (TEAM_SET.has(s)) return s;
  if (TEAM_ALIASES[s]) return TEAM_ALIASES[s];
  return null;
}

export function isValidTeam(t) {
  return t === 'FA' || TEAM_SET.has(t);
}
