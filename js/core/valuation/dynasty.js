// DYNASTY model — "What is this player's expected long-term fantasy asset value in THIS league?"
//
// Fundamental value = Σ_t δ^(t-1) · S_t · E[surplus(X_t)], X_t ~ Normal(μ_t·G·avail, σ_t·G·avail)
//   μ_1  current scoring rate from projections, production, last season and a draft-capital prior
//   μ_t  aged with position aging curves; young players blend toward the draft-capital career trajectory
//   σ_t  grows with horizon (and for rookies) → upside optionality via E[max(0, X − r)]
//   S_t  probability the player is still fantasy-relevant (attrition by position/age)
//   δ    strategy discount (contending / balanced / rebuilding)
// Market, consensus and ADP enter as separate signals mapped onto the fundamental value curve.
// See docs/DYNASTY_MODEL.md.

import { resolveScoring, scoreStats } from '../scoring.js';
import { weightedMean, clamp, interp, expectedSurplus, probAbove, normCdf } from '../util/stats.js';
import { computeLeagueRates, derivePlayerInputs } from './context.js';
import { computeLeagueStructure } from './replacement.js';
import { buildCurves } from './mapping.js';
import { collectRankings, collectMarket, collectADP, adpFormatsFor } from './signals.js';
import { aggregateGroup, blendGroups } from './blend.js';
import { assessConfidence } from './confidence.js';
import { FANTASY_POSITIONS } from '../util/positions.js';

export const DYNASTY_GROUPS = ['fundamental', 'market', 'consensus', 'adp'];

function curvePoints(curveObj) {
  return Object.entries(curveObj || {}).filter(([k]) => !k.startsWith('_')).map(([a, m]) => [Number(a), Number(m)]).sort((a, b) => a[0] - b[0]);
}

export function agingMultiplier(model, pos, age) {
  const pts = curvePoints(model.dynasty.aging_curves[pos]);
  return pts.length ? interp(pts, age) : 1;
}

export function hazard(model, pos, age) {
  const tbl = model.dynasty.attrition_table && model.dynasty.attrition_table[pos];
  if (tbl) {
    const pts = curvePoints(tbl);
    if (pts.length) return clamp(interp(pts, age), 0, 0.9);
  }
  const d = model.dynasty.default_attrition[pos] || { base: 0.08, onset: 30, slope: 0.05 };
  return clamp(d.base + d.slope * Math.max(0, age - d.onset), 0, 0.9);
}

export function draftBucket(draft) {
  if (!draft || !draft.round) return 'UDFA';
  const r = Number(draft.round), pick = Number(draft.pick);
  if (r === 1) return pick && pick <= 16 ? 'R1a' : 'R1b';
  if (r === 2) return 'R2';
  if (r === 3) return 'R3';
  if (r <= 5) return 'R4-5';
  return 'R6-7';
}

/** Draft-capital prior PPG (PPR) for a career year (1-based), or null. */
export function draftPrior(model, pos, draft, careerYear) {
  const pri = model.dynasty.draft_priors && model.dynasty.draft_priors[pos];
  if (!pri) return null;
  const arr = pri[draftBucket(draft)];
  if (!arr || !arr.length) return null;
  const i = clamp(careerYear, 1, arr.length) - 1;
  return typeof arr[i] === 'number' ? arr[i] : null;
}

export function runDynasty(dataset, league, model, env) {
  const cfg = model.dynasty;
  const scoring = resolveScoring(league, env.leagueDefaults);
  const pprScoring = resolveScoring({ scoring_preset: 'ppr', scoring: {} }, env.leagueDefaults);
  const phase = env.phase;
  const rates = computeLeagueRates(dataset, scoring);
  const inputs = derivePlayerInputs(dataset, league, scoring, phase, model, rates);
  const positions = new Set(FANTASY_POSITIONS);
  const beta = cfg.bench_value_fraction ?? model.redraft.bench_value_fraction;
  const strategy = (league.dynasty && league.dynasty.strategy) || 'balanced';
  const delta = cfg.strategy_discount[strategy] ?? cfg.strategy_discount.balanced;
  const H = cfg.horizon_years;
  const G = cfg.season_games;
  const re = cfg.rate_evidence;

  // League-scoring / PPR ratio per position (priors are calibrated in PPR points).
  const ratioAcc = {};
  for (const x of inputs.values()) {
    if (!x.last || !x.p.last_season) continue;
    const a = (ratioAcc[x.pos] ||= { league: 0, ppr: 0 });
    a.league += x.last.points;
    a.ppr += scoreStats(x.p.last_season.st || {}, x.pos, pprScoring, { games: x.p.last_season.games }).points || 0;
  }
  const scoringRatio = {};
  for (const [pos, a] of Object.entries(ratioAcc)) scoringRatio[pos] = a.ppr > 0 ? a.league / a.ppr : 1;

  // --- μ1 (current scoring rate) per player ---
  for (const x of inputs.values()) {
    const ev = [];
    if (x.proj.rate !== null && (x.proj.games ?? 0) >= 2) ev.push({ kind: 'projection', v: x.proj.rate, w: re.projection_weight });
    if (x.prod.gp > 0 && x.prod.blend !== undefined && x.prod.blend !== null) ev.push({ kind: 'production', v: x.prod.blend, w: Math.min(1, x.prod.gp / re.current_season_full_games) });
    if (x.last && x.last.gp >= re.last_season_min_games) ev.push({ kind: 'last_season', v: x.last.ppg, w: re.last_season_weight * Math.min(1, x.last.gp / 8) });
    const yearsExp = Number.isFinite(x.p.years_exp) ? x.p.years_exp : (x.p.draft?.year ? Math.max(0, phase.season - Number(x.p.draft.year)) : null);
    const careerYear = (yearsExp ?? 0) + 1;
    const careerGames = (x.prod.gp || 0) + (x.last?.gp || 0) + 14 * Math.max(0, (yearsExp ?? 0) - 1);
    const priorPPR = draftPrior(model, x.pos, x.p.draft, careerYear);
    const ratio = scoringRatio[x.pos] ?? 1;
    if (priorPPR !== null && ['QB', 'RB', 'WR', 'TE'].includes(x.pos)) {
      ev.push({ kind: 'prior', v: priorPPR * ratio, w: re.prior_pseudo_games / (re.prior_pseudo_games + careerGames) });
    }
    const sumW = ev.reduce((a, e) => a + e.w, 0);
    x.dyn = { ev, mu1: sumW > 0 ? weightedMean(ev.map((e) => ({ v: e.v, w: e.w }))) : null, careerYear, careerGames, yearsExp, priorShare: sumW > 0 ? (ev.find((e) => e.kind === 'prior')?.w || 0) / sumW : 0, ratio };
  }

  // --- league structure from expected Y1 season points ---
  const pool = [];
  for (const x of inputs.values()) {
    if (!positions.has(x.pos) || x.dyn.mu1 === null) continue;
    const avail = cfg.availability[x.pos] ?? 0.85;
    x.dyn.y1Points = x.dyn.mu1 * G * avail;
    pool.push({ cid: x.p.cid, position: x.pos, points: x.dyn.y1Points });
  }
  const structure = computeLeagueStructure(pool, league);

  const unc = cfg.uncertainty;
  // --- fundamental ---
  for (const x of inputs.values()) {
    if (!positions.has(x.pos) || x.dyn.mu1 === null || (x.age === null && !['K', 'DEF'].includes(x.pos))) { x.dyn.F = null; continue; }
    const r = structure.replacement[x.pos], w = structure.waiver[x.pos];
    if (r === null || r === undefined) { x.dyn.F = null; continue; }
    const avail = cfg.availability[x.pos] ?? 0.85;
    const age0 = x.age ?? 27;
    const a0 = agingMultiplier(model, x.pos, age0) || 1;
    const isRookie = !(x.prod.gp > 0) && !x.last && (x.dyn.yearsExp ?? 0) === 0;
    const cv1 = unc.cv_year1[x.pos] ?? 0.3, g = unc.annual_cv_growth[x.pos] ?? 0.12;
    const years = [];
    let surv = 1, F = 0;
    for (let t = 1; t <= H; t++) {
      const age = age0 + (t - 1);
      if (t > 1) surv *= 1 - hazard(model, x.pos, age - 1);
      let mu = x.dyn.mu1;
      if (t > 1) {
        const aged = x.dyn.mu1 * (agingMultiplier(model, x.pos, age) / a0);
        const pr = draftPrior(model, x.pos, x.p.draft, x.dyn.careerYear + t - 1);
        mu = pr !== null && x.dyn.priorShare > 0 ? (1 - x.dyn.priorShare) * aged + x.dyn.priorShare * pr * x.dyn.ratio : aged;
      }
      let cv = Math.sqrt(cv1 ** 2 + (t - 1) * g ** 2);
      if (isRookie) cv = Math.sqrt(cv ** 2 + unc.rookie_extra_cv ** 2);
      const M = mu * G * avail, SD = Math.max(1e-6, cv * mu * G * avail);
      const eAbove = expectedSurplus(M, SD, r);
      const eBand = Math.max(0, expectedSurplus(M, SD, w) - eAbove);
      const eSurplus = eAbove + beta * eBand;
      const disc = Math.pow(delta, t - 1);
      const contrib = disc * surv * eSurplus;
      F += contrib;
      years.push({
        t, season: phase.season + (phase.phase === 'offseason' || phase.phase === 'postseason' ? t : t - 1), age: Math.round(age * 10) / 10,
        ppg: mu, ppgLow: Math.max(0, mu * (1 - 1.2816 * cv)), ppgHigh: mu * (1 + 1.2816 * cv), cv,
        survival: surv, pStarter: surv * probAbove(M, SD, r), eSurplus, discount: disc, contribution: contrib,
      });
    }
    x.dyn.F = F;
    x.dyn.years = years;
    x.dyn.isRookie = isRookie;
    const y2 = years[1];
    if (y2) {
      x.dyn.breakoutProb = y2.pStarter;
      const sd2 = y2.cv * y2.ppg;
      x.dyn.declineProb = sd2 > 0 ? normCdf((0.85 * x.dyn.mu1 - y2.ppg) / sd2) : (y2.ppg < 0.85 * x.dyn.mu1 ? 1 : 0);
    }
    const horizon = years.filter((y) => y.survival * probAbove(y.ppg * G * avail, Math.max(1e-6, y.cv * y.ppg * G * avail), r) >= 0.25).length;
    x.dyn.careerHorizon = horizon;
  }

  const curves = buildCurves([...inputs.values()].filter((x) => x.dyn.F !== null && positions.has(x.pos)).map((x) => ({ cid: x.p.cid, position: x.pos, score: x.dyn.F })));

  const minPlayers = model.mapping.min_source_players;
  const consensus = aggregateGroup(collectRankings(dataset, { kinds: ['dynasty'], league }), curves, { higherIsBetter: false, weights: model.source_weights.consensus, minPlayers });
  const marketLists = collectMarket(dataset, { dynasty: true, league, scoring });
  const market = aggregateGroup(marketLists, curves, { higherIsBetter: true, weights: model.source_weights.market, minPlayers });
  const adp = aggregateGroup(collectADP(dataset, { formats: adpFormatsFor('dynasty', league, scoring) }), curves, { higherIsBetter: false, weights: model.source_weights.adp, minPlayers, overall: true });

  const weights = { ...cfg.weights };
  const assets = new Map();
  for (const x of inputs.values()) {
    if (!positions.has(x.pos)) continue;
    const cid = x.p.cid;
    const injFrac = x.injury.status ? (cfg.injury_year1_fraction[x.injury.status] ?? 0) : 0;
    const y1 = x.dyn.years ? x.dyn.years[0].contribution : 0;
    const injuryLoss = x.dyn.F !== null ? injFrac * y1 : 0;
    const groups = {
      fundamental: x.dyn.F !== null ? x.dyn.F - injuryLoss : null,
      market: market.get(cid)?.value ?? null,
      consensus: consensus.get(cid)?.value ?? null,
      adp: adp.get(cid)?.value ?? null,
    };
    const b = blendGroups(groups, weights);
    if (b.score === null) continue;
    const contributions = { ...b.contributions };
    if (contributions.fundamental !== undefined) {
      const wf = b.effWeights.fundamental;
      delete contributions.fundamental;
      const evW = x.dyn.ev.reduce((a, e) => a + e.w, 0) || 1;
      const share = (k) => x.dyn.ev.filter((e) => k.includes(e.kind)).reduce((a, e) => a + e.w, 0) / evW;
      contributions.projection = wf * y1 * share(['projection']);
      contributions.production = wf * y1 * share(['production', 'last_season']);
      contributions.prospect = wf * y1 * share(['prior']);
      contributions.longevity = wf * (x.dyn.F - y1);
      if (injuryLoss) contributions.injury = -wf * injuryLoss;
    }
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
    if (x.prod.gp > 0 || x.last) usedSources.add(env.statsSource || 'stats');
    const indep = new Set([...usedSources].map((s) => env.independence[s] || s));
    const extraCv = x.dyn.isRookie ? 0.05 : 0;
    const conf = assessConfidence({
      groups: Object.entries(groups).filter(([g]) => weights[g] > 0).map(([g, v]) => ({ group: g, weight: weights[g], value: v })),
      totalWeight: b.totalWeight,
      games: (x.prod.gp || 0) + (x.last?.gp || 0),
      staleSources: [...usedSources].filter((s) => env.stale.has(s)),
      independentSources: indep.size,
      isRookie: x.dyn.isRookie,
      extraCv,
      final: score,
    }, model.confidence);

    assets.set(cid, {
      id: cid, kind: 'player', mode: 'dynasty',
      name: x.p.name, position: x.pos, team: x.p.team, age: x.age,
      score, groups, weights: b.effWeights, contributions, confidence: conf,
      sources: [...usedSources],
      details: {
        mu1: x.dyn.mu1, evidence: x.dyn.ev, careerYear: x.dyn.careerYear, yearsExp: x.dyn.yearsExp, draftBucket: draftBucket(x.p.draft),
        years: x.dyn.years || null, fundamental: x.dyn.F, isRookie: x.dyn.isRookie || false,
        breakoutProb: x.dyn.breakoutProb ?? null, declineProb: x.dyn.declineProb ?? null, careerHorizon: x.dyn.careerHorizon ?? null,
        projection: { points: x.proj.points, games: x.proj.games, rate: x.proj.rate, scope: x.proj.scope, bySource: x.proj.bySource.map((s) => ({ src: s.src, points: s.points, games: s.games })) },
        production: { gp: x.prod.gp, ppg: x.prod.ppg, xppg: x.prod.xppg, blend: x.prod.blend, recentPPG: x.prod.recentPPG, weekly: x.prod.weeks },
        lastSeason: x.last, usage: x.usage, injury: x.injury, injuryLoss,
        replacement: structure.replacement[x.pos], waiver: structure.waiver[x.pos], y1Points: x.dyn.y1Points ?? null,
        consensus: consensus.get(cid)?.sources || [], market: mk?.sources || [], adp: adp.get(cid)?.sources || [],
        trendRel, strategy, discount: delta,
      },
    });
  }
  return { mode: 'dynasty', assets, structure, curves, scoring, weights, phase, marketLists, delta, strategy };
}

