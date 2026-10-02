// REDRAFT model — "What is this player's expected value for the remainder of this fantasy season in THIS league?"
//
// Every signal is converted to rest-of-season surplus points over the league's positional replacement level,
// then blended with phase-aware weights. See docs/VALUATION_MODEL.md.

import { resolveScoring } from '../scoring.js';
import { blendWeights } from '../settings.js';
import { weightedMean, clamp, quantile } from '../util/stats.js';
import { computeLeagueRates, derivePlayerInputs } from './context.js';
import { computeLeagueStructure, surplusPoints } from './replacement.js';
import { buildCurves } from './mapping.js';
import { collectRankings, collectMarket, collectADP, adpFormatsFor } from './signals.js';
import { aggregateGroup, blendGroups } from './blend.js';
import { assessConfidence } from './confidence.js';
import { FANTASY_POSITIONS } from '../util/positions.js';

export const REDRAFT_GROUPS = ['projection', 'production', 'consensus', 'market', 'adp'];

export function runRedraft(dataset, league, model, env) {
  const cfg = model.redraft;
  const scoring = resolveScoring(league, env.leagueDefaults);
  const phase = { ...env.phase };
  const offseason = phase.phase === 'postseason' || phase.phase === 'offseason' || phase.phase === 'preseason';
  if (phase.phase === 'postseason') phase.phase = 'offseason';
  const alpha = offseason ? 0 : phase.alpha;
  const rates = computeLeagueRates(dataset, scoring);
  const inputs = derivePlayerInputs(dataset, league, scoring, phase, model, rates);
  const beta = cfg.bench_value_fraction;
  const positions = new Set(FANTASY_POSITIONS);

  // In-season, weekly projection sources omit players already ruled out for the remaining weeks. For players on a
  // long-term list (IR/PUP/NFI/Suspended) that absence is treated as a ZERO projection (not missing data) and they are
  // assumed out for the rest of the season unless a projection source still projects games for them.
  const projSourcesActive = !offseason && [...inputs.values()].some((x) => x.proj.bySource.length > 0);
  const LONG_TERM = new Set(['IR', 'PUP', 'NFI', 'Suspended']);
  for (const x of inputs.values()) {
    x.zeroProjection = projSourcesActive && LONG_TERM.has(x.injury.status) && x.proj.points === null;
    if (x.zeroProjection) { x.proj.points = 0; x.proj.games = 0; }
  }

  // --- production → rest-of-season points ---
  for (const x of inputs.values()) {
    x.prodROS = null; x.prodROSNoInj = null; x.gamesLost = 0;
    if (offseason || x.prod.rate === null || x.remGames === null || x.remGames === undefined || x.p.team === 'FA') continue;
    const lost = x.zeroProjection ? x.remGames : Math.min(x.injury.gamesLostRedraft || 0, x.remGames);
    x.gamesLost = lost;
    x.prodROSNoInj = x.prod.rate * x.remGames * x.sos;
    x.prodROS = x.prod.rate * Math.max(0, x.remGames - lost) * x.sos;
  }

  // --- league structure from baseline points ---
  const pool = [];
  for (const x of inputs.values()) {
    if (!positions.has(x.pos)) continue;
    x.basePoints = weightedMean([{ v: x.proj.points, w: 1 }, { v: x.prodROS, w: alpha }]);
    if (x.basePoints !== null) pool.push({ cid: x.p.cid, position: x.pos, points: x.basePoints });
  }
  const structure = computeLeagueStructure(pool, league);
  const S = (pts, pos) => (pts === null || pts === undefined ? null : surplusPoints(pts, pos, structure, beta));
  const curves = buildCurves(pool.map((x) => ({ cid: x.cid, position: x.position, score: S(x.points, x.position) })));

  // --- mapped groups ---
  const minPlayers = model.mapping.min_source_players;
  const rankingKinds = alpha > 0 ? ['ros', 'redraft'] : ['redraft', 'ros'];
  const consensus = aggregateGroup(collectRankings(dataset, { kinds: rankingKinds, league }), curves, { higherIsBetter: false, weights: model.source_weights.consensus, minPlayers });
  const marketLists = collectMarket(dataset, { dynasty: false, league, scoring });
  const market = aggregateGroup(marketLists, curves, { higherIsBetter: true, weights: model.source_weights.market, minPlayers });
  const adp = aggregateGroup(collectADP(dataset, { formats: adpFormatsFor('redraft', league, scoring) }), curves, { higherIsBetter: false, weights: model.source_weights.adp, minPlayers, overall: true });

  const weights = blendWeights(cfg.weights.preseason, cfg.weights.in_season, alpha);
  if (offseason) weights.production = 0;

  const assets = new Map();
  for (const x of inputs.values()) {
    if (!positions.has(x.pos)) continue;
    const cid = x.p.cid;
    const projS = S(x.proj.points, x.pos);
    const prodS = S(x.prodROS, x.pos);
    const prodSNoInj = S(x.prodROSNoInj, x.pos);
    const groups = {
      projection: projS,
      production: prodS,
      consensus: consensus.get(cid)?.value ?? null,
      market: market.get(cid)?.value ?? null,
      adp: adp.get(cid)?.value ?? null,
    };
    const b = blendGroups(groups, weights);
    if (b.score === null) continue;

    const contributions = { ...b.contributions };
    if (contributions.production !== undefined && prodSNoInj !== null) {
      const w = b.effWeights.production;
      contributions.production = w * prodSNoInj;
      contributions.injury = w * (prodS - prodSNoInj);
    }
    // Market momentum (source-reported 30-day trend), capped.
    let trendAdj = 0, trendRel = null;
    const mk = market.get(cid);
    if (mk && cfg.trend.weight) {
      const rels = mk.sources.filter((s) => s.raw && typeof s.raw.trend30 === 'number' && s.raw.value > 0).map((s) => ({ v: s.raw.trend30 / s.raw.value, w: s.weight }));
      trendRel = weightedMean(rels);
      if (trendRel !== null) trendAdj = clamp(cfg.trend.weight * trendRel * b.score, -cfg.trend.cap_pct * b.score, cfg.trend.cap_pct * b.score);
    }
    if (trendAdj) contributions.trend = trendAdj;
    const score = Math.max(0, b.score + trendAdj);

    const usedSources = new Set([
      ...x.proj.bySource.map((s) => s.src),
      ...(consensus.get(cid)?.sources || []).map((s) => s.src),
      ...(mk?.sources || []).map((s) => s.src),
      ...(adp.get(cid)?.sources || []).map((s) => s.src),
    ]);
    if (prodS !== null) usedSources.add(env.statsSource || 'stats');
    const indep = new Set([...usedSources].map((s) => env.independence[s] || s));
    const conf = assessConfidence({
      groups: Object.entries(groups).filter(([g]) => weights[g] > 0).map(([g, v]) => ({ group: g, weight: weights[g], value: v })),
      totalWeight: b.totalWeight,
      games: (x.prod.gp || 0) + (x.last?.gp || 0),
      staleSources: [...usedSources].filter((s) => env.stale.has(s)),
      independentSources: indep.size,
      isRookie: !x.last && !(x.prod.gp > 0) && x.p.years_exp === 0,
      final: score,
    }, model.confidence);

    const weeklyPts = x.prod.weeks.map((w) => w.pts);
    assets.set(cid, {
      id: cid, kind: 'player', mode: 'redraft',
      name: x.p.name, position: x.pos, team: x.p.team, age: x.age,
      score, groups, weights: b.effWeights, contributions, confidence: conf,
      sources: [...usedSources],
      details: {
        projection: { points: x.proj.points, games: x.proj.games, rate: x.proj.rate, scope: x.proj.scope, zeroedForInjury: x.zeroProjection, bySource: x.proj.bySource.map((s) => ({ src: s.src, points: s.points, games: s.games, surplus: S(s.points, x.pos), estimated: s.estimated })) },
        production: { gp: x.prod.gp, ppg: x.prod.ppg, xppg: x.prod.xppg, blend: x.prod.blend, rate: x.prod.rate, prior: x.prod.prior, priorKind: x.prod.priorKind, recentPPG: x.prod.recentPPG, rosPoints: x.prodROS, rosPointsNoInjury: x.prodROSNoInj, gamesLost: x.gamesLost, remGames: x.remGames, sos: x.sos, sosDetail: x.sosDetail, weekly: x.prod.weeks },
        weeklyRange: weeklyPts.length >= 4 ? { floor: quantile(weeklyPts, 0.1), median: quantile(weeklyPts, 0.5), ceiling: quantile(weeklyPts, 0.9), n: weeklyPts.length } : null,
        lastSeason: x.last,
        usage: x.usage,
        injury: x.injury,
        basePoints: x.basePoints,
        replacement: structure.replacement[x.pos], waiver: structure.waiver[x.pos],
        consensus: consensus.get(cid)?.sources || [],
        market: mk?.sources || [],
        adp: adp.get(cid)?.sources || [],
        trendRel,
      },
    });
  }
  return { mode: 'redraft', assets, structure, curves, scoring, weights, phase, marketLists };
}
