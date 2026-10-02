#!/usr/bin/env node
// Calibrates dynasty / rookie-pick model inputs from real historical data and writes config/calibration/*.json.
//
//   npm run calibrate            (downloads ~130 MB on first run; cached in scripts/.cache)
//
// Outputs (all derived statistics, safe to commit):
//   aging-curves.json      relative PPR PPG by age per position (delta method on log PPG, smoothed)
//   attrition.json         P(fewer than 4 games next season | fantasy-relevant this season) by position & age
//   availability.json      share of games played by fantasy-relevant players who remain active
//   draft-priors.json      expected PPR PPG by position × draft-capital bucket × career year (1-5)
//   year-over-year.json    coefficient of variation of next-season PPG
//   rookie-slot-curve.json realised 3-year surplus value by consensus rookie rank (FantasyPros rookie ECR, summer)

import path from 'node:path';
import { ROOT } from '../server/lib/paths.js';
import { writeJSON, readJSONSync } from '../server/lib/store.js';
import { loadSeasons, loadCSV, streamECRArchive, replacementBySeason } from './lib/history-data.js';
import { mean, sd, isotonicDecreasing, median } from '../js/core/util/stats.js';
import { toNumber } from '../js/core/util/csv.js';
import { draftBucket } from '../js/core/valuation/dynasty.js';

const OUT = path.join(ROOT, 'config', 'calibration');
const FROM = 2006, TO = 2025;
const POS = ['QB', 'RB', 'WR', 'TE'];
const RELEVANT_N = { QB: 32, RB: 60, WR: 84, TE: 32 };
const seasonGames = (y) => (y >= 2021 ? 17 : 16);
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const now = new Date().toISOString();

console.log(`Loading nflverse seasonal stats ${FROM}-${TO} …`);
const { seasons, meta } = await loadSeasons(FROM, TO);

// relevance: top-N by season points
const relevant = new Set();
const byYearPos = {};
for (const arr of seasons.values()) for (const r of arr) ((byYearPos[r.season] ||= {})[r.pos] ||= []).push(r);
for (const [y, pm] of Object.entries(byYearPos)) for (const [p, list] of Object.entries(pm)) {
  list.sort((a, b) => b.pts - a.pts).slice(0, RELEVANT_N[p]).forEach((r) => relevant.add(`${r.gsis}|${y}`));
}

// ---------- aging curves (delta method, symmetric selection) ----------
// Pairs of consecutive seasons with >=6 games in both. Selecting on year-1 performance would build regression to the
// mean into every age step, so pairs are kept when EITHER season reaches 5 PPG (symmetric selection). Mean absolute
// PPG change by age is integrated into a level curve anchored at the mean PPG of 24-28 year-olds, then scaled to peak=1.
const defaults = readJSONSync(path.join(ROOT, 'config', 'model.json')).dynasty.default_aging_curves;
const aging = {}, agingRaw = {};
for (const pos of POS) {
  const acc = {};
  const anchorVals = [];
  for (const arr of seasons.values()) {
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.pos === pos && a.age !== null && a.age >= 24 && a.age < 29 && a.games >= 6 && a.ppg >= 5) anchorVals.push(a.ppg);
      const b = arr[i + 1];
      if (!b || a.pos !== pos || b.pos !== pos || b.season !== a.season + 1 || a.age === null) continue;
      if (a.games < 6 || b.games < 6 || Math.max(a.ppg, b.ppg) < 5) continue;
      const age = Math.floor(a.age);
      const w = 2 / (1 / a.games + 1 / b.games);
      (acc[age] ||= { s: 0, w: 0, n: 0 });
      acc[age].s += w * (b.ppg - a.ppg); acc[age].w += w; acc[age].n++;
    }
  }
  const d = {};
  for (const a of Object.keys(acc).map(Number)) if (acc[a].n >= 15) d[a] = acc[a].s / acc[a].w;
  const sm = {};
  for (const a of Object.keys(d).map(Number)) sm[a] = mean([d[a - 1], d[a], d[a + 1]].filter((v) => v !== undefined));
  agingRaw[pos] = Object.fromEntries(Object.entries(acc).map(([a, v]) => [a, { n: v.n, mean_ppg_change: r3(v.s / v.w) }]));
  const validAges = Object.keys(sm).map(Number).sort((x, y) => x - y);
  const lo = validAges[0], hi = validAges[validAges.length - 1];
  const lvl = {};
  lvl[lo] = 0;
  for (let a = lo; a <= hi; a++) lvl[a + 1] = lvl[a] + (sm[a] ?? 0);
  const anchorAges = [24, 25, 26, 27, 28].filter((a) => lvl[a] !== undefined);
  const shift = mean(anchorVals) - mean(anchorAges.map((a) => lvl[a]));
  const level = {};
  for (const [a, v] of Object.entries(lvl)) level[a] = Math.max(0.5, v + shift);
  const defPts = Object.entries(defaults[pos]).map(([k, v]) => [Number(k), v]).sort((x, y) => x[0] - y[0]);
  const defAt = (age) => { let best = defPts[0]; for (const p of defPts) if (Math.abs(p[0] - age) < Math.abs(best[0] - age)) best = p; return best[1]; };
  for (let a = lo - 1; a >= 20; a--) level[a] = level[a + 1] * (defAt(a) / defAt(a + 1));
  for (let a = hi + 2; a <= 42; a++) level[a] = level[a - 1] * (defAt(a) / Math.max(1e-6, defAt(a - 1)));
  const peak = Math.max(...Object.values(level));
  // Shrink toward the default curve where the sample is thin: w = n / (n + 80) using the pairs observed at that age
  // (and the age before, since level(a) depends on the step from a-1).
  const out = {};
  for (const [a, v] of Object.entries(level)) {
    const n = Math.min(acc[a]?.n ?? 0, acc[a - 1]?.n ?? 0);
    const w = n / (n + 80);
    out[a] = w * (v / peak) + (1 - w) * defAt(Number(a));
  }
  const peak2 = Math.max(...Object.values(out));
  aging[pos] = Object.fromEntries(Object.entries(out).sort((x, y) => x[0] - y[0]).map(([a, v]) => [a, r3(v / peak2)]));
}

// ---------- attrition & availability ----------
const hazard = {}, hazardRaw = {}, avail = {};
for (const pos of POS) {
  const acc = {}, availVals = [];
  for (const arr of seasons.values()) {
    const bySeason = new Map(arr.map((r) => [r.season, r]));
    for (const r of arr) {
      if (r.pos !== pos || r.season >= TO || r.age === null || !relevant.has(`${r.gsis}|${r.season}`)) continue;
      const nx = bySeason.get(r.season + 1);
      const exit = !nx || nx.games < 4;
      const age = Math.floor(r.age);
      (acc[age] ||= { exits: 0, n: 0 }); acc[age].n++; if (exit) acc[age].exits++;
      if (nx && nx.games >= 4) availVals.push(Math.min(1, nx.games / seasonGames(r.season + 1)));
    }
  }
  hazardRaw[pos] = acc;
  const ages = Object.keys(acc).map(Number).sort((a, b) => a - b);
  hazard[pos] = {};
  for (let a = 21; a <= 40; a++) {
    // pool ±1 year (±2 when sparse) for stability
    let ex = 0, n = 0;
    for (const span of [1, 2]) {
      ex = 0; n = 0;
      for (let b = a - span; b <= a + span; b++) if (acc[b]) { ex += acc[b].exits; n += acc[b].n; }
      if (n >= 30) break;
    }
    if (n >= 15) hazard[pos][a] = r3(ex / n);
  }
  // enforce non-decreasing after the minimum (older players do not get less likely to exit)
  const hs = Object.keys(hazard[pos]).map(Number).sort((a, b) => a - b);
  let minAge = hs[0];
  for (const a of hs) if (hazard[pos][a] < hazard[pos][minAge]) minAge = a;
  for (let i = 1; i < hs.length; i++) if (hs[i] > minAge && hazard[pos][hs[i]] < hazard[pos][hs[i - 1]]) hazard[pos][hs[i]] = hazard[pos][hs[i - 1]];
  const last = hs[hs.length - 1];
  for (let a = last + 1; a <= 42; a++) hazard[pos][a] = r3(Math.min(0.9, hazard[pos][a - 1] + 0.06));
  avail[pos] = r3(mean(availVals));
  void ages;
}
avail.K = 0.95; avail.DEF = 1.0;

// ---------- year-over-year volatility ----------
const yoy = {};
for (const pos of POS) {
  const changes = [], base = [];
  for (const arr of seasons.values()) for (let i = 0; i + 1 < arr.length; i++) {
    const a = arr[i], b = arr[i + 1];
    if (a.pos !== pos || b.pos !== pos || b.season !== a.season + 1 || a.games < 8 || b.games < 8 || a.ppg < 8) continue;
    changes.push(b.ppg - a.ppg); base.push(a.ppg);
  }
  yoy[pos] = r3(sd(changes) / mean(base));
}

// ---------- draft-capital priors ----------
const priors = {}, priorDetail = {};
for (const pos of POS) {
  priors[pos] = {}; priorDetail[pos] = {};
  const groups = {};
  for (const [gsis, m] of meta) {
    if (m.position !== pos && !(pos === 'RB' && m.position === 'FB')) continue;
    const dy = toNumber(m.draft_year) ?? toNumber(m.rookie_season);
    if (!dy || dy < FROM || dy > TO - 1) continue;
    const bucket = draftBucket({ round: toNumber(m.draft_round), pick: toNumber(m.draft_pick) });
    (groups[bucket] ||= []).push({ gsis, dy });
  }
  for (const [bucket, list] of Object.entries(groups)) {
    const arr = [], det = [];
    for (let k = 1; k <= 5; k++) {
      const vals = [];
      let n = 0;
      for (const { gsis, dy } of list) {
        const y = dy + k - 1;
        if (y > TO) continue;
        n++;
        const row = (seasons.get(gsis) || []).find((r) => r.season === y);
        if (row && row.games >= 4) vals.push(row.ppg);
      }
      const pPlay = n ? vals.length / n : 0;
      const cond = vals.length >= 5 ? mean(vals) : null;
      const prior = cond === null ? null : cond * Math.min(1, pPlay / (avail[pos] || 0.85));
      arr.push(r3(prior));
      det.push({ k, n, played: vals.length, p_play: r3(pPlay), cond_mean_ppg: r3(cond), median_ppg: r3(vals.length ? median(vals) : null) });
    }
    // Fill career years with too few observations from the neighbouring draft bucket / previous year.
    for (let i = 0; i < arr.length; i++) if (arr[i] === null) arr[i] = i > 0 ? arr[i - 1] : null;
    priors[pos][bucket] = arr;
    priorDetail[pos][bucket] = det;
  }
}

// ---------- rookie slot curve from FantasyPros rookie ECR (summer of the draft year) ----------
console.log('Streaming FantasyPros ECR archive for rookie rankings …');
const ids = await loadCSV('db_playerids.csv', 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv');
const fpToGsis = new Map(ids.filter((r) => r.fantasypros_id && r.gsis_id).map((r) => [r.fantasypros_id, { gsis: r.gsis_id, dy: toNumber(r.draft_year) }]));
const rookieRows = await streamECRArchive((o) => /rookies/.test(o.fp_page || '') && o.scrape_date && /^(2020|2021|2022|2023)-0[6-8]/.test(o.scrape_date));
const repl = replacementBySeason(seasons);
const classes = {};
for (const year of [2020, 2021, 2022, 2023]) {
  const rows = rookieRows.filter((r) => r.scrape_date.startsWith(String(year)));
  if (!rows.length) continue;
  const lastDate = rows.map((r) => r.scrape_date).sort().pop();
  const list = rows.filter((r) => r.scrape_date === lastDate)
    .map((r) => ({ name: r.player, pos: r.pos, ecr: toNumber(r.ecr), m: fpToGsis.get(r.id) }))
    .filter((r) => r.ecr !== null && POS.includes(r.pos) && r.m && (!r.m.dy || r.m.dy === year))
    .sort((a, b) => a.ecr - b.ecr);
  classes[year] = list.map((r, i) => {
    let value = 0, top24 = false;
    for (let k = 0; k < 3; k++) {
      const y = year + k;
      const row = (seasons.get(r.m.gsis) || []).find((x) => x.season === y);
      if (!row) continue;
      value += Math.pow(0.82, k) * Math.max(0, row.pts - (repl[y]?.[r.pos] ?? 0));
      const posList = byYearPos[y]?.[r.pos] || [];
      const t24 = posList[Math.min(23, posList.length - 1)]?.pts ?? Infinity;
      if (row.pts >= t24) top24 = true;
    }
    return { p: i + 1, name: r.name, pos: r.pos, ecr: r.ecr, value: r3(value), top24 };
  });
}
const maxP = Math.min(72, Math.min(...Object.values(classes).map((c) => c.length)));
const byP = Array.from({ length: maxP }, (_, i) => mean(Object.values(classes).map((c) => c[i]?.value).filter((v) => v !== undefined && v !== null)));
// Smooth with a centred window that widens with p (later slots are noisier), then enforce monotonicity.
const smooth = byP.map((_, i) => {
  const h = Math.max(1, Math.round((i + 1) * 0.25));
  return mean(byP.slice(Math.max(0, i - h), Math.min(byP.length, i + h + 1)));
});
const iso = isotonicDecreasing(smooth);
const top12 = mean(iso.slice(0, 12));
const shape = iso.map((v) => r3(Math.max(v / top12, 0.002)));
const bucketsP = [[1, 3], [4, 6], [7, 12], [13, 24], [25, 36], [37, 72]];
const all = Object.values(classes).flat();
const hitRates = bucketsP.map(([a, b]) => {
  const xs = all.filter((r) => r.p >= a && r.p <= b);
  const vals = xs.map((r) => r.value);
  return { picks: `${a}-${b}`, n: xs.length, top24_rate: r3(xs.filter((r) => r.top24).length / Math.max(1, xs.length)), mean_value: r3(mean(vals)), outcome_cv: r3(mean(vals) ? sd(vals) / mean(vals) : null) };
});

const sample = { seasons: `${FROM}-${TO}`, players: seasons.size };
await writeJSON(path.join(OUT, 'aging-curves.json'), { generated_at: now, method: 'Delta method on PPR PPG: consecutive seasons with >=6 games, kept when either season >=5 PPG (symmetric selection avoids building regression-to-the-mean into the curve), weighted by harmonic-mean games, 3-pt smoothed, anchored at mean PPG of ages 24-28; ages without >=15 pairs follow the shape of the default curve, and every age is shrunk toward the default curve with weight n/(n+80) (n = pairs observed). Survivorship bias (decliners leave the sample) is partly offset by attrition.json.', sample, curves: aging, raw: agingRaw }, { pretty: true });
await writeJSON(path.join(OUT, 'attrition.json'), { generated_at: now, method: 'P(next season < 4 games or absent | top-N positional finish this season: QB32/RB60/WR84/TE32), pooled +-1 age (+-2 when sparse), non-decreasing after the minimum.', sample, hazard, raw: hazardRaw }, { pretty: true });
await writeJSON(path.join(OUT, 'availability.json'), { generated_at: now, method: 'Mean share of games played next season by fantasy-relevant players who played >=4 games.', sample, by_position: avail }, { pretty: true });
await writeJSON(path.join(OUT, 'year-over-year.json'), { generated_at: now, method: 'SD of next-season PPG change / mean PPG, players with >=8 games and >=8 PPG.', sample, cv: yoy }, { pretty: true });
await writeJSON(path.join(OUT, 'draft-priors.json'), { generated_at: now, method: 'Mean PPR PPG of players with >=4 games in career year k, scaled by min(1, P(>=4 games)/position availability). Buckets: R1a picks 1-16, R1b 17-32, R2, R3, R4-5, R6-7, UDFA.', sample, priors, detail: priorDetail }, { pretty: true });
await writeJSON(path.join(OUT, 'rookie-slot-curve.json'), { generated_at: now, method: 'FantasyPros rookie ECR (last summer scrape, Jun-Aug of the draft year) for the 2020-2023 classes; value = discounted (0.82) 3-season PPR surplus over 12-team replacement (QB12/RB30/WR42/TE12). Mean by class rank, smoothed, isotonic; shape normalised so mean of ranks 1-12 = 1.', classes: Object.fromEntries(Object.entries(classes).map(([y, c]) => [y, c.length])), shape, raw_mean_by_rank: byP.map(r3), hit_rates: hitRates, examples: Object.fromEntries(Object.entries(classes).map(([y, c]) => [y, c.slice(0, 15)])) }, { pretty: true });

console.log('\nAging (peak=1):'); for (const p of POS) console.log(' ', p, Object.entries(aging[p]).filter(([a]) => a % 2 === 0 && a >= 22 && a <= 36).map(([a, v]) => `${a}:${v}`).join(' '));
console.log('Attrition:'); for (const p of POS) console.log(' ', p, Object.entries(hazard[p]).filter(([a]) => a % 2 === 0).map(([a, v]) => `${a}:${v}`).join(' '));
console.log('Availability:', JSON.stringify(avail));
console.log('YoY cv:', JSON.stringify(yoy));
console.log('Draft priors (yr1..5):'); for (const p of POS) console.log(' ', p, Object.entries(priors[p]).map(([b, a]) => `${b}=[${a.map((x) => (x === null ? '-' : x.toFixed(1))).join(',')}]`).join(' '));
console.log('Rookie slot shape (p1..24):', shape.slice(0, 24).join(' '));
console.log('Hit rates:', JSON.stringify(hitRates));
console.log(`\nWrote ${OUT}`);
