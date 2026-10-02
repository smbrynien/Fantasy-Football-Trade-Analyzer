// SETTINGS — league profiles, scoring, roster, model weights, package adjustments, data refresh, debug.
// Editing a built-in preset automatically creates a custom copy; user profiles auto-save.

import { h, toast, download, fmtTime } from '../dom.js';
import { app, activeProfile, allProfiles, upsertUserProfile, deleteUserProfile, setProfile, emit, save, load } from '../state.js';
import { buildLeague, buildModel, validateLeague, settingsHash } from '../../core/settings.js';
import { resolveScoring } from '../../core/scoring.js';
import { deepClone } from '../../core/util/objects.js';

const SECTIONS = [['league', 'League'], ['scoring', 'Scoring'], ['roster', 'Roster'], ['redraft', 'Redraft Model'], ['dynasty', 'Dynasty Model'], ['picks', 'Rookie Pick Model'], ['sources', 'Source Weights'], ['package', 'Trade Package Adjustments'], ['refresh', 'Data Refresh'], ['advanced', 'Advanced / Debug']];

function getPath(o, path) { return path.split('.').reduce((x, k) => (x === null || x === undefined ? undefined : x[k]), o); }
function setPath(o, path, v) { const ks = path.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ||= {}; x[ks[ks.length - 1]] = v; }

export function renderSettings(root, args) {
  const sec = SECTIONS.some(([k]) => k === args[0]) ? args[0] : 'league';
  const profile = deepClone(activeProfile());
  const league = buildLeague(profile, app.config.leagueDefaults);
  const model = buildModel(app.config.model, app.config.calibration, league);

  /** Persist a change: built-in presets are copied to a user profile on first edit. */
  function commit(mutator, { rerender = true } = {}) {
    let p = deepClone(activeProfile());
    if (p.builtin) {
      p = { ...p, id: `user_${Date.now().toString(36)}`, name: `${p.name} (custom)`, builtin: false };
      toast(`Preset copied to "${p.name}" — your changes are saved there.`);
    }
    mutator(p);
    const errs = validateLeague(buildLeague(p, app.config.leagueDefaults));
    if (errs.length) { toast(errs.join(' '), 'bad', 6000); return; }
    const saved = upsertUserProfile(p);
    if (app.profileId !== saved.id) setProfile(saved.id); else emit('profiles');
    if (rerender) location.hash = `#/settings/${sec}`;
  }
  const modelVal = (path) => getPath(model, path);
  const setModel = (path, v) => commit((p) => { p.overrides = p.overrides || {}; setPath(p.overrides, path, v); });

  const numField = (label, value, onSet, { step = 'any', min, max, help } = {}) => h('label.field', { title: help || '' }, label,
    h('input', { type: 'number', step, min, max, value: value ?? '', onchange: (e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== null && !Number.isFinite(v)) return; onSet(v); } }));
  const modelNum = (label, path, opts) => numField(label, modelVal(path), (v) => setModel(path, v), opts);

  const nav = h('div.subtabs', {}, SECTIONS.map(([k, l]) => h('button', { class: k === sec ? 'active' : '', onclick: () => { location.hash = `#/settings/${k}`; } }, l)));
  const body = h('div.panel');
  root.append(profileBar(), nav, body);

  function profileBar() {
    const p = activeProfile();
    return h('div.panel.mb', {},
      h('div.flex-between', {},
        h('div', {}, h('div.small.muted', {}, 'Active configuration profile'), h('h2', { style: { margin: 0 } }, p.name, p.builtin ? h('span.badge', { style: { marginLeft: '.5rem' } }, 'preset') : h('span.badge.info', { style: { marginLeft: '.5rem' } }, 'saved'))),
        h('div.flex', {},
          h('button.btn.btn-sm', { onclick: () => { const name = prompt('Name for the new profile', `${p.name.replace(/ \(custom\)$/, '')} — copy`); if (!name) return; const c = { ...deepClone(p), id: `user_${Date.now().toString(36)}`, name, builtin: false }; upsertUserProfile(c); setProfile(c.id); } }, 'Save as…'),
          !p.builtin ? h('button.btn.btn-sm', { onclick: () => { const name = prompt('Rename profile', p.name); if (name) commit((x) => { x.name = name; }); } }, 'Rename') : null,
          !p.builtin ? h('button.btn.btn-sm.btn-danger', { onclick: () => { if (confirm(`Delete "${p.name}"?`)) deleteUserProfile(p.id); } }, 'Delete') : null,
          h('button.btn.btn-sm', { onclick: () => download(`${p.name.replace(/[^\w-]+/g, '_')}.league.json`, JSON.stringify({ ...p, builtin: undefined, exported_at: new Date().toISOString(), model_version: app.config.model.model_version }, null, 2), 'application/json') }, '⤓ Export'),
          h('label.btn.btn-sm', {}, '⤒ Import', h('input', { type: 'file', accept: '.json', hidden: true, onchange: (e) => importProfile(e.target.files[0]) })),
          h('button.btn.btn-sm', { onclick: sleeperImport }, 'Import from Sleeper league'))),
      h('p.small.muted', {}, `${allProfiles().filter((x) => !x.builtin).length} saved profile(s). Profiles are stored in your browser and in data/user/profiles.json on the local server.`));
  }

  function importProfile(f) {
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = JSON.parse(rd.result);
        if (!p.roster || !p.teams) throw new Error('Not a league profile (missing teams/roster).');
        p.id = `user_${Date.now().toString(36)}`;
        p.builtin = false;
        const errs = validateLeague(buildLeague(p, app.config.leagueDefaults));
        if (errs.length) throw new Error(errs.join(' '));
        upsertUserProfile(p);
        setProfile(p.id);
        toast(`Imported "${p.name}".`);
      } catch (e) { toast(`Import failed: ${e.message}`, 'bad'); }
    };
    rd.readAsText(f);
  }

  async function sleeperImport() {
    const id = prompt('Sleeper league ID (the number in your league URL)');
    if (!id || !/^\d{5,25}$/.test(id.trim())) return;
    try {
      const res = await fetch(`https://api.sleeper.app/v1/league/${id.trim()}`);
      if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
      const lg = await res.json();
      const rp = lg.roster_positions || [];
      const count = (k) => rp.filter((x) => x === k).length;
      const ss = lg.scoring_settings || {};
      const sc = {};
      const map = { pass_yd: 'pass_yd', pass_td: 'pass_td', pass_int: 'pass_int', pass_2pt: 'pass_2pt', pass_fd: 'pass_fd', rush_yd: 'rush_yd', rush_td: 'rush_td', rush_2pt: 'rush_2pt', rush_fd: 'rush_fd', rec: 'rec', rec_yd: 'rec_yd', rec_td: 'rec_td', rec_2pt: 'rec_2pt', rec_fd: 'rec_fd', fum_lost: 'fum_lost', bonus_rec_te: 'bonus_rec_te', bonus_rec_rb: 'bonus_rec_rb', bonus_rec_wr: 'bonus_rec_wr', pass_sack: 'pass_sack', pass_cmp: 'pass_cmp', pass_inc: 'pass_inc', rush_att: 'rush_att' };
      for (const [k, v] of Object.entries(map)) if (typeof ss[k] === 'number') sc[v] = ss[k];
      const bonuses = [];
      for (const [k, stat, thr] of [['bonus_pass_yd_300', 'pass_yd', 300], ['bonus_pass_yd_400', 'pass_yd', 400], ['bonus_rush_yd_100', 'rush_yd', 100], ['bonus_rush_yd_200', 'rush_yd', 200], ['bonus_rec_yd_100', 'rec_yd', 100], ['bonus_rec_yd_200', 'rec_yd', 200]]) if (ss[k]) bonuses.push({ stat, threshold: thr, points: ss[k] });
      if (bonuses.length) sc.bonuses = bonuses;
      const isDynasty = lg.settings && lg.settings.type === 2;
      const p = {
        id: `user_${Date.now().toString(36)}`, name: lg.name || `Sleeper ${id}`, mode: isDynasty ? 'dynasty' : 'redraft', builtin: false,
        teams: lg.total_rosters || 12, scoring_preset: sc.rec >= 0.75 ? 'ppr' : sc.rec >= 0.25 ? 'half_ppr' : 'standard', scoring: sc,
        roster: { QB: count('QB'), RB: count('RB'), WR: count('WR'), TE: count('TE'), FLEX: count('FLEX') + count('REC_FLEX') + count('WRRB_FLEX'), SUPERFLEX: count('SUPER_FLEX'), K: count('K'), DEF: count('DEF'), BENCH: count('BN'), IR: lg.settings?.reserve_slots ?? 0 },
        dynasty: { strategy: 'balanced', rookie_rounds: lg.settings?.draft_rounds && isDynasty ? Math.min(6, lg.settings.draft_rounds) : 4, pick_years: 3 },
        source: { platform: 'sleeper', league_id: id.trim(), imported_at: new Date().toISOString() },
      };
      if (count('REC_FLEX') || count('WRRB_FLEX')) toast('Note: WR/TE-only or WR/RB-only flex slots were treated as regular FLEX.', 'warn', 6000);
      // Same checks as the settings form and profile import (it used to skip them, e.g. a 2-team league).
      const errs = validateLeague(buildLeague(p, app.config.leagueDefaults));
      if (errs.length) throw new Error(`this league can't be modelled as-is: ${errs.join(' ')}`);
      upsertUserProfile(p);
      setProfile(p.id);
      toast(`Imported "${p.name}" from Sleeper (${p.teams} teams, ${isDynasty ? 'dynasty' : 'redraft'}).`);
    } catch (e) { toast(`Sleeper import failed: ${e.message}`, 'bad'); }
  }

  const S = {
    league() {
      return h('div', {},
        h('h3', {}, 'League'),
        h('div.fields', {},
          h('label.field', {}, 'Name', h('input', { type: 'text', value: league.name, onchange: (e) => commit((p) => { p.name = e.target.value || p.name; }) })),
          h('label.field', {}, 'Teams', h('select', { onchange: (e) => { if (e.target.value === 'custom') { const n = Number(prompt('Number of teams (4–32)', league.teams)); if (n) commit((p) => { p.teams = n; }); } else commit((p) => { p.teams = Number(e.target.value); }); } },
            [8, 10, 12, 14, 16].map((n) => h('option', { value: n, selected: league.teams === n ? true : null }, `${n} teams`)), h('option', { value: 'custom', selected: ![8, 10, 12, 14, 16].includes(league.teams) ? true : null }, ![8, 10, 12, 14, 16].includes(league.teams) ? `${league.teams} teams (custom)` : 'Custom…'))),
          h('label.field', {}, 'QB format', h('select', { onchange: (e) => commit((p) => { p.roster = { ...league.roster }; if (e.target.value === 'sf') { p.roster.SUPERFLEX = Math.max(1, p.roster.SUPERFLEX || 0); p.roster.QB = 1; } else if (e.target.value === '2qb') { p.roster.QB = 2; p.roster.SUPERFLEX = 0; } else { p.roster.QB = 1; p.roster.SUPERFLEX = 0; } }) },
            [['1qb', '1 QB'], ['2qb', '2 QB'], ['sf', 'Superflex']].map(([v, l]) => h('option', { value: v, selected: league.qb_format === v ? true : null }, l)))),
          h('label.field', {}, 'Default mode hint', h('select', { onchange: (e) => commit((p) => { p.mode = e.target.value; }) }, ['redraft', 'dynasty'].map((m) => h('option', { value: m, selected: (profile.mode || 'redraft') === m ? true : null }, m))))),
        h('p.small.muted.mt', {}, 'The REDRAFT / DYNASTY toggle at the top switches the valuation engine; both use these league settings.'));
    },
    scoring() {
      const sc = resolveScoring(league, app.config.leagueDefaults);
      const set = (k, v) => commit((p) => { p.scoring = { ...(p.scoring || {}), [k]: v }; if (k === 'rec') p.scoring_preset = v === 1 ? 'ppr' : v === 0.5 ? 'half_ppr' : v === 0 ? 'standard' : 'custom'; });
      const f = (label, k, step = 'any') => numField(label, sc[k], (v) => set(k, v ?? 0), { step });
      return h('div', {},
        h('div.flex', {}, h('label.field', {}, 'Preset', h('select', { onchange: (e) => commit((p) => { p.scoring_preset = e.target.value; p.scoring = { ...(p.scoring || {}) }; delete p.scoring.rec; }) },
          [['standard', 'Standard'], ['half_ppr', 'Half PPR'], ['ppr', 'Full PPR'], ['custom', 'Custom']].map(([v, l]) => h('option', { value: v, selected: league.scoring_preset === v ? true : null }, l)))),
          h('button.btn.btn-sm', { onclick: () => commit((p) => { p.scoring = {}; }) }, 'Reset custom scoring')),
        h('h3.mt', {}, 'Passing'), h('div.fields', {}, f('Pass yards (pts/yd)', 'pass_yd'), f('Pass TD', 'pass_td'), f('Interception', 'pass_int'), f('Pass 2-pt', 'pass_2pt'), f('Pass 1st down', 'pass_fd'), f('Completion', 'pass_cmp'), f('Incompletion', 'pass_inc'), f('Sack taken', 'pass_sack')),
        h('h3.mt', {}, 'Rushing'), h('div.fields', {}, f('Rush yards (pts/yd)', 'rush_yd'), f('Rush TD', 'rush_td'), f('Rush 2-pt', 'rush_2pt'), f('Rush 1st down', 'rush_fd'), f('Rush attempt', 'rush_att')),
        h('h3.mt', {}, 'Receiving'), h('div.fields', {}, f('Reception', 'rec'), f('Rec yards (pts/yd)', 'rec_yd'), f('Rec TD', 'rec_td'), f('Rec 2-pt', 'rec_2pt'), f('Rec 1st down', 'rec_fd'), f('Fumble lost', 'fum_lost')),
        h('h3.mt', {}, 'Premiums'), h('div.fields', {}, f('TE premium (pts/rec)', 'bonus_rec_te'), f('TE 1st-down bonus', 'bonus_fd_te'), f('RB reception bonus', 'bonus_rec_rb'), f('WR reception bonus', 'bonus_rec_wr')),
        h('h3.mt', {}, 'Bonuses (per game)'),
        h('table.data', {}, h('tbody', {}, (sc.bonuses || []).map((b, i) => h('tr', {}, h('td', {}, b.stat), h('td', {}, `≥ ${b.threshold}`),
          h('td', {}, h('input', { type: 'number', step: 'any', value: b.points, onchange: (e) => commit((p) => { const arr = deepClone(sc.bonuses); arr[i].points = Number(e.target.value) || 0; p.scoring = { ...(p.scoring || {}), bonuses: arr }; }) }), ' pts'))))),
        h('p.small.muted', {}, 'Bonuses are exact for actual weekly stats; for projections they are estimated per game from the projected average (normal approximation). K and DEF use the source\'s own fantasy points (custom K/DST scoring is not modelled yet).'));
    },
    roster() {
      const r = league.roster;
      const slot = (k, label) => numField(label, r[k], (v) => commit((p) => { p.roster = { ...league.roster, [k]: Math.max(0, Math.round(v || 0)) }; }), { step: 1, min: 0, max: 30 });
      return h('div', {}, h('h3', {}, 'Starting lineup'), h('div.fields', {}, slot('QB', 'QB'), slot('RB', 'RB'), slot('WR', 'WR'), slot('TE', 'TE'), slot('FLEX', 'FLEX (RB/WR/TE)'), slot('SUPERFLEX', 'Superflex (QB/RB/WR/TE)'), slot('K', 'K'), slot('DEF', 'DEF')),
        h('h3.mt', {}, 'Reserves'), h('div.fields', {}, slot('BENCH', 'Bench'), slot('IR', 'IR')),
        h('p.small.muted.mt', {}, 'Replacement levels are derived from these settings: dedicated slots × teams, then FLEX and Superflex slots are filled greedily with the best remaining eligible players. Bench spots set the waiver level (depth value).'));
    },
    redraft() {
      const groups = ['projection', 'consensus', 'market', 'production', 'adp'];
      return h('div', {},
        h('h3', {}, 'Signal weights'), h('p.small.muted', {}, 'Weights move linearly from the preseason set to the in-season set by the week below. They are renormalised over signals that exist for each player.'),
        h('table.data', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Signal'), h('th', {}, 'Preseason'), h('th', {}, 'In-season'))),
          h('tbody', {}, groups.map((g) => h('tr', {}, h('td', {}, g), h('td', {}, numField('', modelVal(`redraft.weights.preseason.${g}`), (v) => setModel(`redraft.weights.preseason.${g}`, v ?? 0), { step: 0.05, min: 0 })), h('td', {}, numField('', modelVal(`redraft.weights.in_season.${g}`), (v) => setModel(`redraft.weights.in_season.${g}`, v ?? 0), { step: 0.05, min: 0 })))))),
        h('div.fields.mt', {},
          modelNum('Full in-season weight from week', 'phase.full_in_season_week', { step: 1, min: 2 }),
          modelNum('Production regression (games)', 'redraft.production.regression_games', { step: 1, min: 0, help: 'Pseudo-games of the prior blended into the production rate' }),
          modelNum('Expected-points blend (0–1)', 'redraft.production.xfp_blend', { step: 0.05, min: 0, max: 1 }),
          modelNum('Schedule strength (0–1)', 'redraft.production.sos_strength', { step: 0.05, min: 0, max: 1 }),
          modelNum('Bench value fraction', 'redraft.bench_value_fraction', { step: 0.05, min: 0, max: 1 }),
          modelNum('Games before production counts (no last season)', 'redraft.production.min_games_without_history', { step: 1, min: 1 }),
          modelNum('Market trend weight', 'redraft.trend.weight', { step: 0.05, min: 0, help: '0 by default (model 2.0): no evidence the 30-day trend predicts outcomes' }),
          modelNum('Trend cap (share of value)', 'redraft.trend.cap_pct', { step: 0.01, min: 0 })),
        h('h3.mt', {}, 'Outcome uncertainty (points SD per remaining game)'), h('p.small.muted', {}, 'Used for expected surplus E[max(0, X − replacement)]: players near replacement keep some upside value. Set to 0 for the deterministic v1 behaviour.'),
        h('div.fields', {}, ['QB', 'RB', 'WR', 'TE'].flatMap((p) => [modelNum(`${p} preseason`, `redraft.uncertainty.sd_per_game.preseason.${p}`, { step: 0.1, min: 0 }), modelNum(`${p} in-season`, `redraft.uncertainty.sd_per_game.in_season.${p}`, { step: 0.1, min: 0 })])),
        h('h3.mt', {}, 'Availability (expected share of remaining games played)'), h('div.fields', {}, ['QB', 'RB', 'WR', 'TE'].map((p) => modelNum(p, `redraft.production.availability.${p}`, { step: 0.01, min: 0, max: 1 }))),
        h('h3.mt', {}, 'Injury: expected games lost'), h('div.fields', {}, Object.keys(model.redraft.injury_games_lost).map((k) => modelNum(k, `redraft.injury_games_lost.${k}`, { step: 0.25, min: 0 }))));
    },
    dynasty() {
      const groups = ['fundamental', 'market', 'consensus', 'adp'];
      return h('div', {},
        h('div.fields', {},
          h('label.field', {}, 'Team strategy', h('select', { onchange: (e) => commit((p) => { p.dynasty = { ...(league.dynasty || {}), strategy: e.target.value }; }) }, ['contending', 'balanced', 'rebuilding'].map((s) => h('option', { value: s, selected: league.dynasty?.strategy === s ? true : null }, s)))),
          modelNum('Horizon (years)', 'dynasty.horizon_years', { step: 1, min: 1, max: 8 }),
          modelNum('Discount — contending', 'dynasty.strategy_discount.contending', { step: 0.01, min: 0.3, max: 1 }),
          modelNum('Discount — balanced', 'dynasty.strategy_discount.balanced', { step: 0.01, min: 0.3, max: 1 }),
          modelNum('Discount — rebuilding', 'dynasty.strategy_discount.rebuilding', { step: 0.01, min: 0.3, max: 1 }),
          modelNum('Aging-curve power', 'dynasty.aging_power', { step: 0.25, min: 0, help: '(A(age_t)/A(age_0))^power; 2 corrects the survivorship bias of delta-method curves' }),
          modelNum('Draft-prior pseudo-games', 'dynasty.rate_evidence.prior_pseudo_games', { step: 1, min: 0 }),
          modelNum('Market trend weight', 'dynasty.trend.weight', { step: 0.05, min: 0 })),
        h('h3.mt', {}, 'Signal weights'), h('div.fields', {}, groups.map((g) => modelNum(g, `dynasty.weights.${g}`, { step: 0.05, min: 0 }))),
        h('h3.mt', {}, 'Uncertainty'), h('div.fields', {}, ['QB', 'RB', 'WR', 'TE'].map((p) => modelNum(`${p} year-1 CV`, `dynasty.uncertainty.cv_year1.${p}`, { step: 0.01, min: 0 })), ['QB', 'RB', 'WR', 'TE'].map((p) => modelNum(`${p} CV growth / yr`, `dynasty.uncertainty.annual_cv_growth.${p}`, { step: 0.01, min: 0 })), modelNum('Rookie extra CV', 'dynasty.uncertainty.rookie_extra_cv', { step: 0.01, min: 0 })),
        h('p.small.muted.mt', {}, `Aging curves, attrition, availability and draft-capital priors come from config/calibration (${(model.calibrated || []).join(', ') || 'none — using defaults'}). Re-derive them with npm run calibrate; view them under Model.`));
    },
    picks() {
      return h('div', {},
        h('div.fields', {},
          numField('Rookie draft rounds', league.dynasty?.rookie_rounds ?? model.picks.default_rounds, (v) => commit((p) => { p.dynasty = { ...(league.dynasty || {}), rookie_rounds: Math.max(1, Math.min(model.picks.max_rounds, Math.round(v || 4))) }; }), { step: 1, min: 1, max: model.picks.max_rounds }),
          numField('Future seasons shown', league.dynasty?.pick_years ?? model.picks.years_ahead, (v) => commit((p) => { p.dynasty = { ...(league.dynasty || {}), pick_years: Math.max(1, Math.min(6, Math.round(v || 3))) }; }), { step: 1, min: 1, max: 6 }),
          modelNum('Weight: market', 'picks.weights.market', { step: 0.05, min: 0 }),
          modelNum('Weight: historical curve', 'picks.weights.historical', { step: 0.05, min: 0 }),
          modelNum('Weight: current class', 'picks.weights.current_class', { step: 0.05, min: 0 }),
          modelNum('Future-year discount', 'picks.future_year_discount', { step: 0.01, min: 0.3, max: 1 }),
          modelNum('Class strength multiplier', 'picks.class_strength', { step: 0.05, min: 0.3, max: 2 }),
          modelNum('Drafted-class hindsight adj.', 'picks.prior_class_adjustment', { step: 0.05, min: 0.3, max: 1.2 }),
          modelNum('Upcoming class switches in month', 'picks.upcoming_class_switch_month', { step: 1, min: 1, max: 12 })),
        h('p.small.muted.mt', {}, 'See Rookies & Picks → "How picks are valued" for the methodology and the slot-value chart.'));
    },
    sources() {
      const groups = Object.keys(model.source_weights).filter((k) => !k.startsWith('_'));
      return h('div', {}, h('p.small.muted', {}, 'Relative weight of each source within its signal group (default rationale in docs/VALUATION_MODEL.md). Set to 0 to ignore a source without disabling its sync.'),
        groups.map((g) => h('div.mt', {}, h('h3', {}, g), h('div.fields', {}, Object.keys(model.source_weights[g]).map((src) => modelNum(app.config.sources.sources.find((s) => s.id === src)?.name || src, `source_weights.${g}.${src}`, { step: 0.05, min: 0 }))))));
    },
    package() {
      return h('div', {},
        h('label.check', {}, h('input', { type: 'checkbox', checked: model.package.enabled ? true : null, onchange: (e) => setModel('package.enabled', e.target.checked) }), 'Apply package (consolidation) adjustment'),
        ['redraft', 'dynasty'].map((m) => h('div.mt', {}, h('h3', {}, m), h('div.fields', {},
          modelNum('Lineup displacement strength', `package.${m}.displacement_strength`, { step: 0.05, min: 0, max: 2 }),
          modelNum('Roster-slot cost multiplier', `package.${m}.roster_slot_cost`, { step: 0.05, min: 0, max: 3 }),
          modelNum('Minimum retained fraction', `package.${m}.min_retained_fraction`, { step: 0.05, min: 0, max: 1 })))),
        h('p.small.muted.mt', {}, 'For the side receiving more players, each extra (lowest-valued) player is charged: strength × min(its value, value of the average team\'s worst starter at its position) + cost × value of the last rostered player — but keeps at least the minimum retained fraction. Picks are exempt. The trade screen shows the full arithmetic.'));
    },
    refresh() {
      const fr = app.config.sources.freshness_hours;
      return h('div', {}, h('h3', {}, 'Freshness targets (hours)'), h('p.small.muted', {}, 'Data becomes "stale" at twice the target. Targets live in config/sources.json (freshness_hours); per-source refresh frequency in each source entry.'),
        h('table.data', {}, h('tbody', {}, Object.entries(fr).map(([k, v]) => h('tr', {}, h('td', {}, k), h('td.num', {}, v))))),
        h('p.mt', {}, h('a.btn.btn-sm', { href: '#/data' }, 'Open sync dashboard')));
    },
    advanced() {
      const theme = load('theme', 'auto');
      return h('div', {},
        h('div.fields', {}, h('label.field', {}, 'Theme', h('select', { onchange: (e) => { save('theme', e.target.value); applyTheme(e.target.value); } }, ['auto', 'light', 'dark'].map((t) => h('option', { selected: theme === t ? true : null }, t))))),
        h('dl.kv.mt', {}, h('dt', {}, 'Model version'), h('dd', {}, model.model_version), h('dt', {}, 'Settings hash'), h('dd.mono', {}, settingsHash(league, model)), h('dt', {}, 'Dataset'), h('dd', {}, app.dataset ? `${app.dataset.data_version} (built ${fmtTime(app.dataset.built_at)})` : '—'), h('dt', {}, 'Calibration'), h('dd', {}, (model.calibrated || []).join(', ') || 'none')),
        h('div.flex.mt', {},
          h('button.btn.btn-sm', { onclick: () => { commit((p) => { p.overrides = {}; }); toast('Model overrides cleared for this profile.'); } }, 'Reset model overrides'),
          h('button.btn.btn-sm', { onclick: () => { app.cache.clear(); emit('dataset'); toast('Valuation cache cleared.'); } }, 'Clear valuation cache'),
          h('button.btn.btn-sm.btn-danger', { onclick: () => { if (!confirm('Clear all browser-stored preferences (profiles stay on the server)?')) return; try { Object.keys(localStorage).filter((k) => k.startsWith('ffta.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } location.reload(); } }, 'Clear browser storage')),
        h('details.mt', {}, h('summary', {}, 'Effective league settings (JSON)'), h('pre.math', {}, JSON.stringify(league, null, 2))),
        h('details.mt', {}, h('summary', {}, 'Effective model parameters (JSON)'), h('pre.math', {}, JSON.stringify({ ...model, dynasty: { ...model.dynasty, draft_priors: '(see Model page)', aging_curves: '(see Model page)', attrition_table: '(see Model page)' }, picks: { ...model.picks, historical_shape: `[${(model.picks.historical_shape || []).length} values]` } }, null, 2))));
    },
  };
  body.append(S[sec]());
}

export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
applyTheme(load('theme', 'auto'));
