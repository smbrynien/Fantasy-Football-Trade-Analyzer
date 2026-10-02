// Player-name normalization used ONLY by the identity resolver (js/core/identity.js).
// Keep all name heuristics here so matching logic is never scattered across the codebase.

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'vi']);

// First-name equivalences seen across fantasy sites. Bidirectional groups.
const FIRST_NAME_GROUPS = [
  ['gabe', 'gabriel'], ['mitch', 'mitchell'], ['josh', 'joshua'], ['cam', 'cameron'], ['chig', 'chigoziem'],
  ['tank', 'nathaniel', 'nate'], ['hollywood', 'marquise'], ['mike', 'michael'], ['matt', 'matthew'],
  ['chris', 'christopher'], ['dan', 'daniel', 'danny'], ['dave', 'david'], ['will', 'william', 'bill'],
  ['rob', 'robert', 'robbie', 'bob'], ['tony', 'anthony'], ['jon', 'jonathan', 'jonathon'], ['nick', 'nicholas'],
  ['joe', 'joseph', 'joey'], ['ken', 'kenneth', 'kenny'], ['zach', 'zachary', 'zack'], ['jeff', 'jeffery', 'jeffrey'],
  ['steve', 'steven', 'stephen'], ['ben', 'benjamin', 'benny'], ['alex', 'alexander'], ['tom', 'thomas', 'tommy'],
  ['jim', 'james', 'jimmy', 'jamie'], ['pat', 'patrick'], ['greg', 'gregory'], ['ed', 'edward', 'eddie'],
  ['sam', 'samuel', 'sammy'], ['andy', 'andrew', 'drew'], ['ricky', 'richard', 'rick', 'rich'],
  ['dj', 'deejay'], ['scotty', 'scott'], ['bam', 'john'], ['jj', 'jayjay'], ['kc', 'kaycee'],
  ['tre', 'trey'], ['jeff', 'jeffery'], ['olabisi', 'bisi'], ['hunter', 'hunt'],
];
const FIRST_ALIAS = new Map();
for (const g of FIRST_NAME_GROUPS) for (const n of g) FIRST_ALIAS.set(n, g);

/** Remove accents/diacritics. */
export function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Canonical name key: lowercase ASCII letters/digits + single spaces, suffixes removed.
 * "D.K. Metcalf" → "dk metcalf", "Kenneth Walker III" → "kenneth walker", "Amon-Ra St. Brown" → "amonra st brown"
 */
export function nameKey(name) {
  if (!name) return '';
  let s = stripAccents(String(name)).toLowerCase();
  s = s.replace(/[’'`.]/g, '').replace(/-/g, '').replace(/[^a-z0-9 ]/g, ' ');
  const parts = s.split(/\s+/).filter(Boolean);
  while (parts.length > 2 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  if (parts.length === 2 && SUFFIXES.has(parts[1])) parts.pop();
  return parts.join(' ');
}

/** All alternative keys produced by first-name equivalences (including the base key). */
export function nameVariants(name) {
  const key = nameKey(name);
  const out = new Set([key]);
  const parts = key.split(' ');
  if (parts.length >= 2) {
    const group = FIRST_ALIAS.get(parts[0]);
    if (group) for (const alt of group) out.add([alt, ...parts.slice(1)].join(' '));
  }
  return [...out];
}

export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  if (parts.length <= 1) return { first_name: parts[0] || '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

/** Jaro-Winkler similarity in [0,1]. */
export function jaroWinkler(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, lb);
    for (let j = lo; j < hi; j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, la, lb) && a[i] === b[i]; i++) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}
