// Manual import service: preview (mapping, validation, identity report, overwrite impact) and commit.

import { P } from './lib/paths.js';
import { readJSON, writeJSON } from './lib/store.js';
import { parseUpload, autoMapColumns, applyMapping, toNormalized, validateRows } from '../js/core/import/mapper.js';
import { PlayerIndex } from '../js/core/identity.js';
import { assessBatch } from '../js/core/quality.js';
import { NORMALIZED_SCHEMA_VERSION } from '../js/core/version.js';
import { nameKey } from '../js/core/util/names.js';

/** Records from a previous import that a new import with these options replaces. */
function sameFormat(spec, rec, opts) {
  switch (spec.record_type) {
    case 'market_value': return rec.type !== 'pick_market' && Boolean(rec.dynasty) === (opts.dynasty !== false && opts.dynasty !== 'false') && (rec.qb || '1qb') === (opts.qb || '1qb');
    case 'ranking': return rec.kind === (opts.kind || 'ros') && (rec.qb || '1qb') === (opts.qb || '1qb') && (rec.scope || 'overall') === (opts.scope || 'overall');
    case 'adp': return rec.format === (opts.format || 'redraft_ppr');
    case 'projection': return rec.scope === (opts.scope || 'ros');
    case 'pick_market': return (rec.qb || '1qb') === (opts.qb || '1qb');
    default: return true;
  }
}

export async function previewImport(config, body) {
  const spec = config.importSpecs.specs.find((s) => s.id === body.spec_id);
  if (!spec) throw Object.assign(new Error(`Unknown import spec "${body.spec_id}"`), { status: 400 });
  const opts = { ...Object.fromEntries(Object.entries(spec.format_options || {}).map(([k, v]) => [k, v.default])), ...(body.options || {}) };
  const parsed = parseUpload(body.text, body.filename);
  if (parsed.error) return { ok: false, spec_id: spec.id, parse: { warnings: parsed.warnings, format: parsed.format }, fatal: parsed.warnings.join(' ') };
  const auto = autoMapColumns(parsed.headers, spec, config.importSpecs.common_aliases);
  const mapping = body.mapping && Object.keys(body.mapping).length ? body.mapping : auto.mapping;
  const missingRequired = spec.columns.filter((c) => c.required && !mapping[c.key]).map((c) => c.key);
  if (missingRequired.length) {
    return { ok: false, spec_id: spec.id, headers: parsed.headers, mapping, auto, missingRequired, parse: { warnings: parsed.warnings, format: parsed.format, rows: parsed.records.length }, fatal: `Required column(s) not mapped: ${missingRequired.join(', ')}` };
  }
  const { rows, errors } = applyMapping(parsed.records, mapping, spec);
  const normalized = toNormalized(rows, spec, opts);
  const validation = validateRows(normalized, spec);

  // Identity report
  const players = await readJSON(P.players, []);
  const overrides = await readJSON(P.playerOverrides, {});
  const index = new PlayerIndex(players, { overrides });
  const identity = { matched: 0, fuzzy: [], unmatched: [], ambiguous: [], ignored: 0 };
  const seen = new Set();
  const resolved = [];
  for (const r of normalized.players) {
    if (r._invalid) continue;
    const k = `${nameKey(r.name)}|${r.position || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const res = index.resolve(r, { source: spec.source_id });
    if (res.status === 'matched') {
      identity.matched++;
      if (res.method === 'fuzzy_name') identity.fuzzy.push({ row: r._row, name: r.name, matched: index.get(res.cid)?.name, team: index.get(res.cid)?.team });
      resolved.push({ ...r, _cid: res.cid });
    } else if (res.status === 'ignored') identity.ignored++;
    else if (res.status === 'unmatched') identity.unmatched.push({ row: r._row, name: r.name, position: r.position, team: r.team });
    else identity.ambiguous.push({ row: r._row, name: r.name, position: r.position, team: r.team, candidates: res.candidates.map((c) => ({ cid: c, name: index.get(c)?.name, team: index.get(c)?.team, position: index.get(c)?.position, birth_date: index.get(c)?.birth_date })) });
  }

  const existingEnv = await readJSON(P.normalizedFile(spec.source_id, spec.record_type), null);
  const existingPicks = await readJSON(P.normalizedFile(spec.source_id, 'pick_market'), null);
  const replaced = (existingEnv?.records || []).filter((r) => sameFormat(spec, r, opts)).length + (normalized.picks.length ? (existingPicks?.records || []).filter((r) => sameFormat({ record_type: 'pick_market' }, r, opts)).length : 0);
  const quality = assessBatch({ type: spec.record_type, records: normalized.players.filter((p) => !p._invalid) });

  return {
    ok: true, spec_id: spec.id, source_id: spec.source_id, options: opts,
    headers: parsed.headers, mapping, auto, missingRequired: [],
    parse: { warnings: parsed.warnings, format: parsed.format, rows: parsed.records.length },
    rowErrors: errors.slice(0, 200), rowErrorCount: errors.length,
    preview: [...normalized.players.slice(0, 15), ...normalized.picks.slice(0, 10)].map((r) => { const o = { ...r }; delete o.ids; return o; }),
    counts: validation.counts, issues: validation.issues.slice(0, 300), missing: validation.missing,
    identity, quality,
    existing: existingEnv ? { fetched_at: existingEnv.fetched_at, records: existingEnv.records.length, replaced } : null,
    _normalized: normalized,
  };
}

export async function commitImport(config, body, rebuildFn) {
  const pv = await previewImport(config, body);
  if (!pv.ok) throw Object.assign(new Error(pv.fatal || 'Import is not valid'), { status: 400, detail: pv });
  if (pv.existing && pv.existing.replaced > 0 && !body.confirmOverwrite) {
    throw Object.assign(new Error(`This import replaces ${pv.existing.replaced} existing records with the same format. Confirm to overwrite.`), { status: 409, detail: { existing: pv.existing } });
  }
  const spec = config.importSpecs.specs.find((s) => s.id === body.spec_id);
  const opts = pv.options;
  const now = new Date().toISOString();
  const seen = new Set();
  const players = pv._normalized.players.filter((r) => {
    if (r._invalid) return false;
    const k = `${nameKey(r.name)}|${r.position || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((r) => { const o = { ...r, as_of: now }; delete o._row; delete o.type; return o; });
  const writes = [];
  if (spec.record_type !== 'pick_market' && players.length) {
    const prev = await readJSON(P.normalizedFile(spec.source_id, spec.record_type), null);
    const kept = (prev?.records || []).filter((r) => !sameFormat(spec, r, opts));
    writes.push([spec.record_type, [...kept, ...players]]);
  }
  if (pv._normalized.picks.length) {
    const prev = await readJSON(P.normalizedFile(spec.source_id, 'pick_market'), null);
    const kept = (prev?.records || []).filter((r) => !sameFormat({ record_type: 'pick_market' }, r, opts));
    writes.push(['pick_market', [...kept, ...pv._normalized.picks.map((r) => { const o = { ...r, as_of: now }; delete o._row; delete o.type; return o; })]]);
  }
  for (const [type, records] of writes) {
    await writeJSON(P.normalizedFile(spec.source_id, type), {
      schema_version: NORMALIZED_SCHEMA_VERSION, source: spec.source_id, type, fetched_at: now, run: 'manual-import',
      meta: { spec: spec.id, options: opts, filename: body.filename || null }, quality: pv.quality, records,
    });
  }
  const status = await readJSON(P.sourceStatus, {});
  status[spec.source_id] = { ...(status[spec.source_id] || {}), last_attempt: now, last_success: now, status: 'ok', error: null, method: 'manual', records: Object.fromEntries(writes.map(([t, r]) => [t, r.length])) };
  await writeJSON(P.sourceStatus, status, { pretty: true });
  const build = await rebuildFn();
  return { ok: true, imported: { players: Math.max(0, players.length - pv.identity.unmatched.length - pv.identity.ambiguous.length), stored: players.length, picks: pv._normalized.picks.length }, unmatched: pv.identity.unmatched.length, ambiguous: pv.identity.ambiguous.length, data_version: build?.dataset?.data_version };
}

export async function clearManualSource(config, sourceId, rebuildFn) {
  const src = config.sources.sources.find((s) => s.id === sourceId);
  if (!src || src.adapter !== 'manual') throw Object.assign(new Error('Only manual sources can be cleared'), { status: 400 });
  const fs = await import('node:fs/promises');
  await fs.rm(P.normalized(sourceId), { recursive: true, force: true });
  const status = await readJSON(P.sourceStatus, {});
  delete status[sourceId];
  await writeJSON(P.sourceStatus, status, { pretty: true });
  await rebuildFn();
  return { ok: true };
}
