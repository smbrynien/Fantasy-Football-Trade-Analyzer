// Before/after comparison: values of the previous model version (frozen in reports/audit/values-v1.json, computed by
// snapshotValues on the same frozen dataset) vs the current model, for four reference leagues.
// Label: CURRENT DATA (frozen snapshot) — differences are model changes only, never data changes.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../server/lib/paths.js';
import { computeValuations } from '../../js/core/valuation/engine.js';
import { spearman, mean, median } from '../../js/core/util/stats.js';

export const SETS = [['redraft', 'preset_12_1qb_ppr'], ['redraft', 'preset_12_sf_ppr'], ['dynasty', 'preset_dyn_12_1qb'], ['dynasty', 'preset_dyn_12_sf']];
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** Snapshot of values (players ranked <= 400 and picks) for the four reference leagues. */
export function snapshotValues(ds, config) {
  const sets = {};
  for (const [mode, pid] of SETS) {
    const r = computeValuations({ dataset: ds, league: config.profiles.presets.find((p) => p.id === pid), mode, config });
    sets[`${mode}|${pid}`] = {
      model_version: r.meta.model_version, data_version: r.meta.data_version,
      assets: Object.fromEntries([...r.assets.values()]
        .filter((a) => a.value > 0 && (a.kind === 'pick' ? a.descriptor.slot === null || a.descriptor.slot <= 12 : a.rank <= 400))
        .map((a) => [a.id, { name: a.name, pos: a.position, team: a.team, age: a.age, value: Math.round(a.value), rank: a.rank, sigma: Math.round(a.sigma), conf: a.confidence?.label, comp: Object.fromEntries(Object.entries(a.components).map(([k, v]) => [k, Math.round(v)])) }])),
    };
  }
  return { data_version: ds.data_version, generated_at: new Date().toISOString(), sets };
}

export function compareSnapshots(before, after) {
  if (before.data_version !== after.data_version) throw new Error(`data_version mismatch: ${before.data_version} vs ${after.data_version} — compare on the same frozen dataset`);
  const out = { label: `CURRENT DATA (${after.data_version}, frozen) — model ${Object.values(before.sets)[0].model_version} → ${Object.values(after.sets)[0].model_version}`, sets: {} };
  const csv = [['set', 'id', 'name', 'pos', 'age', 'value_before', 'value_after', 'pct_change', 'rank_before', 'rank_after']];
  for (const key of Object.keys(after.sets)) {
    const A = before.sets[key]?.assets || {}, B = after.sets[key].assets;
    const ids = [...new Set([...Object.keys(A), ...Object.keys(B)])];
    const rows = ids.map((id) => {
      const a = A[id], b = B[id];
      const x = a || b;
      return { id, name: x.name, pos: x.pos, age: x.age === null || x.age === undefined ? null : r3(x.age), before: a?.value ?? 0, after: b?.value ?? 0, rankBefore: a?.rank ?? null, rankAfter: b?.rank ?? null, sigmaAfter: b?.sigma ?? null };
    });
    for (const r of rows) csv.push([key, r.id, r.name, r.pos ?? '', r.age ?? '', r.before, r.after, r.before ? r3(r.after / r.before - 1) : '', r.rankBefore ?? '', r.rankAfter ?? '']);
    const players = rows.filter((r) => !r.id.startsWith('pick:') && r.before > 0 && r.after > 0);
    const topBefore = rows.filter((r) => r.rankBefore && r.rankBefore <= 100 && !r.id.startsWith('pick:'));
    const topAfter = rows.filter((r) => r.rankAfter && r.rankAfter <= 100 && !r.id.startsWith('pick:'));
    const share = (list) => Object.fromEntries(['QB', 'RB', 'WR', 'TE'].map((p) => [p, list.filter((r) => r.pos === p).length]));
    const ageBand = (lo, hi) => { const z = players.filter((r) => r.age !== null && r.age >= lo && r.age < hi && r.rankBefore <= 200); return z.length ? { n: z.length, medianPctChange: r3(median(z.map((r) => r.after / r.before - 1))) } : null; };
    const movers = players.filter((r) => r.rankBefore <= 150 || r.rankAfter <= 150).map((r) => ({ ...r, pct: r3(r.after / r.before - 1) })).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    out.sets[key] = {
      spearmanValues: r3(spearman(players.map((r) => r.before), players.map((r) => r.after))),
      medianAbsPctChange: r3(median(players.map((r) => Math.abs(r.after / r.before - 1)))),
      top100ByPosition: { before: share(topBefore), after: share(topAfter) },
      top10: { before: rows.filter((r) => r.rankBefore && r.rankBefore <= 10).sort((a, b) => a.rankBefore - b.rankBefore).map((r) => `${r.name} ${r.before}`), after: rows.filter((r) => r.rankAfter && r.rankAfter <= 10).sort((a, b) => a.rankAfter - b.rankAfter).map((r) => `${r.name} ${r.after}`) },
      byAge: { 'under 23': ageBand(0, 23), '23-26': ageBand(23, 26), '26-29': ageBand(26, 29), '29+': ageBand(29, 99) },
      droppedToZero: rows.filter((r) => r.before >= 500 && r.after === 0 && !r.id.startsWith('pick:')).map((r) => `${r.name} (${r.pos}, ${r.age}) ${r.before}`),
      biggestRisers: movers.filter((r) => r.pct > 0).slice(0, 12).map((r) => `${r.name} ${r.before}→${r.after}`),
      biggestFallers: movers.filter((r) => r.pct < 0).slice(0, 12).map((r) => `${r.name} ${r.before}→${r.after}`),
      picks: rows.filter((r) => r.id.startsWith('pick:')).sort((a, b) => b.after - a.after).slice(0, 16).map((r) => `${r.name} ${r.before}→${r.after}`),
      meanValueTop50: { before: Math.round(mean(rows.filter((r) => r.rankBefore && r.rankBefore <= 50).map((r) => r.before))), after: Math.round(mean(rows.filter((r) => r.rankAfter && r.rankAfter <= 50).map((r) => r.after))) },
    };
  }
  return { summary: out, csv: csv.map((r) => r.map((c) => (typeof c === 'string' && /[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') };
}

export const DEFAULT_OUT = path.join(ROOT, 'reports', 'audit');
export const v1File = (outDir = DEFAULT_OUT) => path.join(outDir, 'values-v1.json');
export function loadV1(outDir) { const f = v1File(outDir); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }

/** Representative before/after sample with the component deltas that explain each change. */
export const SAMPLE = [
  ['QB', 'elite', 'Josh Allen'], ['QB', 'mediocre starter', 'Geno Smith'], ['QB', 'one-game backup', 'Jack Strand'],
  ['RB', 'elite young', 'Jahmyr Gibbs'], ['RB', 'aging elite', 'Christian McCaffrey'], ['RB', 'mediocre veteran', "D'Andre Swift"],
  ['WR', 'elite', 'Jaxon Smith-Njigba'], ['WR', 'aging', 'Davante Adams'], ['WR', 'mediocre', 'Tre Tucker'],
  ['TE', 'elite', 'Brock Bowers'], ['TE', 'young prospect', 'Colston Loveland'], ['TE', 'aging', 'Travis Kelce'],
  ['WR', 'injured (IR)', 'A.J. Brown'], ['RB', 'rookie (top)', 'Jeremiyah Love'], ['WR', 'rookie', 'Carnell Tate'], ['WR', 'rookie', 'Jordyn Tyson'],
  ['WR', 'out of league veteran', 'John Ross'], ['RB', 'out of league veteran', 'Ezekiel Elliott'],
  ['PICK', 'draft pick', '2027 1.01'], ['PICK', 'draft pick', '2027 1.06'], ['PICK', 'draft pick', '2027 1.12'], ['PICK', 'draft pick', '2027 2.01'], ['PICK', 'draft pick', '2028 1st'],
];
export function sampleTable(before, after) {
  const rows = [];
  for (const key of Object.keys(after.sets)) {
    const A = before.sets[key]?.assets || {}, B = after.sets[key].assets;
    for (const [pos, cat, name] of SAMPLE) {
      if (pos === 'PICK' && key.startsWith('redraft')) continue;
      const id = Object.keys({ ...A, ...B }).find((k) => (A[k] || B[k]).name === name);
      if (!id) continue;
      const a = A[id], b = B[id];
      const comps = [...new Set([...Object.keys(a?.comp || {}), ...Object.keys(b?.comp || {})])]
        .map((c) => [c, (b?.comp?.[c] ?? 0) - (a?.comp?.[c] ?? 0)]).filter(([, d]) => Math.abs(d) >= 1).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      rows.push({ set: key, category: cat, pos, name, before: a?.value ?? 0, after: b?.value ?? 0, diff: (b?.value ?? 0) - (a?.value ?? 0), rankBefore: a?.rank ?? null, rankAfter: b?.rank ?? null, componentDeltas: Object.fromEntries(comps.slice(0, 4)) });
    }
  }
  return rows;
}
