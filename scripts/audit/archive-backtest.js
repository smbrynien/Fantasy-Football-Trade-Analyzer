// E13 — BACKTEST FROM THE APP'S OWN DAILY SIGNAL ARCHIVE (server/archive.js; REAL data once a season has been archived).
//
// E9 could test consensus, projections and ADP on public archives; trade-market values have none. The app archives
// every day's signals, so after a completed season this experiment measures, at every archived in-season week, how
// well each group predicted rest-of-season points — market included — and which blend weights would have done best.
// Checkpoints: the last archived day of each NFL week (state.week = W, regular season) → target = PPR points in weeks
// W+1…end (nflverse). Groups: consensus (ROS ECR positional rank), market (FantasyCalc-style redraft list closest to
// 12-team 1QB PPR → positional rank), projection (rest-of-season projection points). Rank groups map to points by a
// curve, points groups by a line, fitted WITHOUT the test checkpoint: on earlier seasons when the archive has them,
// otherwise on the season's other checkpoints (leave-one-checkpoint-out; flagged — weaker than walk-forward).

import { fitRankCurve, metrics, fitLinear } from './backtests.js';
import { scoreStats, resolveScoring } from '../../js/core/scoring.js';
import { mean } from '../../js/core/util/stats.js';
import { readJSONSync } from '../../server/lib/store.js';
import path from 'node:path';
import { ROOT } from '../../server/lib/paths.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const GROUPS = ['consensus', 'market', 'projection'];
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** The last archived day of each (season, week) in the regular season. */
export function checkpointsOf(days) {
  const by = new Map();
  for (const d of days) {
    const st = d.state || {};
    if (st.season_type && st.season_type !== 'regular') continue;
    const W = Number(st.week), Y = Number(st.season);
    if (!(W >= 1) || !Y) continue;
    const k = `${Y}:${W}`;
    if (!by.has(k) || by.get(k).date < d.date) by.set(k, d);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function positionalRanks(entries, higherIsBetter) {
  const out = new Map();
  for (const pos of POS) entries.filter((e) => e.pos === pos).sort((a, b) => (higherIsBetter ? b.v - a.v : a.v - b.v)).forEach((e, i) => out.set(e.key, i + 1));
  return out;
}

/**
 * Rows of one checkpoint: one per player with a GSIS id, its group inputs and its realised rest-of-season points.
 * outcomes: (gsis, season, fromWeek) → points (null = unknown player).
 */
export function checkpointRows(day, outcomes, scoring) {
  const Y = Number(day.state.season), W = Number(day.state.week);
  const players = day.players.filter((p) => p.gsis && POS.includes(p.pos));
  const ecr = [], mkt = [];
  for (const p of players) {
    const r = p.rank.find((x) => x[1] === 'ros' && x[2] === 'position' && (x[3] === '1qb' || x[3] === null)) || p.rank.find((x) => x[1] === 'redraft' && x[2] === 'position');
    if (r && Number.isFinite(r[5])) ecr.push({ key: p.gsis, pos: p.pos, v: r[5] });
    const m = p.mkt.filter((x) => x[1] === 0 && Number.isFinite(x[6])).sort((a, b) => (a[2] === '1qb' ? 0 : 1) - (b[2] === '1qb' ? 0 : 1) || Math.abs((a[3] ?? 1) - 1) - Math.abs((b[3] ?? 1) - 1) || Math.abs((a[4] ?? 12) - 12) - Math.abs((b[4] ?? 12) - 12))[0];
    if (m) mkt.push({ key: p.gsis, pos: p.pos, v: m[6] });
  }
  const rE = positionalRanks(ecr, false), rM = positionalRanks(mkt, true);
  const rows = [];
  for (const p of players) {
    const target = outcomes(p.gsis, Y, W + 1);
    if (target === null || target === undefined) continue;
    const ros = p.proj.filter((x) => x[1] === 'ros');
    const pts = ros.map((x) => scoreStats(x[4] || {}, p.pos, scoring, {}).points).filter(Number.isFinite);
    rows.push({ g: p.gsis, pos: p.pos, Y, W, date: day.date, rankE: rE.get(p.gsis) ?? null, rankM: rM.get(p.gsis) ?? null, projPts: pts.length ? mean(pts) : null, target });
  }
  return rows;
}

function predict(train, test) {
  const cE = fitRankCurve(train.filter((r) => r.rankE).map((r) => ({ pos: r.pos, rank: r.rankE, y: r.target })));
  const cM = fitRankCurve(train.filter((r) => r.rankM).map((r) => ({ pos: r.pos, rank: r.rankM, y: r.target })));
  const lin = Object.fromEntries(POS.map((pos) => { const xs = train.filter((r) => r.pos === pos && r.projPts !== null); return [pos, fitLinear(xs.map((r) => r.projPts), xs.map((r) => r.target))]; }));
  return test.map((r) => ({ ...r, consensus: r.rankE ? cE(r.pos, r.rankE) : null, market: r.rankM ? cM(r.pos, r.rankM) : null, projection: r.projPts !== null ? lin[r.pos].a + lin[r.pos].b * r.projPts : null }));
}

function blend(r, w) { let s = 0, ws = 0; GROUPS.forEach((g, i) => { if (Number.isFinite(r[g]) && w[i] > 0) { s += w[i] * r[g]; ws += w[i]; } }); return ws ? s / ws : null; }
function simplex() { const out = []; for (let a = 0; a <= 10; a++) for (let b = 0; a + b <= 10; b++) out.push([a / 10, b / 10, (10 - a - b) / 10]); return out; }

/**
 * @param days      archive day records (loadArchiveDay), any order
 * @param outcomes  (gsis, season, fromWeek) → realised PPR points from that week to the end of the season, or null
 * @param appWeights [consensus, market, projection] — the app's in-season weights for these groups
 * @param minCheckpoints  per completed season
 */
export function archiveBacktest(days, outcomes, { appWeights = [0.45, 0.15, 0.30], minCheckpoints = 4, completedSeasons = null, scoring = null } = {}) {
  const ppr = scoring || resolveScoring({ scoring_preset: 'ppr', scoring: {} }, readJSONSync(path.join(ROOT, 'config', 'league-defaults.json')));
  const cps = checkpointsOf(days);
  const seasons = [...new Set(cps.map((c) => Number(c.state.season)))].filter((y) => !completedSeasons || completedSeasons.includes(y)).sort();
  const usable = seasons.filter((y) => cps.filter((c) => Number(c.state.season) === y).length >= minCheckpoints);
  if (!usable.length) {
    return { skipped: true, reason: `The archive has ${days.length} day(s) (${days[0]?.date ?? '—'} … ${days[days.length - 1]?.date ?? '—'}) and no completed season with at least ${minCheckpoints} archived weeks yet. Keep the app syncing; the first full test is possible after the season ends.`, archivedDays: days.length };
  }
  const rowsByCp = new Map(cps.filter((c) => usable.includes(Number(c.state.season))).map((c) => [c.date, checkpointRows(c, outcomes, ppr)]));
  const results = [];
  for (const [date, test] of rowsByCp) {
    const Y = test[0]?.Y;
    const earlier = [...rowsByCp].filter(([d, rs]) => d !== date && rs[0]?.Y < Y).flatMap(([, rs]) => rs);
    const train = earlier.length ? earlier : [...rowsByCp].filter(([d, rs]) => d !== date && rs[0]?.Y === Y).flatMap(([, rs]) => rs);
    if (!train.length || !test.length) continue;
    const tr = predict(train, train), te = predict(train, test);
    const full = tr.filter((r) => GROUPS.every((g) => Number.isFinite(r[g])));
    let best = null;
    for (const w of simplex()) { const e = mean(full.map((r) => Math.abs(blend(r, w) - r.target))); if (e !== null && (!best || e < best.e)) best = { w, e }; }
    for (const r of te) { r.app = blend(r, appWeights); r.fit = best ? blend(r, best.w) : null; }
    const same = te.filter((r) => GROUPS.every((g) => Number.isFinite(r[g])));
    results.push({ date, season: Y, week: test[0]?.W, method: earlier.length ? 'walk-forward (earlier seasons)' : 'leave-one-checkpoint-out (same season)', n: same.length, fittedWeights: best ? Object.fromEntries(GROUPS.map((g, i) => [g, best.w[i]])) : null, ...Object.fromEntries([...GROUPS, 'app', 'fit'].map((k) => [k, metrics(same, k)])) });
  }
  const keys = [...GROUPS, 'app', 'fit'];
  const summary = Object.fromEntries(keys.map((k) => [k, { rho: r3(mean(results.map((r) => r[k].rho).filter(Number.isFinite))), mae: r3(mean(results.map((r) => r[k].mae).filter(Number.isFinite))) }]));
  return { skipped: false, archivedDays: days.length, seasons: usable, checkpoints: results.length, appWeights: Object.fromEntries(GROUPS.map((g, i) => [g, appWeights[i]])), summary, results };
}
