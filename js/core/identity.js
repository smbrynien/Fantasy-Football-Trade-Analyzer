// Player identity resolution — the ONLY place that decides which source record belongs to which player.
//
//  * Canonical player DB is built from "authoritative" player sources (DynastyProcess crosswalk, Sleeper, nflverse).
//  * Every other source record (rankings, values, projections, imports) is resolved against that DB with
//    `PlayerIndex.resolve()`; such records never create players.
//  * Resolution order: manual override → external IDs → exact normalized name (+ position) → disambiguation by
//    team / birth date / age / draft year → conservative fuzzy match. Ambiguous results are NEVER merged; they are
//    returned as `ambiguous` with candidates for the data-quality report and manual resolution UI.

import { nameKey, nameVariants, jaroWinkler, splitName } from './util/names.js';
import { normalizeTeam } from './util/teams.js';
import { normalizePosition } from './util/positions.js';
import { hashString } from './util/objects.js';

/** External ID systems we track, in priority order for generating canonical IDs. */
export const ID_TYPES = [
  'gsis', 'sleeper', 'espn', 'fantasypros', 'pfr', 'mfl', 'sportradar', 'yahoo', 'nfl', 'ktc', 'fantasycalc',
  'cbs', 'fleaflicker', 'rotowire', 'pff', 'fantasy_data', 'ffc',
];

const POSITION_COMPAT = { RB: ['RB'], WR: ['WR'], TE: ['TE'], QB: ['QB'], K: ['K'], DEF: ['DEF'] };

export function ageOn(birthDate, asOf = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate + (String(birthDate).length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(b.getTime())) return null;
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  return Math.round(((d - b) / (365.2425 * 864e5)) * 10) / 10;
}

export function canonicalIdFor(ids, position, team) {
  if (position === 'DEF' && team && team !== 'FA') return `DEF_${team}`;
  for (const t of ID_TYPES) {
    if (ids && ids[t] !== undefined && ids[t] !== null && ids[t] !== '') return `P${hashString(`${t}:${ids[t]}`)}`;
  }
  return null;
}

function cleanIds(ids) {
  const out = {};
  if (!ids) return out;
  for (const [k, v] of Object.entries(ids)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s || s === 'NA' || s === '0' || s === 'null' || s === 'undefined') continue;
    out[k] = s;
  }
  return out;
}

/**
 * Evidence in the record itself that `p` is a DIFFERENT person: birth dates more than 2 days apart, an age more than
 * 2 years off, or another draft year. Returns the reason or null. A name match that contradicts it must not be used —
 * it used to attach e.g. a 2003-born rookie's data to a retired namesake born in 1994.
 */
function identityConflict(rec, p) {
  const bd = (d) => (d ? Date.parse(String(d).slice(0, 10)) : NaN);
  const a = bd(rec.birth_date), b = bd(p.birth_date);
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 2 * 864e5) return 'birth_date';
  if (typeof rec.age === 'number' && Number.isFinite(b) && Math.abs(ageOn(p.birth_date) - rec.age) > 2) return 'age';
  if (rec.draft_year && p.draft?.year && Number(rec.draft_year) !== Number(p.draft.year)) return 'draft_year';
  return null;
}

function positionsCompatible(recPos, player) {
  if (!recPos) return true;
  const allowed = POSITION_COMPAT[recPos] || [recPos];
  const pp = player.positions && player.positions.length ? player.positions : [player.position];
  return pp.some((p) => allowed.includes(p));
}

export class PlayerIndex {
  constructor(players = [], { overrides = {} } = {}) {
    this.players = new Map();
    this.byId = {};
    for (const t of ID_TYPES) this.byId[t] = new Map();
    this.byName = new Map();
    this.overrides = overrides; // { "<source>|<key>": cid | "IGNORE" }
    for (const p of players) this.add(p);
  }

  add(p) {
    this.players.set(p.cid, p);
    for (const [t, v] of Object.entries(p.ids || {})) {
      if (!this.byId[t]) this.byId[t] = new Map();
      this.byId[t].set(String(v), p.cid);
    }
    const keys = new Set([nameKey(p.name), ...(p.aliases || []).map(nameKey)]);
    for (const k of keys) {
      if (!k) continue;
      if (!this.byName.has(k)) this.byName.set(k, new Set());
      this.byName.get(k).add(p.cid);
    }
  }

  get(cid) { return this.players.get(cid); }

  static overrideKeys(source, rec) {
    const keys = [];
    if (rec.source_player_id !== undefined && rec.source_player_id !== null) keys.push(`${source}|id:${rec.source_player_id}`);
    keys.push(`${source}|name:${nameKey(rec.name)}|${normalizePosition(rec.position) || ''}`);
    keys.push(`*|name:${nameKey(rec.name)}|${normalizePosition(rec.position) || ''}`);
    return keys;
  }

  /**
   * Resolve a source record. rec: { name, position, team, ids:{}, birth_date, age, draft_year, source_player_id }
   * Returns { status: 'matched'|'ambiguous'|'unmatched'|'ignored'|'conflict', cid, confidence, method, candidates, flags }
   */
  resolve(rec, { source = '*', allowFuzzy = true } = {}) {
    const position = normalizePosition(rec.position);
    const team = rec.team === undefined ? undefined : normalizeTeam(rec.team);
    const flags = [];

    for (const k of PlayerIndex.overrideKeys(source, rec)) {
      const o = this.overrides[k];
      if (o === 'IGNORE') return { status: 'ignored', cid: null, confidence: 1, method: 'override', candidates: [], flags };
      if (o && this.players.has(o)) return { status: 'matched', cid: o, confidence: 1, method: 'override', candidates: [], flags };
    }

    if (position === 'DEF' && team && team !== 'FA') {
      const cid = `DEF_${team}`;
      if (this.players.has(cid)) return { status: 'matched', cid, confidence: 1, method: 'team_defense', candidates: [], flags };
    }

    // 1. External IDs
    const ids = cleanIds(rec.ids);
    const idHits = new Map();
    for (const [t, v] of Object.entries(ids)) {
      const cid = this.byId[t] && this.byId[t].get(v);
      if (cid) idHits.set(cid, (idHits.get(cid) || []).concat(t));
    }
    if (idHits.size === 1) {
      const [cid, types] = [...idHits.entries()][0];
      const p = this.players.get(cid);
      if (position && !positionsCompatible(position, p)) flags.push('position_mismatch');
      if (rec.name && nameKey(rec.name) !== nameKey(p.name) && !(p.aliases || []).some((a) => nameKey(a) === nameKey(rec.name))) flags.push('name_differs');
      return { status: 'matched', cid, confidence: 1, method: `id:${types.join('+')}`, candidates: [], flags };
    }
    if (idHits.size > 1) {
      return { status: 'conflict', cid: null, confidence: 0, method: 'id_conflict', candidates: [...idHits.keys()], flags: ['ids_point_to_different_players'] };
    }

    // 2. Names
    if (!rec.name) return { status: 'unmatched', cid: null, confidence: 0, method: 'no_name', candidates: [], flags };
    let cands = new Set();
    for (const k of nameVariants(rec.name)) for (const cid of this.byName.get(k) || []) cands.add(cid);
    let list = [...cands].map((c) => this.players.get(c)).filter((p) => positionsCompatible(position, p));

    if (!list.length && allowFuzzy) {
      // 3. Conservative fuzzy match: same position, high similarity, unique.
      const key = nameKey(rec.name);
      const scored = [];
      for (const p of this.players.values()) {
        if (!positionsCompatible(position, p) || !position) continue;
        if (team && team !== 'FA' && p.team && p.team !== team) continue;
        if (identityConflict(rec, p)) continue;
        const s = jaroWinkler(key, nameKey(p.name));
        if (s >= 0.94) scored.push({ p, s });
      }
      scored.sort((a, b) => b.s - a.s);
      if (scored.length === 1 || (scored.length > 1 && scored[0].s - scored[1].s > 0.03)) {
        return { status: 'matched', cid: scored[0].p.cid, confidence: 0.8, method: 'fuzzy_name', candidates: scored.slice(0, 3).map((x) => x.p.cid), flags: ['fuzzy_match_review'] };
      }
      if (scored.length > 1) return { status: 'ambiguous', cid: null, confidence: 0, method: 'fuzzy_name', candidates: scored.slice(0, 5).map((x) => x.p.cid), flags };
      return { status: 'unmatched', cid: null, confidence: 0, method: 'name', candidates: [], flags };
    }
    if (!list.length) return { status: 'unmatched', cid: null, confidence: 0, method: 'name', candidates: [], flags };

    if (list.length > 1) {
      // Disambiguate — each filter is applied only if it leaves at least one candidate. Strongest evidence first:
      // a birth date identifies a person; a team does not (players move), so team comes last.
      const filters = [];
      if (rec.birth_date) filters.push(['birth_date', (p) => !identityConflict({ birth_date: rec.birth_date }, p) && Boolean(p.birth_date)]);
      if (typeof rec.age === 'number') filters.push(['age', (p) => p.birth_date && Math.abs(ageOn(p.birth_date) - rec.age) <= 1.5]);
      if (rec.draft_year) filters.push(['draft_year', (p) => p.draft && Number(p.draft.year) === Number(rec.draft_year)]);
      if (team && team !== 'FA') filters.push(['team', (p) => p.team === team]);
      const used = [];
      for (const [label, f] of filters) {
        const next = list.filter(f);
        if (next.length && next.length < list.length) { list = next; used.push(label); }
        if (list.length === 1) break;
      }
      if (list.length > 1) {
        return { status: 'ambiguous', cid: null, confidence: 0, method: 'name', candidates: list.map((p) => p.cid), flags: ['duplicate_name'] };
      }
      const why = identityConflict(rec, list[0]);
      if (why) return { status: 'unmatched', cid: null, confidence: 0, method: 'name', candidates: [list[0].cid], flags: ['identity_conflict', `conflict_${why}`] };
      return { status: 'matched', cid: list[0].cid, confidence: 0.9, method: `name+${used.join('+')}`, candidates: [], flags: ['disambiguated'] };
    }

    const p = list[0];
    const why = identityConflict(rec, p);
    if (why) return { status: 'unmatched', cid: null, confidence: 0, method: 'name', candidates: [p.cid], flags: ['identity_conflict', `conflict_${why}`] };
    let confidence = 0.95;
    if (team && team !== 'FA' && p.team && p.team !== 'FA' && p.team !== team) { flags.push('team_differs'); confidence = 0.9; }
    if (!position) { flags.push('no_position'); confidence -= 0.05; }
    return { status: 'matched', cid: p.cid, confidence, method: 'name', candidates: [], flags };
  }
}

/**
 * PlayerStore — maintains the canonical player DB from authoritative player records.
 * Pure (no I/O). The server persists `toJSON()` to data/players/players.json.
 */
export class PlayerStore {
  constructor(players = [], { overrides = {}, asOf = new Date(), teamAuthority = null } = {}) {
    this.index = new PlayerIndex(players, { overrides });
    this.teamAuthority = teamAuthority;
    this.events = [];
    this.asOf = asOf;
  }

  get players() { return [...this.index.players.values()]; }

  _event(type, cid, detail) {
    this.events.push({ type, cid, detail, at: new Date(this.asOf).toISOString() });
  }

  /**
   * Upsert an authoritative player record:
   * { name, position, positions, team, birth_date, college, draft:{year,round,pick}, status, years_exp, ids:{}, ... }
   * Name-only merges require matching position AND birth date (or matching team+draft year when birth date unknown).
   */
  upsert(rec, source) {
    const position = normalizePosition(rec.position);
    if (!position) return { action: 'skipped', reason: 'unsupported_position' };
    const team = normalizeTeam(rec.team) || 'FA';
    const ids = cleanIds(rec.ids);

    let cid = null;
    const idHits = new Set();
    for (const [t, v] of Object.entries(ids)) {
      const hit = this.index.byId[t] && this.index.byId[t].get(v);
      if (hit) idHits.add(hit);
    }
    if (position === 'DEF') {
      cid = `DEF_${team}`;
      if (team === 'FA') return { action: 'skipped', reason: 'defense_without_team' };
    } else if (idHits.size === 1) {
      cid = [...idHits][0];
    } else if (idHits.size > 1) {
      this._event('id_conflict', null, { source, name: rec.name, ids, candidates: [...idHits] });
      return { action: 'conflict', candidates: [...idHits] };
    } else {
      // strict name merge
      const cands = new Set();
      for (const k of nameVariants(rec.name)) for (const c of this.index.byName.get(k) || []) cands.add(c);
      const strict = [...cands].map((c) => this.index.get(c)).filter((p) => p.position === position && (
        (rec.birth_date && p.birth_date && p.birth_date === rec.birth_date) ||
        (!rec.birth_date || !p.birth_date) && rec.draft && p.draft && rec.draft.year && Number(rec.draft.year) === Number(p.draft.year) && team === p.team
      ));
      if (strict.length === 1) cid = strict[0].cid;
      else if (strict.length > 1) {
        this._event('ambiguous_authoritative', null, { source, name: rec.name, candidates: strict.map((p) => p.cid) });
        return { action: 'conflict', candidates: strict.map((p) => p.cid) };
      }
    }

    if (!cid) {
      const derived = canonicalIdFor(ids, position, team);
      if (derived && this.index.get(derived)) cid = derived;
    }
    const existing = cid ? this.index.get(cid) : null;
    if (!existing) {
      const newCid = cid || canonicalIdFor(ids, position, team);
      if (!newCid) return { action: 'skipped', reason: 'no_ids' };
      const { first_name, last_name } = rec.first_name ? rec : splitName(rec.name);
      const p = {
        cid: newCid,
        name: rec.name,
        first_name: rec.first_name || first_name,
        last_name: rec.last_name || last_name,
        position,
        positions: rec.positions && rec.positions.length ? [...new Set(rec.positions.map(normalizePosition).filter(Boolean))] : [position],
        team,
        birth_date: rec.birth_date || null,
        college: rec.college || null,
        draft: rec.draft || { year: null, round: null, pick: null },
        status: rec.status || null,
        years_exp: rec.years_exp ?? null,
        depth_chart_order: rec.depth_chart_order ?? null,
        depth_chart_position: rec.depth_chart_position ?? null,
        height: rec.height ?? null,
        weight: rec.weight ?? null,
        ids,
        aliases: [],
        sources: [source],
        first_seen: new Date(this.asOf).toISOString(),
        updated_at: new Date(this.asOf).toISOString(),
      };
      this.index.add(p);
      this._event('created', p.cid, { source, name: p.name, position, team });
      return { action: 'created', cid: p.cid };
    }

    // Merge into existing
    const p = existing;
    const changes = [];
    for (const [t, v] of Object.entries(ids)) {
      if (!p.ids[t]) { p.ids[t] = v; changes.push(`id:${t}`); }
      else if (p.ids[t] !== v) this._event('id_mismatch', p.cid, { source, type: t, existing: p.ids[t], incoming: v });
    }
    if (rec.name && nameKey(rec.name) !== nameKey(p.name)) {
      if (!p.aliases.some((a) => nameKey(a) === nameKey(rec.name))) {
        p.aliases.push(rec.name);
        this._event('name_variant', p.cid, { source, name: p.name, incoming: rec.name });
      }
    }
    // Team/status: authoritative sources may disagree briefly after transactions; the configured team authority
    // (the source updated fastest) wins whenever it has data for this player.
    const ta = this.teamAuthority;
    const teamAuthority = !ta || source === ta || !p.sources.includes(ta);
    if (team && team !== p.team && teamAuthority) {
      this._event('team_change', p.cid, { source, from: p.team, to: team, name: p.name });
      p.team = team;
      changes.push('team');
    }
    if (rec.positions && rec.positions.length) {
      const merged = [...new Set([...(p.positions || []), ...rec.positions.map(normalizePosition).filter(Boolean)])];
      if (merged.length !== (p.positions || []).length) { p.positions = merged; changes.push('positions'); if (merged.length > 1) this._event('multi_position', p.cid, { positions: merged, name: p.name }); }
    }
    for (const k of ['birth_date', 'college', 'height', 'weight']) if (!p[k] && rec[k]) { p[k] = rec[k]; changes.push(k); }
    if (rec.draft && rec.draft.year && !(p.draft && p.draft.year)) { p.draft = rec.draft; changes.push('draft'); }
    if (rec.draft && p.draft && rec.draft.round && !p.draft.round) { p.draft = { ...p.draft, ...rec.draft }; }
    if (teamAuthority) {
      for (const k of ['status', 'years_exp', 'depth_chart_order', 'depth_chart_position']) if (rec[k] !== undefined && rec[k] !== null) p[k] = rec[k];
    }
    if (!p.sources.includes(source)) p.sources.push(source);
    p.updated_at = new Date(this.asOf).toISOString();
    // Re-index (ids/aliases may have changed)
    this.index.add(p);
    return { action: changes.length ? 'updated' : 'unchanged', cid: p.cid, changes };
  }

  toJSON() { return this.players; }
}
