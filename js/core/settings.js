// League settings and effective model construction (pure; used by browser and Node).

import { deepMerge, deepClone, stableHash } from './util/objects.js';
import { clamp } from './util/stats.js';

export const ROSTER_SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF', 'BENCH', 'IR'];

/** Merge a profile over the default league. */
export function buildLeague(profile, leagueDefaults) {
  const base = deepClone(leagueDefaults.default_league);
  const league = deepMerge(base, profile || {});
  // qb_format follows SUPERFLEX slots unless explicitly 2QB (QB>=2)
  if (league.roster.SUPERFLEX > 0) league.qb_format = 'sf';
  else if (league.roster.QB >= 2) league.qb_format = '2qb';
  else league.qb_format = '1qb';
  return league;
}

/** Returns a list of human-readable problems (empty = valid). */
export function validateLeague(league) {
  const errs = [];
  if (!Number.isInteger(league.teams) || league.teams < 4 || league.teams > 32) errs.push('Teams must be an integer between 4 and 32.');
  for (const s of ROSTER_SLOTS) {
    const v = league.roster[s];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < 0 || v > 30) errs.push(`Roster slot ${s} must be an integer 0–30.`);
  }
  const starters = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF'].reduce((a, s) => a + (league.roster[s] || 0), 0);
  if (starters < 1) errs.push('At least one starting slot is required.');
  const sc = league.scoring || {};
  for (const [k, v] of Object.entries(sc)) {
    if (k === 'bonuses') continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 50) errs.push(`Scoring value ${k} must be a number between -50 and 50.`);
  }
  return errs;
}

/** Effective model = config/model.json + calibration overrides + league-level overrides. */
export function buildModel(modelConfig, calibration, league) {
  let m = deepClone(modelConfig);
  if (calibration) {
    const c = calibration;
    if (c.aging_curves?.curves) m.dynasty.aging_curves = { ...m.dynasty.default_aging_curves, ...c.aging_curves.curves };
    if (c.attrition?.hazard) m.dynasty.attrition_table = c.attrition.hazard;
    if (c.availability?.by_position) m.dynasty.availability = { ...m.dynasty.default_availability, ...c.availability.by_position };
    if (c.draft_priors?.priors) m.dynasty.draft_priors = c.draft_priors.priors;
    if (c.rookie_slot_curve?.shape) m.picks.historical_shape = c.rookie_slot_curve.shape;
    if (c.year_over_year?.cv) m.dynasty.uncertainty.cv_year1 = { ...m.dynasty.uncertainty.cv_year1, ...c.year_over_year.cv };
    m.calibrated = Object.keys(c).filter((k) => c[k]);
  }
  if (!m.dynasty.aging_curves) m.dynasty.aging_curves = m.dynasty.default_aging_curves;
  if (!m.dynasty.availability) m.dynasty.availability = m.dynasty.default_availability;
  if (league && league.overrides) m = deepMerge(m, league.overrides);
  return m;
}

/**
 * Season phase from NFL state. Returns { season, week, phase, alpha, remaining_weeks }
 * alpha = 0 (pure preseason weights) … 1 (pure in-season weights).
 */
export function computePhase(state, model) {
  const weeks = model.phase.regular_season_weeks;
  const season = Number(state?.season) || new Date().getFullYear();
  const type = state?.season_type || 'regular';
  let week = Number(state?.week) || 0;
  let phase;
  if (type === 'pre' || type === 'preseason' || week <= 0) phase = 'preseason';
  else if (type === 'post' || week > weeks) phase = 'postseason';
  else if (type === 'off') phase = 'offseason';
  else phase = 'in_season';
  if (phase === 'preseason' || phase === 'offseason') week = 1;
  const full = model.phase.full_in_season_week;
  const alpha = phase === 'in_season' ? clamp((week - 1) / Math.max(1, full - 1), 0, 1) : phase === 'postseason' ? 1 : 0;
  const remaining_weeks = phase === 'postseason' ? 0 : Math.max(0, weeks - week + 1);
  return { season, week, phase, alpha, remaining_weeks };
}

export function blendWeights(pre, inSeason, alpha) {
  const keys = new Set([...Object.keys(pre), ...Object.keys(inSeason)]);
  const out = {};
  for (const k of keys) out[k] = (1 - alpha) * (pre[k] || 0) + alpha * (inSeason[k] || 0);
  return out;
}

export function settingsHash(league, model) {
  return stableHash({ league, model_version: model.model_version, model });
}

/** Number of starters per position after allocating FLEX/SUPERFLEX (used for labels/explanations only). */
export function starterSlotsSummary(league) {
  const r = league.roster;
  return ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF'].filter((s) => r[s]).map((s) => `${r[s]} ${s}`).join(' · ');
}
