// Current-data audit (CURRENT DATA = today's synced dataset, frozen copy in data/benchmark/dataset-frozen.json;
// SIMULATION = roster-economics simulation built from those values). No historical accuracy claims are made here.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, P } from '../../server/lib/paths.js';
import { loadConfig } from '../../server/lib/config.js';
import { computeValuations } from '../../js/core/valuation/engine.js';
import { analyzeTrade } from '../../js/core/valuation/trade.js';
import { scoreStats, resolveScoring } from '../../js/core/scoring.js';
import { spearman, mean, median, pearson } from '../../js/core/util/stats.js';
import { deepClone, deepMerge } from '../../js/core/util/objects.js';
import { pickAssetId } from '../../js/core/pick-labels.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const rnd = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
export const FROZEN = path.join(DATA_DIR, 'benchmark', 'dataset-frozen.json');

/** The frozen dataset if one exists, else the live synced dataset (frozen: false), else null (nothing synced yet). */
export function loadFrozenDataset() {
  const f = fs.existsSync(FROZEN) ? FROZEN : fs.existsSync(P.dataset) ? P.dataset : null;
  if (!f) return null;
  return { ds: JSON.parse(fs.readFileSync(f, 'utf8')), file: f, frozen: f === FROZEN };
}

/** Copy the live synced dataset to the frozen location so later before/after runs see identical data. */
export function freezeDataset() {
  if (!fs.existsSync(P.dataset)) throw new Error('No synced dataset to freeze — run `npm run sync` first.');
  const previous = fs.existsSync(FROZEN) ? JSON.parse(fs.readFileSync(FROZEN, 'utf8')).data_version : null;
  fs.mkdirSync(path.dirname(FROZEN), { recursive: true });
  fs.copyFileSync(P.dataset, FROZEN);
  return { previous, current: JSON.parse(fs.readFileSync(FROZEN, 'utf8')).data_version };
}
const preset = (c, id) => c.profiles.presets.find((p) => p.id === id);

// ------------------------------------------------------------------ 1. raw signal correlations + PCA
function signalTable(ds, config) {
  const ppr = resolveScoring({ scoring_preset: 'ppr', scoring: {} }, config.leagueDefaults);
  const rows = [];
  for (const p of ds.players) {
    if (!POS.includes(p.position)) continue;
    const mk = (src, dyn, qb = '1qb') => (p.market || []).find((m) => m.src === src && m.dynasty === dyn && m.qb === qb && (m.ppr === 1 || m.ppr === null) && (m.teams === 12 || m.teams === null))?.value ?? null;
    const rk = (src, kind, scope) => { const r = (p.rankings || []).filter((x) => x.src === src && x.kind === kind && x.scope === scope && (x.qb || '1qb') === '1qb'); return r.length ? r[0].ecr : null; };
    const adp = (src, f) => (p.adp || []).find((a) => a.src === src && a.format === f)?.adp ?? null;
    const proj = (src) => { const x = (p.projections || []).find((q) => q.src === src && q.scope === 'ros'); return x ? scoreStats(x.stats, p.position, ppr, { games: x.games || 1 }).points : null; };
    const wk = (p.weekly || []).filter((w) => w.s === ds.state.season);
    const ppg = wk.length ? mean(wk.map((w) => scoreStats(w.st, p.position, ppr, { perGame: true }).points || 0)) : null;
    const last = p.last_season?.games >= 4 ? scoreStats(p.last_season.st, p.position, ppr, { games: p.last_season.games }).points / p.last_season.games : null;
    // all "higher = better": negate ranks/ADP
    rows.push({
      cid: p.cid, name: p.name, pos: p.position, age: p.birth_date ? (Date.now() - new Date(p.birth_date)) / (365.25 * 864e5) : null,
      fc_dyn: mk('fantasycalc', true), fc_red: mk('fantasycalc', false), dp_dyn: mk('dynastyprocess_values', true), ktc: mk('ktc', true),
      fp_dyn_pos: neg(rk('fantasypros_ecr', 'dynasty', 'position')), fp_ros_pos: neg(rk('fantasypros_ecr', 'ros', 'position')),
      adp_sleeper: neg(adp('sleeper_projections', 'redraft_ppr')), adp_espn: neg(adp('espn', 'redraft_ppr')), adp_ffc: neg(adp('ffc_adp', 'redraft_ppr')), adp_dyn_sleeper: neg(adp('sleeper_projections', 'dynasty')),
      proj_sleeper: proj('sleeper_projections'), proj_espn: proj('espn'), ppg_season: ppg, ppg_last: last,
    });
  }
  return rows;
}
const neg = (x) => (x === null || x === undefined ? null : -x);
const SIGS = ['fc_dyn', 'dp_dyn', 'fp_dyn_pos', 'adp_dyn_sleeper', 'fc_red', 'fp_ros_pos', 'adp_sleeper', 'adp_espn', 'adp_ffc', 'proj_sleeper', 'proj_espn', 'ppg_season', 'ppg_last'];

function correlations(rows) {
  const matrix = {};
  for (const a of SIGS) {
    matrix[a] = {};
    for (const b of SIGS) {
      // within-position Spearman, averaged (raw scales differ by position, so pooled correlations mislead)
      const rhos = [], ns = [];
      for (const pos of POS) {
        const z = rows.filter((r) => r.pos === pos && r[a] !== null && r[b] !== null);
        if (z.length < 15) continue;
        rhos.push(spearman(z.map((r) => r[a]), z.map((r) => r[b])));
        ns.push(z.length);
      }
      matrix[a][b] = rhos.length ? { rho: r3(mean(rhos)), n: ns.reduce((x, y) => x + y, 0) } : null;
    }
  }
  return matrix;
}

/** PCA (power iteration with deflation) on a Spearman correlation matrix of the given signals over complete cases. */
function pca(rows, sigs, pos) {
  const z = rows.filter((r) => r.pos === pos && sigs.every((s) => r[s] !== null));
  if (z.length < 25) return { n: z.length, note: 'too few complete cases' };
  const rankCol = (s) => { const v = z.map((r) => r[s]); const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const out = new Array(v.length); idx.forEach(([, i], k) => { out[i] = k; }); return out; };
  const cols = sigs.map(rankCol);
  const k = sigs.length;
  const C = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => pearson(cols[i], cols[j])));
  const eig = [];
  let M = C.map((r) => r.slice());
  for (let e = 0; e < k; e++) {
    let v = Array(k).fill(1 / Math.sqrt(k));
    let lambda = 0;
    for (let it = 0; it < 300; it++) {
      const w = M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      lambda = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
      if (!lambda) break;
      v = w.map((x) => x / lambda);
    }
    eig.push({ lambda: r3(lambda), loadings: Object.fromEntries(sigs.map((s, i) => [s, r3(v[i])])) });
    M = M.map((row, i) => row.map((x, j) => x - lambda * v[i] * v[j]));
  }
  const ls = eig.map((e) => e.lambda);
  const effective = ls.reduce((a, b) => a + b, 0) ** 2 / ls.reduce((a, b) => a + b * b, 0);
  return { pos, n: z.length, signals: sigs, varianceExplained: ls.map((l) => r3(l / k)), effectiveIndependentSignals: r3(effective), components: eig.slice(0, 3) };
}

// ------------------------------------------------------------------ 2. source bias (market vs consensus by age/position)
function sourceBias(rows) {
  const out = [];
  for (const [a, b, label] of [['fc_dyn', 'fp_dyn_pos', 'FantasyCalc dynasty vs FantasyPros dynasty ECR'], ['dp_dyn', 'fp_dyn_pos', 'DynastyProcess vs FantasyPros dynasty ECR'], ['fc_red', 'fp_ros_pos', 'FantasyCalc redraft vs FantasyPros ROS ECR'], ['adp_sleeper', 'fp_ros_pos', 'Sleeper ADP vs FantasyPros ROS ECR'], ['proj_espn', 'proj_sleeper', 'ESPN vs Sleeper/Rotowire ROS projection'], ['ppg_season', 'fp_ros_pos', 'Season PPG vs FantasyPros ROS ECR']]) {
    for (const pos of POS) {
      const z = rows.filter((r) => r.pos === pos && r[a] !== null && r[b] !== null);
      if (z.length < 20) continue;
      const pr = (key) => { const s = [...z].sort((x, y) => y[key] - x[key]); const m = new Map(); s.forEach((r, i) => m.set(r.cid, i / (s.length - 1))); return m; };
      const pa = pr(a), pb = pr(b);
      const d = z.map((r) => ({ age: r.age, diff: pb.get(r.cid) - pa.get(r.cid) })); // + = source a ranks the player better
      const withAge = d.filter((x) => x.age !== null);
      const young = withAge.filter((x) => x.age < 25), old = withAge.filter((x) => x.age >= 28);
      out.push({ comparison: label, pos, n: z.length, rho: r3(spearman(z.map((r) => r[a]), z.map((r) => r[b]))), youngPremium: r3(mean(young.map((x) => x.diff))), veteranPremium: r3(mean(old.map((x) => x.diff))), ageSlope: r3(slope(withAge.map((x) => x.age), withAge.map((x) => x.diff))) });
    }
  }
  return out;
}
function slope(x, y) { const mx = mean(x), my = mean(y); let a = 0, b = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; } return b ? a / b : null; }

// ------------------------------------------------------------------ helpers
function values(ds, config, profileId, mode, mutateConfig) {
  const cfg = mutateConfig ? mutateConfig(deepClone(config)) : config;
  return computeValuations({ dataset: ds, league: preset(config, profileId), mode, config: cfg });
}
function compareValues(a, b, top = 150) {
  const base = [...a.assets.values()].filter((x) => x.kind === 'player').sort((x, y) => y.value - x.value).slice(0, top);
  const pairs = base.map((x) => [x.value, b.assets.get(x.id)?.value ?? 0]);
  const pctChanges = pairs.map(([u, v]) => (u > 0 ? Math.abs(v - u) / u : 0));
  return { spearman: r3(spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]))), medianAbsPctChange: r3(median(pctChanges)), p90AbsPctChange: r3(pctChanges.sort((x, y) => x - y)[Math.floor(pctChanges.length * 0.9)]), maxAbsPctChange: r3(Math.max(...pctChanges)) };
}
const cfgFor = (config) => ({ model: config.model, leagueDefaults: config.leagueDefaults, sources: config.sources, calibration: config.calibration, profiles: config.profiles });

// ------------------------------------------------------------------ 3. component influence (ablation on current data)
function influence(ds, config) {
  const out = [];
  for (const [mode, pid, groups] of [['redraft', 'preset_12_1qb_ppr', ['projection', 'production', 'consensus', 'market', 'adp']], ['dynasty', 'preset_dyn_12_1qb', ['fundamental', 'market', 'consensus', 'adp']]]) {
    const base = values(ds, config, pid, mode);
    for (const g of groups) {
      const v = values(ds, config, pid, mode, (c) => {
        if (mode === 'redraft') { c.model.redraft.weights.preseason[g] = 0; c.model.redraft.weights.in_season[g] = 0; } else c.model.dynasty.weights[g] = 0;
        return c;
      });
      out.push({ mode, removed: g, ...compareValues(base, v) });
    }
    for (const extra of mode === 'redraft' ? ['trend', 'sos', 'injury'] : ['trend', 'injury']) {
      const v = values(ds, config, pid, mode, (c) => {
        if (extra === 'trend') { c.model.redraft.trend.weight = 0; c.model.dynasty.trend.weight = 0; }
        if (extra === 'sos') c.model.redraft.production.sos_strength = 0;
        if (extra === 'injury') { for (const k of Object.keys(c.model.redraft.injury_games_lost)) c.model.redraft.injury_games_lost[k] = 0; } // dynasty uses the same games-lost table since 2.2.0
        return c;
      });
      out.push({ mode, removed: extra, ...compareValues(base, v) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ 4. missing-source robustness
function missingSources(ds, config) {
  const out = [];
  const drop = (srcs) => { const d = deepClone(ds); for (const p of d.players) for (const k of ['rankings', 'market', 'adp', 'projections']) p[k] = (p[k] || []).filter((x) => !srcs.includes(x.src)); d.picks = d.picks.filter((x) => !srcs.includes(x.src)); return d; };
  const sets = [['fantasycalc'], ['fantasypros_ecr'], ['sleeper_projections'], ['espn'], ['dynastyprocess_values'], ['fantasycalc', 'dynastyprocess_values'], ['sleeper_projections', 'espn'], ['fantasypros_ecr', 'fantasycalc']];
  for (const [mode, pid] of [['redraft', 'preset_12_1qb_ppr'], ['dynasty', 'preset_dyn_12_1qb']]) {
    const base = values(ds, config, pid, mode);
    for (const s of sets) out.push({ mode, removed: s.join('+'), ...compareValues(base, computeValuations({ dataset: drop(s), league: preset(config, pid), mode, config })) });
  }
  return out;
}

// ------------------------------------------------------------------ 5. noise stability
function stability(ds, config) {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const out = [];
  for (const [mode, pid] of [['redraft', 'preset_12_1qb_ppr'], ['dynasty', 'preset_dyn_12_1qb']]) {
    const base = values(ds, config, pid, mode);
    for (const [label, fn] of [
      ['market ±5% noise', (d) => { for (const p of d.players) for (const m of p.market) m.value *= 1 + (rnd() - 0.5) * 0.1; }],
      ['ECR ±1 rank noise', (d) => { for (const p of d.players) for (const r of p.rankings) { r.ecr = Math.max(1, r.ecr + (rnd() - 0.5) * 2); r.rank = r.ecr; } }],
      ['projections ±5% noise', (d) => { for (const p of d.players) for (const pr of p.projections) for (const k of Object.keys(pr.stats)) pr.stats[k] *= 1 + (rnd() - 0.5) * 0.1; }],
    ]) {
      const d = deepClone(ds); fn(d);
      out.push({ mode, perturbation: label, ...compareValues(base, computeValuations({ dataset: d, league: preset(config, pid), mode, config })) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ 6. sensitivity (single-player perturbations)
function sensitivity(ds, config) {
  const out = [];
  const red = values(ds, config, 'preset_12_1qb_ppr', 'redraft');
  const dyn = values(ds, config, 'preset_dyn_12_1qb', 'dynasty');
  const sample = [];
  for (const pos of POS) sample.push(...[...red.assets.values()].filter((a) => a.kind === 'player' && a.position === pos).sort((a, b) => b.value - a.value).filter((_, i) => [0, 5, 15, 30].includes(i)));
  for (const a of sample) {
    const run = (mode, pid, mut) => { const d = deepClone(ds); const p = d.players.find((x) => x.cid === a.id); mut(p); return computeValuations({ dataset: d, league: preset(config, pid), mode, config }).assets.get(a.id)?.value ?? 0; };
    const r0 = red.assets.get(a.id)?.value, d0 = dyn.assets.get(a.id)?.value;
    const proj10 = (p) => { for (const pr of p.projections) for (const k of Object.keys(pr.stats)) pr.stats[k] *= 1.1; };
    const mkt10 = (p) => { for (const m of p.market) m.value *= 1.1; };
    const age1 = (p) => { if (p.birth_date) { const b = new Date(p.birth_date); b.setFullYear(b.getFullYear() - 1); p.birth_date = b.toISOString().slice(0, 10); } };
    out.push({
      name: a.name, pos: a.position, redraftRank: a.rank,
      redraft_proj_plus10pct: r3((run('redraft', 'preset_12_1qb_ppr', proj10) - r0) / r0),
      redraft_market_plus10pct: r3((run('redraft', 'preset_12_1qb_ppr', mkt10) - r0) / r0),
      dynasty_age_plus1yr: d0 ? r3((run('dynasty', 'preset_dyn_12_1qb', age1) - d0) / d0) : null,
      dynasty_market_plus10pct: d0 ? r3((run('dynasty', 'preset_dyn_12_1qb', mkt10) - d0) / d0) : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 7. monotonicity & sanity checks
export function monotonicity(ds, config) {
  const fails = [], checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); if (!ok) fails.push({ name, detail }); };
  const red = values(ds, config, 'preset_12_1qb_ppr', 'redraft');
  const dyn = values(ds, config, 'preset_dyn_12_1qb', 'dynasty');
  // projection ↑ → value not ↓ (sample of 30 players)
  const sample = [...red.assets.values()].filter((a) => a.kind === 'player').sort((a, b) => b.value - a.value).filter((_, i) => i % 7 === 0).slice(0, 30);
  for (const a of sample) {
    const d = deepClone(ds); const p = d.players.find((x) => x.cid === a.id);
    for (const pr of p.projections) for (const k of Object.keys(pr.stats)) pr.stats[k] *= 1.15;
    const v = computeValuations({ dataset: d, league: preset(config, 'preset_12_1qb_ppr'), mode: 'redraft', config }).assets.get(a.id)?.value ?? 0;
    check(`projection +15% does not lower value: ${a.name}`, v >= a.value - 1e-6, `${Math.round(a.value)} → ${Math.round(v)}`);
  }
  // younger → dynasty value not ↓ (all else equal)
  const dsample = [...dyn.assets.values()].filter((a) => a.kind === 'player' && a.age).sort((a, b) => b.value - a.value).filter((_, i) => i % 9 === 0).slice(0, 25);
  for (const a of dsample) {
    const d = deepClone(ds); const p = d.players.find((x) => x.cid === a.id);
    const b = new Date(p.birth_date); b.setFullYear(b.getFullYear() + 2); p.birth_date = b.toISOString().slice(0, 10);
    const v = computeValuations({ dataset: d, league: preset(config, 'preset_dyn_12_1qb'), mode: 'dynasty', config }).assets.get(a.id)?.value ?? 0;
    check(`2 years younger does not lower dynasty value: ${a.name} (${a.age.toFixed(1)})`, v >= a.value * 0.995, `${Math.round(a.value)} → ${Math.round(v)}`);
  }
  // picks monotone in slot
  const up = dyn.picks.upcoming;
  for (const season of dyn.picks.seasons) for (let r = 1; r <= dyn.picks.rounds; r++) {
    let prev = Infinity;
    for (let k = 1; k <= 12; k++) { const v = dyn.getAsset(pickAssetId({ season, round: r, slot: k })).value; if (v > prev + 1e-6) check(`pick ${season} ${r}.${k} not above ${r}.${k - 1}`, false, `${Math.round(prev)} < ${Math.round(v)}`); prev = v; }
    check(`${season} round ${r} pick slots monotone`, true, '');
  }
  check('upcoming 1.12 > 2.01', dyn.getAsset(pickAssetId({ season: up, round: 1, slot: 12 })).value > dyn.getAsset(pickAssetId({ season: up, round: 2, slot: 1 })).value, '');
  check('next-year unknown 1st < upcoming unknown 1st', dyn.getAsset(pickAssetId({ season: up + 1, round: 1 })).value < dyn.getAsset(pickAssetId({ season: up, round: 1 })).value, '');
  // league format checks
  const sf = values(ds, config, 'preset_12_sf_ppr', 'redraft');
  const topQB = [...red.assets.values()].filter((a) => a.position === 'QB').sort((a, b) => b.value - a.value)[0];
  const topWR = [...red.assets.values()].filter((a) => a.position === 'WR').sort((a, b) => b.value - a.value)[0];
  check('Superflex raises top QB relative to top WR', sf.assets.get(topQB.id).value / sf.assets.get(topWR.id).value > red.assets.get(topQB.id).value / red.assets.get(topWR.id).value * 1.3, '');
  let prevTE = -1;
  for (const tep of [0, 0.25, 0.5, 1]) {
    const pr = deepClone(preset(config, 'preset_12_1qb_ppr')); pr.scoring = { bonus_rec_te: tep };
    const r = computeValuations({ dataset: ds, league: pr, mode: 'redraft', config });
    const te = [...r.assets.values()].filter((a) => a.position === 'TE').sort((a, b) => b.value - a.value).slice(0, 5).reduce((s, a) => s + a.value, 0);
    check(`TE premium ${tep} raises top-5 TE value`, te > prevTE, `${Math.round(prevTE)} → ${Math.round(te)}`);
    prevTE = te;
  }
  // elite players above replacement / missing data lowers confidence
  const elite = [...red.assets.values()].filter((a) => a.kind === 'player').sort((a, b) => b.value - a.value).slice(0, 24);
  check('top-24 redraft players all have positive value', elite.every((a) => a.value > 0), '');
  return { checks: checks.length, failures: fails.length, failed: fails.slice(0, 50) };
}

// ------------------------------------------------------------------ 8. positional equity & league grid
function positionalEquity(ds, config) {
  const out = [];
  const base = deepClone(ds);
  const games = 14;
  const mk = (pos) => {
    const st = pos === 'QB' ? { pass_yd: 260, pass_td: 1.6, pass_int: 0.8, rush_yd: 18, rush_td: 0.15 } : pos === 'RB' ? { rush_yd: 70, rush_td: 0.6, rec: 3, rec_yd: 22, rec_td: 0.12 } : { rec: 5.5, rec_yd: 70, rec_td: 0.5 };
    return st;
  };
  const ppr = resolveScoring({ scoring_preset: 'ppr', scoring: {} }, config.leagueDefaults);
  for (const pos of POS) {
    const st = mk(pos);
    const per = scoreStats(st, pos, ppr, { perGame: true }).points;
    const scale = 250 / (per * games);
    const stats = Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v * scale * games]));
    base.players.push({ cid: `EQ_${pos}`, name: `Equity ${pos}`, position: pos, positions: [pos], team: 'DET', birth_date: '2000-01-01', draft: { year: 2022, round: 1, pick: 20 }, years_exp: 4, ids: {}, aliases: [], rankings: [], market: [], adp: [], weekly: [], last_season: null, injury: null, projections: [{ src: 'sleeper_projections', scope: 'ros', season: ds.state.season, games, stats }] });
  }
  const leagues = [
    ['10-team 1QB', { teams: 10 }], ['12-team 1QB', {}], ['14-team 1QB', { teams: 14 }], ['16-team 1QB', { teams: 16 }],
    ['12-team Superflex', { roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 0, DEF: 0, BENCH: 8, IR: 1 } }],
    ['12-team 2QB', { roster: { QB: 2, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 0, DEF: 0, BENCH: 8, IR: 1 } }],
    ['12-team TE premium 1.0', { scoring: { bonus_rec_te: 1 } }],
    ['12-team 3WR 2FLEX', { roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 0, K: 0, DEF: 0, BENCH: 6, IR: 1 } }],
  ];
  for (const [name, over] of leagues) {
    const lg = deepMerge(preset(config, 'preset_12_1qb_ppr'), over);
    const r = computeValuations({ dataset: base, league: lg, mode: 'redraft', config });
    const row = { league: name };
    for (const pos of POS) {
      const a = r.assets.get(`EQ_${pos}`);
      row[pos] = a ? Math.round(a.value) : null;
      row[`${pos}_replacement`] = r3(r.structure.replacement[pos] * (games / Math.max(1, (r.phase.remaining_weeks || 14))));
    }
    out.push(row);
  }
  return { note: 'Synthetic players (label: SYNTHETIC) with identical 250 projected PPR points over 14 games, valued in each league. Differences arise only from replacement levels (roster economics).', rows: out };
}

function leagueGrid(ds, config) {
  const out = [];
  const red = values(ds, config, 'preset_12_1qb_ppr', 'redraft');
  const sample = [];
  for (const pos of POS) sample.push(...[...red.assets.values()].filter((a) => a.position === pos).sort((a, b) => b.value - a.value).filter((_, i) => [0, 4, 11, 23].includes(i)).map((a) => ({ id: a.id, name: a.name, pos })));
  for (const teams of [10, 12, 14, 16]) for (const [qbName, roster] of [['1QB', { QB: 1, SUPERFLEX: 0 }], ['SF', { QB: 1, SUPERFLEX: 1 }], ['2QB', { QB: 2, SUPERFLEX: 0 }]]) for (const tep of [0, 0.5]) {
    const lg = deepMerge(preset(config, 'preset_12_1qb_ppr'), { teams, roster, scoring: { bonus_rec_te: tep } });
    const r = computeValuations({ dataset: ds, league: lg, mode: 'redraft', config });
    out.push({ teams, qb: qbName, tep, ...Object.fromEntries(sample.map((s) => [`${s.pos}:${s.name}`, Math.round(r.assets.get(s.id)?.value ?? 0)])) });
  }
  return out;
}

// ------------------------------------------------------------------ 9. roster-economics trade simulation (SIMULATION)
export function packageSimulation(ds, config, { trials = 400, avail = { QB: 0.8, RB: 0.77, WR: 0.83, TE: 0.82 } } = {}) {
  const league = preset(config, 'preset_12_1qb_ppr');
  const res = computeValuations({ dataset: ds, league: { ...league, roster: { ...league.roster, K: 0, DEF: 0 } }, mode: 'redraft', config });
  const R = res.league.roster;
  const T = res.league.teams;
  const pool = [...res.assets.values()].filter((a) => a.kind === 'player' && POS.includes(a.position) && a.value > 0);
  const rate = new Map(pool.map((a) => [a.id, Math.max(0, (a.details.basePoints || 0) / Math.max(1, a.details.projection?.games || 14))]));
  pool.sort((a, b) => b.value - a.value);
  const size = R.QB + R.RB + R.WR + R.TE + R.FLEX + R.SUPERFLEX + R.BENCH;
  const teams = Array.from({ length: T }, () => []);
  const cap = { QB: 3, RB: 7, WR: 8, TE: 3 };
  let i = 0;
  for (let round = 0; round < size; round++) {
    const order = round % 2 === 0 ? [...Array(T).keys()] : [...Array(T).keys()].reverse();
    for (const t of order) {
      while (i < pool.length && teams[t].filter((a) => a.position === pool[i].position).length >= cap[pool[i].position]) i++;
      if (i >= pool.length) break;
      teams[t].push(pool[i]);
      pool.splice(i, 1);
      i = 0;
    }
  }
  const freeAgents = pool; // undrafted, sorted by value
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const weeks = 300;
  const avails = Array.from({ length: weeks }, () => new Map());
  const teamPoints = (roster, wks = weeks) => {
    let total = 0;
    for (let w = 0; w < wks; w++) {
      const av = avails[w];
      const up = roster.filter((a) => { if (!av.has(a.id)) av.set(a.id, rnd() < (avail[a.position] || 0.8)); return av.get(a.id); }).map((a) => ({ pos: a.position, r: rate.get(a.id) || 0 })).sort((x, y) => y.r - x.r);
      const used = new Set();
      const take = (posSet, n) => { let s = 0; for (const p of up) { if (n <= 0) break; if (!used.has(p) && posSet.includes(p.pos)) { used.add(p); s += p.r; n--; } } return s; };
      total += take(['QB'], R.QB) + take(['RB'], R.RB) + take(['WR'], R.WR) + take(['TE'], R.TE) + take(['RB', 'WR', 'TE'], R.FLEX) + take(['QB', 'RB', 'WR', 'TE'], R.SUPERFLEX);
    }
    return (total / wks) * (res.phase.remaining_weeks || 14);
  };
  const shapes = [[1, 1], [2, 1], [2, 2], [3, 1], [3, 2], [4, 2]];
  const trades = [];
  for (let k = 0; k < trials; k++) {
    const [na, nb] = shapes[k % shapes.length];
    const ta = Math.floor(rnd() * T); let tb = Math.floor(rnd() * T); if (tb === ta) tb = (tb + 1) % T;
    const pickN = (roster, n) => { const c = [...roster]; const out = []; for (let j = 0; j < n; j++) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
    // Team A RECEIVES `na` players from B and sends `nb` players to A... (na = assets A receives)
    const recvA = pickN(teams[tb], na), sendA = pickN(teams[ta], nb);
    const after = (roster, out, inn) => {
      let r = roster.filter((a) => !out.includes(a)).concat(inn);
      while (r.length > size) { r.sort((x, y) => x.value - y.value); r = r.slice(1); }
      while (r.length < size && freeAgents.length) r.push(freeAgents[r.length % Math.min(20, freeAgents.length)]);
      return r;
    };
    const before = teamPoints(teams[ta]);
    const aft = teamPoints(after(teams[ta], sendA, recvA));
    const ana = analyzeTrade(res, recvA.map((a) => a.id), sendA.map((a) => a.id));
    trades.push({ shape: `${na}-for-${nb}`, simDeltaPoints: aft - before, rawDiff: (ana.sides[0].raw - ana.sides[1].raw) / res.factor, adjDiff: ana.diff / res.factor });
  }
  const byShape = {};
  for (const s of shapes.map(([a, b]) => `${a}-for-${b}`)) {
    const z = trades.filter((t) => t.shape === s);
    const fit = (k) => ({ corr: r3(pearson(z.map((t) => t[k]), z.map((t) => t.simDeltaPoints))), slope: r3(slope(z.map((t) => t[k]), z.map((t) => t.simDeltaPoints))), meanModel: r3(mean(z.map((t) => t[k]))), meanSim: r3(mean(z.map((t) => t.simDeltaPoints))) });
    byShape[s] = { n: z.length, raw: fit('rawDiff'), packageAdjusted: fit('adjDiff') };
  }
  return { note: 'SIMULATION: 12-team league drafted by model value from current data; weekly availability sampled; Δ = change in Team A expected optimal-lineup points for the rest of the season. Model numbers converted back to surplus points (value ÷ factor).', avail, byShape, overall: { raw: r3(pearson(trades.map((t) => t.rawDiff), trades.map((t) => t.simDeltaPoints))), packageAdjusted: r3(pearson(trades.map((t) => t.adjDiff), trades.map((t) => t.simDeltaPoints))) } };
}

// ------------------------------------------------------------------ 10. extreme cases & disagreements
function extremes(ds, config) {
  const red = values(ds, config, 'preset_12_1qb_ppr', 'redraft');
  const dyn = values(ds, config, 'preset_dyn_12_1qb', 'dynasty');
  const dsf = values(ds, config, 'preset_dyn_12_sf', 'dynasty');
  const pick = (r, f) => [...r.assets.values()].filter((a) => a.kind === 'player').filter(f).sort((a, b) => b.value - a.value)[0];
  const cases = {
    'elite young RB': pick(dyn, (a) => a.position === 'RB' && a.age < 25),
    'elite veteran RB (28+)': pick(dyn, (a) => a.position === 'RB' && a.age >= 28),
    'aging star WR (30+)': pick(dyn, (a) => a.position === 'WR' && a.age >= 30),
    'young WR, little production': pick(dyn, (a) => a.position === 'WR' && a.age < 23 && (a.details?.production?.gp || 0) <= 4),
    'elite TE': pick(dyn, (a) => a.position === 'TE'),
    'top QB (1QB)': pick(dyn, (a) => a.position === 'QB'),
    'injured (IR) star': pick(red, (a) => a.details?.injury?.status === 'IR'),
    'rookie 1st-round WR': pick(dyn, (a) => a.position === 'WR' && a.details?.isRookie && a.details?.draftBucket?.startsWith('R1')),
    'late-round rookie RB': pick(dyn, (a) => a.position === 'RB' && a.details?.isRookie && ['R4-5', 'R6-7', 'UDFA'].includes(a.details?.draftBucket)),
  };
  const rows = Object.entries(cases).filter(([, a]) => a).map(([k, a]) => ({ case: k, name: a.name, age: r3(a.age), redraft: Math.round(red.assets.get(a.id)?.value ?? 0), dynasty1QB: Math.round(dyn.assets.get(a.id)?.value ?? 0), dynastySF: Math.round(dsf.assets.get(a.id)?.value ?? 0), dynastyMarket: rnd(dyn.assets.get(a.id)?.groupValues?.market), dynastyFundamental: rnd(dyn.assets.get(a.id)?.groupValues?.fundamental) }));
  const up = dyn.picks.upcoming;
  for (const [k, id] of [['upcoming 1.01', pickAssetId({ season: up, round: 1, slot: 1 })], ['upcoming early 1st', pickAssetId({ season: up, round: 1, bucket: 'early' })], ['upcoming unknown 1st', pickAssetId({ season: up, round: 1 })], ['upcoming late 1st', pickAssetId({ season: up, round: 1, bucket: 'late' })], ['next-year 1st', pickAssetId({ season: up + 1, round: 1 })]]) rows.push({ case: k, name: dyn.getAsset(id).name, dynasty1QB: Math.round(dyn.getAsset(id).value), dynastySF: Math.round(dsf.getAsset(id).value) });
  // biggest model-vs-market disagreements (dynasty 1QB), with component explanation
  const dis = [...dyn.assets.values()].filter((a) => a.kind === 'player' && a.groupValues?.market > 50 && a.rank <= 150).map((a) => ({ name: a.name, pos: a.position, age: r3(a.age), value: Math.round(a.value), market: Math.round(a.groupValues.market), fundamental: Math.round(a.groupValues.fundamental ?? 0), consensus: Math.round(a.groupValues.consensus ?? 0), gapPct: r3((a.groupValues.fundamental - a.groupValues.market) / a.groupValues.market) })).filter((x) => Number.isFinite(x.gapPct)).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, 20);
  return { cases: rows, fundamentalVsMarketDisagreements: dis };
}

export async function currentDataAudit() {
  const config = loadConfig();
  const { ds, file } = loadFrozenDataset() || {};
  if (!ds) return null;
  const label = { label: `CURRENT DATA (${ds.data_version}, ${path.basename(file)}) — model ${config.model.model_version}` };
  const rows = signalTable(ds, config);
  const t0 = Date.now();
  const out = {
    'cur-correlations': { ...label, note: 'Within-position Spearman correlations between raw signals (ranks/ADP negated so higher = better), averaged over QB/RB/WR/TE.', matrix: correlations(rows), pca: POS.map((p) => pca(rows, ['fc_dyn', 'dp_dyn', 'fp_dyn_pos', 'fc_red', 'fp_ros_pos', 'adp_sleeper', 'proj_sleeper', 'proj_espn', 'ppg_season'], p)) },
    'cur-source-bias': { ...label, note: 'Positive premium = first source ranks that age group better than the second source does (percentile points within position).', rows: sourceBias(rows) },
    'cur-influence': { ...label, note: 'How much final values move when a component is removed (influence, NOT accuracy).', rows: influence(ds, config) },
    'cur-missing-sources': { ...label, rows: missingSources(ds, config) },
    'cur-stability': { ...label, rows: stability(ds, config) },
    'cur-sensitivity': { ...label, rows: sensitivity(ds, config) },
    'cur-monotonicity': { ...label, ...monotonicity(ds, config) },
    'cur-positional-equity': { ...label, ...positionalEquity(ds, config) },
    'cur-league-grid': { ...label, rows: leagueGrid(ds, config) },
    'cur-package-simulation': { ...label, ...packageSimulation(ds, config) },
    'cur-extremes': { ...label, ...extremes(ds, config) },
  };
  out['cur-meta'] = { ...label, seconds: Math.round((Date.now() - t0) / 1000) };
  void cfgFor;
  return out;
}
