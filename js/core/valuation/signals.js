// Collects per-source signal lists (rankings, market values, ADP) from the dataset and picks, for each source,
// the variant that best matches the league format. Sources are identified only by id — no source-specific logic.

/** Score how well a market record's format matches the league (lower = better; >= 100 = wrong QB format). */
export function marketMismatch(rec, league, scoring) {
  let d = 0;
  const qb = league.qb_format === '1qb' ? '1qb' : 'sf';
  if ((rec.qb || '1qb') !== qb) d += 100;
  if (typeof rec.ppr === 'number') d += Math.abs(rec.ppr - (scoring.rec ?? 1)) * 10;
  if (typeof rec.teams === 'number') d += Math.abs(rec.teams - league.teams) * 0.5;
  // TE premium: a list's `tep` is the extra points per TE reception it assumes (0, 0.5 "TE+", 1 "TE++").
  if (typeof rec.tep === 'number') d += Math.abs(rec.tep - (scoring.bonus_rec_te || 0)) * 5;
  return d;
}

/**
 * Market lists: Map src → {items:[{cid, position, key:value, trend30, raw}], meta} using the best-matching variant per
 * source. A source with only lists in the wrong QB format (1QB vs Superflex/2QB) is left out — QB values and the
 * source's value scale (used to price picks) differ too much between formats — and listed in `out.excluded`.
 */
export function collectMarket(dataset, { dynasty, league, scoring }) {
  const variants = new Map(); // src → Map(variantKey → {mismatch, items})
  for (const p of dataset.players) {
    for (const m of p.market || []) {
      if (Boolean(m.dynasty) !== Boolean(dynasty)) continue;
      if (typeof m.value !== 'number') continue;
      const vk = `${m.qb || '1qb'}|${m.ppr ?? ''}|${m.teams ?? ''}|${m.tep ?? ''}`;
      if (!variants.has(m.src)) variants.set(m.src, new Map());
      const vmap = variants.get(m.src);
      if (!vmap.has(vk)) vmap.set(vk, { mismatch: marketMismatch(m, league, scoring), items: [], meta: { qb: m.qb, ppr: m.ppr, teams: m.teams, tep: m.tep } });
      vmap.get(vk).items.push({ cid: p.cid, position: p.position, key: m.value, trend30: m.trend30 ?? null, raw: m });
    }
  }
  const out = new Map();
  out.excluded = [];
  for (const [src, vmap] of variants) {
    const best = [...vmap.values()].sort((a, b) => a.mismatch - b.mismatch || b.items.length - a.items.length)[0];
    if (best && best.mismatch < 100) out.set(src, best); // never use a 1QB list for SF or vice-versa
    else if (best) out.excluded.push({ src, reason: 'qb_format', meta: best.meta, players: best.items.length });
  }
  return out;
}

/** Ranking lists usable for a mode. Returns Map src → [{list, kind, scope, qb, items}] */
export function collectRankings(dataset, { kinds, league }) {
  const lists = new Map(); // src → Map(listKey → list)
  for (const p of dataset.players) {
    for (const r of p.rankings || []) {
      if (!kinds.includes(r.kind)) continue;
      const rank = typeof r.ecr === 'number' ? r.ecr : r.rank;
      if (typeof rank !== 'number') continue;
      const lk = `${r.kind}|${r.scope}|${r.qb || ''}|${r.scope === 'position' ? r.pos || p.position : ''}`;
      if (!lists.has(r.src)) lists.set(r.src, new Map());
      const m = lists.get(r.src);
      if (!m.has(lk)) m.set(lk, { kind: r.kind, scope: r.scope, qb: r.qb, pos: r.scope === 'position' ? r.pos || p.position : null, items: [] });
      m.get(lk).items.push({ cid: p.cid, position: p.position, key: rank, raw: r });
    }
  }
  const qb = league.qb_format === '1qb' ? '1qb' : 'sf';
  const out = new Map();
  for (const [src, m] of lists) {
    const all = [...m.values()];
    // Prefer kinds in the given order, positional lists over overall, and overall lists in the right QB format.
    const selected = [];
    for (const kind of kinds) {
      const ofKind = all.filter((l) => l.kind === kind);
      if (!ofKind.length) continue;
      const positional = ofKind.filter((l) => l.scope === 'position');
      const overall = ofKind.filter((l) => l.scope !== 'position').sort((a, b) => ((a.qb || '1qb') === qb ? 0 : 1) - ((b.qb || '1qb') === qb ? 0 : 1));
      const coveredPos = new Set(positional.map((l) => l.pos));
      selected.push(...positional);
      if (overall.length) selected.push({ ...overall[0], excludePositions: coveredPos });
      break; // use the first kind that exists for this source
    }
    if (selected.length) out.set(src, selected);
  }
  return out;
}

/** ADP lists. formats: ordered preference list. Returns Map src → {format, items:[{cid, position, key}]} */
export function collectADP(dataset, { formats }) {
  const lists = new Map();
  for (const p of dataset.players) {
    for (const a of p.adp || []) {
      if (!formats.includes(a.format) || typeof a.adp !== 'number') continue;
      if (!lists.has(a.src)) lists.set(a.src, new Map());
      const m = lists.get(a.src);
      if (!m.has(a.format)) m.set(a.format, []);
      m.get(a.format).push({ cid: p.cid, position: p.position, key: a.adp, raw: a });
    }
  }
  const out = new Map();
  for (const [src, m] of lists) {
    for (const f of formats) if (m.has(f) && m.get(f).length) { out.set(src, { format: f, items: m.get(f) }); break; }
  }
  return out;
}

export function adpFormatsFor(mode, league, scoring) {
  const sf = league.qb_format !== '1qb';
  if (mode === 'dynasty') return sf ? ['dynasty_sf', 'dynasty'] : ['dynasty', 'dynasty_half', 'dynasty_sf'];
  if (sf) return ['redraft_sf'];
  const rec = scoring.rec;
  if (rec >= 0.75) return ['redraft_ppr', 'redraft_half'];
  if (rec >= 0.25) return ['redraft_half', 'redraft_ppr', 'redraft_std'];
  return ['redraft_std', 'redraft_half'];
}
