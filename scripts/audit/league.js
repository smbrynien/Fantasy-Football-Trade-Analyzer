// E6 — HISTORICAL LEAGUE SIMULATION: do trade values predict what a trade actually did to each team's season?
// (REAL HISTORICAL DATA for outcomes; SIMULATION for league behaviour.)
//
// For each season 2020–2025: 12 teams snake-draft real players by preseason value (rank→rate curves, availability
// and replacement fitted on earlier seasons only). Every week each team starts its best active lineup by information
// available before the week (preseason prior + points so far) and makes at most one same-position waiver pickup.
// Random trades (1-for-1 … 4-for-2) are executed right after the draft; rosters are restored to 13 (the side with
// more players drops its least valuable bench players, the other side signs the best free agents), then the season is
// replayed. Outcome of a trade for Team A = (A's season points with the trade − without) − (same for Team B).
// Each candidate valuation predicts the trade margin from PRESEASON information; the question is which candidate's
// margins match the realised outcomes (correlation, calibration slope, by trade type).
// Unlike the 2.0.0 package simulation (which drafted AND scored with the model's own values), outcomes here are real
// weekly points, including injuries, byes, breakouts and busts.

import { windowPlayers, fitPriors, AVAIL_CAP_RANK } from './lineup.js';
import { computeLeagueStructure, surplusPoints } from '../../js/core/valuation/replacement.js';
import { packageAdjustment } from '../../js/core/valuation/trade.js';
import { mean, pearson, sd } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TEAMS = 12, ROSTER = 13, K_INFO = 4;
const LEAGUE = { teams: TEAMS, roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 0, DEF: 0, BENCH: 6, IR: 0 }, flex_eligibility: { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] } };
const MIN = { QB: 1, RB: 2, WR: 2, TE: 1 };
const CAP = { QB: 2, RB: 5, WR: 5, TE: 2 };
const SIGMA = { QB: 4.9, RB: 4.2, WR: 3.8, TE: 3.1 }; // model preseason σ per game (2.1.2)
const TYPES = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3], [3, 2], [2, 3], [4, 2], [2, 4]];
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Preseason values of every ranked player under one candidate specification.
 * spec: { sigmaMult, beta, availability (bool: expected games = availability × games, else all games),
 *         pkg: { displacement_strength, roster_slot_cost, min_retained_fraction } | null }
 */
function candidateValues(players, priors, spec) {
  const pool = [];
  for (const p of players) {
    if (!p.rank) continue;
    const games = spec.availability ? priors.availAt(p.pos, p.rank) * p.teamGames : p.teamGames;
    pool.push({ cid: p.g, position: p.pos, rank: p.rank, points: games * priors.rateAt(p.pos, p.rank), games });
  }
  const structure = computeLeagueStructure(pool, LEAGUE);
  const assets = new Map();
  for (const x of pool) {
    let v = surplusPoints(x.points, x.position, structure, spec.beta, spec.sigmaMult * SIGMA[x.position] * x.games);
    // E11 per-game form: a missed game costs the player's surplus that week (the replacement plays), so expected value =
    // share of games played × healthy-season surplus. (spec.availability above scales POINTS before the replacement
    // level is computed — the 2.2.0 audit's candidate, which also shifts the replacement level.)
    if (spec.perGameAvail && v) v *= AVAIL_FORMS[spec.perGameAvail](priors, x);
    assets.set(x.cid, { id: x.cid, kind: 'player', position: x.position, value: v ?? 0, name: x.cid });
  }
  const result = { mode: 'redraft', league: LEAGUE, structure, assets, model: { package: { enabled: !!spec.pkg, redraft: spec.pkg || {} } } };
  return { assets, result };
}

/** Predicted margin for Team A (adjusted value A receives − adjusted value B receives); `sides` adds the totals. */
function predictTrade(cand, getsA, getsB, sides = false) {
  const A = getsA.map((g) => cand.assets.get(g)).filter(Boolean), B = getsB.map((g) => cand.assets.get(g)).filter(Boolean);
  const sumA = A.reduce((s, a) => s + a.value, 0), sumB = B.reduce((s, a) => s + a.value, 0);
  const on = cand.result.model.package.enabled;
  const pa = on ? packageAdjustment(A, B.length, cand.result).total : 0, pb = on ? packageAdjustment(B, A.length, cand.result).total : 0;
  const diff = sumA - pa - (sumB - pb);
  return sides ? { diff, adjA: sumA - pa, adjB: sumB - pb, valuesA: A.map((a) => a.value), valuesB: B.map((a) => a.value) } : diff;
}

/** Snake draft by value (ties by points), respecting caps and leaving room for the required starters. */
function draft(players, value, rand) {
  const avail = players.filter((p) => p.rank).sort((a, b) => (value.get(b.g) - value.get(a.g)) || (a.rank - b.rank));
  const rosters = Array.from({ length: TEAMS }, () => []);
  const taken = new Set();
  const order = Array.from({ length: TEAMS }, (_, i) => i).sort(() => rand() - 0.5);
  for (let round = 0; round < ROSTER; round++) {
    const seq = round % 2 ? [...order].reverse() : order;
    for (const t of seq) {
      const r = rosters[t];
      const count = (pos) => r.filter((p) => p.pos === pos).length;
      const need = POS.filter((pos) => count(pos) < MIN[pos]);
      const needSlots = need.reduce((a, pos) => a + MIN[pos] - count(pos), 0);
      const mustNeed = ROSTER - r.length <= needSlots;
      const p = avail.find((x) => !taken.has(x.g) && count(x.pos) < CAP[x.pos] && (!mustNeed || need.includes(x.pos)));
      if (!p) continue;
      taken.add(p.g); r.push(p);
    }
  }
  return rosters;
}

/** Replay a season. rosters: arrays of players. Returns season points per team. Waivers: one same-position swap a week. */
function simulate(season, priors, rostersIn) {
  const players = season.players;
  const rosters = rostersIn.map((r) => [...r]);
  const owner = new Map();
  rosters.forEach((r, t) => r.forEach((p) => owner.set(p.g, t)));
  const sums = new Map(players.map((p) => [p.g, { n: 0, s: 0 }]));
  const prior = new Map(players.map((p) => [p.g, priors.rateAt(p.pos, p.rank)]));
  const info = (p) => { const t = sums.get(p.g); return (t.s + K_INFO * prior.get(p.g)) / (t.n + K_INFO); };
  const points = Array(TEAMS).fill(0);
  const W = players.reduce((m, p) => Math.max(m, p.pts.length - 1), 0);
  for (let w = 1; w <= W; w++) {
    for (let t = 0; t < TEAMS; t++) {
      const act = rosters[t].filter((p) => p.pts[w] !== null).map((p) => ({ p, v: info(p) })).sort((a, b) => b.v - a.v);
      const used = new Set();
      let tot = 0;
      const take = (ok, n) => { for (const x of act) { if (n <= 0) break; if (!used.has(x.p.g) && ok(x.p.pos)) { used.add(x.p.g); tot += x.p.pts[w]; n--; } } };
      take((q) => q === 'QB', 1); take((q) => q === 'RB', 2); take((q) => q === 'WR', 2); take((q) => q === 'TE', 1); take((q) => q !== 'QB', 1);
      points[t] += tot;
    }
    for (const p of players) if (p.pts[w] !== null) { const s = sums.get(p.g); s.n++; s.s += p.pts[w]; }
    // Waivers (rotating order): best free agent at a position replaces the team's worst player there if clearly better.
    const fas = {};
    for (const pos of POS) fas[pos] = players.filter((p) => p.pos === pos && !owner.has(p.g) && sums.get(p.g).n > 0).map((p) => ({ p, v: info(p) })).sort((a, b) => b.v - a.v);
    for (let i = 0; i < TEAMS; i++) {
      const t = (i + w) % TEAMS;
      let best = null;
      for (const pos of POS) {
        const fa = fas[pos].find((x) => !owner.has(x.p.g));
        if (!fa) continue;
        const mine = rosters[t].filter((p) => p.pos === pos).map((p) => ({ p, v: info(p) })).sort((a, b) => a.v - b.v)[0];
        const gain = mine ? fa.v - mine.v : fa.v;
        if (mine && gain > 1 && (!best || gain > best.gain)) best = { fa, mine, gain };
      }
      if (best) {
        rosters[t] = rosters[t].filter((p) => p.g !== best.mine.p.g).concat(best.fa.p);
        owner.delete(best.mine.p.g); owner.set(best.fa.p.g, t);
      }
    }
  }
  return points;
}

/** Apply a trade and restore legal 13-player rosters (drop least valuable surplus; sign best free agents). */
function applyTrade(rosters, a, b, outA, outB, players, value) {
  const next = rosters.map((r) => [...r]);
  const gone = new Set([...outA, ...outB].map((p) => p.g));
  next[a] = next[a].filter((p) => !gone.has(p.g)).concat(outB);
  next[b] = next[b].filter((p) => !gone.has(p.g)).concat(outA);
  const rostered = new Set(next.flat().map((p) => p.g));
  const freeAgents = players.filter((p) => p.rank && !rostered.has(p.g)).sort((x, y) => value.get(y.g) - value.get(x.g) || x.rank - y.rank);
  for (const t of [a, b]) {
    const r = next[t];
    const count = (pos) => r.filter((p) => p.pos === pos).length;
    for (const pos of POS) while (count(pos) < MIN[pos]) { const fa = freeAgents.find((p) => p.pos === pos && !rostered.has(p.g)); if (!fa) break; r.push(fa); rostered.add(fa.g); }
    while (r.length > ROSTER) {
      const drop = r.filter((p) => count(p.pos) > MIN[p.pos]).sort((x, y) => value.get(x.g) - value.get(y.g) || y.rank - x.rank)[0];
      if (!drop) break;
      r.splice(r.indexOf(drop), 1); rostered.delete(drop.g);
    }
    while (r.length < ROSTER) { const fa = freeAgents.find((p) => !rostered.has(p.g) && count(p.pos) < CAP[p.pos]); if (!fa) break; r.push(fa); rostered.add(fa.g); }
    next[t] = r;
  }
  return next;
}

const AVAIL_FORMS = {
  tier: (pr, x) => pr.availAt(x.position, x.rank),
  smooth: (pr, x) => pr.availSmooth(x.position, x.rank),
  pos: (pr, x) => pr.availPos(x.position),
  // within-position shape only: smooth curve relative to the position's starter-level share (cross-position unchanged)
  relative: (pr, x) => pr.availSmooth(x.position, x.rank) / pr.availPos(x.position),
  relCap: (pr, x) => pr.availSmooth(x.position, Math.min(x.rank, AVAIL_CAP_RANK[x.position])) / pr.availPos(x.position),
};

const DETAIL = 's04'; // candidate whose side totals are kept for the verdict calibration (E7)
export { LEAGUE, SIGMA, predictTrade };
export const CANDIDATES = {
  current: { label: '2.1.2: σ = model table, healthy games, β .35, package 1/1', sigmaMult: 1, beta: 0.35, availability: false, pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  current_raw: { label: '2.1.2 without package adjustment (plain sums)', sigmaMult: 1, beta: 0.35, availability: false, pkg: null },
  s04: { label: 'σ × 0.4, healthy games', sigmaMult: 0.4, beta: 0.35, availability: false, pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_avail: { label: 'σ × 0.4, expected games (availability)', sigmaMult: 0.4, beta: 0.35, availability: true, pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s0_avail: { label: 'σ = 0 (deterministic), availability', sigmaMult: 0, beta: 0.35, availability: true, pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_avail_raw: { label: 'σ × 0.4, availability, no package adjustment', sigmaMult: 0.4, beta: 0.35, availability: true, pkg: null },
  s04_avail_b0: { label: 'σ × 0.4, availability, β 0 (no bench value)', sigmaMult: 0.4, beta: 0, availability: true, pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_avail_b07: { label: 'σ × 0.4, availability, β .7', sigmaMult: 0.4, beta: 0.7, availability: true, pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_avail_pk05: { label: 'σ × 0.4, availability, displacement .5', sigmaMult: 0.4, beta: 0.35, availability: true, pkg: { displacement_strength: 0.5, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_avail_pk15: { label: 'σ × 0.4, availability, displacement 1.5, keep ≥ .1', sigmaMult: 0.4, beta: 0.35, availability: true, pkg: { displacement_strength: 1.5, roster_slot_cost: 1, min_retained_fraction: 0.1 } },
  s04_avail_slot2: { label: 'σ × 0.4, availability, roster-slot cost × 2', sigmaMult: 0.4, beta: 0.35, availability: true, pkg: { displacement_strength: 1, roster_slot_cost: 2, min_retained_fraction: 0.25 } },
  s04_pg_tier: { label: 'E11: σ × 0.4, per-game availability (5-tier table)', sigmaMult: 0.4, beta: 0.35, availability: false, perGameAvail: 'tier', pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_pg_smooth: { label: 'E11: σ × 0.4, per-game availability (smooth curve by rank)', sigmaMult: 0.4, beta: 0.35, availability: false, perGameAvail: 'smooth', pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_pg_pos: { label: 'E11: σ × 0.4, per-game availability (one share per position)', sigmaMult: 0.4, beta: 0.35, availability: false, perGameAvail: 'pos', pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_pg_rel: { label: 'E11: σ × 0.4, within-position availability shape only', sigmaMult: 0.4, beta: 0.35, availability: false, perGameAvail: 'relative', pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s04_pg_relcap: { label: 'E11: σ × 0.4, within-position availability shape, flat beyond 2× starters (model 2.3.0)', sigmaMult: 0.4, beta: 0.35, availability: false, perGameAvail: 'relCap', pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
  s1_avail: { label: 'σ = model table, availability', sigmaMult: 1, beta: 0.35, availability: true, pkg: { displacement_strength: 1, roster_slot_cost: 1, min_retained_fraction: 0.25 } },
};

/** Least-squares slope of outcome on prediction (through the means) and correlation. */
function fitStats(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return { n: xs.length, corr: r3(pearson(xs, ys)), slope: r3(sxx ? sxy / sxx : null) };
}

/**
 * @param onTrade optional (ctx) => object: called once per simulated trade with the full league context (season, priors,
 *   candidate values, rosters before/after, the trade, realised gains); whatever it returns is kept as trade.extra.
 *   Used by E10 (uncertainty) and E12 (roster-specific values); it does not change the simulation.
 */
export function leagueSimulation(bench, { tradesPerSeason = 600, seed = 7, onTrade = null } = {}) {
  const seasons = {};
  for (const y of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) { const w = windowPlayers(bench, y, 1); if (w) seasons[y] = w; }
  const years = Object.keys(seasons).map(Number).sort();
  const trades = [];
  for (const y of years.slice(1)) {
    const rand = rng(seed + y);
    const priors = fitPriors(years.filter((t) => t < y).flatMap((t) => seasons[t].players));
    const season = seasons[y];
    const cands = Object.fromEntries(Object.entries(CANDIDATES).map(([k, spec]) => [k, candidateValues(season.players, priors, spec)]));
    // Rosters are drafted (and fixed up after trades) with one neutral value — the deterministic availability-adjusted
    // surplus — so every candidate is scored on the same leagues and trades.
    const base = candidateValues(season.players, priors, { sigmaMult: 0, beta: 0.35, availability: true, pkg: null });
    const baseValue = new Map([...base.assets].map(([g, a]) => [g, a.value + 1e-6 * priors.rateAt(a.position, season.players.find((p) => p.g === g)?.rank)]));
    for (const p of season.players) if (!baseValue.has(p.g)) baseValue.set(p.g, -1);
    const rosters = draft(season.players, baseValue, rand);
    const basePts = simulate(season, priors, rosters);
    for (let k = 0; k < tradesPerSeason; k++) {
      const a = Math.floor(rand() * TEAMS); let b = Math.floor(rand() * (TEAMS - 1)); if (b >= a) b++;
      const [na, nb] = TYPES[Math.floor(rand() * TYPES.length)];
      const pickN = (r, n) => [...r].sort(() => rand() - 0.5).slice(0, n);
      const outA = pickN(rosters[a], na), outB = pickN(rosters[b], nb); // A sends outA, receives outB
      const next = applyTrade(rosters, a, b, outA, outB, season.players, baseValue);
      const pts = simulate(season, priors, next);
      const outcome = (pts[a] - basePts[a]) - (pts[b] - basePts[b]);
      const pred = Object.fromEntries(Object.entries(cands).map(([c, cand]) => [c, predictTrade(cand, outB.map((p) => p.g), outA.map((p) => p.g))]));
      const detail = predictTrade(cands[DETAIL], outB.map((p) => p.g), outA.map((p) => p.g), true);
      const extra = onTrade ? onTrade({ y, season, priors, cands, rosters, next, a, b, outA, outB, outcome, gainA: pts[a] - basePts[a], gainB: pts[b] - basePts[b], baseValue }) : undefined;
      trades.push({ y, type: `${nb}-for-${na}`, nA: nb, nB: na, outcome, gainA: pts[a] - basePts[a], gainB: pts[b] - basePts[b], pred, detail, extra });
    }
  }
  const summary = {};
  for (const c of Object.keys(CANDIDATES)) {
    const all = fitStats(trades.map((t) => t.pred[c]), trades.map((t) => t.outcome));
    const even = trades.filter((t) => t.nA === t.nB), uneven = trades.filter((t) => t.nA !== t.nB);
    summary[c] = {
      label: CANDIDATES[c].label, all,
      evenCount: fitStats(even.map((t) => t.pred[c]), even.map((t) => t.outcome)),
      unevenCount: fitStats(uneven.map((t) => t.pred[c]), uneven.map((t) => t.outcome)),
      byType: Object.fromEntries([...new Set(trades.map((t) => t.type))].sort().map((ty) => { const xs = trades.filter((t) => t.type === ty); return [ty, fitStats(xs.map((t) => t.pred[c]), xs.map((t) => t.outcome))]; })),
      bySeason: Object.fromEntries(years.slice(1).map((y) => { const xs = trades.filter((t) => t.y === y); return [y, fitStats(xs.map((t) => t.pred[c]), xs.map((t) => t.outcome)).corr]; })),
    };
  }
  return {
    experiment: 'E6 historical league simulation (12-team 1QB PPR, 13-man rosters, weekly lineups + waivers)',
    labels: 'REAL HISTORICAL outcomes (nflverse weekly points 2020–2025); SIMULATED league behaviour',
    trades: trades.length, outcomeSd: r3(sd(trades.map((t) => t.outcome))), summary, tradeRows: trades,
  };
}
