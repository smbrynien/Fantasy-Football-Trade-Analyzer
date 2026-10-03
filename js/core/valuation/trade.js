// Trade analysis: totals, component differences, uncertainty, package (consolidation) adjustments,
// age / position / time-horizon implications, and a reproducibility record.

import { getAsset, COMPONENT_ORDER } from './engine.js';
import { valueAtRank } from '../util/stats.js';

function positionValueCurves(result) {
  const byPos = {};
  const all = [];
  for (const a of result.assets.values()) {
    if (a.kind !== 'player') continue;
    (byPos[a.position] ||= []).push(a.value);
    all.push(a.value);
  }
  for (const k of Object.keys(byPos)) byPos[k].sort((x, y) => y - x);
  all.sort((x, y) => y - x);
  return { byPos, all };
}

/**
 * Package adjustment for the side that receives MORE players than it sends.
 * Extra players (the lowest-valued ones beyond a 1-for-1 swap) are charged:
 *   lineup displacement = value of the average team's worst starter at that position × strength
 *   roster-slot cost    = value of the last rostered player × roster_slot_cost
 * capped so each extra keeps at least min_retained_fraction of its value. Picks are exempt.
 */
export function packageAdjustment(receivedAssets, sentPlayersCount, result) {
  const cfg = result.model.package;
  const mcfg = cfg[result.mode];
  const players = receivedAssets.filter((a) => a.kind === 'player');
  const nExtra = players.length - sentPlayersCount;
  if (!cfg.enabled || nExtra <= 0) return { total: 0, items: [], nExtra: Math.max(0, nExtra), explanation: [] };
  const curves = positionValueCurves(result);
  const T = result.league.teams;
  const st = result.structure;
  const rosterCost = valueAtRank(curves.all, st.totalRostered) || 0;
  const extras = [...players].sort((a, b) => a.value - b.value).slice(0, nExtra);
  const items = [];
  const explanation = [];
  for (const a of extras) {
    const s = st.starters[a.position] || 0;
    const dRank = Math.max(1, Math.round(s - T / 2 + 0.5));
    const dispValue = s > 0 ? valueAtRank(curves.byPos[a.position] || [], dRank) || 0 : 0;
    const raw = mcfg.displacement_strength * Math.min(a.value, dispValue) + mcfg.roster_slot_cost * rosterCost;
    const charge = Math.min(raw, a.value * (1 - mcfg.min_retained_fraction));
    items.push({ id: a.id, name: a.name, position: a.position, value: a.value, displacement: dispValue, rosterCost, charge });
    explanation.push(`${a.name}: extra roster piece. Typical team's worst starting ${a.position} (≈${a.position}${dRank}) is worth ${Math.round(dispValue)}; ` +
      `charge = ${mcfg.displacement_strength} × min(${Math.round(a.value)}, ${Math.round(dispValue)}) + ${mcfg.roster_slot_cost} × ${Math.round(rosterCost)} (last rostered player)` +
      `${charge < raw ? `, capped at ${Math.round((1 - mcfg.min_retained_fraction) * 100)}% of value` : ''} = −${Math.round(charge)}.`);
  }
  return { total: items.reduce((s, i) => s + i.charge, 0), items, nExtra, explanation };
}

function sideSummary(assets, result) {
  const raw = assets.reduce((s, a) => s + a.value, 0);
  const sigma = Math.sqrt(assets.reduce((s, a) => s + (a.sigma || 0) ** 2, 0));
  const components = {};
  for (const a of assets) for (const [k, v] of Object.entries(a.components || {})) components[k] = (components[k] || 0) + v;
  const groupValues = {};
  for (const a of assets) for (const [k, v] of Object.entries(a.groupValues || {})) if (typeof v === 'number') groupValues[k] = (groupValues[k] || 0) + v;
  const players = assets.filter((a) => a.kind === 'player');
  const valueWeightedAge = players.length && players.some((a) => a.age) ? players.filter((a) => a.age).reduce((s, a) => s + a.age * a.value, 0) / Math.max(1e-9, players.filter((a) => a.age).reduce((s, a) => s + a.value, 0)) : null;
  const byPosition = {};
  for (const a of assets) byPosition[a.position] = (byPosition[a.position] || 0) + a.value;
  let now = null, future = null;
  if (result.mode === 'dynasty') {
    now = 0; future = 0;
    for (const a of assets) {
      const c = a.components || {};
      if (a.kind === 'pick') { future += a.value; continue; }
      const cur = (c.projection || 0) + (c.production || 0) + (c.injury || 0);
      const fut = (c.longevity || 0) + (c.prospect || 0);
      const signal = a.value - cur - fut; // market/consensus/adp/trend — split in the same proportion as the fundamental
      const fundamental = cur + fut;
      const curShare = fundamental > 0 ? cur / fundamental : 0.5;
      now += cur + signal * curShare;
      future += fut + signal * (1 - curShare);
    }
  }
  return { raw, sigma, components, groupValues, valueWeightedAge, byPosition, now, future };
}

/**
 * @param result    computeValuations() output
 * @param idsA      asset ids Team A RECEIVES
 * @param idsB      asset ids Team B RECEIVES
 * @param names     optional id → display name lookup (function or object) for assets without a value
 */
export function analyzeTrade(result, idsA, idsB, { dataSources = {}, names = null } = {}) {
  const resolve = (ids) => ids.map((id) => getAsset(result, id)).filter(Boolean);
  const A = resolve(idsA), B = resolve(idsB);
  const missing = [...idsA, ...idsB].filter((id) => !getAsset(result, id));
  const nameOf = (id) => (typeof names === 'function' ? names(id) : names?.[id]) || id;
  const sa = sideSummary(A, result), sb = sideSummary(B, result);
  // An unavailable player (no value in this mode/data) still changes hands and takes a roster spot: count him for the
  // package adjustment so the other side isn't charged for "consolidating". Unvalued picks stay exempt like all picks.
  const unvaluedPlayers = (ids) => ids.filter((id) => !getAsset(result, id) && !String(id).startsWith('pick:')).length;
  const playersA = A.filter((a) => a.kind === 'player').length + unvaluedPlayers(idsA);
  const playersB = B.filter((a) => a.kind === 'player').length + unvaluedPlayers(idsB);
  // An incomplete trade (one side still empty) is not a consolidation: charging the only side that has players made
  // a lone Player X show as a fraction of his value while the user was still building the trade.
  const complete = idsA.length > 0 && idsB.length > 0;
  const none = { total: 0, items: [], nExtra: 0, explanation: [] };
  const pkgA = complete ? packageAdjustment(A, playersB, result) : none;
  const pkgB = complete ? packageAdjustment(B, playersA, result) : none;
  const adjA = sa.raw - pkgA.total, adjB = sb.raw - pkgB.total;
  const diff = adjA - adjB;
  const base = Math.max(adjA, adjB, 1e-9);
  const pct = diff / base;
  const sigmaDiff = Math.sqrt(sa.sigma ** 2 + sb.sigma ** 2);
  const z = sigmaDiff > 0 ? Math.abs(diff) / sigmaDiff : (diff === 0 ? 0 : Infinity);

  let assessment;
  if (!idsA.length || !idsB.length) assessment = { level: 'incomplete', text: 'Add at least one asset to each side to compare.' };
  else if (z < 1) assessment = { level: 'even', text: `The model considers this trade close: the ${Math.round(Math.abs(diff)).toLocaleString()}-point gap is smaller than the combined uncertainty of ±${Math.round(sigmaDiff).toLocaleString()}.` };
  else if (z < 2) assessment = { level: 'lean', text: `Team ${diff > 0 ? 'A' : 'B'} receives more value (${Math.abs(pct * 100).toFixed(1)}%). The gap exceeds the model's uncertainty, but only modestly — reasonable people could disagree.` };
  else assessment = { level: 'clear', text: `Team ${diff > 0 ? 'A' : 'B'} receives clearly more value in this model (${Math.abs(pct * 100).toFixed(1)}%, about ${z.toFixed(1)}× the combined uncertainty).` };

  // How often a margin this size actually worked out over a season (audit E7; redraft only, display only).
  const slope = result.model.trade_outcome?.redraft_logit_slope;
  const outcome = result.mode === 'redraft' && complete && diff !== 0 && slope > 0
    ? { favoured: diff > 0 ? 'A' : 'B', probability: 1 / (1 + Math.exp(-slope * Math.abs(pct))) }
    : null;

  const keys = new Set([...Object.keys(sa.components), ...Object.keys(sb.components)]);
  const componentDiffs = COMPONENT_ORDER.filter((k) => keys.has(k)).map((k) => ({ key: k, a: sa.components[k] || 0, b: sb.components[k] || 0, diff: (sa.components[k] || 0) - (sb.components[k] || 0) }));
  const groupKeys = new Set([...Object.keys(sa.groupValues), ...Object.keys(sb.groupValues)]);
  const signalDiffs = [...groupKeys].map((k) => ({ key: k, a: sa.groupValues[k] || 0, b: sb.groupValues[k] || 0, diff: (sa.groupValues[k] || 0) - (sb.groupValues[k] || 0) }));

  const notes = [];
  if (result.mode === 'dynasty' && sa.valueWeightedAge && sb.valueWeightedAge && Math.abs(sa.valueWeightedAge - sb.valueWeightedAge) >= 1.5) {
    const younger = sa.valueWeightedAge < sb.valueWeightedAge ? 'A' : 'B';
    notes.push(`Team ${younger} receives the younger package (value-weighted age ${Math.min(sa.valueWeightedAge, sb.valueWeightedAge).toFixed(1)} vs ${Math.max(sa.valueWeightedAge, sb.valueWeightedAge).toFixed(1)}).`);
  }
  if (result.mode === 'dynasty' && sa.now !== null) {
    const nowLead = sa.now - sb.now, futLead = sa.future - sb.future;
    if (Math.sign(nowLead) !== Math.sign(futLead) && Math.abs(nowLead) > 200 && Math.abs(futLead) > 200) {
      notes.push(`Team ${nowLead > 0 ? 'A' : 'B'} gains more current-season value; Team ${futLead > 0 ? 'A' : 'B'} gains more future value.`);
    }
  }
  if (pkgA.nExtra || pkgB.nExtra) {
    const cons = pkgA.nExtra ? 'B' : 'A';
    const extra = pkgA.nExtra ? 'A' : 'B';
    // "Team A consolidates" read wrongly when Team A receives a draft pick for a player: say what is actually charged.
    if ((cons === 'A' ? A : B).some((a) => a.kind === 'pick')) notes.push(`Team ${extra} receives more players than it sends (draft picks don't count as players), so its extra player(s) are charged the package adjustment for lineup displacement and roster spots.`);
    else notes.push(`Team ${cons} consolidates (receives fewer players). The package adjustment charges the extra pieces for lineup displacement and roster spots.`);
  }
  const lowConf = [...A, ...B].filter((a) => a.confidence && a.confidence.label === 'Low');
  if (lowConf.length) notes.push(`Low-confidence values: ${lowConf.map((a) => a.name).join(', ')}.`);
  if (missing.length) notes.push(`Unavailable assets (no value in this mode/data, counted as 0): ${missing.map(nameOf).join(', ')}.`);

  const summarize = (a) => ({ id: a.id, name: a.name, kind: a.kind, position: a.position, team: a.team, age: a.age, value: a.value, range: a.range, sigma: a.sigma, confidence: a.confidence?.label, components: a.components });
  return {
    sides: [
      { label: 'Team A receives', assets: A.map(summarize), ...sa, package: pkgA, adjusted: adjA },
      { label: 'Team B receives', assets: B.map(summarize), ...sb, package: pkgB, adjusted: adjB },
    ],
    diff, pct, sigmaDiff, z, assessment, outcome, componentDiffs, signalDiffs, notes, missing,
    audit: {
      calculated_at: new Date().toISOString(),
      model_version: result.meta.model_version,
      data_version: result.meta.data_version,
      dataset_built_at: result.meta.dataset_built_at,
      settings_hash: result.meta.settings_hash,
      mode: result.mode,
      league: result.league,
      phase: result.phase,
      source_timestamps: dataSources,
      assets: { A: idsA, B: idsB },
    },
  };
}
