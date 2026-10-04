// Walk-forward backtests on REAL HISTORICAL DATA (see benchmark.js). No future information is used:
//   * rank→points curves, blend weights and regression constants are fitted only on seasons BEFORE the test season
//   * "to-date" production uses weeks strictly before the checkpoint; targets start after the ranking snapshot
// Every experiment reports the simple baselines next to the candidate models.

import { snapshotBefore } from './benchmark.js';
import { scoreStats, resolveScoring } from '../../js/core/scoring.js';
import { mean, median, spearman, isotonicDecreasing, sd, expectedSurplus, interp } from '../../js/core/util/stats.js';
import { readJSONSync } from '../../server/lib/store.js';
import path from 'node:path';
import { ROOT } from '../../server/lib/paths.js';
import { monotoneHazard, unimodalAgeCurve } from '../lib/calibration-shape.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TOPN = { QB: 32, RB: 60, WR: 72, TE: 32 };
const REPL_RANK = { QB: 12, RB: 30, WR: 42, TE: 12 }; // 12-team 1QB/2RB/3WR/1TE/1FLEX
const ppr = resolveScoring({ scoring_preset: 'ppr', scoring: {} }, readJSONSync(path.join(ROOT, 'config', 'league-defaults.json')));
const lastWeek = (y) => (y >= 2021 ? 18 : 17);
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

export function weekPts(st, pos) { return scoreStats(st, pos, ppr, { perGame: true }).points || 0; }

function weeksOf(bench, g, y) { return (bench.weekly[g] && bench.weekly[g][y]) || []; }
export function played(wk) { return (wk.st.pass_att || 0) + (wk.st.rush_att || 0) + (wk.st.rec_tgt || 0) + (wk.st.rec || 0) > 0; }

export function windowPoints(bench, g, y, from, to) {
  const pos = bench.meta[g]?.pos;
  let pts = 0, gp = 0;
  for (const wk of weeksOf(bench, g, y)) if (wk.w >= from && wk.w <= to) { pts += weekPts(wk.st, pos); if (played(wk)) gp++; }
  return { pts, gp };
}

function replacementFrom(rows, key) {
  const out = {};
  for (const pos of POS) {
    const xs = rows.filter((r) => r.pos === pos).map((r) => r[key]).sort((a, b) => b - a);
    out[pos] = xs[Math.min(REPL_RANK[pos], xs.length) - 1] ?? 0;
  }
  return out;
}

/** Fit a monotone rank→target curve per position from training pairs. Returns predict(pos, rank). */
export function fitRankCurve(pairs) {
  const by = {};
  for (const { pos, rank, y } of pairs) { const k = Math.max(1, Math.round(rank)); ((by[pos] ||= {})[k] ||= []).push(y); }
  const curves = {};
  for (const [pos, m] of Object.entries(by)) {
    const maxR = Math.max(...Object.keys(m).map(Number));
    const raw = [];
    for (let r = 1; r <= maxR; r++) {
      // pool neighbouring ranks (wider for deeper ranks) to reduce noise
      const h = Math.max(1, Math.round(r * 0.15));
      const vals = [];
      for (let q = Math.max(1, r - h); q <= r + h; q++) if (m[q]) vals.push(...m[q]);
      raw.push(vals.length ? mean(vals) : raw[raw.length - 1] ?? 0);
    }
    curves[pos] = isotonicDecreasing(raw);
  }
  return (pos, rank) => { const c = curves[pos]; if (!c || !c.length) return null; const i = Math.min(c.length, Math.max(1, Math.round(rank))) - 1; return c[i]; };
}

export function positionalRanks(rows) {
  // rows: [{g,pos,ecr}] → Map g → positional rank (1-based, by ecr)
  const out = new Map();
  for (const pos of POS) rows.filter((r) => r.pos === pos && r.ecr !== null).sort((a, b) => a.ecr - b.ecr).forEach((r, i) => out.set(r.g, { rank: i + 1, pos }));
  return out;
}

export function metrics(rows, predKey, targetKey = 'target') {
  const ok = rows.filter((r) => Number.isFinite(r[predKey]));
  const mae = mean(ok.map((r) => Math.abs(r[predKey] - r[targetKey])));
  const byPos = {};
  for (const pos of POS) {
    const xs = ok.filter((r) => r.pos === pos);
    byPos[pos] = { n: xs.length, rho: r3(spearman(xs.map((r) => r[predKey]), xs.map((r) => r[targetKey]))), mae: r3(mean(xs.map((r) => Math.abs(r[predKey] - r[targetKey])))) };
  }
  const meanRho = mean(Object.values(byPos).map((x) => x.rho).filter(Number.isFinite));
  return { n: ok.length, mae: r3(mae), rho: r3(meanRho), byPos };
}

// ---------------------------------------------------------------------------------------------------------------
// E1 — PRESEASON REDRAFT: what predicts season fantasy points (and surplus over replacement)?
// ---------------------------------------------------------------------------------------------------------------
export function preseasonRedraft(bench) {
  const data = {};
  for (const y of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
    const first = bench.schedule[y]?.weeks[1]?.first;
    const snap = first && snapshotBefore(bench, 'redraft', first, 30);
    if (!snap) continue;
    const ranks = positionalRanks(snap.rows);
    const rows = [];
    for (const [g, { rank, pos }] of ranks) {
      if (rank > TOPN[pos]) continue;
      const cur = windowPoints(bench, g, y, 1, lastWeek(y));
      const prev = windowPoints(bench, g, y - 1, 1, lastWeek(y - 1));
      const prevUse = prevUsage(bench, g, y - 1);
      rows.push({ g, pos, rank, target: cur.pts, gp: cur.gp, prevPPG: prev.gp >= 4 ? prev.pts / prev.gp : null, prevGP: prev.gp, prevXppg: prevUse });
    }
    const repl = replacementFrom(rows, 'target');
    for (const r of rows) r.surplus = Math.max(0, r.target - repl[r.pos]);
    data[y] = { date: snap.date, rows };
  }
  const years = Object.keys(data).map(Number).sort();
  const results = [];
  const scaleRows = [];
  for (const y of years.slice(1)) {
    const train = years.filter((t) => t < y).flatMap((t) => data[t].rows);
    const test = data[y].rows;
    const ecrCurve = fitRankCurve(train.map((r) => ({ pos: r.pos, rank: r.rank, y: r.target })));
    // production baseline: linear map prevPPG → season points, fitted per position on training
    const lin = {};
    for (const pos of POS) {
      const xs = train.filter((r) => r.pos === pos && r.prevPPG !== null);
      lin[pos] = fitLinear(xs.map((r) => r.prevPPG), xs.map((r) => r.target));
    }
    const linX = {};
    for (const pos of POS) {
      const xs = train.filter((r) => r.pos === pos && r.prevXppg !== null && r.prevPPG !== null);
      linX[pos] = fitLinear(xs.map((r) => 0.5 * r.prevPPG + 0.5 * r.prevXppg), xs.map((r) => r.target));
    }
    const prodPred = (r, f) => (r.prevPPG === null ? null : f[r.pos].a + f[r.pos].b * r.prevPPG);
    const prodXPred = (r) => (r.prevPPG === null || r.prevXppg === null ? null : linX[r.pos].a + linX[r.pos].b * (0.5 * r.prevPPG + 0.5 * r.prevXppg));
    // blend weight fitted on training (leave-one-season-out within training to avoid in-sample curve fit)
    let bestW = 1, bestErr = Infinity;
    for (let w = 0; w <= 1.0001; w += 0.1) {
      const err = mean(train.filter((r) => r.prevPPG !== null).map((r) => Math.abs(w * ecrCurve(r.pos, r.rank) + (1 - w) * prodPred(r, lin) - r.target)));
      if (err < bestErr) { bestErr = err; bestW = w; }
    }
    for (const r of test) {
      r.p_ecr = ecrCurve(r.pos, r.rank);
      r.p_prod = prodPred(r, lin);
      r.p_prodx = prodXPred(r);
      r.p_blend = r.p_prod === null ? r.p_ecr : bestW * r.p_ecr + (1 - bestW) * r.p_prod;
    }
    const both = test.filter((r) => r.p_prod !== null);
    results.push({ season: y, train: years.filter((t) => t < y), fittedEcrWeight: r3(bestW), all: metrics(test, 'p_ecr'), sameSample: { ecr: metrics(both, 'p_ecr'), prodLastSeason: metrics(both, 'p_prod'), prodLastSeasonWithUsage: metrics(both, 'p_prodx'), blend: metrics(both, 'p_blend') } });
  }
  // Scale question: realized surplus by preseason positional rank, pooled over all seasons
  for (const pos of POS) {
    const all = years.flatMap((y) => data[y].rows).filter((r) => r.pos === pos);
    for (const [a, b] of [[1, 1], [2, 2], [3, 3], [4, 6], [7, 12], [13, 18], [19, 24], [25, 36], [37, 48], [49, 72]]) {
      const xs = all.filter((r) => r.rank >= a && r.rank <= b);
      if (!xs.length) continue;
      scaleRows.push({ pos, ranks: `${a}-${b}`, n: xs.length, meanPoints: r3(mean(xs.map((r) => r.target))), meanSurplus: r3(mean(xs.map((r) => r.surplus))), medianSurplus: r3(median(xs.map((r) => r.surplus))), sdSurplus: r3(sd(xs.map((r) => r.surplus))), pBelowRepl: r3(xs.filter((r) => r.surplus === 0).length / xs.length) });
    }
  }
  // E1b — what should the VALUE be: raw points, deterministic surplus, or expected surplus under outcome uncertainty?
  const scaleTest = [];
  for (const y of years.slice(1)) {
    const train = years.filter((t) => t < y).flatMap((t) => data[t].rows);
    const test = data[y].rows;
    const ptsCurve = fitRankCurve(train.map((r) => ({ pos: r.pos, rank: r.rank, y: r.target })));
    const surCurve = fitRankCurve(train.map((r) => ({ pos: r.pos, rank: r.rank, y: r.surplus })));
    const sigma = {}, replT = {};
    for (const pos of POS) {
      const xs = train.filter((r) => r.pos === pos);
      sigma[pos] = sd(xs.map((r) => r.target - ptsCurve(pos, r.rank)));
      replT[pos] = mean(years.filter((t) => t < y).map((t) => replacementFrom(data[t].rows, 'target')[pos]));
    }
    const rowsOut = test.map((r) => {
      const p = ptsCurve(r.pos, r.rank);
      return { ...r, raw: p, det: Math.max(0, p - replT[r.pos]), exp: expectedSurplus(p, sigma[r.pos], replT[r.pos]), emp: surCurve(r.pos, r.rank) };
    });
    const tiers = [[1, 6], [7, 18], [19, 36], [37, 99]];
    const res = { season: y, sigma: Object.fromEntries(Object.entries(sigma).map(([k, v]) => [k, r3(v)])) };
    for (const k of ['det', 'exp', 'emp']) {
      res[k] = { mae: r3(mean(rowsOut.map((r) => Math.abs(r[k] - r.surplus)))), biasByTier: tiers.map(([a, b]) => { const z = rowsOut.filter((r) => r.rank >= a && r.rank <= b); return { tier: `${a}-${b}`, bias: r3(mean(z.map((r) => r[k] - r.surplus))) }; }) };
    }
    scaleTest.push(res);
  }
  const scaleSummary = {};
  for (const k of ['det', 'exp', 'emp']) {
    scaleSummary[k] = { mae: r3(mean(scaleTest.map((r) => r[k].mae))), biasByTier: ['1-6', '7-18', '19-36', '37-99'].map((t) => ({ tier: t, bias: r3(mean(scaleTest.map((r) => r[k].biasByTier.find((b) => b.tier === t)?.bias).filter(Number.isFinite))) })) };
  }
  return { experiment: 'E1 preseason redraft (season PPR points)', scaleTest, scaleSummary, snapshots: Object.fromEntries(years.map((y) => [y, data[y].date])), results, scale: scaleRows, summary: summarize(results, ['ecr', 'prodLastSeason', 'prodLastSeasonWithUsage', 'blend']) };
}

function prevUsage(bench, g, y) {
  // last-season expected PPG from opportunities (targets, carries, pass attempts) × league-average PPR value per opportunity
  const ws = weeksOf(bench, g, y).filter(played);
  if (ws.length < 4) return null;
  const pos = bench.meta[g]?.pos;
  const rate = OPP_RATE[pos];
  return mean(ws.map((wk) => (wk.st.rec_tgt || 0) * rate.tgt + (wk.st.rush_att || 0) * rate.car + (wk.st.pass_att || 0) * rate.att));
}
// League-average PPR points per opportunity (stable across seasons; computed from 2018-2025 nflverse, see audit report)
export const OPP_RATE = { QB: { tgt: 1.6, car: 0.62, att: 0.48 }, RB: { tgt: 1.55, car: 0.6, att: 0 }, WR: { tgt: 1.75, car: 0.75, att: 0 }, TE: { tgt: 1.55, car: 0.6, att: 0 } };
export function measureOppRates(bench) {
  const acc = {};
  for (const [g, seasons] of Object.entries(bench.weekly)) {
    const pos = bench.meta[g]?.pos;
    for (const ws of Object.values(seasons)) for (const wk of ws) {
      const a = (acc[pos] ||= { recPts: 0, tgt: 0, rushPts: 0, car: 0, passPts: 0, att: 0 });
      const st = wk.st;
      a.tgt += st.rec_tgt || 0; a.recPts += (st.rec || 0) + 0.1 * (st.rec_yd || 0) + 6 * (st.rec_td || 0);
      a.car += st.rush_att || 0; a.rushPts += 0.1 * (st.rush_yd || 0) + 6 * (st.rush_td || 0);
      a.att += st.pass_att || 0; a.passPts += 0.04 * (st.pass_yd || 0) + 4 * (st.pass_td || 0) - 2 * (st.pass_int || 0);
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([p, a]) => [p, { perTarget: r3(a.recPts / a.tgt), perCarry: r3(a.rushPts / a.car), perPassAtt: a.att > 1000 ? r3(a.passPts / a.att) : null }]));
}

export function fitLinear(x, y) {
  if (x.length < 5) return { a: mean(y) || 0, b: 0 };
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

function summarize(results, keys) {
  const out = {};
  for (const k of keys) {
    const ms = results.map((r) => r.sameSample?.[k] || r[k]).filter(Boolean);
    out[k] = { meanRho: r3(mean(ms.map((m) => m.rho).filter(Number.isFinite))), meanMAE: r3(mean(ms.map((m) => m.mae).filter(Number.isFinite))) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// E2 — IN-SEASON REST-OF-SEASON: consensus vs production, usage vs points, recency, regression, schedule, by week
// ---------------------------------------------------------------------------------------------------------------
export function inSeasonROS(bench, { checkpoints = [4, 6, 8, 10, 12] } = {}) {
  const cases = []; // one per (season, checkpoint)
  for (const y of [2020, 2021, 2022, 2023, 2024]) {
    for (const W of checkpoints) {
      const wkW = bench.schedule[y]?.weeks[W];
      if (!wkW) continue;
      // ROS lists scraped during week W (Friday after TNF): latest scrape before week W+1 starts and on/after week W's first game
      const nextFirst = bench.schedule[y].weeks[W + 1]?.first;
      const lists = {};
      for (const pos of POS) {
        const key = pos === 'QB' ? 'ros:qb' : `ros:${pos.toLowerCase()}`;
        const s = snapshotBefore(bench, key, nextFirst, 10);
        if (s && s.date >= wkW.first) lists[pos] = s;
      }
      if (Object.keys(lists).length < 4) continue;
      const fpa = defenseFPA(bench, y, W - 1);
      const rows = [];
      for (const pos of POS) {
        lists[pos].rows.filter((r) => r.pos === pos).sort((a, b) => a.ecr - b.ecr).slice(0, TOPN[pos]).forEach((r, i) => {
          const g = r.g;
          const ws = weeksOf(bench, g, y).filter((wk) => wk.w <= W - 1 && played(wk)).sort((a, b) => a.w - b.w);
          const team = ws.length ? ws[ws.length - 1].team : null;
          const tgt = windowPoints(bench, g, y, W + 1, lastWeek(y));
          const remTeamGames = team ? Object.keys(bench.schedule[y].opp[team] || {}).map(Number).filter((w) => w >= W + 1).length : null;
          const prev = windowPoints(bench, g, y - 1, 1, lastWeek(y - 1));
          rows.push({
            g, pos, rank: i + 1, gp: ws.length, team, remTeamGames,
            ppg: ws.length ? mean(ws.map((wk) => weekPts(wk.st, pos))) : null,
            last4: ws.length ? mean(ws.slice(-4).map((wk) => weekPts(wk.st, pos))) : null,
            xppg: ws.length ? mean(ws.map((wk) => (wk.st.rec_tgt || 0) * OPP_RATE[pos].tgt + (wk.st.rush_att || 0) * OPP_RATE[pos].car + (wk.st.pass_att || 0) * OPP_RATE[pos].att)) : null,
            prevPPG: prev.gp >= 4 ? prev.pts / prev.gp : null,
            sosRatio: team ? sosRatio(bench, y, team, W + 1, pos, fpa) : 1,
            target: tgt.pts, targetGP: tgt.gp,
          });
        });
      }
      cases.push({ y, W, date: lists.RB.date, rows });
    }
  }
  // Production rate model family: rate = (gp·((1−x)·ppg_m + x·xppg) + k·prior)/(gp+k);  ppg_m = (1−m)·season + m·last4
  const grid = [];
  for (const x of [0, 0.25, 0.5, 0.75, 1]) for (const k of [0, 2, 4, 8]) for (const m of [0, 0.5]) for (const s of [0, 0.5, 1]) grid.push({ x, k, m, s });
  const posPrior = (rows) => Object.fromEntries(POS.map((p) => [p, mean(rows.filter((r) => r.pos === p && r.ppg !== null && r.rank <= TOPN[p] / 2).map((r) => r.ppg))]));
  const prodRate = (r, prm, prior) => {
    if (r.ppg === null || !r.gp) return null;
    const base = (1 - prm.m) * r.ppg + prm.m * r.last4;
    const blend = (1 - prm.x) * base + prm.x * r.xppg;
    const pr = r.prevPPG ?? prior[r.pos];
    return (r.gp * blend + prm.k * pr) / (r.gp + prm.k);
  };
  const prodPred = (r, prm, prior, avail) => {
    const rate = prodRate(r, prm, prior);
    if (rate === null || r.remTeamGames === null) return null;
    const sosMult = 1 + prm.s * (r.sosRatio - 1);
    return rate * r.remTeamGames * avail[r.pos] * sosMult;
  };
  const results = [];
  const seasons = [...new Set(cases.map((c) => c.y))].sort();
  for (const ty of seasons.slice(1)) {
    const trainCases = cases.filter((c) => c.y < ty);
    const testCases = cases.filter((c) => c.y === ty);
    const trainRows = trainCases.flatMap((c) => c.rows.map((r) => ({ ...r, W: c.W, prior: posPrior(c.rows) })));
    // availability: realized games / remaining team games (training)
    const avail = {};
    for (const p of POS) { const xs = trainRows.filter((r) => r.pos === p && r.remTeamGames && r.gp); avail[p] = mean(xs.map((r) => r.targetGP / r.remTeamGames)); }
    // fit production params on training
    let best = null;
    for (const prm of grid) {
      const err = mean(trainRows.map((r) => { const v = prodPred(r, prm, r.prior, avail); return v === null ? null : Math.abs(v - r.target); }).filter((v) => v !== null));
      if (!best || err < best.err) best = { prm, err };
    }
    const ecrCurves = {};
    for (const W of checkpoints) ecrCurves[W] = fitRankCurve(trainRows.filter((r) => r.W === W).map((r) => ({ pos: r.pos, rank: r.rank, y: r.target })));
    // consensus weight by checkpoint (training)
    const wByW = {};
    for (const W of checkpoints) {
      const xs = trainRows.filter((r) => r.W === W);
      let bw = 0.5, be = Infinity;
      for (let w = 0; w <= 1.0001; w += 0.1) {
        const e = mean(xs.map((r) => { const p = prodPred(r, best.prm, r.prior, avail); return p === null ? null : Math.abs(w * ecrCurves[W](r.pos, r.rank) + (1 - w) * p - r.target); }).filter((v) => v !== null));
        if (e < be) { be = e; bw = w; }
      }
      wByW[W] = r3(bw);
    }
    for (const c of testCases) {
      const prior = posPrior(c.rows);
      const rows = c.rows.filter((r) => r.gp > 0 && r.remTeamGames);
      const variant = (prm) => rows.map((r) => prodPred(r, prm, prior, avail));
      const P = {
        ecr: rows.map((r) => ecrCurves[c.W](r.pos, r.rank)),
        seasonPPG: variant({ x: 0, k: 0, m: 0, s: 0 }),
        last4: variant({ x: 0, k: 0, m: 1, s: 0 }),
        usageOnly: variant({ x: 1, k: 0, m: 0, s: 0 }),
        currentModelProd: variant({ x: 0.4, k: 4, m: 0, s: 0.5 }),
        fittedProd: variant(best.prm),
        fittedProdNoSOS: variant({ ...best.prm, s: 0 }),
      };
      // current model relative consensus:production weight at week W (config: pre {c:.30,p:0} → in {c:.25,p:.30} by week 8)
      const alpha = Math.min(1, Math.max(0, (c.W - 1) / 7));
      const cw = 0.30 * (1 - alpha) + 0.25 * alpha, pw = 0.30 * alpha;
      P.currentBlend = rows.map((r, i) => (P.currentModelProd[i] === null ? null : (cw * P.ecr[i] + pw * P.currentModelProd[i]) / (cw + pw)));
      P.fittedBlend = rows.map((r, i) => (P.fittedProd[i] === null ? null : wByW[c.W] * P.ecr[i] + (1 - wByW[c.W]) * P.fittedProd[i]));
      const res = { season: ty, W: c.W, snapshot: c.date, n: rows.length };
      res.residualSD = Object.fromEntries(POS.map((p) => { const z = rows.map((r, i) => ({ r, pr: P.ecr[i] })).filter((x) => x.r.pos === p && Number.isFinite(x.pr)); return [p, { sd: r3(sd(z.map((x) => x.r.target - x.pr))), meanPred: r3(mean(z.map((x) => x.pr))), remGames: r3(mean(z.map((x) => x.r.remTeamGames))) }]; }));
      for (const [k, preds] of Object.entries(P)) {
        const tmp = rows.map((r, i) => ({ ...r, pred: preds[i] }));
        res[k] = metrics(tmp, 'pred');
      }
      results.push(res);
    }
    results.push({ season: ty, fitted: { production: best.prm, consensusWeightByWeek: wByW, availability: Object.fromEntries(Object.entries(avail).map(([k, v]) => [k, r3(v)])) } });
  }
  const keys = ['ecr', 'seasonPPG', 'last4', 'usageOnly', 'currentModelProd', 'fittedProd', 'fittedProdNoSOS', 'currentBlend', 'fittedBlend'];
  const byW = {};
  for (const W of checkpoints) {
    byW[W] = {};
    for (const k of keys) {
      const ms = results.filter((r) => r.W === W && r[k]).map((r) => r[k]);
      byW[W][k] = { rho: r3(mean(ms.map((m) => m.rho))), mae: r3(mean(ms.map((m) => m.mae))) };
    }
  }
  const overall = {};
  for (const k of keys) { const ms = results.filter((r) => r[k]).map((r) => r[k]); overall[k] = { rho: r3(mean(ms.map((m) => m.rho))), mae: r3(mean(ms.map((m) => m.mae))) }; }
  return { experiment: 'E2 in-season rest-of-season points (walk-forward by season)', cases: cases.map((c) => ({ season: c.y, week: c.W, snapshot: c.date, n: c.rows.length })), results, byWeek: byW, overall };
}

function defenseFPA(bench, y, uptoW) {
  const acc = {};
  for (const [g, seasons] of Object.entries(bench.weekly)) {
    const pos = bench.meta[g]?.pos;
    for (const wk of seasons[y] || []) {
      if (wk.w > uptoW || !wk.opp) continue;
      const a = ((acc[pos] ||= {})[wk.opp] ||= { pts: 0, weeks: new Set() });
      a.pts += weekPts(wk.st, pos); a.weeks.add(wk.w);
    }
  }
  const out = {};
  for (const [pos, m] of Object.entries(acc)) {
    out[pos] = {};
    const vals = [];
    for (const [t, a] of Object.entries(m)) { out[pos][t] = a.pts / a.weeks.size; vals.push(out[pos][t]); }
    out[pos]._avg = mean(vals);
  }
  return out;
}
function sosRatio(bench, y, team, fromW, pos, fpa) {
  const opps = Object.entries(bench.schedule[y].opp[team] || {}).filter(([w]) => Number(w) >= fromW).map(([, o]) => fpa[pos]?.[o]).filter(Number.isFinite);
  if (!opps.length || !fpa[pos]?._avg) return 1;
  return mean(opps) / fpa[pos]._avg;
}

// ---------------------------------------------------------------------------------------------------------------
// E3 — DYNASTY: preseason consensus vs a leak-free fundamental model, 3-season outcomes; ablations; age bias
//   hist = loadSeasons(2006, 2025) (nflverse season totals). Aging curve, attrition and draft priors are refit for each
//   test season Y using ONLY seasons < Y, so the fundamental model never sees the outcomes it is scored on.
// ---------------------------------------------------------------------------------------------------------------
export function dynasty(bench, hist, { discount = 0.82, regularize = true, concave = 'decline' } = {}) {
  const seasonRows = new Map();
  for (const arr of hist.seasons.values()) for (const r of arr) seasonRows.set(`${r.gsis}|${r.season}`, r);
  const replCache = {};
  const repl = (y, pos) => {
    const k = `${y}|${pos}`;
    if (!(k in replCache)) { const xs = [...seasonRows.values()].filter((r) => r.season === y && r.pos === pos).map((r) => r.pts).sort((a, b) => b - a); replCache[k] = xs[REPL_RANK[pos] - 1] ?? 0; }
    return replCache[k];
  };
  const out = { experiment: 'E3 dynasty: preseason ranking → realized 3-season discounted surplus (leak-free refit per season)', results: [], ageBias: [], calibrations: {} };
  for (const Y of [2020, 2021, 2022, 2023]) {
    const first = bench.schedule[Y]?.weeks[1]?.first;
    const snap = snapshotBefore(bench, 'dynasty', first, 45);
    if (!snap) continue;
    const cal = calibrateBefore(hist, Y, { regularize, concave });
    out.calibrations[Y] = { survMult: cal.survMult, agingSample: cal.agingN, priorsClasses: cal.priorClasses, aging: Object.fromEntries(POS.map((p) => [p, Object.fromEntries([22, 24, 26, 28, 30, 32].map((a) => [a, r3(interp(cal.aging[p], a))]))])) };
    const ranks = positionalRanks(snap.rows);
    const rows = [];
    for (const [g, { rank, pos }] of ranks) {
      if (rank > TOPN[pos]) continue;
      const m = hist.meta.get(g);
      if (!m) continue;
      const age = m.birth_date ? (new Date(`${Y}-09-01`) - new Date(m.birth_date)) / (365.25 * 864e5) : null;
      let target = 0;
      for (let k = 0; k < 3; k++) { const s = seasonRows.get(`${g}|${Y + k}`); target += discount ** k * (s ? Math.max(0, s.pts - repl(Y + k, pos)) : 0); }
      const F = (opt) => fundamental(seasonRows, cal, g, m, pos, Y, age, repl(Y - 1, pos), opt);
      const row = { g, pos, rank, age, target, F: F({}), F_survMult: F({ survMult: true }), F_noAge: F({ noAge: true }), F_noAttr: F({ noAttrition: true }), F_noPrior: F({ noPrior: true }), F_det: F({ deterministic: true }), F_y1only: F({ horizon: 1 }) };
      for (const k of [10, 20, 40]) for (const gm of [1, 1.5, 2]) row[`V_k${k}_g${gm}`] = F({ priorK: k, agingPower: gm });
      for (const k of [5, 10, 20, 40]) row[`P_k${k}`] = F({ priorK: k, agingPower: 2 });
      row.C_base = F({ priorK: 20, agingPower: 2 });
      row.G_15 = F({ priorK: 20, agingPower: 2, growthPower: 1.5 });
      row.G_1 = F({ priorK: 20, agingPower: 2, growthPower: 1 });
      row.C_wr10 = F({ priorK: { WR: 10 }, agingPower: 2 });
      row.C_smooth = F({ priorK: 20, agingPower: 2, priorSmooth: true });
      row.C_both = F({ priorK: { WR: 10 }, agingPower: 2, priorSmooth: true });
      rows.push(row);
    }
    const withF = rows.filter((r) => r.F !== null);
    const rhoOf = (key, higher = true) => mean(POS.map((p) => { const z = withF.filter((r) => r.pos === p && r[key] !== null); return spearman(z.map((r) => (higher ? r[key] : -r[key])), z.map((r) => r.target)); }).filter(Number.isFinite));
    const pct = (xs, key, higher) => { const s = [...xs].sort((a, b) => (higher ? b[key] - a[key] : a[key] - b[key])); const mm = new Map(); s.forEach((r, i) => mm.set(r.g, i / Math.max(1, s.length - 1))); return mm; };
    const blendRho = (w) => mean(POS.map((p) => {
      const z = withF.filter((r) => r.pos === p);
      const a = pct(z, 'rank', false), b = pct(z, 'F', true);
      return spearman(z.map((r) => -(w * a.get(r.g) + (1 - w) * b.get(r.g))), z.map((r) => r.target));
    }).filter(Number.isFinite));
    out.results.push({
      season: Y, snapshot: snap.date, n: rows.length, nWithFundamental: withF.length,
      // Young AND already good (age < 24, consensus top third at the position): over/under-rating by aging power.
      growthVariants: Object.fromEntries(['C_base', 'G_15', 'G_1'].map((key) => { const yb = [], gb = []; for (const p of POS) { const zz = withF.filter((r) => r.pos === p && r[key] !== null); const a = pct(zz, key, true), b = pct(zz, 'target', true); yb.push(...zz.filter((r) => r.age !== null && r.age < 24).map((r) => b.get(r.g) - a.get(r.g))); gb.push(...zz.filter((r) => r.age !== null && r.age < 24 && r.rank <= TOPN[p] / 3).map((r) => b.get(r.g) - a.get(r.g))); } return [key, { rho: r3(rhoOf(key)), youngBias: r3(-mean(yb)), youngGoodBias: r3(-mean(gb)) }]; })),
      youngGoodBias: Object.fromEntries([1, 1.5, 2].map((gm) => { const key = `V_k20_g${gm}`; const d = []; for (const p of POS) { const zz = withF.filter((r) => r.pos === p && r[key] !== null); const a = pct(zz, key, true), b = pct(zz, 'target', true); d.push(...zz.filter((r) => r.age !== null && r.age < 24 && r.rank <= TOPN[p] / 3).map((r) => b.get(r.g) - a.get(r.g))); } return [`g${gm}`, { n: d.length, meanOverrating: r3(mean(d)) }]; })),
      candidates: Object.fromEntries(['C_base', 'C_wr10', 'C_smooth', 'C_both'].map((c) => [c, Object.fromEntries(POS.map((p) => { const z = withF.filter((r) => r.pos === p && r[c] !== null); return [p, r3(spearman(z.map((r) => r[c]), z.map((r) => r.target)))]; }))])),
      priorKByPos: Object.fromEntries(POS.map((p) => [p, Object.fromEntries([5, 10, 20, 40].map((k) => { const z = withF.filter((r) => r.pos === p && r[`P_k${k}`] !== null); return [k, r3(spearman(z.map((r) => r[`P_k${k}`]), z.map((r) => r.target)))]; }))])),
      priorKYoung: Object.fromEntries(POS.map((p) => [p, Object.fromEntries([5, 10, 20, 40].map((k) => { const z = withF.filter((r) => r.pos === p && r.age !== null && r.age < 25 && r[`P_k${k}`] !== null); return [k, z.length >= 8 ? r3(spearman(z.map((r) => r[`P_k${k}`]), z.map((r) => r.target))) : null]; }))])),
      variants: Object.fromEntries([10, 20, 40].flatMap((k) => [1, 1.5, 2].map((gm) => [`k${k}_g${gm}`, r3(rhoOf(`V_k${k}_g${gm}`))]))),
      variantAgeBias: Object.fromEntries([10, 20, 40].flatMap((k) => [1, 1.5, 2].map((gm) => { const key = `V_k${k}_g${gm}`; let young = [], old = []; for (const p of POS) { const zz = withF.filter((r) => r.pos === p && r[key] !== null); const a = pct(zz, key, true), b = pct(zz, 'target', true); young = young.concat(zz.filter((r) => r.age !== null && r.age < 24).map((r) => b.get(r.g) - a.get(r.g))); old = old.concat(zz.filter((r) => r.age !== null && r.age >= 27).map((r) => b.get(r.g) - a.get(r.g))); } return [`k${k}_g${gm}`, { young: r3(mean(young)), old: r3(mean(old)) }]; }))),
      rho: { ecr: r3(rhoOf('rank', false)), fundamental: r3(rhoOf('F')), fundamental_survMult: r3(rhoOf('F_survMult')), noAgeCurve: r3(rhoOf('F_noAge')), noAttrition: r3(rhoOf('F_noAttr')), noDraftPrior: r3(rhoOf('F_noPrior')), deterministicSurplus: r3(rhoOf('F_det')), year1Only: r3(rhoOf('F_y1only')), blend_ecr25: r3(blendRho(0.25)), blend_ecr50: r3(blendRho(0.5)), blend_ecr75: r3(blendRho(0.75)) },
    });
    for (const [lab, lo, hi] of [['<=23', 0, 23.99], ['24-26', 24, 26.99], ['27-29', 27, 29.99], ['30+', 30, 99]]) {
      for (const [mname, key, higher] of [['ecr', 'rank', false], ['fundamental', 'F', true]]) {
        let diffs = [];
        for (const p of POS) {
          const zz = withF.filter((r) => r.pos === p);
          const a = pct(zz, key, higher), b = pct(zz, 'target', true);
          // positive = model ranked the player BETTER than the outcome (overrated)
          diffs = diffs.concat(zz.filter((r) => r.age !== null && r.age >= lo && r.age <= hi).map((r) => b.get(r.g) - a.get(r.g)));
        }
        out.ageBias.push({ season: Y, model: mname, age: lab, n: diffs.length, meanOverrating: r3(mean(diffs)) });
      }
    }
  }
  const keys = Object.keys(out.results[0]?.rho || {});
  out.summary = Object.fromEntries(keys.map((k) => [k, r3(mean(out.results.map((r) => r.rho[k]).filter(Number.isFinite)))]));
  const vk = Object.keys(out.results[0]?.variants || {});
  out.variantSummary = Object.fromEntries(vk.map((k) => [k, { rho: r3(mean(out.results.map((r) => r.variants[k]))), youngBias: r3(mean(out.results.map((r) => r.variantAgeBias[k].young))), oldBias: r3(mean(out.results.map((r) => r.variantAgeBias[k].old))), minSeasonRho: r3(Math.min(...out.results.map((r) => r.variants[k]))) }]));
  const ab = {};
  for (const r of out.ageBias) ((ab[r.model] ||= {})[r.age] ||= []).push(r.meanOverrating);
  out.ageBiasSummary = Object.fromEntries(Object.entries(ab).map(([m, v]) => [m, Object.fromEntries(Object.entries(v).map(([a, xs]) => [a, r3(mean(xs.filter(Number.isFinite)))]))]));
  return out;
}

/** Aging (delta method, symmetric selection, shrunk to default), attrition and draft priors from seasons < Y only. */
export function calibrateBefore(hist, Y, { regularize = true, concave = 'decline' } = {}) {
  const defaults = readJSONSync(path.join(ROOT, 'config', 'model.json')).dynasty.default_aging_curves;
  const aging = {}, hazard = {};
  let agingN = 0;
  for (const pos of POS) {
    const acc = {};
    const rel = {};
    for (const arr of hist.seasons.values()) for (let i = 0; i < arr.length; i++) {
      const a = arr[i], b = arr[i + 1];
      if (a.pos !== pos || a.season >= Y - 1) continue;
      const age = a.age === null ? null : Math.floor(a.age);
      if (b && b.pos === pos && b.season === a.season + 1 && b.season < Y && age !== null && a.games >= 6 && b.games >= 6 && Math.max(a.ppg, b.ppg) >= 5) {
        const w = 2 / (1 / a.games + 1 / b.games);
        (acc[age] ||= { s: 0, w: 0, n: 0 }); acc[age].s += w * (b.ppg - a.ppg); acc[age].w += w; acc[age].n++; agingN++;
      }
      if (age !== null && a.ppg >= 8 && a.games >= 8) {
        const nx = arr.find((x) => x.season === a.season + 1);
        (rel[age] ||= { e: 0, n: 0 }); rel[age].n++; if (!nx || nx.games < 4) rel[age].e++;
      }
    }
    const defPts = Object.entries(defaults[pos]).map(([k, v]) => [Number(k), v]).sort((x, y) => x[0] - y[0]);
    const level = { 22: 10 };
    for (let a = 22; a < 42; a++) level[a + 1] = level[a] + (acc[a] && acc[a].n >= 10 ? acc[a].s / acc[a].w : 0);
    for (let a = 21; a >= 20; a--) level[a] = level[a + 1] - 0.5;
    const minL = Math.min(...Object.values(level));
    const pk = Math.max(...Object.values(level).map((v) => v - minL + 3));
    aging[pos] = Object.keys(level).map(Number).sort((a, b) => a - b).map((a) => {
      const n = Math.min(acc[a]?.n || 0, acc[a - 1]?.n || 0), w = n / (n + 80);
      return [a, w * ((level[a] - minL + 3) / pk) + (1 - w) * interp(defPts, a)];
    });
    const pk2 = Math.max(...aging[pos].map((x) => x[1]));
    aging[pos] = aging[pos].map(([a, v]) => [a, v / pk2]);
    if (regularize) {
      // Same shape constraints as scripts/calibrate.js (scripts/lib/calibration-shape.js).
      const supported = Object.keys(acc).map(Number).filter((a) => acc[a].n >= 15);
      const reg = unimodalAgeCurve(Object.fromEntries(aging[pos]), supported.length ? Math.max(...supported) + 1 : undefined, { concave });
      aging[pos] = Object.entries(reg).map(([a, v]) => [Number(a), v]).sort((x, y) => x[0] - y[0]);
      const hz = monotoneHazard(Object.fromEntries(Object.entries(rel).map(([a, r]) => [a, { exits: r.e, n: r.n }])));
      hazard[pos] = (age) => hz[Math.min(42, Math.max(21, Math.floor(age)))] ?? 0.1;
    } else {
      hazard[pos] = (age) => { let e = 0, n = 0; for (let b = Math.floor(age) - 1; b <= Math.floor(age) + 1; b++) if (rel[b]) { e += rel[b].e; n += rel[b].n; } return n >= 15 ? e / n : 0.1; };
    }
  }
  // draft priors: classes whose career year k ended before Y
  const priors = {};
  const priorClasses = new Set();
  for (const [g, m] of hist.meta) {
    const pos = m.position === 'FB' ? 'RB' : m.position;
    if (!POS.includes(pos)) continue;
    const dy = toNum(m.draft_year) ?? toNum(m.rookie_season);
    if (!dy || dy < 2006) continue;
    const b = bucket({ dr: toNum(m.draft_round), dp: toNum(m.draft_pick) });
    for (let k = 1; k <= 5; k++) {
      const yy = dy + k - 1;
      if (yy >= Y) break;
      priorClasses.add(dy);
      const row = (hist.seasons.get(g) || []).find((r) => r.season === yy);
      const c = ((((priors[pos] ||= {})[b] ||= []))[k - 1] ||= { n: 0, s: 0, play: 0 });
      c.n++; if (row && row.games >= 4) { c.s += row.ppg; c.play++; }
    }
  }
  const prior = (pos, b, k) => { const c = priors[pos]?.[b]?.[Math.min(5, Math.max(1, k)) - 1]; if (!c || c.play < 5) return null; return (c.s / c.play) * Math.min(1, (c.play / c.n) / 0.82); };
  // Smoothed across neighbouring career years (count-weighted ±1 year): each cell averages only the players of one
  // draft bucket and career year, so single cells swing with a handful of players.
  const priorSmooth = (pos, b, k) => {
    const kk = Math.min(5, Math.max(1, k));
    let sv = 0, sp = 0, sn = 0;
    for (const j of [kk - 1, kk, kk + 1]) { const c = priors[pos]?.[b]?.[j - 1]; if (!c) continue; sv += c.s; sp += c.play; sn += c.n; }
    if (sp < 5) return null;
    return (sv / sp) * Math.min(1, (sp / sn) / 0.82);
  };
  // E19: hazard multiplier for the transitions after the first. Compounding the hazard of currently relevant players
  // over-states multi-year survival for RB/WR/TE (survivors who decline exit faster) and under-states it for QBs.
  // One factor per position, fitted on seasons before Y: observed P(≥ 4 games k = 2..4 seasons later) vs
  // Π_j (1 − h(age + j) · (j ≥ 1 ? m : 1)).
  const survMult = {};
  for (const pos of POS) {
    const obs = [];
    for (const arr of hist.seasons.values()) {
      const by = new Map(arr.map((r) => [r.season, r]));
      for (const a of arr) {
        if (a.pos !== pos || a.age === null || !(a.ppg >= 8 && a.games >= 8)) continue;
        for (let k = 2; k <= 4; k++) { if (a.season + k >= Y) break; const nx = by.get(a.season + k); obs.push({ age: a.age, k, active: nx && nx.games >= 4 ? 1 : 0 }); }
      }
    }
    let best = null;
    for (let mm = 0.5; mm <= 2.501; mm += 0.05) {
      let err = 0;
      for (const o of obs) { let sv = 1; for (let j = 0; j < o.k; j++) sv *= 1 - Math.min(0.95, hazard[pos](o.age + j) * (j ? mm : 1)); err += (o.active - sv) ** 2; }
      if (!best || err < best.err) best = { mm, err };
    }
    survMult[pos] = best ? Math.round(best.mm * 100) / 100 : 1;
  }
  return { aging, hazard, prior, priorSmooth, agingN, priorClasses: [...priorClasses].length, survMult };
}
const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function fundamental(seasonRows, cal, g, m, pos, Y, age, r, opt) {
  // Reduced form of js/core/valuation/dynasty.js using only information available before season Y.
  const prev = seasonRows.get(`${g}|${Y - 1}`), prev2 = seasonRows.get(`${g}|${Y - 2}`);
  const ev = [];
  if (prev && prev.games >= 4) ev.push({ v: prev.ppg, w: 0.8 * Math.min(1, prev.games / 8) });
  if (prev2 && prev2.games >= 4) ev.push({ v: prev2.ppg, w: 0.4 * Math.min(1, prev2.games / 8) });
  const dy = toNum(m.draft_year) ?? toNum(m.rookie_season);
  const careerYear = dy ? Y - dy + 1 : 1;
  const prior = opt.priorSmooth ? cal.priorSmooth : cal.prior;
  const p = opt.noPrior ? null : prior(pos, bucket({ dr: toNum(m.draft_round), dp: toNum(m.draft_pick) }), careerYear);
  const careerGames = (prev?.games || 0) + (prev2?.games || 0);
  const pk = typeof opt.priorK === 'object' ? opt.priorK[pos] ?? 20 : opt.priorK ?? 10;
  if (p !== null) ev.push({ v: p, w: pk / (pk + careerGames) });
  const sw = ev.reduce((a, e) => a + e.w, 0);
  if (!sw || age === null) return null;
  const mu1 = ev.reduce((a, e) => a + e.v * e.w, 0) / sw;
  const A = (a) => (opt.noAge ? 1 : interp(cal.aging[pos], a) ** (opt.agingPower ?? 1));
  const H = opt.horizon || 5;
  let F = 0, surv = 1;
  for (let t = 1; t <= H; t++) {
    if (t > 1 && !opt.noAttrition) surv *= 1 - Math.min(0.95, cal.hazard[pos](age + t - 2) * (opt.survMult && t > 2 && (!opt.survMultPos || opt.survMultPos.includes(pos)) ? cal.survMult[pos] : 1));
    // opt.growthPower: separate power for improvement (ratio > 1) and decline (aging power), E20.
    const ratioRaw = opt.noAge ? 1 : interp(cal.aging[pos], age + t - 1) / interp(cal.aging[pos], age);
    const mu = opt.growthPower !== undefined ? mu1 * ratioRaw ** (ratioRaw > 1 ? opt.growthPower : opt.agingPower ?? 1) : (mu1 * A(age + t - 1)) / A(age);
    const M = mu * 17 * 0.82, S = (opt.cvMult ?? 1) * (0.3 + 0.12 * (t - 1)) * M;
    F += 0.82 ** (t - 1) * surv * (opt.deterministic ? Math.max(0, M - r) : expectedSurplus(M, S, r));
  }
  return F;
}
function bucket(m) { if (!m.dr) return 'UDFA'; if (m.dr === 1) return m.dp && m.dp <= 16 ? 'R1a' : 'R1b'; if (m.dr === 2) return 'R2'; if (m.dr === 3) return 'R3'; if (m.dr <= 5) return 'R4-5'; return 'R6-7'; }

export function buildSeasonTable(bench) {
  const t = new Map();
  for (const [g, seasons] of Object.entries(bench.weekly)) {
    const pos = bench.meta[g]?.pos;
    for (const [y, ws] of Object.entries(seasons)) {
      const pl = ws.filter(played);
      const pts = ws.reduce((a, wk) => a + weekPts(wk.st, pos), 0);
      t.set(`${g}|${y}`, { g, y: Number(y), pos, pts, gp: pl.length, ppg: pl.length ? pts / pl.length : 0 });
    }
  }
  return t;
}
function replFor(seasonRows, y, pos) {
  const xs = [...seasonRows.values()].filter((r) => r.y === y && r.pos === pos).map((r) => r.pts).sort((a, b) => b - a);
  return xs[REPL_RANK[pos] - 1] ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// E4 — ROOKIE SLOT CURVE FORM: leave-one-class-out comparison of curve families
// ---------------------------------------------------------------------------------------------------------------
export function rookieCurve(bench) {
  const seasonRows = buildSeasonTable(bench);
  const classes = {};
  for (const Y of [2019, 2020, 2021, 2022, 2023]) {
    const first = bench.schedule[Y]?.weeks[1]?.first;
    // last rookie list scraped in Jun–Aug of the class year (after the NFL draft, before the season)
    const dates = Object.keys(bench.rankings.rookie || {}).filter((d) => d >= `${Y}-06-01` && d < first).sort();
    const d = dates[dates.length - 1];
    if (!d) continue;
    const list = bench.rankings.rookie[d].filter((r) => { const m = bench.meta[r.g]; return m && (m.rookie === Y || m.dy === Y); }).sort((a, b) => a.ecr - b.ecr);
    classes[Y] = list.map((r, i) => {
      let v = 0;
      for (let k = 0; k < 3; k++) { const s = seasonRows.get(`${r.g}|${Y + k}`); if (s) v += 0.82 ** k * Math.max(0, s.pts - replFor(seasonRows, Y + k, r.pos)); }
      return { p: i + 1, v };
    });
  }
  const years = Object.keys(classes).map(Number);
  const P = 48;
  const families = {
    isotonicAverage: (train) => { const avg = Array.from({ length: P }, (_, i) => mean(train.map((c) => c[i]?.v).filter(Number.isFinite))); return isotonicDecreasing(avg); },
    exponential: (train) => fitParam(train, (p, a, b) => a * Math.exp(-b * (p - 1))),
    power: (train) => fitParam(train, (p, a, b) => a * p ** -b),
    linear: (train) => fitParam(train, (p, a, b) => Math.max(0, a - b * (p - 1))),
    logarithmic: (train) => fitParam(train, (p, a, b) => Math.max(0, a - b * Math.log(p))),
    // least squares targets the conditional MEAN (what an additive trade value needs); the MAE fits above target the median
    exponentialLS: (train) => fitParam(train, (p, a, b) => a * Math.exp(-b * (p - 1)), 'sq'),
    linearLS: (train) => fitParam(train, (p, a, b) => Math.max(0, a - b * (p - 1)), 'sq'),
  };
  const res = {};
  for (const [name, fit] of Object.entries(families)) {
    const errs = [], biases = [], top12 = [];
    for (const Y of years) {
      const train = years.filter((t) => t !== Y).map((t) => classes[t]);
      const curve = fit(train);
      const test = classes[Y].slice(0, P);
      errs.push(mean(test.map((x) => Math.abs((curve[x.p - 1] ?? 0) - x.v))));
      biases.push(mean(test.map((x) => (curve[x.p - 1] ?? 0) - x.v)));
      top12.push(mean(test.slice(0, 12).map((x) => (curve[x.p - 1] ?? 0) - x.v)));
    }
    res[name] = { looMAE: r3(mean(errs)), looBias: r3(mean(biases)), looBiasTop12: r3(mean(top12)), byClass: errs.map(r3) };
  }
  const pooled = Array.from({ length: P }, (_, i) => mean(years.map((y) => classes[y][i]?.v).filter(Number.isFinite)));
  const iso = isotonicDecreasing(pooled);
  const drops = iso.slice(0, 24).map((v, i) => ({ pick: i + 1, value: r3(v), dropToNext: r3(v - (iso[i + 1] ?? 0)) }));
  const classTop12 = Object.fromEntries(years.map((y) => [y, r3(mean(classes[y].slice(0, 12).map((x) => x.v)))]));
  return { experiment: 'E4 rookie slot value curve (leave-one-class-out)', classes: Object.fromEntries(years.map((y) => [y, classes[y].length])), families: res, pooledCurve: drops, classStrengthTop12: classTop12, classStrengthCV: r3(sd(Object.values(classTop12)) / mean(Object.values(classTop12))) };
}

function fitParam(train, f, loss = 'abs') {
  const pts = [];
  for (const c of train) for (const x of c.slice(0, 48)) pts.push(x);
  let best = null;
  const maxV = Math.max(...pts.map((x) => x.v), 1);
  for (let a = maxV * 0.05; a <= maxV * 1.5; a += maxV * 0.02) {
    for (const b of [0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1, 1.3, 1.6, 2, 3, 5, 8, 12, 20]) {
      const e = mean(pts.map((x) => (loss === 'sq' ? (f(x.p, a, b) - x.v) ** 2 : Math.abs(f(x.p, a, b) - x.v))));
      if (!best || e < best.e) best = { a, b, e };
    }
  }
  return Array.from({ length: 48 }, (_, i) => f(i + 1, best.a, best.b));
}
