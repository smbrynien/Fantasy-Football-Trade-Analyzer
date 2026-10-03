// E12 — ROSTER-SPECIFIC VALUES (REAL HISTORICAL outcomes, SIMULATED leagues; the E6 league simulation).
//
// Question: when the app knows a team's roster (My Team), should it judge a trade by what it does to THAT roster's
// lineup instead of by the generic league-wide values? Each E6 trade is re-predicted from preseason information with:
//   generic      the 2.2.0 values (σ × 0.4) + package adjustment — what the trade verdict uses today
//   lineupValue  change in the summed generic value of the best starting lineup (js/core/roster.js bestLineup, the
//                My Team "lineup value" the app shows), A's change minus B's
//   lineupPoints change in the starters' projected points per game (the My Team "points/game" line)
//   expected     change in EXPECTED season lineup points: each week every rostered player is active with his
//                availability (share of team games played, fitted on earlier seasons), the best active lineup starts,
//                an empty slot is filled from waivers at replacement level — so depth and bye/injury cover count
// Outcomes: realised change of each team's season points (E6). Reported: correlation of each predictor with the
// realised margin (A − B) and, separately, with each team's OWN realised gain (what a roster-specific view claims).

import { leagueSimulation, LEAGUE, predictTrade } from './league.js';
import { bestLineup } from '../../js/core/roster.js';
import { pearson, mean, sd } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const SLOTS = [['QB', ['QB']], ['RB', ['RB']], ['RB', ['RB']], ['WR', ['WR']], ['WR', ['WR']], ['TE', ['TE']], ['FLEX', ['RB', 'WR', 'TE']]];
const WEEKS = 17, DRAWS = 300;
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Expected weekly lineup points of a roster: Monte Carlo over who is active; empty slots get the waiver rate. */
function expectedWeek(roster, priors, waiverRate, rand) {
  const ps = roster.map((p) => ({ pos: p.pos, rate: priors.rateAt(p.pos, p.rank), avail: priors.availSmooth(p.pos, p.rank ?? 999) })).sort((x, y) => y.rate - x.rate);
  let total = 0;
  for (let d = 0; d < DRAWS; d++) {
    const used = new Array(ps.length).fill(false);
    const active = ps.map((p) => rand() < p.avail);
    for (const [slot, ok] of SLOTS) {
      let got = -1;
      for (let i = 0; i < ps.length; i++) if (!used[i] && active[i] && ok.includes(ps[i].pos)) { got = i; break; }
      if (got >= 0) { used[got] = true; total += ps[got].rate; } else total += slot === 'FLEX' ? Math.max(waiverRate.RB, waiverRate.WR) : waiverRate[slot];
    }
  }
  return total / DRAWS;
}

/** Generic-value lineup (the app's My Team computation) and starter points per game. */
function lineupStats(roster, cand, priors) {
  const assets = roster.map((p) => ({ ...(cand.assets.get(p.g) || { id: p.g, kind: 'player', position: p.pos, value: 0 }), rate: priors.rateAt(p.pos, p.rank) }));
  const L = bestLineup(assets, LEAGUE);
  return { value: L.starters.reduce((s, a) => s + a.value, 0), points: L.starters.reduce((s, a) => s + a.rate, 0) };
}

const standardize = (xs) => { const m = mean(xs), s = sd(xs) || 1; return xs.map((x) => (x - m) / s); };

export function rosterSpecific(bench, { tradesPerSeason = 1000 } = {}) {
  const rand = rng(12);
  const cache = new Map();
  const waiverCache = new Map();
  const sim = leagueSimulation(bench, {
    tradesPerSeason,
    onTrade: ({ y, season, priors, cands, rosters, next, a, b, outA, outB }) => {
      const cand = cands.s04;
      // Waiver level: the best player nobody rosters at each position (preseason rate × availability).
      if (!waiverCache.has(y)) {
        const rostered = new Set(rosters.flat().map((p) => p.g));
        waiverCache.set(y, Object.fromEntries(POS.map((pos) => {
          const fa = season.players.filter((p) => p.pos === pos && p.rank && !rostered.has(p.g)).sort((x, z) => x.rank - z.rank)[0];
          return [pos, fa ? priors.rateAt(pos, fa.rank) * priors.availSmooth(pos, fa.rank) : 0];
        })));
      }
      const waiver = waiverCache.get(y);
      const key = (t) => `${y}:${t}`;
      const before = (t) => {
        if (!cache.has(key(t))) cache.set(key(t), { exp: expectedWeek(rosters[t], priors, waiver, rand) * WEEKS, ...lineupStats(rosters[t], cand, priors) });
        return cache.get(key(t));
      };
      // The app sees the traded rosters (no automatic drops/signings); the expected-points view uses the legal
      // 13-man rosters after the simulated drop/sign step, which a manager would also do.
      const traded = (t, out, inn) => rosters[t].filter((p) => !out.some((o) => o.g === p.g)).concat(inn);
      const tA = traded(a, outA, outB), tB = traded(b, outB, outA);
      const lA = lineupStats(tA, cand, priors), lB = lineupStats(tB, cand, priors);
      const eA = expectedWeek(next[a], priors, waiver, rand) * WEEKS, eB = expectedWeek(next[b], priors, waiver, rand) * WEEKS;
      const A0 = before(a), B0 = before(b);
      return {
        dLineupValueA: lA.value - A0.value, dLineupValueB: lB.value - B0.value,
        dPointsA: lA.points - A0.points, dPointsB: lB.points - B0.points,
        dExpA: eA - A0.exp, dExpB: eB - B0.exp,
        genericA: predictTrade(cand, outB.map((p) => p.g), outA.map((p) => p.g)),
      };
    },
  });
  const T = sim.tradeRows;
  const out = T.map((t) => t.outcome);
  const preds = {
    generic: T.map((t) => t.pred.s04),
    lineupValue: T.map((t) => t.extra.dLineupValueA - t.extra.dLineupValueB),
    lineupPoints: T.map((t) => t.extra.dPointsA - t.extra.dPointsB),
    expected: T.map((t) => t.extra.dExpA - t.extra.dExpB),
  };
  const zG = standardize(preds.generic), zE = standardize(preds.expected);
  for (const lam of [0.25, 0.5, 0.75]) preds[`blend_expected_${lam}`] = zG.map((g, i) => (1 - lam) * g + lam * zE[i]);
  const years = [...new Set(T.map((t) => t.y))].sort();
  const margin = Object.fromEntries(Object.entries(preds).map(([k, xs]) => [k, {
    corr: r3(pearson(xs, out)),
    bySeason: Object.fromEntries(years.map((y) => { const ix = T.map((t, i) => (t.y === y ? i : -1)).filter((i) => i >= 0); return [y, r3(pearson(ix.map((i) => xs[i]), ix.map((i) => out[i])))]; })),
    even: r3(pearson(xs.filter((_, i) => T[i].nA === T[i].nB), out.filter((_, i) => T[i].nA === T[i].nB))),
    uneven: r3(pearson(xs.filter((_, i) => T[i].nA !== T[i].nB), out.filter((_, i) => T[i].nA !== T[i].nB))),
  }]));
  // Each team's own gain: A's realised gain vs A's predicted change (generic: value received − sent; roster views: ΔA).
  const own = (f, g) => r3(pearson(T.flatMap((t) => [f(t, 'A'), f(t, 'B')]), T.flatMap((t) => [g(t, 'A'), g(t, 'B')])));
  const gain = (t, s) => (s === 'A' ? t.gainA : t.gainB);
  const ownGain = {
    generic: own((t, s) => (s === 'A' ? t.extra.genericA : -t.extra.genericA), gain),
    lineupValue: own((t, s) => t.extra[`dLineupValue${s}`], gain),
    lineupPoints: own((t, s) => t.extra[`dPoints${s}`], gain),
    expected: own((t, s) => t.extra[`dExp${s}`], gain),
  };
  // Where the roster view disagrees with the generic verdict on the direction, which one was right more often?
  const dis = T.map((t, i) => ({ g: preds.generic[i], e: preds.expected[i], o: out[i] })).filter((x) => Math.sign(x.g) !== Math.sign(x.e) && x.o !== 0);
  const disagreement = { n: dis.length, share: r3(dis.length / T.length), genericRight: r3(dis.filter((x) => Math.sign(x.g) === Math.sign(x.o)).length / Math.max(1, dis.length)), expectedRight: r3(dis.filter((x) => Math.sign(x.e) === Math.sign(x.o)).length / Math.max(1, dis.length)) };
  // Calibration of the expected view for one team: realised own gain on predicted ΔE (slope 1 = take it at face value),
  // and how often a team whose expected lineup rose by x points per week actually gained (logistic, as E7).
  const ownRows = T.flatMap((t) => [{ x: t.extra.dExpA, y: t.gainA }, { x: t.extra.dExpB, y: t.gainB }]);
  const mx = mean(ownRows.map((r) => r.x)), my = mean(ownRows.map((r) => r.y));
  const slope = ownRows.reduce((s, r) => s + (r.x - mx) * (r.y - my), 0) / ownRows.reduce((s, r) => s + (r.x - mx) ** 2, 0);
  const won = ownRows.filter((r) => r.x !== 0 && r.y !== 0);
  let best = null;
  for (let k = 0.05; k <= 3; k += 0.05) {
    const ll = won.reduce((s, r) => { const p = 1 / (1 + Math.exp(-k * Math.abs(r.x / WEEKS))); return s + Math.log(Math.sign(r.x) === Math.sign(r.y) ? p : 1 - p); }, 0);
    if (!best || ll > best.ll) best = { k, ll };
  }
  const bins = [[0, 0.5], [0.5, 1], [1, 2], [2, 4], [4, 99]].map(([a, b]) => { const xs = won.filter((r) => Math.abs(r.x / WEEKS) >= a && Math.abs(r.x / WEEKS) < b); return { perWeek: `${a}-${b}`, n: xs.length, gainedShare: r3(xs.filter((r) => Math.sign(r.x) === Math.sign(r.y)).length / Math.max(1, xs.length)) }; });
  const calibration = { slopeRealisedOnPredicted: r3(slope), meanPredicted: r3(mx), meanRealised: r3(my), logisticPerWeekSlope: r3(best.k), byPredictedPerWeek: bins, at1: r3(1 / (1 + Math.exp(-best.k))), at3: r3(1 / (1 + Math.exp(-3 * best.k))) };
  return {
    experiment: 'E12 roster-specific trade evaluation (E6 leagues, 12-team 1QB PPR)', calibration,
    labels: sim.labels, trades: T.length,
    predictors: {
      generic: '2.2.0 generic values (σ × 0.4) + package adjustment (the trade verdict)',
      lineupValue: 'Δ summed generic value of the best starting lineup (My Team "lineup value")',
      lineupPoints: 'Δ starters\' projected points per game (My Team)',
      expected: 'Δ expected season lineup points with availability, bench cover and waiver fill-ins',
      blend_expected_x: 'standardised generic and expected, weight x on expected',
    },
    margin, ownGain, disagreement,
  };
}
