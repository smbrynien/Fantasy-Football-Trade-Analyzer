// Manual-import pipeline (shared): parse → auto-map columns → coerce → normalize → validate.
// Identity resolution (unmatched-player report) happens on the server with the canonical player DB.

import { parseCSV, toNumber } from '../util/csv.js';
import { normalizePosition, positionalRankFromLabel } from '../util/positions.js';
import { normalizeTeam } from '../util/teams.js';
import { nameKey } from '../util/names.js';
import { parsePickLabel } from '../pick-labels.js';
import { CANONICAL_STATS } from '../scoring.js';

export function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[%#]/g, (m) => (m === '#' ? ' # ' : ' pct ')).replace(/[^a-z0-9#]+/g, ' ').trim();
}

/** Parse uploaded text as CSV or JSON into {headers, records, warnings, format}. */
/** Larger files are refused up front: no fantasy source has anywhere near this many players (BUG_AUDIT 2, I6). */
export const MAX_IMPORT_ROWS = 20000;

export function parseUpload(text, filename = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { headers: [], records: [], warnings: ['File is empty.'], format: 'empty' };
  // A UTF-16 file (Excel "Unicode text") read as UTF-8 has a NUL between characters: say so instead of reporting
  // unmapped columns (BUG_AUDIT 2, I8). The browser decodes UTF-16 itself (js/ui/views/data.js readImportFile).
  if ((trimmed.slice(0, 400).match(/\u0000/g) || []).length > 20) return { headers: [], records: [], warnings: ['The file looks UTF-16 encoded ("Unicode text"). Save it as "CSV UTF-8" and try again.'], format: 'csv', error: true };
  const tooMany = (n) => ({ headers: [], records: [], warnings: [`The file has ${n.toLocaleString()} rows; imports are limited to ${MAX_IMPORT_ROWS.toLocaleString()}. Split it or remove unneeded rows.`], format: 'csv', error: true });
  if (/\.json$/i.test(filename) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let data;
    try { data = JSON.parse(trimmed); } catch (e) {
      if (/\.json$/i.test(filename)) return { headers: [], records: [], warnings: [`Invalid JSON: ${e.message}`], format: 'json', error: true };
      data = null;
    }
    if (data !== null) {
      let arr = Array.isArray(data) ? data : Array.isArray(data.players) ? data.players : Array.isArray(data.data) ? data.data : null;
      if (!arr) return { headers: [], records: [], warnings: ['JSON must be an array of objects, or an object with a "players" array.'], format: 'json', error: true };
      arr = arr.filter((x) => x && typeof x === 'object');
      if (arr.length > MAX_IMPORT_ROWS) return { ...tooMany(arr.length), format: 'json' };
      const headers = [...new Set(arr.flatMap((o) => Object.keys(o)))];
      const records = arr.map((o) => Object.fromEntries(headers.map((h) => [h, o[h] === undefined || o[h] === null ? null : typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h])])));
      return { headers, records, warnings: [], format: 'json' };
    }
  }
  try {
    const lines = (trimmed.match(/\n/g) || []).length;
    if (lines > MAX_IMPORT_ROWS) return tooMany(lines);
    const r = parseCSV(trimmed);
    return { ...r, format: 'csv' };
  } catch (e) {
    return { headers: [], records: [], warnings: [e.message], format: 'csv', error: true };
  }
}

/**
 * Auto-map file headers to spec columns. Exact (normalized) alias match first, then whole-word containment.
 * Returns { mapping: {key: header}, unmapped: [header], missingRequired: [key], method: {key: 'exact'|'contains'} }
 */
export function autoMapColumns(headers, spec, commonAliases = {}) {
  const normHeaders = headers.map((h) => ({ h, n: normalizeHeader(h) }));
  const used = new Set();
  const mapping = {}, method = {};
  const aliasesFor = (col) => [...new Set([col.key, ...(col.aliases || []), ...(commonAliases[col.key] || [])].map(normalizeHeader))];
  // pass 1: exact
  for (const col of spec.columns) {
    const al = aliasesFor(col);
    const hit = normHeaders.find((x) => !used.has(x.h) && al.includes(x.n));
    if (hit) { mapping[col.key] = hit.h; used.add(hit.h); method[col.key] = 'exact'; }
  }
  // pass 2: containment (only for aliases of >= 3 chars, whole words)
  for (const col of spec.columns) {
    if (mapping[col.key]) continue;
    const al = aliasesFor(col).filter((a) => a.length >= 3);
    const hit = normHeaders.find((x) => !used.has(x.h) && al.some((a) => new RegExp(`(^| )${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(x.n)));
    if (hit) { mapping[col.key] = hit.h; used.add(hit.h); method[col.key] = 'contains'; }
  }
  const missingRequired = spec.columns.filter((c) => c.required && !mapping[c.key]).map((c) => c.key);
  const unmapped = headers.filter((h) => !used.has(h));
  return { mapping, unmapped, missingRequired, method };
}

/** Apply a mapping and coerce types. Returns { rows, errors:[{row, message}] } — rows keep their 1-based file row. */
export function applyMapping(records, mapping, spec) {
  const rows = [], errors = [];
  records.forEach((rec, i) => {
    const row = { _row: i + 2 };
    let bad = false;
    const badCols = new Set();
    for (const col of spec.columns) {
      const h = mapping[col.key];
      if (!h) continue;
      let v = rec[h];
      if (col.type === 'number') {
        const n = toNumber(v);
        if (v !== null && v !== undefined && v !== '' && n === null) { errors.push({ row: i + 2, message: `"${col.key}" is not a number: "${v}"` }); bad = true; badCols.add(col.key); }
        v = n;
      } else if (v !== null && v !== undefined) v = String(v).trim();
      row[col.key] = v;
    }
    for (const col of spec.columns) {
      if (col.required && !badCols.has(col.key) && (row[col.key] === null || row[col.key] === undefined || row[col.key] === '')) {
        errors.push({ row: i + 2, message: `Missing required "${col.key}"` });
        bad = true;
      }
    }
    if (!bad) rows.push(row);
  });
  return { rows, errors };
}

function ids(row) {
  const out = {};
  if (row.sleeper_id) out.sleeper = row.sleeper_id;
  if (row.fantasypros_id) out.fantasypros = row.fantasypros_id;
  if (row.ktc_id) out.ktc = row.ktc_id;
  if (row.espn_id) out.espn = row.espn_id;
  return out;
}

/**
 * Convert mapped rows into normalized records for the spec's record type.
 * options: spec format options chosen by the user (dynasty/qb/kind/scope/format/tep).
 * Returns { players: [...], picks: [...] }
 */
export function toNormalized(rows, spec, options = {}) {
  const players = [], picks = [];
  for (const r of rows) {
    const label = r.player_name || r.pick;
    const posRaw = r.position;
    const pos = normalizePosition(posRaw);
    const pickDesc = (pos === 'PICK' || spec.record_type === 'pick_market' || !pos) ? parsePickLabel(label) : null;
    if (pickDesc && (spec.record_type === 'market_value' || spec.record_type === 'pick_market')) {
      picks.push({ type: 'pick_market', label, ...pickDesc, value: r.value, qb: options.qb || '1qb', dynasty: true, _row: r._row });
      continue;
    }
    if (spec.record_type === 'pick_market') { players.push({ _invalid: true, _row: r._row, name: label, reason: 'Unrecognised pick label' }); continue; }
    const base = { type: spec.record_type, name: label, position: pos, team: r.team ? normalizeTeam(r.team) : undefined, age: r.age ?? undefined, ids: ids(r), source_player_id: r.ktc_id || r.fantasypros_id || r.sleeper_id || null, _row: r._row };
    if (spec.record_type === 'ranking') {
      const posRank = r.pos_rank !== undefined && r.pos_rank !== null ? (positionalRankFromLabel(r.pos_rank) ?? toNumber(r.pos_rank)) : positionalRankFromLabel(posRaw);
      players.push({ ...base, kind: options.kind || 'ros', qb: options.qb || '1qb', scope: options.scope || 'overall', pos: options.scope === 'position' ? pos : null, rank: r.rank, ecr: r.rank, pos_rank: posRank, best: r.best ?? null, worst: r.worst ?? null, sd: r.sd ?? null });
    } else if (spec.record_type === 'market_value') {
      players.push({ ...base, dynasty: options.dynasty !== false && options.dynasty !== 'false', qb: options.qb || '1qb', tep: Number(options.tep) || 0, value: r.value, rank: r.rank ?? null });
    } else if (spec.record_type === 'adp') {
      players.push({ ...base, format: options.format || 'redraft_ppr', adp: r.adp, pos_adp: r.pos_adp ?? null });
    } else if (spec.record_type === 'projection') {
      const stats = {};
      for (const k of CANONICAL_STATS) if (typeof r[k] === 'number') stats[k] = r[k];
      if ((pos === 'K' || pos === 'DEF' || !Object.keys(stats).length) && typeof r.fantasy_points === 'number') stats.fp_src = r.fantasy_points;
      players.push({ ...base, scope: options.scope || 'ros', games: r.games ?? null, stats });
    }
  }
  return { players, picks };
}

/** Validation: duplicates, missing data, suspicious ranges. */
export function validateRows(normalized, spec) {
  const issues = [];
  const seen = new Map();
  for (const p of normalized.players) {
    if (p._invalid) { issues.push({ level: 'error', row: p._row, message: `${p.name}: ${p.reason}` }); continue; }
    const k = `${nameKey(p.name)}|${p.position || ''}`;
    if (seen.has(k)) issues.push({ level: 'warning', row: p._row, message: `Duplicate player "${p.name}" (also row ${seen.get(k)}). Only the first row will be imported.`, duplicate: true });
    else seen.set(k, p._row);
    if (!p.position) issues.push({ level: 'warning', row: p._row, message: `"${p.name}" has no recognised position — matching will rely on name only.` });
    if (p.team === null) issues.push({ level: 'warning', row: p._row, message: `"${p.name}" has an unrecognised team abbreviation.` });
    if (typeof p.age === 'number' && (p.age < 19 || p.age > 45)) issues.push({ level: 'warning', row: p._row, message: `"${p.name}" has an implausible age ${p.age}.` });
    // Error-level problems make the row invalid, so it is counted as invalid and NOT committed. They used to be
    // reported but still imported: a rank of 0 or −3 then ranked as the best player in the list.
    let reason = null;
    if (spec.record_type === 'market_value' && !(p.value >= 0)) reason = 'negative or missing value';
    if ((spec.record_type === 'ranking' && !(p.rank > 0)) || (spec.record_type === 'adp' && !(p.adp > 0))) reason = 'invalid rank/ADP (must be > 0)';
    if (reason) {
      issues.push({ level: 'error', row: p._row, message: `"${p.name}": ${reason} — row skipped.` });
      p._invalid = true;
      p.reason = reason;
    }
  }
  if (spec.record_type === 'ranking') {
    const ranks = normalized.players.map((p) => p.rank).filter((r) => typeof r === 'number');
    const dup = ranks.length - new Set(ranks).size;
    if (dup > ranks.length * 0.2) issues.push({ level: 'warning', message: `${dup} duplicated rank values — is this the right rank column (and the right list scope)?` });
  }
  const counts = { rows: normalized.players.length + normalized.picks.length, players: normalized.players.filter((p) => !p._invalid).length, picks: normalized.picks.length };
  const missing = {};
  for (const col of spec.columns) {
    if (col.required) continue;
    const n = normalized.players.filter((p) => p[col.key] === null || p[col.key] === undefined).length;
    if (n) missing[col.key] = n;
  }
  return { issues, counts, missing };
}
