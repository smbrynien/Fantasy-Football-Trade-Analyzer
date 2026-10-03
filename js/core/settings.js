// League settings and effective model construction (pure; used by browser and Node).

import { deepMerge, deepClone, stableHash } from './util/objects.js';
import { clamp } from './util/stats.js';

export const ROSTER_SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF', 'BENCH', 'IR'];

/** Merge a profile over the default league. */
export function buildLeague(profile, leagueDefaults) {
  const base = deepClone(leagueDefaults.default_league);
  const league = deepMerge(base, profile || {});
  if (!league.roster || typeof league.roster !== 'object') league.roster = deepClone(base.roster || {}); // e.g. roster: null
  // qb_format follows SUPERFLEX slots unless explicitly 2QB (QB>=2)
  if (league.roster.SUPERFLEX > 0) league.qb_format = 'sf';
  else if (league.roster.QB >= 2) league.qb_format = '2qb';
  else league.qb_format = '1qb';
  return league;
}

/**
 * Coerce a built league into what the engine can value safely. Profiles can reach the engine without passing the
 * settings form (localStorage, the server copy, older versions, imports): a negative team count or a roster slot of
 * "two" used to crash every page, and 0/NaN teams produced values with teams = null. Clamps to the same limits
 * validateLeague enforces in the UI (which still reports the problem to the user — buildLeague stays unclamped).
 */
export function sanitizeLeague(league, leagueDefaults) {
  const def = leagueDefaults?.default_league || {};
  const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const out = { ...league };
  out.teams = clamp(Math.round(num(league.teams, def.teams ?? 12)), 4, 32);
  out.roster = Object.fromEntries(ROSTER_SLOTS.map((s) => [s, clamp(Math.round(num(league.roster?.[s], def.roster?.[s] ?? 0)), 0, 30)]));
  const sc = league.scoring && typeof league.scoring === 'object' ? league.scoring : {};
  out.scoring = Object.fromEntries(Object.entries(sc).filter(([k, v]) => k === 'bonuses' || (typeof v === 'number' && Number.isFinite(v))));
  if (Array.isArray(sc.bonuses)) out.scoring.bonuses = sc.bonuses.filter((b) => b && Number.isFinite(Number(b.threshold)) && Number.isFinite(Number(b.points)));
  else delete out.scoring.bonuses;
  if (league.dynasty && typeof league.dynasty === 'object') {
    // Only fix values that are present: absent ones fall back to the (overridable) model defaults downstream.
    const dy = { ...league.dynasty };
    if (dy.strategy !== undefined && !['contending', 'balanced', 'rebuilding'].includes(dy.strategy)) dy.strategy = 'balanced';
    for (const k of ['rookie_rounds', 'pick_years']) if (dy[k] !== undefined && dy[k] !== null) { const n = num(dy[k], null); if (n === null) delete dy[k]; else dy[k] = clamp(Math.round(n), 1, 6); }
    out.dynasty = dy;
  }
  // FLEX/SUPERFLEX eligibility: a list of real positions. A number or string here ({ FLEX: 5 }, 'RB') crashed the league
  // structure and the lineup code on every page (BUG_AUDIT 2, E1); anything else falls back to the defaults.
  const defElig = def.flex_eligibility || { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] };
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const fe = league.flex_eligibility && typeof league.flex_eligibility === 'object' ? league.flex_eligibility : {};
  out.flex_eligibility = Object.fromEntries(['FLEX', 'SUPERFLEX'].map((slot) => {
    const list = Array.isArray(fe[slot]) ? [...new Set(fe[slot].filter((p) => POSITIONS.includes(p)))] : null;
    return [slot, list && list.length ? list : [...(defElig[slot] || [])]];
  }));
  out.qb_format = out.roster.SUPERFLEX > 0 ? 'sf' : out.roster.QB >= 2 ? '2qb' : '1qb';
  return out;
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
  if (league && league.overrides) {
    m = deepMerge(m, sanitizeOverrides(m, league.overrides));
    clampModel(m);
  }
  return m;
}

// Engine-safe ranges for parameters whose extreme values break the computation (BUG_AUDIT 2, E3): a stored/imported
// profile with dynasty.horizon_years 1e9 ran out of memory, 0 hung, -5 crashed; a negative pick discount or value scale
// made values negative. Every default lies inside these ranges, so default values never change. Overrides are also
// never negative (no parameter of config/model.json is), see sanitizeOverrides.
const MODEL_BOUNDS = {
  'dynasty.horizon_years': [1, 15, true],
  'dynasty.strategy_discount.contending': [0.01, 1], 'dynasty.strategy_discount.balanced': [0.01, 1], 'dynasty.strategy_discount.rebuilding': [0.01, 1],
  'picks.future_year_discount': [0.01, 1], 'picks.class_strength': [0.01, 5], 'picks.prior_class_adjustment': [0.01, 2],
  'picks.upcoming_class_switch_month': [1, 12, true], 'picks.years_ahead': [1, 6, true],
  'scale.top_value': [1, 1e6], 'scale.anchor_top_n': [1, 200, true],
  'phase.full_in_season_week': [2, 30, true], 'phase.regular_season_weeks': [1, 30, true],
  'package.redraft.min_retained_fraction': [0, 1], 'package.dynasty.min_retained_fraction': [0, 1],
};
function clampModel(m) {
  for (const [path, [lo, hi, int]] of Object.entries(MODEL_BOUNDS)) {
    const ks = path.split('.');
    const parent = ks.slice(0, -1).reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), m);
    const k = ks[ks.length - 1];
    if (!parent || typeof parent[k] !== 'number') continue;
    const v = Math.min(hi, Math.max(lo, int ? Math.round(parent[k]) : parent[k]));
    parent[k] = v;
  }
}

/**
 * Per-league model overrides, keeping only leaves whose type matches the default (a finite number where the default
 * is a number, an object where it is an object, ...). Overrides reach the engine from stored or imported profiles and
 * from the Settings form, which stored `null` for a cleared number field: JavaScript reads null as 0, so clearing
 * "Bench value fraction" zeroed 77 values and a null weight table crashed every page (BUG_AUDIT 2, E2). A dropped
 * leaf means "use the default".
 */
export function sanitizeOverrides(def, ov) {
  const plain = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  if (!plain(ov)) return {};
  const out = {};
  for (const [k, v] of Object.entries(ov)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const d = def?.[k];
    if (plain(v)) {
      if (d === undefined || d === null || plain(d)) { const sub = sanitizeOverrides(plain(d) ? d : {}, v); if (Object.keys(sub).length) out[k] = sub; }
    } else if (typeof v === 'number') {
      if (Number.isFinite(v) && v >= 0 && (d === undefined || d === null || typeof d === 'number')) out[k] = v;
    } else if (typeof v === 'string' || typeof v === 'boolean') {
      if (typeof d === typeof v) out[k] = v;
    } else if (Array.isArray(v)) {
      if (Array.isArray(d)) out[k] = v;
    }
  }
  return out;
}

/**
 * The date the dataset describes (ages, the upcoming rookie class): state.as_of, else built_at, else now — the first
 * that is a valid date. A malformed as_of made every pick season null (BUG_AUDIT 2, D2).
 */
export function datasetAsOf(dataset) {
  for (const x of [dataset?.state?.as_of, dataset?.built_at]) {
    if (!x) continue;
    const d = new Date(x);
    if (Number.isFinite(d.getTime())) return d;
  }
  return new Date();
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
