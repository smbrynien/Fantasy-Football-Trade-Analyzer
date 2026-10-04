// E19 — DOES COMPOUNDING A ONE-YEAR EXIT HAZARD DESCRIBE HOW LONG PLAYERS STAY ACTIVE? (REAL HISTORICAL DATA)
//
// The dynasty model multiplies year-t surplus by S_t = Π (1 − h(age)), h = P(fewer than 4 games next season |
// fantasy-relevant this season) (config/calibration/attrition.json). Compounding treats every <4-game season as a
// permanent exit (an injured season never comes back) and applies the hazard of RELEVANT players to survivors who
// may no longer be relevant. Observed: P(≥ 4 games in season t+k | relevant in season t, age a) for k = 1..4, by
// position and age band, against the compounded model (both from nflverse 2006–2025, the calibration data).

import { mean } from '../../js/core/util/stats.js';
import { readJSONSync } from '../../server/lib/store.js';
import path from 'node:path';
import { ROOT } from '../../server/lib/paths.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TOPN = { QB: 32, RB: 60, WR: 84, TE: 32 };
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

export function attritionCheck(hist, { from = 2006, to = 2025, maxK = 4 } = {}) {
  const hz = readJSONSync(path.join(ROOT, 'config', 'calibration', 'attrition.json')).hazard;
  const h = (pos, age) => { const t = hz[pos]; const a = Math.min(42, Math.max(21, Math.floor(age))); return t[a] ?? 0.1; };
  // relevant = top-N positional finish by PPR points that season
  const bySeasonPos = new Map();
  for (const arr of hist.seasons.values()) for (const r of arr) { const k = `${r.season}|${r.pos}`; (bySeasonPos.get(k) || bySeasonPos.set(k, []).get(k)).push(r); }
  const relevant = new Set();
  for (const [k, rows] of bySeasonPos) { const pos = k.split('|')[1]; rows.sort((a, b) => b.pts - a.pts).slice(0, TOPN[pos]).forEach((r) => relevant.add(`${r.gsis}|${r.season}`)); }
  const bands = [[21, 23], [24, 26], [27, 29], [30, 32], [33, 40]];
  const cells = {};
  for (const arr of hist.seasons.values()) {
    const by = new Map(arr.map((r) => [r.season, r]));
    for (const r of arr) {
      if (r.age === null || r.season < from || !relevant.has(`${r.gsis}|${r.season}`)) continue;
      const band = bands.find(([a, b]) => r.age >= a && r.age < b + 1);
      if (!band) continue;
      for (let k = 1; k <= maxK; k++) {
        if (r.season + k > to) break;
        const nx = by.get(r.season + k);
        let model = 1;
        for (let j = 0; j < k; j++) model *= 1 - h(r.pos, r.age + j);
        const c = ((cells[r.pos] ||= {})[`${band[0]}-${band[1]}`] ||= {})[k] ||= { n: 0, active: 0, model: 0, returned: 0, gap: 0 };
        c.n++; c.model += model;
        if (nx && nx.games >= 4) c.active++;
        // returned: active in t+k although some season in between had < 4 games (a "permanent" exit that wasn't)
        if (nx && nx.games >= 4 && k > 1) { let gap = false; for (let j = 1; j < k; j++) { const m = by.get(r.season + j); if (!m || m.games < 4) gap = true; } if (gap) c.returned++; }
      }
    }
  }
  const table = {};
  for (const pos of POS) for (const [band, ks] of Object.entries(cells[pos] || {})) for (const [k, c] of Object.entries(ks)) {
    ((table[pos] ||= {})[band] ||= {})[k] = { n: c.n, observed: r3(c.active / c.n), compounded: r3(c.model / c.n), returnedAfterGap: r3(c.returned / c.n) };
  }
  // Summary: mean observed − compounded at k = 2..4 by position (positive = the model under-states survival).
  const summary = {};
  for (const pos of POS) {
    summary[pos] = {};
    for (const k of [1, 2, 3, 4]) {
      const xs = Object.values(table[pos] || {}).map((b) => b[k]).filter(Boolean);
      const n = xs.reduce((a, x) => a + x.n, 0);
      summary[pos][`k${k}`] = { n, observed: r3(xs.reduce((a, x) => a + x.observed * x.n, 0) / n), compounded: r3(xs.reduce((a, x) => a + x.compounded * x.n, 0) / n) };
    }
  }
  return { experiment: 'E19 dynasty survival: compounded one-year exit hazard vs observed share active k seasons later', label: 'REAL HISTORICAL DATA (nflverse 2006–2025)', summary, table, mean: r3(mean([])) };
}
