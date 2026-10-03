// E14 — TRADE FINDER BACKTEST (REAL HISTORICAL outcomes, SIMULATED leagues; the E6 league simulation).
//
// The trade finder (js/core/trade-finder.js) answers "I want Player X — what could I offer?": packages from MY roster
// the model calls fair for both sides, ranked by how much they raise my expected lineup points. Questions:
//   1. Do the packages it ranks first actually help the team that makes them, over a real season?
//   2. Are they fair to the OTHER team in realised points (the finder never sees that roster)?
//   3. Do its rules earn their keep — ranking by expected lineup points vs value-only ("most even") and random fair
//      packages; the no-throw-in (minimal) rule; the fairness band (maxEdge)?
//
// Per season 2020–2025: the E6 league (12 teams snake-drafted on preseason values fitted on earlier seasons only).
// Sampled (my team, target on another roster) pairs; each strategy picks a package; the trade is applied right after
// the draft (E6's drop/sign step restores legal rosters) and the season is replayed with real weekly points.
// Realised gain = that team's season points with the trade − without. Values: the 2.3.0 candidate (σ × 0.4, within-
// position availability shape); expected lineup points: availability by rank, waiver fill-ins (as E12).

import { windowPlayers, fitPriors } from './lineup.js';
import { CANDIDATES, LEAGUE, rng, candidateValues, draft, simulate, applyTrade, TEAMS } from './league.js';
import { findTradePackages } from '../../js/core/trade-finder.js';
import { mean, pearson, sd } from '../../js/core/util/stats.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const WEEKS = 17;
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** Mean and 95% interval (normal approximation) of a list. */
const ci = (xs) => { if (!xs.length) return { n: 0, mean: null, lo: null, hi: null }; const m = mean(xs), se = (sd(xs) || 0) / Math.sqrt(xs.length); return { n: xs.length, mean: r3(m), lo: r3(m - 1.96 * se), hi: r3(m + 1.96 * se) }; };
const share = (xs, f) => (xs.length ? r3(xs.filter(f).length / xs.length) : null);

export function tradeFinderBacktest(bench, model, { targetsPerSeason = 600, seed = 14, only = null, extra = {} } = {}) {
  const seasons = {};
  for (const y of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) { const w = windowPlayers(bench, y, 1); if (w) seasons[y] = w; }
  const years = Object.keys(seasons).map(Number).sort();
  // Strategies: how a package is chosen for a (team, target) pair. All use the finder's fairness test unless noted.
  const STRATS = {
    finder: { label: 'Finder (app): top option by expected lineup points (minimal, maxEdge 5%)', opts: {}, pick: 'top' },
    finder_any: { label: 'Finder: any of the options shown (mean over up to 5)', opts: {}, pick: 'shown' },
    lineup_value: { label: 'Finder ranked by starting-lineup value instead of expected points', opts: { rank: 'lineupValue' }, pick: 'top' },
    most_even: { label: 'Value only: the most evenly valued fair package (no roster view)', opts: { rank: 'even', minGain: -Infinity }, pick: 'top' },
    random_fair: { label: 'A random fair minimal package (no roster view)', opts: { minGain: -Infinity }, pick: 'random' },
    not_minimal: { label: 'Finder without the no-throw-in rule (top by expected points)', opts: { minimal: false }, pick: 'top' },
    edge10: { label: 'Finder with maxEdge 10% (I may take more value)', opts: { maxEdge: 0.10 }, pick: 'top' },
    edge0: { label: 'Finder with maxEdge 0% (I never receive more value)', opts: { maxEdge: 0 }, pick: 'top' },
    edge_close: { label: 'Finder with the model\'s "close" band only (UI fairness "Model\'s close")', opts: { maxEdge: 1 }, pick: 'top' },
    two_max: { label: 'Finder with packages of at most 2 assets', opts: { maxAssets: 2 }, pick: 'top' },
    // Their roster known (e.g. every team of a Sleeper league imported): the other team's expected lineup counts too.
    mutual_filter: { label: 'Their roster known: their expected lineup may not fall (≥ 0), top by my gain', opts: { theirMinGain: 0 }, pick: 'top', theirs: true },
    mutual_sum: { label: 'Their roster known: rank by my + their expected gain (mine must still improve)', opts: { mutualRank: 'sum' }, pick: 'top', theirs: true },
    mutual_min: { label: 'Their roster known: rank by the smaller of the two gains (mine must still improve)', opts: { mutualRank: 'min' }, pick: 'top', theirs: true },
    pen05: { label: 'Finder with a size penalty (0.5 pts/wk per extra asset)', opts: { sizePenalty: 0.5 }, pick: 'top' },
  };
  Object.assign(STRATS, extra); // exploration: extra strategies
  if (only) for (const k of Object.keys(STRATS)) if (!only.includes(k)) delete STRATS[k];
  const rows = Object.fromEntries(Object.keys(STRATS).map((k) => [k, []]));
  const coverage = Object.fromEntries(Object.keys(STRATS).map((k) => [k, { asked: 0, found: 0 }]));
  const timing = [];
  for (const y of years.slice(1)) {
    const rand = rng(seed + y);
    const priors = fitPriors(years.filter((t) => t < y).flatMap((t) => seasons[t].players));
    const season = seasons[y];
    const cand = candidateValues(season.players, priors, CANDIDATES.s04_pg_relcap);
    // The finder's verdict needs the app's trade_outcome levels (redraft: margin → calibrated frequency → "even").
    const result = { ...cand.result, meta: { model_version: model.model_version, data_version: `E14-${y}` }, model: { ...cand.result.model, trade_outcome: model.trade_outcome } };
    const base = candidateValues(season.players, priors, { sigmaMult: 0, beta: 0.35, availability: true, pkg: null });
    const rankOf = new Map(season.players.map((p) => [p.g, p.rank]));
    const baseValue = new Map([...base.assets].map(([g, a]) => [g, a.value + 1e-6 * priors.rateAt(a.position, rankOf.get(g))]));
    for (const p of season.players) if (!baseValue.has(p.g)) baseValue.set(p.g, -1);
    const rosters = draft(season.players, baseValue, rand);
    const basePts = simulate(season, priors, rosters);
    const rostered = new Set(rosters.flat().map((p) => p.g));
    const waiver = Object.fromEntries(POS.map((pos) => {
      const fa = season.players.filter((p) => p.pos === pos && p.rank && !rostered.has(p.g)).sort((a, b) => a.rank - b.rank)[0];
      return [pos, fa ? priors.rateAt(pos, fa.rank) * priors.availSmooth(pos, fa.rank) : 0];
    }));
    const expected = {
      rate: (a) => priors.rateAt(a.position, rankOf.get(a.id)),
      avail: (a) => priors.availSmooth(a.position, rankOf.get(a.id) ?? 999),
      waiver,
    };
    const byG = new Map(season.players.map((p) => [p.g, p]));
    const simCache = new Map();
    const realise = (a, b, give, target) => {
      const key = `${a}:${b}:${[...give].sort().join('|')}:${target}`;
      if (!simCache.has(key)) {
        const next = applyTrade(rosters, a, b, give.map((g) => byG.get(g)), [byG.get(target)], season.players, baseValue);
        const pts = simulate(season, priors, next);
        simCache.set(key, { gainA: pts[a] - basePts[a], gainB: pts[b] - basePts[b] });
      }
      return simCache.get(key);
    };
    for (let k = 0; k < targetsPerSeason; k++) {
      const a = Math.floor(rand() * TEAMS); let b = Math.floor(rand() * (TEAMS - 1)); if (b >= a) b++;
      const theirs = rosters[b].filter((p) => (cand.assets.get(p.g)?.value || 0) > 0);
      if (!theirs.length) continue;
      const target = theirs[Math.floor(rand() * theirs.length)].g;
      const mine = rosters[a].map((p) => p.g);
      const r = rand(); // one draw per pair, so random_fair is reproducible
      for (const [key, st] of Object.entries(STRATS)) {
        const t0 = performance.now();
        const out = findTradePackages(result, mine, target, { expected, ...st.opts, theirs: st.theirs ? rosters[b].map((p) => p.g) : null, includeAll: st.pick === 'random', limit: 5 });
        if (key === 'finder') timing.push(performance.now() - t0);
        coverage[key].asked++;
        const list = st.pick === 'random' ? out.all || [] : out.options;
        if (!list.length) continue;
        coverage[key].found++;
        const chosen = st.pick === 'top' ? [list[0]] : st.pick === 'random' ? [list[Math.floor(r * list.length)]] : list;
        const gs = chosen.map((op) => ({ op, ...realise(a, b, op.ids, target) }));
        rows[key].push({
          y, pid: `${y}:${k}`, gainA: mean(gs.map((g) => g.gainA)), gainB: mean(gs.map((g) => g.gainB)),
          predicted: mean(gs.map((g) => (g.op.expectedGain ?? 0) * WEEKS)), theirPredicted: st.theirs ? mean(gs.map((g) => (g.op.theirExpectedGain ?? 0) * WEEKS)) : null, pct: mean(gs.map((g) => g.op.pct)), size: mean(gs.map((g) => g.op.ids.length)),
          options: list.length,
        });
      }
    }
  }
  const summary = Object.fromEntries(Object.entries(STRATS).map(([k, st]) => {
    const xs = rows[k];
    return [k, {
      label: st.label,
      coverage: r3(coverage[k].found / Math.max(1, coverage[k].asked)),
      myGain: ci(xs.map((x) => x.gainA)), theirGain: ci(xs.map((x) => x.gainB)),
      myGainPositive: share(xs, (x) => x.gainA > 0), theirGainNonNegative: share(xs, (x) => x.gainB >= 0), bothGain: share(xs, (x) => x.gainA > 0 && x.gainB >= 0),
      netForBoth: ci(xs.map((x) => x.gainA + x.gainB)),
      corrPredictedVsRealised: r3(pearson(xs.map((x) => x.predicted), xs.map((x) => x.gainA))),
      ...(st.theirs ? { corrTheirPredictedVsRealised: r3(pearson(xs.map((x) => x.theirPredicted), xs.map((x) => x.gainB))), meanTheirPredicted: r3(mean(xs.map((x) => x.theirPredicted))) } : {}),
      meanPredicted: r3(mean(xs.map((x) => x.predicted))),
      meanValueEdge: r3(mean(xs.map((x) => x.pct))), meanPackageSize: r3(mean(xs.map((x) => x.size))), meanOptions: r3(mean(xs.map((x) => x.options))),
      bySeason: Object.fromEntries(years.slice(1).map((y) => [y, r3(mean(xs.filter((x) => x.y === y).map((x) => x.gainA)))])),
    }];
  }));
  // Paired comparison (same team, same target, both strategies found a package): finder top − the other choice.
  const paired = (k) => pairedFrom('finder', k);
  function pairedFrom(base, k) {
    const other = new Map(rows[k].map((x) => [x.pid, x]));
    const both = rows[base].filter((x) => other.has(x.pid));
    return {
      label: `${base} − ${k}, same (team, target) pairs`,
      myGain: ci(both.map((x) => x.gainA - other.get(x.pid).gainA)),
      theirGain: ci(both.map((x) => x.gainB - other.get(x.pid).gainB)),
    };
  }
  timing.sort((p, q) => p - q);
  return {
    experiment: 'E14 trade finder: do the suggested packages help the team making them, and are they fair to the other team? (E6 leagues, 12-team 1QB PPR)',
    labels: 'REAL HISTORICAL outcomes (nflverse weekly points 2020–2025); SIMULATED league behaviour',
    method: 'Per season: E6 league drafted on preseason values; sampled (my team, target on another roster) pairs; each strategy chooses a package from my roster; the trade is applied after the draft and the season replayed with real weekly points (realised gain = season points with − without the trade). Values: the 2.3.0 candidate; expected lineup points: availability by rank + waiver fill-ins (as E12).',
    league: LEAGUE, targetsPerSeason, summary,
    timingMs: { p50: r3(timing[Math.floor(timing.length / 2)]), p95: r3(timing[Math.floor(timing.length * 0.95)]), max: r3(timing[timing.length - 1]) },
    paired: Object.fromEntries(Object.keys(STRATS).filter((k) => k !== 'finder').map((k) => [k, paired(k)])),
  };
}

// ---- Current data: invariants, coverage, fairness presets and speed on today's values (every preset, both modes) ----
import { computeValuations } from '../../js/core/valuation/engine.js';
import { analyzeTrade } from '../../js/core/valuation/trade.js';
import { expectationInputs } from '../../js/core/roster.js';
import { FAIRNESS, FINDER_DEFAULTS } from '../../js/core/trade-finder.js';

/** Value snake draft of a league from current values (QB ≤ 2+SF, RB/WR ≤ 5, TE ≤ 2; dynasty: 2 generic picks each). */
function draftCurrent(r, teams, rounds, seedVal) {
  const sf = (r.league.roster.SUPERFLEX || 0) > 0 || (r.league.roster.QB || 0) > 1;
  const cap = { QB: sf ? 3 : 2, RB: 5, WR: 5, TE: 2 };
  const pool = [...r.assets.values()].filter((a) => a.kind === 'player' && a.team && a.team !== 'FA' && cap[a.position]).sort((x, y) => y.value - x.value || x.id.localeCompare(y.id));
  const rand = rng(seedVal);
  const out = Array.from({ length: teams }, () => []);
  const taken = new Set();
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? [...Array(teams).keys()].reverse() : [...Array(teams).keys()];
    for (const t of order) {
      const ok = pool.filter((a) => !taken.has(a.id) && out[t].filter((b) => b.position === a.position).length < cap[a.position]).slice(0, 3);
      if (!ok.length) continue;
      const a = ok[Math.floor(rand() * ok.length)];
      taken.add(a.id); out[t].push(a.id);
    }
  }
  if (r.mode === 'dynasty' && r.picks) { const y = r.picks.seasons[0]; for (const ids of out) ids.push(`pick:${y}:1`, `pick:${y}:2`); }
  return out;
}

export function tradeFinderCurrent(dataset, config, { perSet = 60, seed = 140 } = {}) {
  const sets = [];
  const violations = [];
  for (const preset of config.profiles.presets) {
    for (const mode of ['redraft', 'dynasty']) {
      const r = computeValuations({ dataset, league: preset, mode, config });
      const red = mode === 'redraft' ? r : computeValuations({ dataset, league: preset, mode: 'redraft', config });
      const ex = expectationInputs(red);
      const lg = draftCurrent(r, r.league.teams, 15, seed);
      const rand = rng(seed + sets.length);
      const times = [], found = { strict: 0, balanced: 0, close: 0 }, gains = [], theirGains = [], theirKnownGains = [];
      let asked = 0;
      for (let k = 0; k < perSet; k++) {
        const a = Math.floor(rand() * lg.length); let b = Math.floor(rand() * (lg.length - 1)); if (b >= a) b++;
        const theirs = lg[b].filter((id) => (r.getAsset(id)?.value || 0) > 0);
        const target = theirs[Math.floor(rand() * Math.min(8, theirs.length))];
        if (!target) continue;
        asked++;
        for (const [fk, f] of Object.entries(FAIRNESS)) {
          const t0 = performance.now();
          const res = findTradePackages(r, lg[a], target, { expected: ex, maxEdge: f.maxEdge });
          if (fk === 'strict') times.push(performance.now() - t0);
          if (!res.ok) { violations.push(`${preset.id}/${mode}: not ok (${res.reason})`); continue; }
          if (res.options.length) found[fk]++;
          // Invariants on every option (independent re-check with analyzeTrade).
          const uses = new Map();
          for (const o of res.options) {
            const ana = analyzeTrade(r, [target], o.ids);
            if (ana.assessment.level !== 'even' || ana.pct > f.maxEdge + 1e-9 || ana.pct < -FINDER_DEFAULTS.maxOverpay - 1e-9) violations.push(`${preset.id}/${mode}/${fk}: unfair option`);
            const acceptable = (x) => x.pct <= 0 || (x.pct <= f.maxEdge && x.assessment.level === 'even');
            if (o.ids.length > 1 && o.ids.some((d) => acceptable(analyzeTrade(r, [target], o.ids.filter((x, i) => i !== o.ids.indexOf(d)))))) violations.push(`${preset.id}/${mode}/${fk}: throw-in`);
            if (fk !== 'strict' && found.strict === undefined) violations.push('internal');
            if (!(o.gain >= (mode === 'redraft' ? FINDER_DEFAULTS.minGain : FINDER_DEFAULTS.minLineupGain))) violations.push(`${preset.id}/${mode}/${fk}: no gain`);
            if (o.ids.some((id) => !lg[a].includes(id)) || o.ids.includes(target)) violations.push(`${preset.id}/${mode}/${fk}: offers an asset not on the roster`);
            for (const id of o.ids) uses.set(id, (uses.get(id) || 0) + 1);
            if (fk === 'strict') gains.push(o.gain);
          }
          if ([...uses.values()].some((n) => n > FINDER_DEFAULTS.maxUses)) violations.push(`${preset.id}/${mode}/${fk}: diversity cap`);
          if (fk === 'strict' && res.options.length) {
            const known = findTradePackages(r, lg[a], target, { expected: ex, theirs: lg[b] });
            const unknownTheir = findTradePackages(r, lg[a], target, { expected: ex, theirs: lg[b], mutualRank: 'mine' });
            if (known.options[0]) theirKnownGains.push(known.options[0].theirGain);
            if (unknownTheir.options[0]) theirGains.push(unknownTheir.options[0].theirGain);
          }
        }
      }
      times.sort((p, q) => p - q);
      sets.push({
        preset: preset.id, mode, teams: r.league.teams, requests: asked,
        coverage: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, r3(v / Math.max(1, asked))])),
        meanTopGain: r3(mean(gains)), unit: mode === 'redraft' ? 'expected pts/week' : 'starting-lineup value',
        theirGainOfTop: { rankedForMeOnly: r3(mean(theirGains)), rankedForBoth: r3(mean(theirKnownGains)), n: theirKnownGains.length },
        ms: { p50: r3(times[Math.floor(times.length / 2)]), p95: r3(times[Math.floor(times.length * 0.95)]), max: r3(times[times.length - 1]) },
      });
    }
  }
  return { label: `CURRENT DATA (${dataset.data_version}) — model ${config.model.model_version}`, method: 'Every preset × redraft/dynasty: a 15-round value snake draft (dynasty: 2 generic picks per team); random (team, target among the other team\'s 8 most valuable) requests; every option re-checked with analyzeTrade (fair, no throw-in), gain, roster membership and the diversity cap, under all three fairness presets.', sets, violations: violations.length, violationExamples: violations.slice(0, 10) };
}
