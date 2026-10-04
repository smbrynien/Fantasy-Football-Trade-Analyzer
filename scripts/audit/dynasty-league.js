// E15 / E16 — DYNASTY LEAGUE SIMULATION over three seasons (REAL HISTORICAL outcomes, SIMULATED leagues).
//
// The redraft verdict and the trade finder were validated on one season (E6/E7/E14). Dynasty trades pay off over
// years, so this replays three: for each start season Y = 2020–2023 (outcomes through 2025),
//   * values: the app's dynasty blend without the market (no market history exists) — the preseason FantasyPros
//     dynasty ECR mapped by positional rank onto the reduced fundamental curve (E3/E8: calibration refitted on seasons
//     before Y, model settings aging power 2, prior 20 pseudo-games) and the player's own fundamental, weights
//     consensus .40 / fundamental .25 renormalised (what the app does when the market is missing);
//   * league: 12 teams snake-draft 20-man rosters (QB ≤ 3, RB ≤ 7, WR ≤ 8, TE ≤ 3) by those values;
//   * seasons Y, Y+1, Y+2 are each replayed with real weekly points (E6's simulate: weekly best active lineup from
//     preseason ranks + points so far, one waiver pickup a week; rookies of later years reach rosters only through
//     waivers, for every team alike);
//   * outcome of a trade for a team = Σ_k 0.82^k × (season k points with the trade − without), 0.82 = the app's
//     balanced dynasty discount.
// E15: random trades (1-for-1 … 4-for-2) → how often the side receiving more value (app margin incl. the dynasty
//      package adjustment) came out ahead → logistic slope on the margin, as E7 for redraft (config
//      trade_outcome.dynasty_logit_slope) — the evidence for dynasty verdict levels (usability G-28).
// E16: the trade finder in dynasty (ranked by starting-lineup value) vs random fair and most-even packages, with the
//      other team's realised gain (the consolidation question in the handoff backlog).
// Not covered: draft picks (no historical pick values or rookie drafts in the simulation), Superflex, TE premium.

import { snapshotBefore } from './benchmark.js';
import { positionalRanks, calibrateBefore, fundamental } from './backtests.js';
import { windowPlayers, fitPriors } from './lineup.js';
import { rng, simulate, LEAGUE as RLEAGUE } from './league.js';
import { tradeCalibration } from './calibration.js';
import { computeLeagueStructure } from '../../js/core/valuation/replacement.js';
import { packageAdjustment } from '../../js/core/valuation/trade.js';
import { findTradePackages } from '../../js/core/trade-finder.js';
import { mean, sd, pearson } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TEAMS = 12, ROSTER = 20, HORIZON = 3, DELTA = 0.82;
const MIN = { QB: 1, RB: 2, WR: 2, TE: 1 };
const CAP = { QB: 3, RB: 7, WR: 8, TE: 3 };
const TYPES = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3], [3, 2], [2, 3], [4, 2], [2, 4]];
const REPL_RANK = { QB: 12, RB: 30, WR: 42, TE: 12 };
const LEAGUE = { ...RLEAGUE, roster: { ...RLEAGUE.roster, BENCH: ROSTER - 7 } };
const WEIGHTS = { fundamental: 0.25, consensus: 0.40 }; // config dynasty.weights without the market (renormalised)
// The app's fundamental since 2.5.0 (deep audit): aging power 2, draft prior 20 games (WRs 10), later-year attrition
// hazard × the walk-forward multiplier (E19).
const APP_FUNDAMENTAL = { priorK: { QB: 20, RB: 20, WR: 10, TE: 20 }, agingPower: 2, survMult: true };
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const ci = (xs) => { if (!xs.length) return { n: 0, mean: null, lo: null, hi: null }; const m = mean(xs), se = (sd(xs) || 0) / Math.sqrt(xs.length); return { n: xs.length, mean: r3(m), lo: r3(m - 1.96 * se), hi: r3(m + 1.96 * se) }; };

/** Preseason dynasty values of season Y (app blend without market) for every dynasty-ranked player. */
function dynastyValues(bench, hist, seasonRows, replOf, Y, fundOpt = {}) {
  const snap = snapshotBefore(bench, 'dynasty', bench.schedule[Y]?.weeks[1]?.first, 45);
  if (!snap) return null;
  const cal = calibrateBefore(hist, Y, { regularize: true });
  const ranks = positionalRanks(snap.rows);
  const own = new Map(), curves = {};
  for (const [g, { pos }] of ranks) {
    const m = hist.meta.get(g);
    if (!m) continue;
    const age = m.birth_date ? (new Date(`${Y}-09-01`) - new Date(m.birth_date)) / (365.25 * 864e5) : null;
    const F = fundamental(seasonRows, cal, g, m, pos, Y, age, replOf(Y - 1, pos), { ...APP_FUNDAMENTAL, ...fundOpt });
    own.set(g, F);
    if (F !== null) (curves[pos] ||= []).push(F);
  }
  for (const pos of POS) (curves[pos] ||= []).sort((a, b) => b - a);
  const value = new Map();
  for (const [g, { rank, pos }] of ranks) {
    const c = curves[pos];
    if (!c.length) continue;
    const mapped = c[Math.min(rank, c.length) - 1];
    const F = own.get(g);
    const v = F === null || F === undefined ? mapped : (WEIGHTS.fundamental * F + WEIGHTS.consensus * mapped) / (WEIGHTS.fundamental + WEIGHTS.consensus);
    if (v > 0) value.set(g, { v, pos, rank });
  }
  return { value, snapshot: snap.date };
}

/** Snake draft of 20-man dynasty rosters by value, respecting caps and the required starters. */
function draftDynasty(universe, rand) {
  const pool = [...universe].sort((a, b) => b.v - a.v);
  const rosters = Array.from({ length: TEAMS }, () => []);
  const taken = new Set();
  const order = Array.from({ length: TEAMS }, (_, i) => i).sort(() => rand() - 0.5);
  for (let round = 0; round < ROSTER; round++) {
    for (const t of round % 2 ? [...order].reverse() : order) {
      const r = rosters[t];
      const count = (pos) => r.filter((p) => p.pos === pos).length;
      const need = POS.filter((pos) => count(pos) < MIN[pos]);
      const mustNeed = ROSTER - r.length <= need.reduce((a, pos) => a + MIN[pos] - count(pos), 0);
      const p = pool.find((x) => !taken.has(x.g) && count(x.pos) < CAP[x.pos] && (!mustNeed || need.includes(x.pos)));
      if (!p) continue;
      taken.add(p.g); r.push(p);
    }
  }
  return rosters;
}

/** Swap, then restore 20-man rosters: the bigger side drops its least valuable surplus, the other signs free agents. */
function applyTradeDyn(rosters, a, b, outA, outB, universe) {
  const next = rosters.map((r) => [...r]);
  const gone = new Set([...outA, ...outB].map((p) => p.g));
  next[a] = next[a].filter((p) => !gone.has(p.g)).concat(outB);
  next[b] = next[b].filter((p) => !gone.has(p.g)).concat(outA);
  const rostered = new Set(next.flat().map((p) => p.g));
  const fas = universe.filter((p) => !rostered.has(p.g)).sort((x, y) => y.v - x.v);
  for (const t of [a, b]) {
    const r = next[t];
    const count = (pos) => r.filter((p) => p.pos === pos).length;
    while (r.length > ROSTER) {
      const drop = r.filter((p) => count(p.pos) > MIN[p.pos]).sort((x, y) => x.v - y.v)[0];
      if (!drop) break;
      r.splice(r.indexOf(drop), 1); rostered.delete(drop.g);
    }
    while (r.length < ROSTER) { const fa = fas.find((p) => !rostered.has(p.g) && count(p.pos) < CAP[p.pos]); if (!fa) break; r.push(fa); rostered.add(fa.g); }
  }
  return next;
}

/** Shared setup: seasons, priors, history tables. */
async function setup(bench) {
  const { loadSeasons } = await import('../lib/history-data.js');
  const hist = await loadSeasons(2006, 2025);
  const seasonRows = new Map();
  for (const arr of hist.seasons.values()) for (const r of arr) seasonRows.set(`${r.gsis}|${r.season}`, r);
  const replCache = new Map();
  const replOf = (y, pos) => {
    const k = `${y}|${pos}`;
    if (!replCache.has(k)) { const xs = [...seasonRows.values()].filter((r) => r.season === y && r.pos === pos).map((r) => r.pts).sort((a, b) => b - a); replCache.set(k, xs[REPL_RANK[pos] - 1] ?? 0); }
    return replCache.get(k);
  };
  const seasons = {};
  for (let y = 2019; y <= 2025; y++) { const w = windowPlayers(bench, y, 1); if (w) seasons[y] = w; }
  const years = Object.keys(seasons).map(Number).sort();
  const priorsCache = new Map();
  const priorsFor = (y) => { if (!priorsCache.has(y)) priorsCache.set(y, fitPriors(years.filter((t) => t < y).flatMap((t) => seasons[t].players))); return priorsCache.get(y); };
  return { hist, seasonRows, replOf, seasons, priorsFor };
}

/** One dynasty league for start season Y: values, rosters, the app-like valuation result and a 3-season replay. */
function buildLeague(ctx, bench, Y, rand, model, fundOpt = {}) {
  const dv = dynastyValues(bench, ctx.hist, ctx.seasonRows, ctx.replOf, Y, fundOpt);
  if (!dv || ![0, 1, 2].every((k) => ctx.seasons[Y + k])) return null;
  const universe = [...dv.value].map(([g, x]) => ({ g, ...x }));
  const byG = new Map(universe.map((p) => [p.g, p]));
  const rosters = draftDynasty(universe, rand);
  // App-like valuation result (dynasty mode) for analyzeTrade / packageAdjustment / the trade finder.
  const assets = new Map(universe.map((p) => [p.g, { id: p.g, kind: 'player', position: p.pos, value: p.v, sigma: 0, name: p.g, components: {}, groupValues: {} }]));
  const structure = computeLeagueStructure(universe.map((p) => ({ cid: p.g, position: p.pos, points: p.v })), LEAGUE);
  const result = {
    mode: 'dynasty', league: LEAGUE, structure, assets, phase: { phase: 'preseason' },
    meta: { model_version: model.model_version, data_version: `E15-${Y}` },
    model: { package: model.package, trade_outcome: model.trade_outcome },
  };
  const memo = new Map();
  const replay = (rs) => {
    const key = rs.map((r) => r.map((p) => p.g).sort().join(',')).join('|');
    if (memo.has(key)) return memo.get(key);
    const total = Array(TEAMS).fill(0);
    for (let k = 0; k < HORIZON; k++) {
      const season = ctx.seasons[Y + k];
      const inSeason = new Map(season.players.map((p) => [p.g, p]));
      const pts = simulate(season, ctx.priorsFor(Y + k), rs.map((r) => r.map((p) => inSeason.get(p.g)).filter(Boolean)));
      for (let t = 0; t < TEAMS; t++) total[t] += DELTA ** k * pts[t];
    }
    memo.set(key, total);
    return total;
  };
  return { Y, snapshot: dv.snapshot, universe, byG, rosters, result, replay, base: replay(rosters) };
}

function predict(result, getsA, getsB) {
  const A = getsA.map((g) => result.assets.get(g)), B = getsB.map((g) => result.assets.get(g));
  const sumA = A.reduce((s, a) => s + a.value, 0), sumB = B.reduce((s, a) => s + a.value, 0);
  const adjA = sumA - packageAdjustment(A, B.length, result).total, adjB = sumB - packageAdjustment(B, A.length, result).total;
  return { diff: adjA - adjB, adjA, adjB, rawDiff: sumA - sumB, valuesA: A.map((a) => a.value), valuesB: B.map((a) => a.value) };
}

/** E15: dynasty verdict calibration from random trades. */
export async function dynastyVerdictCalibration(bench, model, { tradesPerSeason = 800, seed = 15, fundOpt = {} } = {}) {
  const ctx = await setup(bench);
  const trades = [];
  const leagues = [];
  for (const Y of [2020, 2021, 2022, 2023]) {
    const rand = rng(seed + Y);
    const L = buildLeague(ctx, bench, Y, rand, model, fundOpt);
    if (!L) continue;
    leagues.push({ season: Y, snapshot: L.snapshot, players: L.universe.length });
    for (let k = 0; k < tradesPerSeason; k++) {
      const a = Math.floor(rand() * TEAMS); let b = Math.floor(rand() * (TEAMS - 1)); if (b >= a) b++;
      const [na, nb] = TYPES[Math.floor(rand() * TYPES.length)];
      const pickN = (r, n) => [...r].sort(() => rand() - 0.5).slice(0, n);
      const outA = pickN(L.rosters[a], na), outB = pickN(L.rosters[b], nb); // A sends outA, receives outB
      const next = applyTradeDyn(L.rosters, a, b, outA, outB, L.universe);
      const pts = L.replay(next);
      const gainA = pts[a] - L.base[a], gainB = pts[b] - L.base[b];
      const detail = predict(L.result, outB.map((p) => p.g), outA.map((p) => p.g));
      trades.push({ y: Y, type: `${nb}-for-${na}`, nA: nb, nB: na, outcome: gainA - gainB, gainA, gainB, detail });
    }
  }
  const cal = tradeCalibration(trades);
  const bySeason = Object.fromEntries(leagues.map((l) => [l.season, tradeCalibration(trades.filter((t) => t.y === l.season)).logistic.slope]));
  const pct = (t) => t.detail.diff / Math.max(t.detail.adjA, t.detail.adjB);
  const won = (t) => Math.sign(t.outcome) === Math.sign(t.detail.diff);
  const T = trades.filter((t) => t.detail.diff !== 0 && t.outcome !== 0);
  // Package adjustment check (as E6): does the adjusted margin track outcomes better than plain sums?
  const pkg = { adjusted: r3(pearson(trades.map((t) => t.detail.diff), trades.map((t) => t.outcome))), plainSums: r3(pearson(trades.map((t) => t.detail.rawDiff), trades.map((t) => t.outcome))) };
  // What the app's levels (lean ≥ 60%, clear ≥ 70% of the shown frequency) would mean with the fitted slope.
  const slope = cal.logistic.slope, lv = model.trade_outcome.levels || { lean: 0.6, clear: 0.7 };
  const marginFor = (p) => Math.log(p / (1 - p)) / slope;
  const levelOf = (t) => { const p = Math.round((1 / (1 + Math.exp(-slope * Math.abs(pct(t))))) * 20) / 20; return p < lv.lean ? 'close' : p < lv.clear ? 'lean' : 'clear'; };
  const levels = Object.fromEntries(['close', 'lean', 'clear'].map((L) => { const xs = T.filter((t) => levelOf(t) === L); return [L, { share: r3(xs.length / T.length), hitRate: r3(xs.filter(won).length / Math.max(1, xs.length)) }]; }));
  return {
    experiment: 'E15 dynasty verdict calibration (12-team 1QB PPR dynasty league, 20-man rosters, 3 seasons discounted 0.82)',
    labels: 'REAL HISTORICAL outcomes (nflverse weekly points 2020–2025, FantasyPros dynasty ECR archive); SIMULATED league behaviour',
    leagues, trades: trades.length, outcomeSd: r3(sd(trades.map((t) => t.outcome))),
    calibration: cal, slopeBySeason: bySeason, packageCheck: pkg,
    appLevels: { slope, leanMargin: r3(marginFor(lv.lean - 0.025)), clearMargin: r3(marginFor(lv.clear - 0.025)), levels },
  };
}

/** E16: the trade finder in dynasty over three seasons. */
export async function dynastyFinderBacktest(bench, model, { targetsPerSeason = 300, seed = 16 } = {}) {
  const { FAIRNESS } = await import('../../js/core/trade-finder.js');
  const ctx = await setup(bench);
  const STRATS = {
    finder: { label: 'Finder (app, dynasty): top option by starting-lineup value (minimal, maxEdge 5%)', opts: {}, pick: 'top' },
    most_even: { label: 'Value only: the most evenly valued fair package', opts: { rank: 'even', minGain: -Infinity, minLineupGain: -Infinity }, pick: 'top' },
    random_fair: { label: 'A random fair minimal package', opts: { minGain: -Infinity, minLineupGain: -Infinity }, pick: 'random' },
    mutual_sum: { label: 'Their roster known: rank by my + their lineup-value gain', opts: { mutualRank: 'sum' }, pick: 'top', theirs: true },
  };
  const rows = Object.fromEntries(Object.keys(STRATS).map((k) => [k, []]));
  const coverage = Object.fromEntries(Object.keys(STRATS).map((k) => [k, { asked: 0, found: 0 }]));
  for (const Y of [2020, 2021, 2022, 2023]) {
    const rand = rng(seed + Y);
    const L = buildLeague(ctx, bench, Y, rand, model);
    if (!L) continue;
    // The finder's verdict: dynasty levels (calibrated in E15 when configured, else z with σ 0 → any gap "clear").
    for (let k = 0; k < targetsPerSeason; k++) {
      const a = Math.floor(rand() * TEAMS); let b = Math.floor(rand() * (TEAMS - 1)); if (b >= a) b++;
      const target = L.rosters[b][Math.floor(rand() * L.rosters[b].length)].g;
      const mine = L.rosters[a].map((p) => p.g);
      const r = rand();
      for (const [key, st] of Object.entries(STRATS)) {
        const out = findTradePackages(L.result, mine, target, { ...st.opts, maxEdge: FAIRNESS.strict.maxEdge, theirs: st.theirs ? L.rosters[b].map((p) => p.g) : null, includeAll: st.pick === 'random', limit: 5 });
        coverage[key].asked++;
        const list = st.pick === 'random' ? out.all || [] : out.options;
        if (!list.length) continue;
        coverage[key].found++;
        const op = st.pick === 'top' ? list[0] : list[Math.floor(r * list.length)];
        const next = applyTradeDyn(L.rosters, a, b, op.ids.map((g) => L.byG.get(g)), [L.byG.get(target)], L.universe);
        const pts = L.replay(next);
        rows[key].push({ y: Y, pid: `${Y}:${k}`, gainA: pts[a] - L.base[a], gainB: pts[b] - L.base[b], size: op.ids.length, pct: op.pct, theirLineup: op.theirGain ?? null });
      }
    }
  }
  const paired = (x, y) => {
    const m = new Map(rows[y].map((r) => [r.pid, r]));
    const d = rows[x].filter((r) => m.has(r.pid)).map((r) => ({ mine: r.gainA - m.get(r.pid).gainA, theirs: r.gainB - m.get(r.pid).gainB }));
    return { n: d.length, myGain: ci(d.map((z) => z.mine)), theirGain: ci(d.map((z) => z.theirs)) };
  };
  return {
    experiment: 'E16 trade finder in dynasty (E15 leagues; realised 3-season lineup points, discount 0.82)',
    labels: 'REAL HISTORICAL outcomes; SIMULATED leagues; player-only packages (no picks)',
    summary: Object.fromEntries(Object.entries(STRATS).map(([k, st]) => [k, {
      label: st.label, coverage: r3(coverage[k].found / Math.max(1, coverage[k].asked)),
      myGain: ci(rows[k].map((x) => x.gainA)), theirGain: ci(rows[k].map((x) => x.gainB)),
      myGainShare: r3(rows[k].filter((x) => x.gainA > 0).length / Math.max(1, rows[k].length)),
      meanSize: r3(mean(rows[k].map((x) => x.size))),
    }])),
    paired: { finder_vs_random_fair: paired('finder', 'random_fair'), finder_vs_most_even: paired('finder', 'most_even'), mutual_sum_vs_finder: paired('mutual_sum', 'finder') },
  };
}
