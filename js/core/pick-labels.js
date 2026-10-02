// Rookie draft pick descriptors: parsing source labels and building stable asset IDs.
//
// Descriptor: { season, round, slot|null, bucket: 'early'|'mid'|'late'|null, range: [lo,hi]|null }
// Asset id forms:
//   pick:2027:1:4          known slot 1.04
//   pick:2027:1:early      bucket (early/mid/late third of the round)
//   pick:2027:1:r3-7       projected slot range
//   pick:2028:1            unknown slot

const ORD = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

function roundFromToken(t) {
  if (!t) return null;
  const s = t.toLowerCase();
  if (ORD[s]) return ORD[s];
  const m = s.match(/^(\d+)(st|nd|rd|th)?$/);
  return m ? Number(m[1]) : null;
}

/** Parse labels like "2027 1st (Early)", "2027 Early 1st", "2027 Pick 1.04", "2027 1.04", "2028 1st", "2027 Round 2 Pick 5". */
export function parsePickLabel(label) {
  if (!label) return null;
  const s = String(label).trim().replace(/\s+/g, ' ');
  let m;
  // 2027 Pick 1.04 / 2027 1.04 / 2027 #1.04
  if ((m = s.match(/^(\d{4})\s+(?:pick\s+|#)?(\d{1,2})\.(\d{1,2})$/i))) {
    return { season: +m[1], round: +m[2], slot: +m[3], bucket: null, range: null };
  }
  // 2027 Round 2 Pick 5
  if ((m = s.match(/^(\d{4})\s+round\s+(\d)\s*,?\s*pick\s+(\d{1,2})$/i))) {
    return { season: +m[1], round: +m[2], slot: +m[3], bucket: null, range: null };
  }
  // 2027 Early 1st / 2027 Mid 2nd / 2027 Late 3rd (Round)?
  if ((m = s.match(/^(\d{4})\s+(early|mid|middle|late)\s+(\w+)(?:\s+round)?$/i))) {
    const r = roundFromToken(m[3]);
    if (r) return { season: +m[1], round: r, slot: null, bucket: m[2].toLowerCase().startsWith('mid') ? 'mid' : m[2].toLowerCase(), range: null };
  }
  // 2027 1st (Early) / 2027 1st Round (Mid) / 2027 1st
  if ((m = s.match(/^(\d{4})\s+(\w+)(?:\s+round)?(?:\s*\((early|mid|middle|late)\))?$/i))) {
    const r = roundFromToken(m[2]);
    if (r) {
      const b = m[3] ? (m[3].toLowerCase().startsWith('mid') ? 'mid' : m[3].toLowerCase()) : null;
      return { season: +m[1], round: r, slot: null, bucket: b, range: null };
    }
  }
  return null;
}

export function pickAssetId(d) {
  if (d.slot) return `pick:${d.season}:${d.round}:${d.slot}`;
  if (d.bucket) return `pick:${d.season}:${d.round}:${d.bucket}`;
  if (d.range) return `pick:${d.season}:${d.round}:r${d.range[0]}-${d.range[1]}`;
  return `pick:${d.season}:${d.round}`;
}

export function parsePickAssetId(id) {
  const m = String(id).match(/^pick:(\d{4}):(\d)(?::(.+))?$/);
  if (!m) return null;
  const d = { season: +m[1], round: +m[2], slot: null, bucket: null, range: null };
  const rest = m[3];
  if (!rest) return d;
  if (/^\d+$/.test(rest)) d.slot = +rest;
  else if (['early', 'mid', 'late'].includes(rest)) d.bucket = rest;
  else {
    const r = rest.match(/^r(\d+)-(\d+)$/);
    if (r) d.range = [Math.min(+r[1], +r[2]), Math.max(+r[1], +r[2])];
  }
  return d;
}

const ORD_LABEL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

export function pickDisplayName(d) {
  if (d.slot) return `${d.season} ${d.round}.${String(d.slot).padStart(2, '0')}`;
  if (d.bucket) return `${d.season} ${d.bucket[0].toUpperCase()}${d.bucket.slice(1)} ${ORD_LABEL[d.round] || d.round + 'th'}`;
  if (d.range) return `${d.season} ${ORD_LABEL[d.round] || d.round + 'th'} (proj. ${d.round}.${String(d.range[0]).padStart(2, '0')}–${d.round}.${String(d.range[1]).padStart(2, '0')})`;
  return `${d.season} ${ORD_LABEL[d.round] || d.round + 'th'}`;
}
