// E5 — HINDSIGHT-FREE LINEUP VALUE (REAL HISTORICAL DATA, walk-forward).
//
// The 2.0.0 audit (E1b) judged value definitions against "realised surplus" max(0, season points − replacement),
// which assumes a manager knew in advance which players to start, and charges a player the replacement's points for
// games he missed. Here a player's realised value is what he actually added to fantasy lineups WITHOUT hindsight:
//   each week he counts only if he would have been started on information available before that week (his ranking
//   at the start of the window blended with his scoring since), and then adds his points minus what the best
//   non-starters scored that week. Weeks he does not play add nothing — the alternative plays instead.
// Questions: (1) which outcome SD makes expected surplus proportionally right across tiers (values are rescaled so
// the top assets hit a fixed level — only RELATIVE value across tiers matters); (2) how much hindsight inflates the
// old target; (3) does weekly volatility change lineup value at equal rank; (4) availability by position and tier.
// Windows: preseason (preseason ECR, weeks 1–end) and in-season checkpoints (ROS ECR scraped during week W, weeks
// W+1–end). Leakage: rank→rate curves, availability, replacement rates and fitted σ come from earlier seasons only;
// start decisions use points strictly before the week (plus whether the player is active that week, which managers
// know before kickoff).

import { snapshotBefore } from './benchmark.js';
import { weekPts } from './backtests.js';
import { mean, sd, isotonicDecreasing, expectedSurplus, pearson } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TOPN = { QB: 32, RB: 60, WR: 72, TE: 32 };
const REPL = { QB: 12, RB: 30, WR: 42, TE: 12 }; // 12-team 1QB / 2RB / 2WR + FLEX share / 1TE — as E1
const TIERS = [[1, 6], [7, 12], [13, 24], [25, 36], [37, 72]];
const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
// The 2.1.x σ per game (config/model.json redraft.uncertainty.sd_per_game before 2.2.0) — the candidate under test.
// 2.2.0 ships 0.4 × this table (candidate 'v22').
export const MODEL_SIGMA = { preseason: { QB: 4.9, RB: 4.2, WR: 3.8, TE: 3.1 }, in_season: { QB: 5.5, RB: 4.4, WR: 4.3, TE: 3.8 } };
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const lastWeek = (y) => (y >= 2021 ? 18 : 17);
const isPlayed = (wk) => (wk.st.pass_att || 0) + (wk.st.rush_att || 0) + (wk.st.rec_tgt || 0) + (wk.st.rec || 0) > 0;

/** Ranking used at the start of a window: preseason ECR (startWeek 1) or the ROS ECR scraped during week W−1. */
function windowRanks(bench, y, startWeek) {
  const rank = new Map();
  if (startWeek === 1) {
    const first = bench.schedule[y]?.weeks[1]?.first;
    const snap = first && snapshotBefore(bench, 'redraft', first, 30);
    if (!snap) return null;
    for (const pos of POS) snap.rows.filter((r) => r.pos === pos && r.ecr !== null).sort((a, b) => a.ecr - b.ecr).forEach((r, i) => { if (!rank.has(r.g)) rank.set(r.g, i + 1); });
    return { date: snap.date, rank };
  }
  const W = startWeek - 1;
  const wkW = bench.schedule[y]?.weeks[W], nextFirst = bench.schedule[y]?.weeks[W + 1]?.first;
  if (!wkW || !nextFirst) return null;
  let date = null;
  for (const pos of POS) {
    const s = snapshotBefore(bench, pos === 'QB' ? 'ros:qb' : `ros:${pos.toLowerCase()}`, nextFirst, 10);
    if (!s || s.date < wkW.first) return null;
    date = s.date;
    s.rows.filter((r) => r.pos === pos && r.ecr !== null).sort((a, b) => a.ecr - b.ecr).forEach((r, i) => { if (!rank.has(r.g)) rank.set(r.g, i + 1); });
  }
  return { date, rank };
}

/** Players of one window: rank at the start, weekly points from startWeek (null = did not play), team games left. */
export function windowPlayers(bench, y, startWeek) {
  const wr = windowRanks(bench, y, startWeek);
  if (!wr) return null;
  const players = [];
  const ids = new Set([...wr.rank.keys(), ...Object.keys(bench.weekly).filter((g) => bench.weekly[g][y])]);
  for (const g of ids) {
    const pos = bench.meta[g]?.pos;
    if (!POS.includes(pos)) continue;
    const rows = bench.weekly[g]?.[y] || [];
    const pts = Array(lastWeek(y) + 1).fill(null);
    const teams = {};
    for (const wk of rows) { if (wk.w >= startWeek && isPlayed(wk)) pts[wk.w] = weekPts(wk.st, pos); teams[wk.team] = (teams[wk.team] || 0) + 1; }
    const team = Object.entries(teams).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const teamGames = team ? Object.keys(bench.schedule[y].opp[team] || {}).map(Number).filter((w) => w >= startWeek).length : lastWeek(y) - startWeek;
    const gp = pts.filter((p) => p !== null).length;
    if (!wr.rank.has(g) && !gp) continue;
    players.push({ g, pos, rank: wr.rank.get(g) ?? null, pts, gp, teamGames: teamGames || 1, total: pts.reduce((a, p) => a + (p || 0), 0) });
  }
  return { y, startWeek, date: wr.date, players };
}

/** Rank → points-per-game-played curve, availability by tier and an unranked prior, fitted on training windows. */
export function fitPriors(train) {
  const rate = {}, avail = {}, unranked = {};
  for (const pos of POS) {
    const rows = train.filter((p) => p.pos === pos);
    const raw = [];
    for (let r = 1; r <= 2 * TOPN[pos]; r++) {
      const h = Math.max(1, Math.round(r * 0.15));
      const xs = rows.filter((p) => p.rank && Math.abs(p.rank - r) <= h && p.gp >= 1);
      raw.push(xs.length ? xs.reduce((a, p) => a + p.total, 0) / xs.reduce((a, p) => a + p.gp, 0) : raw[raw.length - 1] ?? 0);
    }
    rate[pos] = isotonicDecreasing(raw);
    avail[pos] = TIERS.map(([a, b]) => { const xs = rows.filter((p) => p.rank >= a && p.rank <= b); return xs.length ? mean(xs.map((p) => p.gp / p.teamGames)) : 0.8; });
    const un = rows.filter((p) => !p.rank && p.gp >= 1);
    unranked[pos] = un.length ? un.reduce((a, p) => a + p.total, 0) / un.reduce((a, p) => a + p.gp, 0) : 3;
  }
  return {
    rateAt: (pos, rank) => (rank ? rate[pos][Math.min(rank, rate[pos].length) - 1] : unranked[pos]),
    availAt: (pos, rank) => { const i = TIERS.findIndex(([a, b]) => rank >= a && rank <= b); return avail[pos][i < 0 ? TIERS.length - 1 : i]; },
  };
}

/** Info-based weekly starts for one window → hindsight-free value per player and the mean replacement rate. */
function simulateStarts(win, priors, kInfo) {
  const { players, startWeek } = win;
  const W = players.reduce((m, p) => Math.max(m, p.pts.length - 1), 0);
  const value = new Map(players.map((p) => [p.g, 0]));
  const replRates = { QB: [], RB: [], WR: [], TE: [] };
  const sums = new Map(players.map((p) => [p.g, { n: 0, s: 0 }]));
  for (let w = startWeek; w <= W; w++) {
    for (const pos of POS) {
      const active = players.filter((p) => p.pos === pos && p.pts[w] !== null);
      if (active.length <= REPL[pos] + 3) continue;
      const info = active.map((p) => { const t = sums.get(p.g); return { p, v: (t.s + kInfo * priors.rateAt(pos, p.rank)) / (t.n + kInfo) }; }).sort((a, b) => b.v - a.v);
      const alt = mean(info.slice(REPL[pos], REPL[pos] + 3).map((x) => x.p.pts[w]));
      replRates[pos].push(alt);
      for (const x of info.slice(0, REPL[pos])) value.set(x.p.g, value.get(x.p.g) + x.p.pts[w] - alt);
    }
    for (const p of players) if (p.pts[w] !== null) { const t = sums.get(p.g); t.n++; t.s += p.pts[w]; }
  }
  return { value, replRate: Object.fromEntries(POS.map((pos) => [pos, mean(replRates[pos])])) };
}

/** Old (E1b) target: max(0, window points − replacement's window points), replacement at the fixed rank. */
function hindsightSurplus(players) {
  const out = new Map();
  for (const pos of POS) {
    const ps = players.filter((p) => p.pos === pos).sort((a, b) => b.total - a.total);
    const r = ps[REPL[pos] - 1]?.total ?? 0;
    for (const p of ps) out.set(p.g, Math.max(0, p.total - r));
  }
  return out;
}

/**
 * Relative accuracy across tiers. Values are rescaled so the top assets reach a fixed level (engine.scaleFactor), so a
 * uniform over/under-statement is harmless: k = Σ target / Σ prediction over ranks 1–12 (all positions), then
 * ratio(tier) = mean(k·prediction) / mean(target). 1.0 = proportionally right; >1 = the tier is over-valued relative
 * to stars. Also MAE after scaling.
 */
function relative(rows, key) {
  const top = rows.filter((r) => r.rank <= 12);
  const k = top.reduce((a, r) => a + r.target, 0) / Math.max(1e-9, top.reduce((a, r) => a + r[key], 0));
  const ratio = TIERS.map(([a, b]) => { const xs = rows.filter((r) => r.rank >= a && r.rank <= b); return { tier: `${a}-${b}`, n: xs.length, ratio: r3(mean(xs.map((r) => k * r[key])) / mean(xs.map((r) => r.target))) }; });
  const loss = ratio.reduce((a, t) => a + (Number.isFinite(t.ratio) && t.ratio > 0 ? Math.log(t.ratio) ** 2 : 0), 0);
  return { k: r3(k), mae: r3(mean(rows.map((r) => Math.abs(k * r[key] - r.target)))), ratio, loss: r3(loss) };
}

/**
 * One experiment (a start week and a kInfo): windows for every season, walk-forward predictions, candidates.
 * σ candidates: 0 (deterministic), the model table, m × model table with m fitted on earlier seasons (one parameter),
 * and the decomposition "rate-only" SD (total per-game SD with the weekly-noise share removed).
 */
export function lineupExperiment(bench, { startWeek = 1, kInfo = 4 } = {}) {
  const wins = {};
  for (const y of SEASONS) { const w = windowPlayers(bench, y, startWeek); if (w) wins[y] = w; }
  const years = Object.keys(wins).map(Number).sort();
  const sim = {};
  for (const y of years.slice(1)) {
    const priors = fitPriors(years.filter((t) => t < y).flatMap((t) => wins[t].players));
    sim[y] = { priors, ...simulateStarts(wins[y], priors, kInfo), hind: hindsightSurplus(wins[y].players) };
  }
  const phase = startWeek === 1 ? 'preseason' : 'in_season';
  const sigModel = MODEL_SIGMA[phase];
  const predict = (p, pr, rr, sig) => pr.availAt(p.pos, p.rank) * p.teamGames * expectedSurplus(pr.rateAt(p.pos, p.rank), sig, rr[p.pos]);
  const rowsFor = (t, pr, rr, sigOf) => wins[t].players.filter((p) => p.rank && p.rank <= TOPN[p.pos]).map((p) => ({ y: t, g: p.g, pos: p.pos, rank: p.rank, target: sim[t].value.get(p.g), pred: predict(p, pr, rr, sigOf(p.pos)) }));
  const grid = Array.from({ length: 13 }, (_, i) => i * 0.1);
  const rowsAll = [];
  const folds = [];
  for (const y of years.slice(2)) {
    const trainYears = years.filter((t) => t < y && sim[t]);
    const priors = sim[y].priors;
    const replRate = Object.fromEntries(POS.map((pos) => [pos, mean(trainYears.map((t) => sim[t].replRate[pos]))]));
    // σ multiplier m fitted on earlier seasons (their own walk-forward priors), scale-invariant loss.
    let best = null;
    for (const m of grid) {
      const tr = trainYears.flatMap((t) => rowsFor(t, sim[t].priors, sim[t].replRate, (pos) => m * sigModel[pos]).map((r) => ({ ...r, x: r.pred })));
      const L = relative(tr, 'x').loss;
      if (!best || L < best.loss) best = { m, loss: L };
    }
    // Decomposition on earlier seasons: Var(PPG − forecast) = σ_rate² + mean(weekly variance / games).
    const sigRate = {};
    for (const pos of POS) {
      const tr = trainYears.flatMap((t) => wins[t].players.filter((p) => p.pos === pos && p.rank && p.rank <= TOPN[pos] && p.gp >= 6).map((p) => ({ p, t })));
      const resid = tr.map(({ p, t }) => p.total / p.gp - sim[t].priors.rateAt(pos, p.rank));
      const noise = tr.map(({ p }) => { const xs = p.pts.filter((v) => v !== null); return sd(xs) ** 2 / xs.length; });
      sigRate[pos] = Math.sqrt(Math.max(0, sd(resid) ** 2 - mean(noise)));
    }
    for (const p of wins[y].players.filter((q) => q.rank && q.rank <= TOPN[q.pos])) {
      rowsAll.push({
        y, g: p.g, pos: p.pos, rank: p.rank, target: sim[y].value.get(p.g), hindsight: sim[y].hind.get(p.g) ?? 0, gp: p.gp, teamGames: p.teamGames,
        det: predict(p, priors, replRate, 0), model: predict(p, priors, replRate, sigModel[p.pos]), v22: predict(p, priors, replRate, 0.4 * sigModel[p.pos]),
        fit: predict(p, priors, replRate, best.m * sigModel[p.pos]), rate: predict(p, priors, replRate, sigRate[p.pos]),
      });
    }
    folds.push({ season: y, fittedMultiplier: best.m, sigmaRateOnly: Object.fromEntries(Object.entries(sigRate).map(([k, v]) => [k, r3(v)])), replacementRate: Object.fromEntries(Object.entries(replRate).map(([k, v]) => [k, r3(v)])) });
  }
  const labels = { det: 'deterministic (σ = 0)', model: `expected surplus, 2.1.x σ (${phase} table)`, v22: 'expected surplus, 0.4 × 2.1.x σ (model 2.2.0)', fit: 'expected surplus, m × model σ, m fitted on earlier seasons', rate: 'expected surplus, rate-only σ (weekly noise removed)' };
  const candidates = Object.fromEntries(Object.entries(labels).map(([k, label]) => [k, { label, ...relative(rowsAll, k), byPos: Object.fromEntries(POS.map((pos) => [pos, relative(rowsAll.filter((r) => r.pos === pos), k).ratio])) }]));
  // The old target against the new one: relative shape (same k logic: old target as the "prediction").
  const hindsight = relative(rowsAll.map((r) => ({ ...r, h: r.hindsight })), 'h');
  return { startWeek, kInfo, phase, windows: Object.fromEntries(years.map((y) => [y, wins[y].date])), folds, candidates, hindsightVsNew: hindsight, rows: rowsAll, wins, sim };
}

export function lineupValue(bench) {
  const pre = lineupExperiment(bench, { startWeek: 1, kInfo: 4 });
  const robustness = [2, 8].map((k) => { const e = lineupExperiment(bench, { startWeek: 1, kInfo: k }); return { kInfo: k, fittedMultipliers: e.folds.map((f) => f.fittedMultiplier), candidates: strip(e.candidates) }; });
  const inSeason = [5, 9].map((s) => { const e = lineupExperiment(bench, { startWeek: s, kInfo: 4 }); return { startWeek: s, folds: e.folds, candidates: strip(e.candidates), hindsightVsNew: e.hindsightVsNew }; });
  // Volatility: at equal preseason rank, does last season's weekly CV predict the residual lineup value?
  const volatility = {};
  for (const pos of POS) {
    const xs = [];
    for (const r of pre.rows.filter((q) => q.pos === pos)) {
      const prev = pre.wins[r.y - 1]?.players.find((p) => p.g === r.g);
      const w = prev ? prev.pts.filter((v) => v !== null) : [];
      if (w.length < 8 || !(mean(w) > 0)) continue;
      xs.push({ cv: sd(w) / mean(w), resid: r.target - pre.candidates.fit.k * r.fit });
    }
    volatility[pos] = { n: xs.length, corrCvResidual: r3(pearson(xs.map((x) => x.cv), xs.map((x) => x.resid))), meanCv: r3(mean(xs.map((x) => x.cv))) };
  }
  // Availability: share of team games played, by preseason rank tier (evaluated seasons).
  const availability = Object.fromEntries(POS.map((pos) => [pos, TIERS.map(([a, b]) => { const xs = pre.rows.filter((r) => r.pos === pos && r.rank >= a && r.rank <= b); return { tier: `${a}-${b}`, n: xs.length, played: r3(mean(xs.map((r) => r.gp / r.teamGames))) }; })]));
  return {
    experiment: 'E5 hindsight-free lineup value (12-team 1QB PPR)',
    method: 'Weekly starts from the window-start ECR rank (rank→rate curve fitted on earlier seasons) blended with points since the window start (kInfo pseudo-games). Value = Σ over started weeks (points − mean of the 3 best non-starters that week). Predictions = availability(tier) × team games × E[max(0, rate − r)], all fitted on earlier seasons. Ratios are relative to ranks 1–12 (values are rescaled to the top assets).',
    preseason: { windows: pre.windows, folds: pre.folds, candidates: pre.candidates, hindsightVsNew: pre.hindsightVsNew },
    robustness, inSeason, volatility, availability,
  };
}

const strip = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { label: v.label, mae: v.mae, loss: v.loss, ratio: v.ratio }]));
