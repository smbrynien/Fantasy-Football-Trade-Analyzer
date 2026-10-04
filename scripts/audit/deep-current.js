// DEEP CURRENT-DATA AUDIT (docs/TRADE_VALUE_DEEP_AUDIT.md). CURRENT DATA, no historical outcomes: structural checks
// that every value and trade comparison should pass whatever the data say —
//   D1 scale & concentration     value by overall/positional rank, share of value in the top N, starters/replacement
//   D2 league sweep              FLEX/WR/RB layouts, 1QB/2QB/SF, TE premium 0–1, 8–14 teams, bench 4–15: direction checks
//   D3 scarcity inventory        where positional differences come from (pure points above replacement vs the app)
//   D4 cross-format              standard/half/PPR: do reception-heavy players move the right way, and how much?
//   D5 dominance inversions      A ≥ B on every input yet worth less
//   D6 sensitivity               +1% projection, +1% market, +1 year of age: elasticities and cliffs
//   D7 age curve                 identical synthetic players aged 21–34: adjacent-age steps
//   D8 source/group ablation     drop each source or signal group: how far do values move?
//   D9 missing data              remove one input from a player: value and confidence behaviour
//   D10 picks                    ordering, 1.12 → 2.01, future years, pick ↔ player equivalence, league context
//   D11 dynasty horizon          share of value from year 1, years 2–3, years 4+; discount sensitivity
//   D12 outliers                 model vs market vs consensus disagreement
import { computeValuations } from '../../js/core/valuation/engine.js';
import { spearman, mean, median } from '../../js/core/util/stats.js';
import { deepClone } from '../../js/core/util/objects.js';

const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null);
const SKILL = ['QB', 'RB', 'WR', 'TE'];

export function deepCurrentAudit(ds, config) {
  const presets = config.profiles.presets;
  const P = (id) => presets.find((p) => p.id === id);
  const run = (dataset, league, mode, overrides) => computeValuations({ dataset, league: overrides ? { ...league, overrides: { ...(league.overrides || {}), ...overrides } } : league, mode, config });
  const players = (r) => [...r.assets.values()].filter((a) => a.kind === 'player' && a.value > 0).sort((a, b) => b.value - a.value);
  const byPos = (r, pos) => players(r).filter((a) => a.position === pos);
  const at = (r, pos, k) => byPos(r, pos)[k - 1]?.value ?? 0;
  const checks = [];
  const check = (section, name, ok, detail) => checks.push({ section, name, ok: Boolean(ok), detail });
  const out = { label: `CURRENT DATA (${ds.data_version}) — model ${config.model.model_version}`, checks };

  // ---------------- D1 scale & concentration
  out.D1_scale = {};
  for (const [id, mode] of [['preset_12_1qb_ppr', 'redraft'], ['preset_12_sf_ppr', 'redraft'], ['preset_dyn_12_1qb', 'dynasty'], ['preset_dyn_12_sf', 'dynasty']]) {
    const r = run(ds, P(id), mode);
    const pl = players(r);
    const tot = pl.reduce((s, a) => s + a.value, 0);
    const top12 = mean(pl.slice(0, 12).map((a) => a.value));
    out.D1_scale[`${id}|${mode}`] = {
      byOverallRank: Object.fromEntries([1, 6, 12, 24, 36, 48, 72, 96, 120, 150, 200].map((k) => [k, pl[k - 1] ? { pos: pl[k - 1].position, value: r0(pl[k - 1].value), relTop12: r3(pl[k - 1].value / top12) } : null])),
      shareOfTotal: Object.fromEntries([12, 24, 50, 100, 200].map((k) => [`top${k}`, r3(pl.slice(0, k).reduce((s, a) => s + a.value, 0) / tot)])),
      positional: Object.fromEntries(SKILL.map((pos) => [pos, Object.fromEntries([1, 3, 6, 12, 24, 36, 48].map((k) => [k, r0(at(r, pos, k))]))])),
      starters: r.structure.starters, replacement: Object.fromEntries(SKILL.map((p) => [p, r3(r.structure.replacement[p])])),
      top100Positions: pl.slice(0, 100).reduce((m, a) => ({ ...m, [a.position]: (m[a.position] || 0) + 1 }), {}),
    };
  }

  // ---------------- D2 league sweep (redraft and dynasty)
  const base = P('preset_12_1qb_ppr');
  const lg = (o) => ({ ...base, ...o, roster: { ...base.roster, ...(o.roster || {}) }, scoring: { ...(base.scoring || {}), ...(o.scoring || {}) } });
  const variants = {
    base: lg({}),
    flex_2rb_3wr_2flex: lg({ roster: { WR: 3, FLEX: 2 } }), flex_1rb_3wr_2flex: lg({ roster: { RB: 1, WR: 3, FLEX: 2 } }), rb_1: lg({ roster: { RB: 1 } }),
    qb_2qb: lg({ roster: { QB: 2 } }), qb_sf: lg({ roster: { SUPERFLEX: 1 } }),
    tep_025: lg({ scoring: { bonus_rec_te: 0.25 } }), tep_05: lg({ scoring: { bonus_rec_te: 0.5 } }), tep_075: lg({ scoring: { bonus_rec_te: 0.75 } }), tep_1: lg({ scoring: { bonus_rec_te: 1 } }),
    teams_8: lg({ teams: 8 }), teams_10: lg({ teams: 10 }), teams_14: lg({ teams: 14 }),
    bench_4: lg({ roster: { BENCH: 4 } }), bench_10: lg({ roster: { BENCH: 10 } }), bench_15: lg({ roster: { BENCH: 15 } }),
    standard: lg({ scoring_preset: 'standard' }), half: lg({ scoring_preset: 'half_ppr' }),
  };
  out.D2_sweep = {};
  const sweepRuns = {};
  for (const mode of ['redraft', 'dynasty']) {
    for (const [k, l] of Object.entries(variants)) {
      const r = run(ds, l, mode);
      sweepRuns[`${mode}|${k}`] = r;
      out.D2_sweep[`${mode}|${k}`] = {
        starters: r.structure.starters,
        values: Object.fromEntries(['QB1', 'QB12', 'QB20', 'QB24', 'RB1', 'RB12', 'RB24', 'RB36', 'WR1', 'WR12', 'WR24', 'WR36', 'WR48', 'TE1', 'TE6', 'TE12'].map((t) => [t, r0(at(r, t.slice(0, 2), Number(t.slice(2))))])),
      };
    }
    const v = (k, t) => out.D2_sweep[`${mode}|${k}`].values[t];
    check('D2', `${mode}: Superflex raises QB12 and QB20`, v('qb_sf', 'QB12') > v('base', 'QB12') && v('qb_sf', 'QB20') > v('base', 'QB20'), { base: [v('base', 'QB12'), v('base', 'QB20')], sf: [v('qb_sf', 'QB12'), v('qb_sf', 'QB20')] });
    check('D2', `${mode}: 2QB raises QB12 and QB20`, v('qb_2qb', 'QB12') > v('base', 'QB12') && v('qb_2qb', 'QB20') > v('base', 'QB20'), { base: [v('base', 'QB12'), v('base', 'QB20')], qb2: [v('qb_2qb', 'QB12'), v('qb_2qb', 'QB20')] });
    const tep = ['base', 'tep_025', 'tep_05', 'tep_075', 'tep_1'];
    check('D2', `${mode}: TE premium never lowers TE1/TE6/TE12`, ['TE1', 'TE6', 'TE12'].every((t) => tep.every((k, i) => i === 0 || v(k, t) >= v(tep[i - 1], t) - 1)), Object.fromEntries(['TE1', 'TE6', 'TE12'].map((t) => [t, tep.map((k) => v(k, t))])));
    // TEs take FLEX spots from WRs under TE premium, so WR values fall (FLEX economics); QB and RB values barely move.
    const nonTeMove = Math.max(...['QB1', 'QB12', 'RB12', 'RB24'].map((t) => Math.abs(v('tep_1', t) / v('base', t) - 1)));
    check('D2', `${mode}: TE premium 1.0 moves QB/RB values < 8%; WRs lose FLEX spots to TEs`, nonTeMove < 0.08 && v('tep_1', 'WR36') < v('base', 'WR36') && out.D2_sweep[`${mode}|tep_1`].starters.TE > out.D2_sweep[`${mode}|base`].starters.TE, { maxQbRbMove: r3(nonTeMove), teStarters: [out.D2_sweep[`${mode}|base`].starters.TE, out.D2_sweep[`${mode}|tep_1`].starters.TE], wr36: [v('base', 'WR36'), v('tep_1', 'WR36')] });
    check('D2', `${mode}: a third WR starter raises WR36`, v('flex_2rb_3wr_2flex', 'WR36') > v('base', 'WR36'), { base: v('base', 'WR36'), more: v('flex_2rb_3wr_2flex', 'WR36') });
    check('D2', `${mode}: one RB slot fewer (no other change) lowers RB24`, v('rb_1', 'RB24') < v('base', 'RB24'), { base: v('base', 'RB24'), fewer: v('rb_1', 'RB24') });
    check('D2', `${mode}: more teams → RB24/WR24 worth more`, v('teams_14', 'RB24') > v('teams_8', 'RB24') && v('teams_14', 'WR24') > v('teams_8', 'WR24'), { t8: [v('teams_8', 'RB24'), v('teams_8', 'WR24')], t14: [v('teams_14', 'RB24'), v('teams_14', 'WR24')] });
  }

  // ---------------- D3 scarcity inventory: where positional value comes from
  const sd0 = Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => [p, 0]));
  const scarcity = {};
  for (const [name, ov] of [
    ['app', null],
    ['no_option_value', { redraft: { uncertainty: { sd_per_game: { preseason: sd0, in_season: sd0 } } } }],
    ['no_bench_band', { redraft: { bench_value_fraction: 0 } }],
    ['no_availability_shape', { redraft: { availability_shape: { enabled: false } } }],
    ['pure_par', { redraft: { bench_value_fraction: 0, availability_shape: { enabled: false }, uncertainty: { sd_per_game: { preseason: sd0, in_season: sd0 } } } }],
  ]) {
    const r = run(ds, base, 'redraft', ov);
    const pl = players(r).slice(0, 100);
    const tot = pl.reduce((s, a) => s + a.value, 0);
    scarcity[name] = {
      top100Share: Object.fromEntries(SKILL.map((p) => [p, r3(pl.filter((a) => a.position === p).reduce((s, a) => s + a.value, 0) / tot)])),
      relTop12: Object.fromEntries([24, 48, 72, 100].map((k) => [k, r3(players(r)[k - 1]?.value / mean(players(r).slice(0, 12).map((a) => a.value)))])),
    };
  }
  out.D3_scarcity = { note: 'No explicit positional multiplier exists in the code: positional value comes only from the league replacement level (plus the bench band, option value and availability shape, which are not position multipliers). Shares of top-100 value under each removal.', ...scarcity };

  // ---------------- D4 cross-format consistency
  const red = { ppr: sweepRuns['redraft|base'], half: sweepRuns['redraft|half'], standard: sweepRuns['redraft|standard'] };
  const recShare = new Map();
  for (const p of ds.players) {
    const pr = (p.projections || []).find((q) => q.scope === 'ros' || q.scope === 'season');
    const st = pr?.stats; if (!st) continue;
    const rec = st.rec || 0, ppr = (st.rush_yd || 0) * 0.1 + (st.rec_yd || 0) * 0.1 + ((st.rush_td || 0) + (st.rec_td || 0)) * 6 + rec;
    if (ppr > 0) recShare.set(p.cid, rec / ppr);
  }
  out.D4_crossFormat = {};
  for (const pos of ['RB', 'WR', 'TE']) {
    const xs = byPos(red.ppr, pos).slice(0, pos === 'TE' ? 24 : 48).filter((a) => red.standard.assets.get(a.id) && recShare.has(a.id));
    const dlog = xs.map((a) => Math.log(red.standard.assets.get(a.id).value / a.value));
    const share = xs.map((a) => recShare.get(a.id));
    const rho = spearman(share, dlog);
    const rk = (r) => new Map(byPos(r, pos).map((a, i) => [a.id, i + 1]));
    const rp = rk(red.ppr), rs = rk(red.standard);
    const moves = xs.map((a) => Math.abs((rp.get(a.id) || 0) - (rs.get(a.id) || 0)));
    out.D4_crossFormat[pos] = { n: xs.length, spearmanRecShareVsStdChange: r3(rho), medianAbsPosRankMove: median(moves), maxPosRankMove: Math.max(...moves) };
    check('D4', `${pos}: in standard scoring, reception-heavy players lose relative value (Spearman < 0)`, rho < 0, { rho: r3(rho) });
  }

  // ---------------- D5 dominance inversions
  out.D5_inversions = {};
  for (const [id, mode] of [['preset_12_1qb_ppr', 'redraft'], ['preset_dyn_12_1qb', 'dynasty']]) {
    const r = run(ds, P(id), mode);
    const inv = [];
    for (const pos of SKILL) {
      const pl = byPos(r, pos).slice(0, 80);
      const feat = (a) => {
        const d = a.details || {};
        const proj = d.projection?.points ?? null;
        const cons = (d.consensus || []).map((c) => c.posRank).filter(Number.isFinite);
        const mk = (d.market || []).map((c) => c.raw?.value).filter(Number.isFinite);
        return { proj, cons: cons.length ? mean(cons) : null, mk: mk.length ? mean(mk) : null, age: a.age };
      };
      const F = new Map(pl.map((a) => [a.id, feat(a)]));
      for (const A of pl) for (const B of pl) {
        if (A === B || !(A.value < B.value * 0.95)) continue;
        const fa = F.get(A.id), fb = F.get(B.id);
        if ([fa.proj, fb.proj, fa.cons, fb.cons, fa.mk, fb.mk].some((v) => v === null)) continue;
        const dom = fa.proj >= fb.proj && fa.cons <= fb.cons && fa.mk >= fb.mk && (mode === 'redraft' || (fa.age !== null && fb.age !== null && fa.age <= fb.age));
        const strict = fa.proj > fb.proj * 1.02 || fa.cons < fb.cons - 1 || fa.mk > fb.mk * 1.02;
        if (dom && strict) inv.push({ pos, a: A.name, b: B.name, valueA: r0(A.value), valueB: r0(B.value), gap: r3(B.value / A.value - 1), a_in: fa, b_in: fb, groupsA: Object.fromEntries(Object.entries(A.groupValues || {}).map(([k, v]) => [k, r0(v)])), groupsB: Object.fromEntries(Object.entries(B.groupValues || {}).map(([k, v]) => [k, r0(v)])) });
      }
    }
    inv.sort((x, y) => y.gap - x.gap);
    out.D5_inversions[`${id}|${mode}`] = { count: inv.length, examples: inv.slice(0, 12) };
  }

  // ---------------- D6 sensitivity: +1% projection / market, +1 year of age
  out.D6_sensitivity = {};
  for (const [id, mode] of [['preset_12_1qb_ppr', 'redraft'], ['preset_dyn_12_1qb', 'dynasty']]) {
    const r0run = run(ds, P(id), mode);
    const sample = players(r0run).filter((_, i) => i < 150 && i % 5 === 0);
    const res = { projection: [], market: [], age: [] };
    for (const a of sample) {
      for (const kind of mode === 'dynasty' ? ['projection', 'market', 'age'] : ['projection', 'market']) {
        const d2 = { ...ds, players: ds.players.map((p) => {
          if (p.cid !== a.id) return p;
          const q = deepClone(p);
          if (kind === 'projection') for (const pr of q.projections || []) for (const k of Object.keys(pr.stats || {})) pr.stats[k] *= 1.01;
          if (kind === 'market') for (const m of q.market || []) m.value *= 1.01;
          if (kind === 'age' && q.birth_date) { const dt = new Date(q.birth_date); dt.setUTCFullYear(dt.getUTCFullYear() - 1); q.birth_date = dt.toISOString().slice(0, 10); }
          return q;
        }) };
        const v1 = run(d2, P(id), mode).assets.get(a.id)?.value ?? 0;
        res[kind].push({ name: a.name, pos: a.position, value: r0(a.value), change: r3(v1 / a.value - 1) });
      }
    }
    const summ = (xs) => ({ n: xs.length, median: r3(median(xs.map((x) => x.change))), maxAbs: r3(Math.max(...xs.map((x) => Math.abs(x.change)))), flagged: xs.filter((x) => Math.abs(x.change) > 0.1).slice(0, 6) });
    out.D6_sensitivity[`${id}|${mode}`] = Object.fromEntries(Object.entries(res).filter(([, v]) => v.length).map(([k, v]) => [k, summ(v)]));
    check('D6', `${mode}: +1% projection never moves a value > 10%`, res.projection.every((x) => Math.abs(x.change) <= 0.1), summ(res.projection));
    check('D6', `${mode}: +1% projection never lowers a value`, res.projection.every((x) => x.change >= -1e-9), { min: r3(Math.min(...res.projection.map((x) => x.change))) });
    check('D6', `${mode}: +1% market never moves a value > 10%`, res.market.every((x) => Math.abs(x.change) <= 0.1), summ(res.market));
    if (mode === 'dynasty') check('D6', 'dynasty: one year older never raises a value and never cuts > 35%', res.age.every((x) => x.change <= 1e-9 && x.change > -0.35), summ(res.age));
  }

  // ---------------- D7 synthetic age curve (identical production, ages 21–34)
  {
    const tmpl = (pos, age) => {
      const rate = { QB: 19, RB: 14, WR: 14, TE: 10 }[pos];
      const stats = pos === 'QB' ? { pass_yd: 260 * 17, pass_td: 1.7 * 17, pass_int: 0.7 * 17, rush_yd: 20 * 17, rush_td: 0.2 * 17 } : { rec: 5 * 17, rec_yd: (rate - 5 - 0.6 * 6) * 10 * 17, rec_td: 0.6 * 17 };
      const dob = new Date(Date.parse(ds.built_at) - age * 365.25 * 864e5).toISOString().slice(0, 10);
      // No draft information and 4 seasons of experience: the draft-capital prior stays out, so only aging, attrition
      // and discounting differ between the synthetic players.
      return { cid: `SYN_${pos}_${age}`, name: `Synthetic ${pos} ${age}`, position: pos, positions: [pos], team: 'DAL', birth_date: dob, draft: {}, years_exp: 4, ids: {}, aliases: [], rankings: [], market: [], adp: [], weekly: [], injury: null,
        last_season: { season: ds.state.season - 1, games: 16, team: 'DAL', st: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, (v * 16) / 17])) },
        projections: [{ src: 'sleeper_projections', scope: ds.state.season_type === 'regular' ? 'ros' : 'season', season: ds.state.season, games: 12, stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, (v * 12) / 17])) }] };
    };
    const d2 = { ...ds, players: [...ds.players, ...SKILL.flatMap((pos) => Array.from({ length: 14 }, (_, i) => tmpl(pos, 21 + i)))] };
    const r = run(d2, P('preset_dyn_12_1qb'), 'dynasty');
    out.D7_ageCurve = {};
    for (const pos of SKILL) {
      const vals = Array.from({ length: 14 }, (_, i) => r.assets.get(`SYN_${pos}_${21 + i}`)?.value ?? null);
      const steps = vals.slice(1).map((v, i) => (vals[i] ? r3(v / vals[i] - 1) : null));
      out.D7_ageCurve[pos] = { ages: '21..34', values: vals.map(r0), stepChange: steps };
      // Two separate questions: an inversion (older worth more past the peak) is a defect; a > 30% one-year cut is a
      // size flag — before the peak it is the youth-growth premium on a near-replacement player (deep audit W3).
      check('D7', `${pos}: identical production, one year older never raises the value past the position's peak-age window`, steps.every((s, i) => s === null || 21 + i + 1 <= { QB: 29, RB: 25, WR: 27, TE: 27 }[pos] || s <= 0.005), { steps });
      check('D7', `${pos}: identical production, no single year older cuts the value by > 30% (size flag; W3)`, steps.every((s) => s === null || s > -0.3), { steps });
    }
  }

  // ---------------- D8 source / group ablation
  out.D8_ablation = {};
  const srcs = [...new Set(ds.players.flatMap((p) => [...(p.rankings || []), ...(p.market || []), ...(p.projections || []), ...(p.adp || [])].map((x) => x.src)))];
  for (const [id, mode] of [['preset_12_1qb_ppr', 'redraft'], ['preset_dyn_12_1qb', 'dynasty']]) {
    const r = run(ds, P(id), mode);
    const top = players(r).slice(0, 200);
    const cmp = (r2) => {
      const ch = top.map((a) => (r2.assets.get(a.id)?.value ?? 0) / a.value - 1);
      const lost = top.slice(0, 100).filter((a) => !(r2.assets.get(a.id)?.value > 0)).length;
      return { medianAbsChange: r3(median(ch.map(Math.abs))), p90AbsChange: r3([...ch.map(Math.abs)].sort((x, y) => x - y)[Math.floor(ch.length * 0.9)]), spearmanTop200: r3(spearman(top.map((a) => a.value), top.map((a) => r2.assets.get(a.id)?.value ?? 0))), lostFromTop100: lost };
    };
    const res = {};
    for (const s of srcs) {
      const d2 = { ...ds, players: ds.players.map((p) => ({ ...p, rankings: (p.rankings || []).filter((x) => x.src !== s), market: (p.market || []).filter((x) => x.src !== s), projections: (p.projections || []).filter((x) => x.src !== s), adp: (p.adp || []).filter((x) => x.src !== s) })), picks: (ds.picks || []).filter((x) => x.src !== s) };
      res[`without ${s}`] = cmp(run(d2, P(id), mode));
    }
    const groups = mode === 'redraft' ? ['consensus', 'market', 'projection', 'production', 'adp'] : ['consensus', 'market', 'fundamental'];
    for (const g of groups) res[`without group ${g}`] = cmp(run(ds, P(id), mode, { [mode]: { weights: mode === 'redraft' ? { preseason: { [g]: 0 }, in_season: { [g]: 0 } } : { [g]: 0 } } }));
    out.D8_ablation[`${id}|${mode}`] = res;
  }

  // ---------------- D9 missing data for individual players
  out.D9_missing = {};
  for (const [id, mode] of [['preset_12_1qb_ppr', 'redraft'], ['preset_dyn_12_1qb', 'dynasty']]) {
    const r = run(ds, P(id), mode);
    const sample = new Set(players(r).filter((_, i) => i < 120 && i % 4 === 0).map((a) => a.id));
    const res = {};
    for (const what of ['projections', 'market', 'rankings', 'weekly', 'birth_date']) {
      const d2 = { ...ds, players: ds.players.map((p) => (sample.has(p.id || p.cid) ? { ...p, [what]: what === 'birth_date' ? null : what === 'weekly' ? [] : [], ...(what === 'weekly' ? { last_season: null } : {}) } : p)) };
      const r2 = run(d2, P(id), mode);
      const rows = [...sample].map((cid) => { const a = r.assets.get(cid), b = r2.assets.get(cid); return { change: b ? b.value / a.value - 1 : -1, confBefore: a.confidence?.score, confAfter: b?.confidence?.score ?? null }; });
      res[`no ${what}`] = { n: rows.length, medianChange: r3(median(rows.map((x) => x.change))), maxRise: r3(Math.max(...rows.map((x) => x.change))), lostValue: rows.filter((x) => x.change <= -0.999).length, confidenceDropShare: r3(rows.filter((x) => x.confAfter !== null && x.confAfter <= x.confBefore).length / rows.filter((x) => x.confAfter !== null).length) };
    }
    out.D9_missing[`${id}|${mode}`] = res;
    // Removing a signal that was BELOW the others raises the renormalised blend (by design: missing data is never
    // imputed). Checked: no value vanishes, nothing more than doubles, and confidence falls in most cases (the
    // confidence heuristic rewards agreement, so dropping a dissenting source can raise it — documented limitation).
    check('D9', `${mode}: removing one input never makes a valued top player vanish or more than double`, Object.values(res).every((x) => x.maxRise <= 1 && x.lostValue === 0), Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.maxRise])));
  }

  // ---------------- D10 picks
  out.D10_picks = {};
  for (const id of ['preset_dyn_12_1qb', 'preset_dyn_12_sf']) {
    const r = run(ds, P(id), 'dynasty');
    const T = r.league.teams, up = r.picks.upcoming, rounds = r.picks.rounds;
    const pv = (s, rd, k) => r.getAsset(k ? `pick:${s}:${rd}:${k}` : `pick:${s}:${rd}`)?.value ?? null;
    let orderOk = true;
    for (const s of r.picks.seasons) { let prev = Infinity; for (let rd = 1; rd <= rounds; rd++) for (let k = 1; k <= T; k++) { const v = pv(s, rd, k); if (v === null) continue; if (v > prev + 1e-6) orderOk = false; prev = v; } }
    const gapsR1 = Array.from({ length: T - 1 }, (_, i) => pv(up, 1, i + 1) - pv(up, 1, i + 2));
    const boundary = pv(up, 1, T) - pv(up, 2, 1);
    const pl = players(r);
    const equiv = (v) => { const i = pl.findIndex((a) => a.value < v); return i < 0 ? null : { overallRank: i + 1, player: pl[Math.max(0, i - 1)].name }; };
    const generic = r.picks.seasons.map((s) => [s, r0(pv(s, 1))]);
    out.D10_picks[id] = {
      upcoming: up, seasons: r.picks.seasons, orderMonotone: orderOk,
      slots: Object.fromEntries([[1, 1], [1, 3], [1, 6], [1, 9], [1, 12], [2, 1], [2, 6], [2, 12], [3, 6], [4, 6]].map(([rd, k]) => [`${rd}.${String(k).padStart(2, '0')}`, r0(pv(up, rd, k))])),
      meanGapRound1: r0(mean(gapsR1)), gap_1_12_to_2_01: r0(boundary),
      genericFirsts: Object.fromEntries(generic), futureRatios: generic.slice(1).map(([s, v], i) => [s, r3(v / generic[i][1])]),
      playerEquivalent: Object.fromEntries([['1.01', pv(up, 1, 1)], ['1.06', pv(up, 1, 6)], ['1.12', pv(up, 1, 12)], ['2.06', pv(up, 2, 6)], [`${up} 1st`, pv(up, 1)], [`${up + 2} 1st`, pv(up + 2, 1)]].map(([k, v]) => [k, equiv(v)])),
    };
    check('D10', `${id}: every pick worth no more than any earlier pick of the same draft`, orderOk, null);
    check('D10', `${id}: later draft years worth less for the same generic pick`, generic.every((g, i) => i === 0 || g[1] <= generic[i - 1][1]), generic);
  }

  // ---------------- D11 dynasty horizon decomposition and discount sensitivity
  {
    const r = run(ds, P('preset_dyn_12_1qb'), 'dynasty');
    const bands = { '<24': [], '24-26': [], '27-29': [], '30+': [] };
    for (const a of players(r).slice(0, 150)) {
      const ys = a.details?.years; if (!ys || !a.age) continue;
      const tot = ys.reduce((s, y) => s + y.contribution, 0); if (!(tot > 0)) continue;
      const y1 = ys[0].contribution / tot, y23 = ys.filter((y) => y.t === 2 || y.t === 3).reduce((s, y) => s + y.contribution, 0) / tot;
      const b = a.age < 24 ? '<24' : a.age < 27 ? '24-26' : a.age < 30 ? '27-29' : '30+';
      bands[b].push({ y1, y23, y4: 1 - y1 - y23 });
    }
    const contend = run(ds, { ...P('preset_dyn_12_1qb'), dynasty: { ...(P('preset_dyn_12_1qb').dynasty || {}), strategy: 'contending' } }, 'dynasty');
    const rebuild = run(ds, { ...P('preset_dyn_12_1qb'), dynasty: { ...(P('preset_dyn_12_1qb').dynasty || {}), strategy: 'rebuilding' } }, 'dynasty');
    const sens = {};
    for (const [b] of Object.entries(bands)) {
      const ids = players(r).slice(0, 150).filter((a) => a.age && (b === '<24' ? a.age < 24 : b === '24-26' ? a.age >= 24 && a.age < 27 : b === '27-29' ? a.age >= 27 && a.age < 30 : a.age >= 30));
      sens[b] = { contending: r3(median(ids.map((a) => (contend.assets.get(a.id)?.value ?? 0) / a.value - 1))), rebuilding: r3(median(ids.map((a) => (rebuild.assets.get(a.id)?.value ?? 0) / a.value - 1))) };
    }
    out.D11_horizon = {
      note: 'Shares of the multi-year FUNDAMENTAL (the fundamental is 25% of the blend; consensus/market carry the rest).',
      shares: Object.fromEntries(Object.entries(bands).map(([b, xs]) => [b, { n: xs.length, year1: r3(median(xs.map((x) => x.y1))), years2to3: r3(median(xs.map((x) => x.y23))), years4plus: r3(median(xs.map((x) => x.y4))) }])),
      strategySensitivity: sens,
    };
  }

  // ---------------- D12 outliers: model vs market vs consensus
  out.D12_outliers = {};
  for (const [id, mode] of [['preset_12_1qb_ppr', 'redraft'], ['preset_dyn_12_1qb', 'dynasty']]) {
    const r = run(ds, P(id), mode);
    const rows = players(r).slice(0, 200).map((a) => {
      const g = a.groupValues || {};
      const vals = Object.entries(g).filter(([, v]) => Number.isFinite(v) && v > 0);
      const spread = vals.length > 1 ? (Math.max(...vals.map((x) => x[1])) - Math.min(...vals.map((x) => x[1]))) / a.value : 0;
      return { name: a.name, pos: a.position, value: r0(a.value), groups: Object.fromEntries(vals.map(([k, v]) => [k, r0(v)])), spreadRel: r3(spread), confidence: a.confidence?.label };
    });
    rows.sort((x, y) => y.spreadRel - x.spreadRel);
    out.D12_outliers[`${id}|${mode}`] = { highestDisagreement: rows.slice(0, 10), shareOver50pct: r3(rows.filter((x) => x.spreadRel > 0.5).length / rows.length) };
  }

  out.summary = { checks: checks.length, failed: checks.filter((c) => !c.ok).map((c) => `${c.section}: ${c.name}`) };
  return out;
}
