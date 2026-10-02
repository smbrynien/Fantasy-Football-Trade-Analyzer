// Data-quality gate. Every normalized batch passes through here before it can be used.
// Verdicts: 'ok' | 'warning' (usable, flagged) | 'quarantine' (NOT used; previous good data retained).

import { isValidTeam } from './util/teams.js';
import { FANTASY_POSITIONS, IDP_POSITIONS } from './util/positions.js';
import { nameKey } from './util/names.js';

const VALID_POS = new Set([...FANTASY_POSITIONS, ...IDP_POSITIONS, 'PICK']);

/** Schema drift check: which expected raw fields are missing / which new ones appeared. */
export function schemaCheck(expected, received) {
  const rec = new Set(received || []);
  const missing = (expected.required || []).filter((f) => !rec.has(f));
  const missingOptional = (expected.optional || []).filter((f) => !rec.has(f));
  return { missing, missingOptional, received: [...rec].slice(0, 60) };
}

const DEDUPE_EXEMPT = ['stat_week', 'stat_season', 'projection', 'pick_market', 'schedule', 'state'];
const dupKey = (r) => `${r.source_player_id ?? nameKey(r.name)}|${r.position}|${r.format || r.kind || ''}|${r.qb || ''}|${r.scope || ''}|${r.pos || ''}|${r.dynasty ?? ''}|${r.ppr ?? ''}|${r.teams ?? ''}`;
const finitePos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Upper plausibility bound for a market batch: values > 20× the batch's 95th percentile are corrupt (scale-free). */
function marketCeiling(records) {
  const vs = records.map((r) => r.value).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  return vs.length >= 20 ? vs[Math.floor(0.95 * (vs.length - 1))] * 20 : Infinity;
}

/** One rule for "invalid record", shared by the quality verdict and by cleanBatch (what is actually stored). */
export function isInvalidRecord(type, r, ctx = {}) {
  if (r.position !== undefined && r.position !== null && !VALID_POS.has(r.position)) return true;
  if (type === 'market_value') return !(typeof r.value === 'number' && Number.isFinite(r.value) && r.value >= 0 && r.value <= (ctx.ceiling ?? Infinity));
  if (type === 'ranking') return !finitePos(r.ecr ?? r.rank);
  if (type === 'adp') return !finitePos(r.adp);
  if (type === 'projection') return !r.stats || typeof r.stats !== 'object';
  return false;
}

/**
 * What gets stored: invalid records and same-batch duplicates (same player + list variant; the first is kept) are
 * removed. The quality message said invalid records "were skipped", but they used to be stored — so NaN/text values,
 * negative values and absurd outliers (1e300 ranked a player first in a market list) reached the dataset.
 */
export function cleanBatch(type, records) {
  const ctx = type === 'market_value' ? { ceiling: marketCeiling(records) } : {};
  const seen = new Set();
  let invalid = 0, duplicates = 0;
  const kept = [];
  for (const r of records || []) {
    if (isInvalidRecord(type, r, ctx)) { invalid++; continue; }
    if (!DEDUPE_EXEMPT.includes(type)) {
      const k = dupKey(r);
      if (seen.has(k)) { duplicates++; continue; }
      seen.add(k);
    }
    kept.push(r);
  }
  return { records: kept, dropped: { invalid, duplicates } };
}

/**
 * @param batch { type, records:[normalized], schema?: {expected, received}, minRecords? }
 * @param prev  previous normalized records of the same source+type (for change detection), optional
 */
export function assessBatch(batch, prev = null, { maxInvalidShare = 0.25, extremeChangePct = 0.45 } = {}) {
  const issues = [];
  const recs = batch.records || [];
  let invalid = 0;
  const dupKeys = new Map();
  const badTeams = [], badAges = [];
  const add = (level, code, message, extra) => issues.push({ level, code, message, ...(extra || {}) });

  if (!recs.length) {
    // An empty response is not a "format change" (that message misled): say what happened.
    add('error', 'no_records', 'The source returned no records.');
  } else if (batch.schema) {
    const sc = schemaCheck(batch.schema.expected, batch.schema.received);
    if (sc.missing.length) {
      add('error', 'schema_changed', `Source format changed. Expected fields missing: ${sc.missing.join(', ')}.`, { expected: batch.schema.expected.required, received: sc.received });
    } else if (sc.missingOptional.length) {
      add('warning', 'schema_optional_missing', `Optional fields missing: ${sc.missingOptional.join(', ')}.`);
    }
  }
  if (batch.minRecords && recs.length < batch.minRecords) {
    add('error', 'too_few_records', `Only ${recs.length} records (expected at least ${batch.minRecords}).`);
  }

  const ctx = batch.type === 'market_value' ? { ceiling: marketCeiling(recs) } : {};
  for (const r of recs) {
    const bad = isInvalidRecord(batch.type, r, ctx);
    if (r.team !== undefined && r.team !== null && !isValidTeam(r.team)) badTeams.push(`${r.name} (${r.team})`);
    if (typeof r.age === 'number' && (r.age < 19 || r.age > 46)) badAges.push(`${r.name} (${r.age})`);
    if (r.birth_date) {
      const y = Number(String(r.birth_date).slice(0, 4));
      if (!(y > 1970 && y < 2012)) badAges.push(`${r.name} (born ${r.birth_date})`);
    }
    if (bad) invalid++;
    if (!DEDUPE_EXEMPT.includes(batch.type)) {
      const k = dupKey(r);
      dupKeys.set(k, (dupKeys.get(k) || 0) + 1);
    }
  }
  if (badTeams.length) add('warning', 'invalid_team', `${badTeams.length} records with unrecognised teams: ${badTeams.slice(0, 6).join(', ')}${badTeams.length > 6 ? ' …' : ''}`);
  if (badAges.length) add('warning', 'impossible_age', `${badAges.length} records with implausible age/birth date: ${badAges.slice(0, 6).join(', ')}${badAges.length > 6 ? ' …' : ''}`);
  const dups = [...dupKeys.values()].filter((n) => n > 1).length;
  if (dups) add('warning', 'duplicate_records', `${dups} duplicated player records in this batch (only the first of each is kept).`);
  if (recs.length && invalid / recs.length > maxInvalidShare) add('error', 'invalid_records', `${invalid} of ${recs.length} records are invalid (bad position/value/rank).`);
  else if (invalid) add('warning', 'invalid_records', `${invalid} invalid records were skipped.`);

  if (batch.type === 'ranking') {
    const byList = new Map();
    for (const r of recs) {
      const k = `${r.kind}|${r.scope}|${r.qb}|${r.pos || ''}`;
      if (!byList.has(k)) byList.set(k, []);
      byList.get(k).push(r.rank);
    }
    for (const [k, ranks] of byList) {
      const valid = ranks.filter((x) => typeof x === 'number');
      const d = valid.length - new Set(valid).size;
      if (valid.length > 20 && d > valid.length * 0.2) add('warning', 'duplicated_ranks', `List ${k}: ${d} duplicated rank values.`);
    }
  }

  // Change detection vs previous good batch
  if (prev && prev.length && recs.length) {
    if (recs.length < prev.length * 0.6) add('warning', 'record_count_drop', `Record count dropped from ${prev.length} to ${recs.length}.`);
    if (batch.type === 'market_value') {
      const pm = new Map(prev.map((r) => [`${r.source_player_id ?? nameKey(r.name)}|${r.dynasty}|${r.qb}|${r.ppr}|${r.teams}`, r.value]));
      const extreme = [];
      const top = [...recs].sort((a, b) => b.value - a.value).slice(0, 200);
      for (const r of top) {
        const old = pm.get(`${r.source_player_id ?? nameKey(r.name)}|${r.dynasty}|${r.qb}|${r.ppr}|${r.teams}`);
        if (old > 0 && Math.abs(r.value - old) / old > extremeChangePct) extreme.push(`${r.name} ${Math.round(old)}→${Math.round(r.value)}`);
      }
      if (extreme.length > 20) add('error', 'mass_value_change', `${extreme.length} top players changed value by more than ${extremeChangePct * 100}% — possible scale/format change.`, { examples: extreme.slice(0, 10) });
      else if (extreme.length) add('warning', 'extreme_value_change', `Sudden value changes: ${extreme.slice(0, 8).join('; ')}${extreme.length > 8 ? ' …' : ''}`, { examples: extreme });
    }
  }

  const hasError = issues.some((i) => i.level === 'error');
  const verdict = hasError ? 'quarantine' : issues.some((i) => i.level === 'warning') ? 'warning' : 'ok';
  return { verdict, issues, counts: { records: recs.length, invalid } };
}
