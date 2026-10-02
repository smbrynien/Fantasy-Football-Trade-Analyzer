// Position normalization. The engine supports offensive skill positions + K + DEF today;
// IDP positions are recognised (so imports don't fail) but not valued yet.

export const FANTASY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
export const IDP_POSITIONS = ['DL', 'LB', 'DB'];

const ALIASES = {
  QB: 'QB', RB: 'RB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  K: 'K', PK: 'K', KICKER: 'K',
  DEF: 'DEF', DST: 'DEF', 'D/ST': 'DEF', DST1: 'DEF', D: 'DEF', DEFENSE: 'DEF', 'D-ST': 'DEF', TD: 'DEF',
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL', LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  DB: 'DB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', SAF: 'DB',
  PICK: 'PICK', RDP: 'PICK',
};

/** 'WR12' → 'WR', 'D/ST' → 'DEF', 'rb' → 'RB'. Returns null if unknown. */
export function normalizePosition(p) {
  if (p === null || p === undefined) return null;
  let s = String(p).trim().toUpperCase();
  if (!s) return null;
  s = s.split(/[,/](?!ST)/)[0]; // "WR/RB" → WR (but keep D/ST)
  if (ALIASES[s]) return ALIASES[s];
  const m = s.match(/^([A-Z/]+?)\d+$/); // positional rank like RB12
  if (m && ALIASES[m[1]]) return ALIASES[m[1]];
  return null;
}

/** Extract numeric positional rank from 'RB12' → 12. */
export function positionalRankFromLabel(p) {
  if (p === null || p === undefined) return null;
  const m = String(p).trim().toUpperCase().match(/^[A-Z/]+?(\d+)$/);
  return m ? Number(m[1]) : null;
}
