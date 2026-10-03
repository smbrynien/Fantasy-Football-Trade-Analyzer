// E9 — SIGNAL WEIGHTS FROM HISTORICAL ARCHIVES (REAL HISTORICAL DATA, walk-forward).
//
// The redraft blend weights for projections and ADP were judgment because no free archive was known (2.0.0 / 2.2.0
// audits). Leak-free archives exist for two of the four groups (scripts/lib/signal-history.js): Sleeper (Rotowire)
// weekly projections frozen before each week, and preseason ADP (Sleeper 2020+, FantasyFootballCalculator 2019+).
// Trade-market values still have no history (the app's daily signal archive starts collecting them).
//
// Preseason: consensus = preseason ECR (as E1); projection = week-1 projection per game; ADP = mean of the available
// ADP sources. Target = season PPR points (and points per game played). In season (checkpoints after weeks 4–12, as
// E2): consensus = ROS ECR scraped during week W; projection = the week-(W+1) projection per game × remaining team
// games (the closest leak-free stand-in for a rest-of-season projection); production = the app's production rate.
// Target = rest-of-season points. Each signal is mapped to points with a curve (ranks) or line (points) fitted on
// earlier seasons only; blends are weighted means of those predictions; weights are fitted on earlier seasons
// (grid over the simplex, step 0.1) and compared with the app's weights renormalised over the testable groups.

import { snapshotBefore } from './benchmark.js';
import { windowPoints, fitRankCurve, metrics, fitLinear, played, OPP_RATE, weekPts } from './backtests.js';
import { sleeperToGsis, sleeperWeekProjection, sleeperADP, ffcADP } from '../lib/signal-history.js';
import { mean } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TOPN = { QB: 32, RB: 60, WR: 72, TE: 32 };
const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const CHECKPOINTS = [4, 6, 8, 10, 12];
const lastWeek = (y) => (y >= 2021 ? 18 : 17);
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** Positional rank of every player in a signal map (gsis → number), lower-is-better or higher-is-better. */
function ranksOf(map, meta, { higherIsBetter = false } = {}) {
  const out = new Map();
  for (const pos of POS) {
    [...map].filter(([g]) => meta[g]?.pos === pos).sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1])).forEach(([g], i) => out.set(g, i + 1));
  }
  return out;
}

/** All weight vectors on the simplex with step 0.1 for `k` groups. */
function simplex(k) {
  const out = [];
  const rec = (left, acc) => { if (acc.length === k - 1) { out.push([...acc, Math.round(left * 10) / 10]); return; } for (let w = 0; w <= left + 1e-9; w += 0.1) rec(Math.round((left - w) * 10) / 10, [...acc, Math.round(w * 10) / 10]); };
  rec(1, []);
  return out;
}

function blend(row, groups, w) {
  let s = 0, ws = 0;
  groups.forEach((g, i) => { if (Number.isFinite(row[g]) && w[i] > 0) { s += w[i] * row[g]; ws += w[i]; } });
  return ws > 0 ? s / ws : null;
}

function fitWeights(train, groups) {
  const full = train.filter((r) => groups.every((g) => Number.isFinite(r[g])));
  let best = null;
  for (const w of simplex(groups.length)) {
    const e = mean(full.map((r) => Math.abs(blend(r, groups, w) - r.target)));
    if (!best || e < best.e) best = { w, e };
  }
  return best.w;
}

// ------------------------------------------------------------------------------------------------ preseason
export async function preseasonRows(bench, s2g) {
  const data = {};
  for (const y of SEASONS) {
    const first = bench.schedule[y]?.weeks[1]?.first;
    const snap = first && snapshotBefore(bench, 'redraft', first, 30);
    if (!snap) continue;
    const ecr = new Map();
    for (const pos of POS) snap.rows.filter((r) => r.pos === pos && r.ecr !== null).sort((a, b) => a.ecr - b.ecr).forEach((r, i) => { if (!ecr.has(r.g)) ecr.set(r.g, i + 1); });
    const proj = await sleeperWeekProjection(y, 1, s2g);
    const projMap = new Map([...proj].filter(([g, p]) => bench.meta[g]?.pos === p.pos).map(([g, p]) => [g, p.pts]));
    const adpS = await sleeperADP(y, s2g), { adp: adpF, window } = await ffcADP(y, bench.meta);
    const rk = { proj: ranksOf(projMap, bench.meta, { higherIsBetter: true }), adpS: ranksOf(adpS, bench.meta), adpF: ranksOf(adpF, bench.meta) };
    const rows = [];
    for (const [g, rank] of ecr) {
      const pos = bench.meta[g]?.pos;
      if (!POS.includes(pos) || rank > TOPN[pos]) continue;
      const cur = windowPoints(bench, g, y, 1, lastWeek(y));
      rows.push({ g, pos, rank, target: cur.pts, gp: cur.gp, ppg: cur.gp ? cur.pts / cur.gp : null, projPts: projMap.get(g) ?? null, rProj: rk.proj.get(g) ?? null, rAdpS: rk.adpS.get(g) ?? null, rAdpF: rk.adpF.get(g) ?? null });
    }
    data[y] = { date: snap.date, ffcWindow: window, rows, coverage: { proj: rows.filter((r) => r.projPts !== null).length, adpSleeper: rows.filter((r) => r.rAdpS !== null).length, adpFFC: rows.filter((r) => r.rAdpF !== null).length, n: rows.length } };
  }
  return data;
}

export function preseason(data) {
  const years = Object.keys(data).map(Number).sort();
  const groups = ['consensus', 'projection', 'adp'];
  // app preseason weights (config redraft.weights.preseason) over the testable groups: consensus .40, projection .30, adp .15
  const APP = [0.40, 0.30, 0.15];
  const results = [];
  const rowsOut = [];
  for (const y of years.slice(1)) {
    const train = years.filter((t) => t < y).flatMap((t) => data[t].rows);
    const test = data[y].rows;
    const curve = (key) => fitRankCurve(train.filter((r) => r[key] !== null).map((r) => ({ pos: r.pos, rank: r[key], y: r.target })));
    const cE = curve('rank'), cP = curve('rProj'), cS = curve('rAdpS'), cF = curve('rAdpF');
    const lin = Object.fromEntries(POS.map((pos) => { const xs = train.filter((r) => r.pos === pos && r.projPts !== null); return [pos, fitLinear(xs.map((r) => r.projPts), xs.map((r) => r.target))]; }));
    const enrich = (r) => {
      const adps = [r.rAdpS !== null && cS ? cS(r.pos, r.rAdpS) : null, r.rAdpF !== null && cF ? cF(r.pos, r.rAdpF) : null].filter(Number.isFinite);
      return { ...r, consensus: cE(r.pos, r.rank), projection: r.rProj !== null ? cP(r.pos, r.rProj) : null, projectionPts: r.projPts !== null ? lin[r.pos].a + lin[r.pos].b * r.projPts : null, adp: adps.length ? mean(adps) : null, adpSleeper: r.rAdpS !== null && cS ? cS(r.pos, r.rAdpS) : null, adpFFC: r.rAdpF !== null && cF ? cF(r.pos, r.rAdpF) : null };
    };
    const tr = train.map(enrich), te = test.map(enrich);
    const fitted = fitWeights(tr, groups);
    const fittedPts = fitWeights(tr.map((r) => ({ ...r, projection: r.projectionPts })), groups);
    for (const r of te) {
      r.app = blend(r, groups, APP);
      r.fit = blend(r, groups, fitted);
      r.ecrProj = blend(r, groups, [0.5, 0.5, 0]);
      r.fitPts = blend({ ...r, projection: r.projectionPts }, groups, fittedPts);
    }
    const same = te.filter((r) => groups.every((g) => Number.isFinite(r[g])));
    const keys = ['consensus', 'projection', 'projectionPts', 'adp', 'adpSleeper', 'adpFFC', 'app', 'ecrProj', 'fit', 'fitPts'];
    results.push({ season: y, n: te.length, sameSampleN: same.length, fittedWeights: Object.fromEntries(groups.map((g, i) => [g, fitted[i]])), fittedWeightsProjPoints: Object.fromEntries(groups.map((g, i) => [g, fittedPts[i]])), sameSample: Object.fromEntries(keys.map((k) => [k, metrics(same, k)])) });
    rowsOut.push(...same.map((r) => ({ y, ...r })));
  }
  const keys = Object.keys(results[0].sameSample);
  const summary = Object.fromEntries(keys.map((k) => [k, { rho: r3(mean(results.map((r) => r.sameSample[k].rho))), mae: r3(mean(results.map((r) => r.sameSample[k].mae))), seasonsBestOrTiedVsApp: results.filter((r) => r.sameSample[k].rho >= r.sameSample.app.rho).length }]));
  return { groups, appWeights: Object.fromEntries(groups.map((g, i) => [g, APP[i]])), coverage: Object.fromEntries(years.map((y) => [y, data[y].coverage])), snapshots: Object.fromEntries(years.map((y) => [y, { ecr: data[y].date, ffc: data[y].ffcWindow }])), results, summary, rows: rowsOut };
}

// ------------------------------------------------------------------------------------------------ in season
export async function inSeasonRows(bench, s2g, cfgProd) {
  const cases = [];
  for (const y of SEASONS) {
    for (const W of CHECKPOINTS) {
      const wkW = bench.schedule[y]?.weeks[W], nextFirst = bench.schedule[y]?.weeks[W + 1]?.first;
      if (!wkW || !nextFirst) continue;
      const lists = {};
      for (const pos of POS) {
        const s = snapshotBefore(bench, pos === 'QB' ? 'ros:qb' : `ros:${pos.toLowerCase()}`, nextFirst, 10);
        if (s && s.date >= wkW.first) lists[pos] = s;
      }
      if (Object.keys(lists).length < 4) continue;
      const proj = await sleeperWeekProjection(y, W + 1, s2g);
      const rows = [];
      // positional medians of last-season PPG among ranked players: the production prior when a player lacks history
      for (const pos of POS) {
        lists[pos].rows.filter((r) => r.pos === pos && r.ecr !== null).sort((a, b) => a.ecr - b.ecr).slice(0, TOPN[pos]).forEach((r, i) => {
          const g = r.g;
          const ws = (bench.weekly[g]?.[y] || []).filter((wk) => wk.w <= W - 1 && played(wk)); // as E2: production through week W−1
          const team = ws.length ? ws[ws.length - 1].team : null;
          const rem = team ? Object.keys(bench.schedule[y].opp[team] || {}).map(Number).filter((w) => w >= W + 1).length : null;
          const prev = windowPoints(bench, g, y - 1, 1, lastWeek(y - 1));
          const ppg = ws.length ? mean(ws.map((wk) => weekPts(wk.st, pos))) : null;
          const xppg = ws.length ? mean(ws.map((wk) => (wk.st.rec_tgt || 0) * OPP_RATE[pos].tgt + (wk.st.rush_att || 0) * OPP_RATE[pos].car + (wk.st.pass_att || 0) * OPP_RATE[pos].att)) : null;
          const p = proj.get(g);
          rows.push({ g, pos, rank: i + 1, gp: ws.length, rem, ppg, xppg, prevPPG: prev.gp >= 4 ? prev.pts / prev.gp : null, projGame: p && p.pos === pos ? p.pts : null, target: windowPoints(bench, g, y, W + 1, lastWeek(y)).pts });
        });
      }
      // app production rate (context.js): blend = (1−x)·ppg + x·xppg; rate = (gp·blend + k·prior)/(gp + k), ≥3 games
      const medPrior = Object.fromEntries(POS.map((pos) => { const xs = rows.filter((r) => r.pos === pos && r.prevPPG !== null).map((r) => r.prevPPG).sort((a, b) => a - b); return [pos, xs.length ? xs[Math.floor(xs.length / 2)] : 0]; }));
      for (const r of rows) {
        const blendR = r.ppg === null ? null : (1 - cfgProd.xfp_blend) * r.ppg + cfgProd.xfp_blend * r.xppg;
        const prior = r.prevPPG ?? medPrior[r.pos];
        r.prodPts = blendR !== null && r.gp >= cfgProd.min_games_without_history && r.rem ? ((r.gp * blendR + cfgProd.regression_games * prior) / (r.gp + cfgProd.regression_games)) * r.rem * (cfgProd.availability[r.pos] ?? 1) : null;
        r.projPts = r.projGame !== null && r.rem ? r.projGame * r.rem : null;
      }
      cases.push({ y, W, date: lists.RB.date, rows });
    }
  }
  return cases;
}

export function inSeason(cases, appWeightsAt) {
  const groups = ['consensus', 'projection', 'production'];
  const seasons = [...new Set(cases.map((c) => c.y))].sort();
  const results = [];
  const rowsOut = [];
  for (const ty of seasons.slice(1)) {
    const trainC = cases.filter((c) => c.y < ty), testC = cases.filter((c) => c.y === ty);
    const curves = Object.fromEntries(CHECKPOINTS.map((W) => [W, fitRankCurve(trainC.filter((c) => c.W === W).flatMap((c) => c.rows.map((r) => ({ pos: r.pos, rank: r.rank, y: r.target }))))]));
    const linFor = (key) => Object.fromEntries(POS.map((pos) => { const xs = trainC.flatMap((c) => c.rows).filter((r) => r.pos === pos && r[key] !== null); return [pos, fitLinear(xs.map((r) => r[key]), xs.map((r) => r.target))]; }));
    const linP = linFor('projPts'), linD = linFor('prodPts');
    const enrich = (c) => c.rows.map((r) => ({ ...r, W: c.W, consensus: curves[c.W](r.pos, r.rank), projection: r.projPts !== null ? linP[r.pos].a + linP[r.pos].b * r.projPts : null, production: r.prodPts !== null ? linD[r.pos].a + linD[r.pos].b * r.prodPts : null, projRaw: r.projPts, prodRaw: r.prodPts }));
    const tr = trainC.flatMap(enrich);
    const fitted = fitWeights(tr, groups);
    const fittedByW = Object.fromEntries(CHECKPOINTS.map((W) => [W, fitWeights(tr.filter((r) => r.W === W), groups)]));
    for (const c of testC) {
      const te = enrich(c);
      const app = appWeightsAt(c.W);
      for (const r of te) { r.app = blend(r, groups, app); r.fit = blend(r, groups, fitted); r.fitW = blend(r, groups, fittedByW[c.W]); r.ecrProj = blend(r, groups, [0.6, 0.4, 0]); }
      const same = te.filter((r) => groups.every((g) => Number.isFinite(r[g])));
      const keys = ['consensus', 'projection', 'production', 'app', 'ecrProj', 'fit', 'fitW'];
      results.push({ season: ty, W: c.W, snapshot: c.date, n: same.length, appWeights: app, ...Object.fromEntries(keys.map((k) => [k, metrics(same, k)])) });
      rowsOut.push(...te.filter((r) => Number.isFinite(r.app)).map((r) => ({ y: ty, W: c.W, pos: r.pos, rem: r.rem, app: r.app, target: r.target })));
    }
    results.push({ season: ty, fitted: Object.fromEntries(groups.map((g, i) => [g, fitted[i]])), fittedByWeek: Object.fromEntries(Object.entries(fittedByW).map(([W, w]) => [W, Object.fromEntries(groups.map((g, i) => [g, w[i]]))])) });
  }
  const keys = ['consensus', 'projection', 'production', 'app', 'ecrProj', 'fit', 'fitW'];
  const ev = results.filter((r) => r.app);
  const overall = Object.fromEntries(keys.map((k) => [k, { rho: r3(mean(ev.map((r) => r[k].rho))), mae: r3(mean(ev.map((r) => r[k].mae))), checkpointsBeatingApp: ev.filter((r) => r[k].mae < r.app.mae).length, of: ev.length }]));
  const byWeek = Object.fromEntries(CHECKPOINTS.map((W) => [W, Object.fromEntries(keys.map((k) => { const xs = ev.filter((r) => r.W === W); return [k, { rho: r3(mean(xs.map((r) => r[k].rho))), mae: r3(mean(xs.map((r) => r[k].mae))) }]; }))]));
  return { groups, cases: cases.map((c) => ({ season: c.y, week: c.W, snapshot: c.date, n: c.rows.length, withProjection: c.rows.filter((r) => r.projPts !== null).length })), results, overall, byWeek, rows: rowsOut };
}

/** Weights of the app's redraft blend at week W (phase ramp), over the in-season testable groups. */
export function appWeightsAt(model) {
  const wPre = model.redraft.weights.preseason, wIn = model.redraft.weights.in_season;
  return (W) => { const a = Math.min(1, Math.max(0, (W - 1) / (model.phase.full_in_season_week - 1))); const w = (g) => (1 - a) * wPre[g] + a * wIn[g]; return [w('consensus'), w('projection'), w('production')]; };
}

export async function signalWeights(bench, model) {
  const s2g = await sleeperToGsis();
  const pre = preseason(await preseasonRows(bench, s2g));
  const appAt = appWeightsAt(model);
  const { rows: _inRows, ...inn } = inSeason(await inSeasonRows(bench, s2g, model.redraft.production), appAt);
  const { rows: _preRows, ...preOut } = pre;
  return {
    experiment: 'E9 signal weights from leak-free historical archives (Sleeper/Rotowire weekly projections, Sleeper + FFC preseason ADP)',
    label: 'REAL HISTORICAL DATA',
    preseason: preOut, inSeason: inn,
  };
}
