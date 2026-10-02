// Derives per-player model inputs from the dataset for a given league: league-scored projections, production
// (actual + opportunity-based expected points), last-season rates, remaining games, injury impact,
// strength of schedule and usage summaries. No valuation happens here.

import { scoreStats } from '../scoring.js';
import { ageOn } from '../identity.js';
import { weightedMean, mean, clamp } from '../util/stats.js';

const PASS_KEYS = ['pass_att', 'pass_cmp', 'pass_inc', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'pass_fd', 'pass_sack'];
const RUSH_KEYS = ['rush_att', 'rush_yd', 'rush_td', 'rush_2pt', 'rush_fd'];
const REC_KEYS = ['rec', 'rec_yd', 'rec_td', 'rec_2pt', 'rec_fd'];

function pick(st, keys) {
  const o = {};
  for (const k of keys) if (st[k] !== undefined) o[k] = st[k];
  return o;
}

export function normalizeInjuryStatus(s) {
  if (!s) return null;
  const x = String(s).trim();
  const map = { 'injured reserve': 'IR', ir: 'IR', out: 'Out', doubtful: 'Doubtful', questionable: 'Questionable', pup: 'PUP', 'physically unable to perform': 'PUP', sus: 'Suspended', suspended: 'Suspended', nfi: 'NFI', cov: 'COV', dnr: 'DNR', na: null, active: null, probable: null };
  const k = x.toLowerCase();
  if (k in map) return map[k];
  if (/^ir/i.test(x)) return 'IR';
  if (/pup/i.test(x)) return 'PUP';
  return x;
}

/** Resolve the injury status the model uses: official report if current, else reported status. */
export function effectiveInjury(inj) {
  if (!inj) return { status: null, source: null };
  const official = normalizeInjuryStatus(inj.official_status);
  const reported = normalizeInjuryStatus(inj.status);
  // Long-term designations (IR/PUP/NFI/Suspended) come from roster status (Sleeper) and dominate game designations.
  if (['IR', 'PUP', 'NFI', 'Suspended'].includes(reported)) return { status: reported, source: 'reported' };
  if (official) return { status: official, source: 'official' };
  return { status: reported, source: reported ? 'reported' : null };
}

/**
 * League-wide per-opportunity point rates by position (for expected fantasy points) and
 * fantasy points allowed per game by defense and position (for strength of schedule).
 */
export function computeLeagueRates(dataset, scoring) {
  const acc = {};
  const fpa = {}; // fpa[pos][team] = {pts, games:Set}
  for (const p of dataset.players) {
    const pos = p.position;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    for (const wk of p.weekly || []) {
      const st = wk.st || {};
      const a = (acc[pos] ||= { passPts: 0, passAtt: 0, rushPts: 0, rushAtt: 0, recPts: 0, tgt: 0 });
      const pp = scoreStats(pick(st, PASS_KEYS), pos, scoring, { perGame: true }).points || 0;
      const rp = scoreStats(pick(st, RUSH_KEYS), pos, scoring, { perGame: true }).points || 0;
      const cp = scoreStats(pick(st, REC_KEYS), pos, scoring, { perGame: true }).points || 0;
      if (st.pass_att) { a.passPts += pp; a.passAtt += st.pass_att; }
      if (st.rush_att) { a.rushPts += rp; a.rushAtt += st.rush_att; }
      if (st.rec_tgt) { a.recPts += cp; a.tgt += st.rec_tgt; }
      if (wk.opp) {
        const total = scoreStats(st, pos, scoring, { perGame: true }).points || 0;
        const d = ((fpa[pos] ||= {})[wk.opp] ||= { pts: 0, games: new Set() });
        d.pts += total;
        d.games.add(wk.w);
      }
    }
  }
  const rates = {};
  for (const [pos, a] of Object.entries(acc)) {
    rates[pos] = {
      perPassAtt: a.passAtt > 50 ? a.passPts / a.passAtt : null,
      perCarry: a.rushAtt > 50 ? a.rushPts / a.rushAtt : null,
      perTarget: a.tgt > 50 ? a.recPts / a.tgt : null,
    };
  }
  const fpaPerGame = {};
  const leagueAvg = {};
  for (const [pos, teams] of Object.entries(fpa)) {
    fpaPerGame[pos] = {};
    const vals = [];
    for (const [t, d] of Object.entries(teams)) {
      if (!d.games.size) continue;
      fpaPerGame[pos][t] = { perGame: d.pts / d.games.size, games: d.games.size };
      vals.push(d.pts / d.games.size);
    }
    leagueAvg[pos] = mean(vals);
  }
  return { rates, fpaPerGame, leagueAvg };
}

function weekPoints(wk, pos, scoring) {
  return scoreStats(wk.st || {}, pos, scoring, { perGame: true }).points;
}

function xfpWeek(wk, pos, rates) {
  const r = rates[pos];
  if (!r) return null;
  const st = wk.st || {};
  let x = 0, any = false;
  if (r.perPassAtt && st.pass_att) { x += st.pass_att * r.perPassAtt; any = true; }
  if (r.perCarry && st.rush_att) { x += st.rush_att * r.perCarry; any = true; }
  if (r.perTarget && st.rec_tgt) { x += st.rec_tgt * r.perTarget; any = true; }
  return any ? x : (Object.keys(st).length ? 0 : null);
}

function playedWeek(wk) {
  const st = wk.st || {};
  const u = wk.u || {};
  if (u.off_snp > 0 || u.snap_pct > 0) return true;
  return ['pass_att', 'rush_att', 'rec_tgt', 'rec', 'fp_src'].some((k) => st[k] > 0);
}

/**
 * Per-player inputs. Returns Map cid → inputs.
 */
export function derivePlayerInputs(dataset, league, scoring, phase, model, leagueRates) {
  const asOf = dataset.state?.as_of ? new Date(dataset.state.as_of) : new Date(dataset.built_at || Date.now());
  const srcW = model.source_weights.projection || {};
  const prodCfg = model.redraft.production;
  const out = new Map();
  const teams = dataset.teams || {};

  // Position average PPG among regular players (prior for players without last-season data)
  const posPPG = {};

  for (const p of dataset.players) {
    const pos = p.position;
    const age = p.birth_date ? ageOn(p.birth_date, asOf) : (typeof p.age === 'number' ? p.age : null);

    // --- Projections (league-scored) ---
    const wantScope = phase.phase === 'in_season' ? 'ros' : 'season';
    const targetSeason = phase.phase === 'postseason' || phase.phase === 'offseason' ? phase.season + 1 : phase.season;
    const bySource = [];
    for (const pr of p.projections || []) {
      if (pr.scope !== wantScope) continue;
      if (wantScope === 'season' && pr.season && Number(pr.season) !== targetSeason) continue;
      const games = typeof pr.games === 'number' && pr.games > 0 ? pr.games : null;
      const { points, estimated } = scoreStats(pr.stats || {}, pos, scoring, { games: games || 1 });
      if (points === null) continue;
      bySource.push({ src: pr.src, points, games, rate: games ? points / games : null, estimated, weight: srcW[pr.src] ?? 0.5, as_of: pr.as_of });
    }
    const projPoints = weightedMean(bySource.map((s) => ({ v: s.points, w: s.weight })));
    const projGames = weightedMean(bySource.filter((s) => s.games).map((s) => ({ v: s.games, w: s.weight })));
    const projRate = weightedMean(bySource.filter((s) => s.rate !== null).map((s) => ({ v: s.rate, w: s.weight })));

    // --- Production (current season) ---
    const weeks = (p.weekly || []).filter((w) => Number(w.s) === Number(phase.season)).sort((a, b) => a.w - b.w);
    const played = weeks.filter(playedWeek);
    const ptsByWeek = played.map((w) => ({ w: w.w, pts: weekPoints(w, pos, scoring) ?? 0, xfp: xfpWeek(w, pos, leagueRates.rates) }));
    const gp = ptsByWeek.length;
    const ppg = gp ? mean(ptsByWeek.map((x) => x.pts)) : null;
    const xs = ptsByWeek.filter((x) => x.xfp !== null);
    const xppg = xs.length ? mean(xs.map((x) => x.xfp)) : null;
    const recent = ptsByWeek.slice(-3);
    const recentPPG = recent.length ? mean(recent.map((x) => x.pts)) : null;

    // --- Last season ---
    let last = null;
    if (p.last_season && p.last_season.games > 0) {
      const lp = scoreStats(p.last_season.st || {}, pos, scoring, { games: p.last_season.games }).points;
      if (lp !== null) last = { season: p.last_season.season, gp: p.last_season.games, ppg: lp / p.last_season.games, points: lp };
    }

    // --- Usage summary (display + confidence) ---
    const usage = summarizeUsage(weeks);

    // --- Injury ---
    const inj = effectiveInjury(p.injury);
    const gamesLostRedraft = inj.status ? (model.redraft.injury_games_lost[inj.status] ?? 0) : 0;

    // --- Remaining games & SoS ---
    const tinfo = teams[p.team];
    const remGames = tinfo ? tinfo.remaining_games : null;
    let sos = 1, sosDetail = null;
    if (tinfo && tinfo.remaining_opponents && leagueRates.fpaPerGame[pos] && leagueRates.leagueAvg[pos]) {
      const opp = tinfo.remaining_opponents.map((o) => leagueRates.fpaPerGame[pos][o]).filter(Boolean);
      const weeksObserved = opp.length ? mean(opp.map((o) => o.games)) : 0;
      if (opp.length && weeksObserved >= prodCfg.sos_min_weeks) {
        const ratio = mean(opp.map((o) => o.perGame)) / leagueRates.leagueAvg[pos];
        const reliability = clamp(weeksObserved / 8, 0, 1);
        sos = 1 + prodCfg.sos_strength * reliability * (ratio - 1);
        sosDetail = { ratio, reliability, opponents: tinfo.remaining_opponents.length };
      }
    }

    out.set(p.cid, {
      p, pos, age,
      proj: { bySource, points: projPoints, games: projGames, rate: projRate, scope: wantScope },
      prod: { gp, ppg, xppg, recentPPG, weeks: ptsByWeek },
      last, usage,
      injury: { ...inj, gamesLostRedraft },
      remGames, sos, sosDetail,
    });
    if (gp >= 3 && ppg !== null) (posPPG[pos] ||= []).push(ppg);
  }

  // Positional prior = mean PPG of the top third of players with >=3 games (startable tier)
  const posPrior = {};
  for (const [pos, arr] of Object.entries(posPPG)) {
    const s = arr.sort((a, b) => b - a);
    posPrior[pos] = mean(s.slice(0, Math.max(1, Math.round(s.length / 3))));
  }

  // Production rate with regression to a prior
  for (const x of out.values()) {
    const { gp, ppg, xppg } = x.prod;
    if (!gp || ppg === null) { x.prod.rate = null; continue; }
    const blend = xppg !== null ? (1 - prodCfg.xfp_blend) * ppg + prodCfg.xfp_blend * xppg : ppg;
    let prior, priorKind;
    if (x.last && x.last.gp >= 4) { prior = x.last.ppg; priorKind = 'last_season'; }
    else { prior = posPrior[x.pos] ?? blend; priorKind = 'position_average'; }
    const k = prodCfg.regression_games;
    x.prod.blend = blend;
    x.prod.prior = prior;
    x.prod.priorKind = priorKind;
    x.prod.rate = (gp * blend + k * prior) / (gp + k);
  }
  return out;
}

function summarizeUsage(weeks) {
  if (!weeks.length) return null;
  const vals = (k) => weeks.map((w) => (w.u || {})[k]).filter((v) => typeof v === 'number');
  const stv = (k) => weeks.map((w) => (w.st || {})[k]).filter((v) => typeof v === 'number');
  const m = (a) => (a.length ? mean(a) : null);
  const sumv = (a) => (a.length ? a.reduce((s, v) => s + v, 0) : null);
  return {
    games: weeks.length,
    snap_pct: m(vals('snap_pct')),
    target_share: m(vals('target_share')),
    air_yards_share: m(vals('air_yards_share')),
    wopr: m(vals('wopr')),
    carries_pg: m(stv('rush_att')),
    targets_pg: m(stv('rec_tgt')),
    rz_targets: sumv(vals('rz_tgt')),
    rz_carries: sumv(vals('rz_att')),
    rec_pg: m(stv('rec')),
    pass_att_pg: m(stv('pass_att')),
  };
}
