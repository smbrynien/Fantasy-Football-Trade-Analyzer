// Valuation engine entry point (isomorphic). Pure function of (dataset, league settings, config) → valuations.

import { buildLeague, buildModel, computePhase, settingsHash } from '../settings.js';
import { runRedraft } from './redraft.js';
import { runDynasty } from './dynasty.js';
import { runPicks } from './picks.js';
import { parsePickAssetId, pickAssetId, pickDisplayName } from '../pick-labels.js';
import { stableHash } from '../util/objects.js';

export const COMPONENT_LABELS = {
  market: 'Market',
  consensus: 'Expert consensus',
  projection: 'Projection',
  production: 'Production',
  adp: 'ADP',
  prospect: 'Prospect / draft capital',
  longevity: 'Age / longevity (future seasons)',
  injury: 'Injury',
  trend: 'Trend (market momentum)',
  historical: 'Historical slot value',
  current_class: 'Current rookie class',
  fundamental: 'Fundamental (multi-year model)',
};

export const COMPONENT_ORDER = ['market', 'consensus', 'projection', 'production', 'prospect', 'longevity', 'adp', 'historical', 'current_class', 'trend', 'injury'];

function referenceLeague(model, league, leagueDefaults) {
  const ref = model.reference_league;
  return buildLeague({
    id: 'reference', name: 'Reference league', teams: ref.teams, scoring_preset: ref.scoring_preset, scoring: {},
    roster: ref.roster, dynasty: { ...(league.dynasty || {}), strategy: 'balanced' }, overrides: league.overrides || {},
  }, leagueDefaults);
}

function sourceEnv(dataset, config) {
  const independence = {};
  for (const s of config.sources?.sources || []) independence[s.id] = s.independence_group || s.id;
  const stale = new Set(Object.entries(dataset.sources || {}).filter(([, s]) => s.stale).map(([id]) => id));
  return { independence, stale, statsSource: dataset.meta?.stats_source || null };
}

/**
 * @param dataset  data/calculated/dataset.json
 * @param league   league profile (partial ok; merged over defaults)
 * @param mode     'redraft' | 'dynasty'
 * @param config   { model, leagueDefaults, sources, calibration }
 */
export function computeValuations({ dataset, league: leagueIn, mode, config }) {
  const t0 = Date.now();
  const league = buildLeague(leagueIn, config.leagueDefaults);
  const model = buildModel(config.model, config.calibration, league);
  const phase = computePhase(dataset.state, model);
  const env = { leagueDefaults: config.leagueDefaults, phase, ...sourceEnv(dataset, config) };
  const run = mode === 'dynasty' ? runDynasty : runRedraft;

  const userRun = run(dataset, league, model, env);
  const refLeague = referenceLeague(model, league, config.leagueDefaults);
  const sameAsRef = stableHash({ ...refLeague, id: null, name: null }) === stableHash({ ...league, id: null, name: null });
  const refRun = sameAsRef ? userRun : run(dataset, refLeague, model, env);

  let maxRef = 0;
  for (const a of refRun.assets.values()) if (a.score > maxRef) maxRef = a.score;
  const factor = maxRef > 0 ? model.scale.top_value / maxRef : 1;

  const assets = new Map();
  for (const a of userRun.assets.values()) {
    const ref = refRun.assets.get(a.id);
    assets.set(a.id, finalizeAsset(a, factor, ref));
  }
  assignRanks(assets);

  let picks = null;
  if (mode === 'dynasty') {
    picks = runPicks(dataset, league, model, env, userRun);
    for (const a of picks.assets.values()) assets.set(a.id, finalizePick(a, factor));
  }

  const meta = {
    mode,
    model_version: model.model_version,
    data_version: dataset.data_version,
    dataset_built_at: dataset.built_at,
    calculated_at: new Date().toISOString(),
    settings_hash: settingsHash(league, model),
    phase,
    compute_ms: Date.now() - t0,
    reference_league: sameAsRef ? 'same as your league' : `${refLeague.teams}-team ${refLeague.qb_format.toUpperCase()} ${refLeague.scoring_preset.toUpperCase()}`,
  };

  const result = {
    mode, league, model, phase, factor, assets, meta,
    structure: userRun.structure, weights: userRun.weights, scoring: userRun.scoring,
    picks: picks ? { upcoming: picks.upcoming, seasons: picks.seasons, rounds: picks.rounds, classYear: picks.classYear, diagnostics: picks.diagnostics } : null,
    _pickValuer: picks ? picks.valueDescriptor : null,
  };
  result.getAsset = (id) => getAsset(result, id);
  return result;
}

function finalizeAsset(a, factor, ref) {
  const value = a.score * factor;
  const sigma = (a.confidence?.sigma || 0) * factor;
  const components = {};
  for (const [k, v] of Object.entries(a.contributions || {})) components[k] = v * factor;
  const groupValues = {};
  for (const [k, v] of Object.entries(a.groups || {})) groupValues[k] = typeof v === 'number' ? v * factor : null;
  const refValue = ref ? ref.score * factor : null;
  return {
    ...a,
    value,
    sigma,
    range: [Math.max(0, value - sigma), value + sigma],
    components,
    groupValues,
    refValue,
    leagueEffect: refValue !== null ? value - refValue : null,
  };
}

function finalizePick(a, factor) {
  const value = a.score * factor;
  const sigma = (a.details?.sigma || 0) * factor;
  const components = {};
  for (const [k, v] of Object.entries(a.contributions || {})) components[k] = v * factor;
  return { ...a, value, sigma, range: [Math.max(0, value - sigma), value + sigma], components, groupValues: {}, refValue: null, leagueEffect: null };
}

function assignRanks(assets) {
  const players = [...assets.values()].filter((a) => a.kind === 'player').sort((a, b) => b.value - a.value);
  const posCount = {};
  players.forEach((a, i) => {
    a.rank = i + 1;
    posCount[a.position] = (posCount[a.position] || 0) + 1;
    a.posRank = posCount[a.position];
  });
}

/** Get any asset by id, valuing custom pick descriptors (ranges, beyond pre-built rounds) on demand. */
export function getAsset(result, id) {
  if (result.assets.has(id)) return result.assets.get(id);
  if (String(id).startsWith('pick:') && result._pickValuer) {
    const desc = parsePickAssetId(id);
    if (!desc) return null;
    const res = result._pickValuer(desc);
    if (!res) return null;
    const a = {
      id: pickAssetId(desc), kind: 'pick', mode: 'dynasty', name: pickDisplayName(desc), position: 'PICK', descriptor: desc,
      score: res.score, contributions: res.contributions, groups: {}, confidence: res.confidence, sources: res.marketSources,
      details: { slots: res.slots, classPositions: res.classPositions, discount: res.discount, sigma: res.sigma, outcomeRiskCv: res.outcomeRiskCv },
    };
    const fin = finalizePick(a, result.factor);
    result.assets.set(fin.id, fin);
    return fin;
  }
  return null;
}
