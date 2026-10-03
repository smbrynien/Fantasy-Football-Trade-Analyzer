// Builds the canonical player DB and the merged dataset consumed by the valuation engine.
//
//   normalized/<source>/<type>.json  ──►  identity resolution  ──►  data/calculated/dataset.json
//
// * Player DB: authoritative player records (DynastyProcess crosswalk, nflverse, Sleeper) are upserted into a
//   persistent PlayerStore; every learned ID mapping is kept across runs.
// * Every other record is resolved with PlayerIndex.resolve(); unresolved/ambiguous records are reported, never merged.
// * Exclusive data types (stats, schedule, official injuries) use exactly one source, with explicit failover.

import fs from 'node:fs/promises';
import path from 'node:path';
import { P, DATA_DIR } from './lib/paths.js';
import { readJSON, writeJSON } from './lib/store.js';
import { PlayerStore, PlayerIndex } from '../js/core/identity.js';
import { DATASET_SCHEMA_VERSION, NORMALIZED_SCHEMA_VERSION } from '../js/core/version.js';
import { stableHash } from '../js/core/util/objects.js';
import { TEAMS } from '../js/core/util/teams.js';


export async function loadNormalized(sourceId, type) {
  const env = await readJSON(P.normalizedFile(sourceId, type), null);
  // Schema versions used to be written and never read: a file in another envelope shape would have been read as if
  // it were current (BUG_AUDIT 2, R7). Such a file is skipped (the source needs a re-sync) instead of misread.
  if (env && env.schema_version !== undefined && env.schema_version !== NORMALIZED_SCHEMA_VERSION) {
    console.warn(`  Skipping ${sourceId}/${type}.json: schema ${env.schema_version}, this version reads ${NORMALIZED_SCHEMA_VERSION}. Sync that source again.`);
    return null;
  }
  return env;
}

async function listNormalized() {
  const out = [];
  let dirs = [];
  try { dirs = await fs.readdir(path.join(DATA_DIR, 'normalized')); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = await fs.readdir(path.join(DATA_DIR, 'normalized', d)); } catch { continue; }
    for (const f of files) if (f.endsWith('.json')) out.push({ source: d, type: f.replace(/\.json$/, '') });
  }
  return out;
}

/** Rebuild the canonical player DB from authoritative normalized player files. */
export async function buildPlayerDB(config, { asOf = new Date() } = {}) {
  const existing = await readJSON(P.players, []);
  const overrides = await readJSON(P.playerOverrides, {});
  const auth = config.sources.authoritative_player_sources || { order: [], team_authority: null };
  const store = new PlayerStore(existing, { overrides, asOf, teamAuthority: auth.team_authority });
  const enabled = new Set(config.sources.sources.filter((s) => s.enabled).map((s) => s.id));
  const summary = {};
  for (const src of auth.order) {
    if (!enabled.has(src)) continue;
    const env = await loadNormalized(src, 'player');
    if (!env) continue;
    const counts = { created: 0, updated: 0, unchanged: 0, conflict: 0, skipped: 0 };
    for (const r of env.records) {
      const a = store.upsert(r, src).action;
      counts[a] = (counts[a] || 0) + 1;
    }
    summary[src] = counts;
  }
  // Defensive: ensure a DEF entry for every team even if Sleeper is unavailable.
  for (const t of TEAMS) store.upsert({ name: `${t} Defense`, position: 'DEF', team: t, ids: {} }, 'system');
  await writeJSON(P.players, store.players);
  const prevEvents = await readJSON(P.playerEvents, []);
  // On the very first build every player is 'created' — not interesting history, so those events are skipped.
  const firstBuild = existing.length === 0;
  const events = [...prevEvents, ...store.events.filter((e) => !(firstBuild && e.type === 'created'))].slice(-3000);
  await writeJSON(P.playerEvents, events);
  return { players: store.players, overrides, summary, events: store.events };
}

function scheduleContext(schedule, state) {
  if (!schedule || !schedule.records.length) return { teams: {}, completed: new Set(), opponentOf: new Map() };
  const season = Number(state.season);
  const week = Number(state.week) || 1;
  const inSeason = state.season_type === 'regular';
  const teams = {};
  const completed = new Set();
  const opponentOf = new Map();
  const maxWeek = Math.max(...schedule.records.map((g) => g.week));
  for (const t of TEAMS) teams[t] = { bye: null, remaining_games: 0, remaining_opponents: [], games: 0 };
  const weeksWithGame = {};
  for (const g of schedule.records) {
    if (g.season !== season) continue;
    for (const [t, o] of [[g.home, g.away], [g.away, g.home]]) {
      if (!teams[t]) continue;
      teams[t].games++;
      (weeksWithGame[t] ||= new Set()).add(g.week);
      opponentOf.set(`${t}|${g.week}`, o);
      const remaining = !inSeason ? true : g.week > week || (g.week === week && !g.completed);
      if (remaining) { teams[t].remaining_games++; teams[t].remaining_opponents.push(o); }
      if (g.completed) completed.add(`${t}|${g.week}`);
    }
  }
  for (const t of TEAMS) {
    for (let w = 1; w <= maxWeek; w++) if (weeksWithGame[t] && !weeksWithGame[t].has(w)) { teams[t].bye = w; break; }
  }
  return { teams, completed, opponentOf };
}

function isStale(statusEntry, source, freshness) {
  if (!statusEntry || !statusEntry.last_success) return true;
  const types = source.data_types || [];
  const target = Math.min(...types.map((t) => freshness[t] || 168));
  const ageH = (Date.now() - new Date(statusEntry.last_success).getTime()) / 36e5;
  return ageH > target * 2;
}

/**
 * Build dataset.json from all normalized data.
 * @returns { dataset, report }
 */
export async function buildDataset(config, { players, overrides, sourceStatus = {}, state }) {
  const index = new PlayerIndex(players, { overrides });
  const srcById = Object.fromEntries(config.sources.sources.map((s) => [s.id, s]));
  const enabled = new Set(config.sources.sources.filter((s) => s.enabled).map((s) => s.id));
  const files = (await listNormalized()).filter((f) => enabled.has(f.source));
  const byType = {};
  for (const f of files) (byType[f.type] ||= []).push(f.source);

  const report = { unresolved: {}, ambiguous: [], conflicts: [], substitutions: [], matched: {}, flags: {} };
  const pmap = new Map();
  const ensure = (cid) => {
    if (!pmap.has(cid)) {
      const p = index.get(cid);
      pmap.set(cid, { ...p, rankings: [], projections: [], market: [], adp: [], weekly: [], last_season: null, injury: null, _weekProj: {} });
    }
    return pmap.get(cid);
  };
  const resolveRec = (src, r) => {
    const res = index.resolve(r, { source: src });
    const rep = (report.matched[src] ||= { matched: 0, unresolved: 0, ambiguous: 0, ignored: 0, fuzzy: 0 });
    if (res.status === 'matched') {
      rep.matched++;
      if (res.method === 'fuzzy_name') { rep.fuzzy++; (report.flags[src] ||= []).push({ name: r.name, position: r.position, team: r.team, matched_to: res.cid, method: res.method }); }
      return res.cid;
    }
    if (res.status === 'ignored') { rep.ignored++; return null; }
    if (res.status === 'ambiguous' || res.status === 'conflict') {
      rep.ambiguous++;
      if (report.ambiguous.length < 500) report.ambiguous.push({ source: src, name: r.name, position: r.position, team: r.team, source_player_id: r.source_player_id ?? null, status: res.status, candidates: res.candidates.map((c) => ({ cid: c, name: index.get(c)?.name, team: index.get(c)?.team, position: index.get(c)?.position, birth_date: index.get(c)?.birth_date })) });
      return null;
    }
    rep.unresolved++;
    const list = (report.unresolved[src] ||= []);
    if (list.length < 400) list.push({ name: r.name, position: r.position, team: r.team, source_player_id: r.source_player_id ?? null });
    return null;
  };

  const week = Number(state.week) || 1;
  const inSeason = state.season_type === 'regular';

  // --- exclusive: weekly stats ---
  const prio = config.sources.exclusive_data_types;
  const pickExclusive = async (type, list) => {
    for (const src of list) {
      if (!enabled.has(src)) continue;
      const env = await loadNormalized(src, type);
      const st = sourceStatus[src];
      if (env && env.records && (env.records.length || type !== 'stat_week' || !inSeason)) {
        if (src !== list[0]) report.substitutions.push({ type, used: src, preferred: list[0], reason: sourceStatus[list[0]]?.error || 'preferred source has no usable data' });
        return { src, env, stale: isStale(st, srcById[src], config.sources.freshness_hours) };
      }
    }
    return null;
  };
  const schedPick = await pickExclusive('schedule', prio.schedule || []);
  const sched = scheduleContext(schedPick ? schedPick.env : null, state);
  const stats = await pickExclusive('stat_week', prio.stat_week);
  if (stats) {
    for (const r of stats.env.records) {
      const cid = resolveRec(stats.src, r);
      if (!cid) continue;
      const opp = r.opp || sched.opponentOf.get(`${r.team}|${r.week}`) || null;
      ensure(cid).weekly.push({ s: r.season, w: r.week, team: r.team, opp, st: r.stats, u: { ...(r.usage || {}) } });
    }
    // Usage enrichment from secondary stats source (distinct fields only: red-zone, snaps) — never overwrites.
    for (const src of prio.stat_week.filter((s) => s !== stats.src && enabled.has(s))) {
      const env = await loadNormalized(src, 'stat_week');
      if (!env) continue;
      for (const r of env.records) {
        const res = index.resolve(r, { source: src, allowFuzzy: false });
        if (res.status !== 'matched' || !pmap.has(res.cid)) continue;
        const line = pmap.get(res.cid).weekly.find((w) => w.w === r.week && w.s === r.season);
        if (!line) continue;
        for (const [k, v] of Object.entries(r.usage || {})) if (line.u[k] === undefined) line.u[k] = v;
      }
    }
  }
  const seasonStats = await pickExclusive('stat_season', prio.stat_week);
  if (seasonStats) {
    for (const r of seasonStats.env.records) {
      const cid = resolveRec(seasonStats.src, r);
      if (!cid || !(r.games > 0)) continue;
      ensure(cid).last_season = { season: r.season, games: r.games, team: r.team, st: r.stats, src: seasonStats.src };
    }
  }

  // --- injuries ---
  const officialSrc = await pickExclusive('injury', prio.injury_official);
  if (officialSrc) {
    for (const r of officialSrc.env.records) {
      if (!r.official) continue;
      const cid = resolveRec(officialSrc.src, r);
      if (!cid) continue;
      const p = ensure(cid);
      p.injury = { ...(p.injury || {}), official_status: r.status, official_week: r.week, official_practice: r.practice, official_body_part: r.body_part, official_source: officialSrc.src };
    }
  }
  for (const src of prio.injury_reported) {
    if (!enabled.has(src)) continue;
    const env = await loadNormalized(src, 'injury');
    if (!env) continue;
    for (const r of env.records) {
      const cid = resolveRec(src, r);
      if (!cid) continue;
      const p = ensure(cid);
      if (p.injury && p.injury.status) continue; // higher-priority reported source already set
      p.injury = { ...(p.injury || {}), status: r.status, body_part: r.body_part, practice: r.practice, notes: r.notes || null, as_of: r.as_of, source: src };
    }
    break; // only the first available reported source
  }

  // --- multi-source signal types ---
  for (const src of byType.ranking || []) {
    const env = await loadNormalized(src, 'ranking');
    for (const r of env.records) {
      const cid = resolveRec(src, r);
      if (!cid) continue;
      ensure(cid).rankings.push({ src, kind: r.kind, scope: r.scope, qb: r.qb, pos: r.pos || null, rank: r.rank, ecr: r.ecr ?? r.rank, sd: r.sd ?? null, best: r.best ?? null, worst: r.worst ?? null, as_of: r.as_of || env.fetched_at });
    }
  }
  for (const src of byType.market_value || []) {
    const env = await loadNormalized(src, 'market_value');
    for (const r of env.records) {
      const cid = resolveRec(src, r);
      if (!cid) continue;
      ensure(cid).market.push({ src, dynasty: r.dynasty, qb: r.qb, ppr: r.ppr ?? null, teams: r.teams ?? null, tep: r.tep ?? null, value: r.value, rank: r.rank ?? null, pos_rank: r.pos_rank ?? null, trend30: r.trend30 ?? null, tier: r.tier ?? null, as_of: r.as_of || env.fetched_at });
    }
  }
  for (const src of byType.adp || []) {
    const env = await loadNormalized(src, 'adp');
    for (const r of env.records) {
      const cid = resolveRec(src, r);
      if (!cid) continue;
      ensure(cid).adp.push({ src, format: r.format, adp: r.adp, pos_adp: r.pos_adp ?? null, n_drafts: r.n_drafts ?? null, as_of: r.as_of || env.fetched_at });
    }
  }
  const projStats = {};
  for (const src of byType.projection || []) {
    const env = await loadNormalized(src, 'projection');
    let used = 0;
    for (const r of env.records) {
      const cid = resolveRec(src, r);
      if (!cid) continue;
      const p = ensure(cid);
      if (r.scope === 'season' || r.scope === 'ros') {
        p.projections.push({ src, scope: r.scope, season: r.season ?? Number(state.season), games: r.games ?? null, stats: r.stats, as_of: r.as_of || env.fetched_at });
        used++;
      } else if (r.scope === 'week' && inSeason) {
        // Skip weeks whose game is already completed for the player's team.
        const team = r.team || p.team;
        if (r.week < week || (r.week === week && sched.completed.has(`${team}|${r.week}`))) continue;
        const acc = ((p._weekProj[src] ||= { games: 0, stats: {}, weeks: [] }));
        acc.games += 1;
        acc.weeks.push(r.week);
        for (const [k, v] of Object.entries(r.stats || {})) acc.stats[k] = (acc.stats[k] || 0) + v;
        used++;
      }
    }
    projStats[src] = used;
  }
  for (const p of pmap.values()) {
    for (const [src, acc] of Object.entries(p._weekProj)) {
      p.projections.push({ src, scope: 'ros', season: Number(state.season), games: acc.games, weeks: [Math.min(...acc.weeks), Math.max(...acc.weeks)], stats: acc.stats, as_of: null });
    }
    delete p._weekProj;
  }

  // --- picks ---
  const picks = [];
  for (const src of byType.pick_market || []) {
    const env = await loadNormalized(src, 'pick_market');
    for (const r of env.records) picks.push({ src, label: r.label, season: r.season, round: r.round, slot: r.slot ?? null, bucket: r.bucket ?? null, dynasty: r.dynasty !== false, qb: r.qb || '1qb', value: r.value, trend30: r.trend30 ?? null, as_of: r.as_of || env.fetched_at });
  }

  // --- sources summary ---
  const sources = {};
  for (const s of config.sources.sources) {
    const st = sourceStatus[s.id] || {};
    const isManual = s.adapter === 'manual';
    const hasData = files.some((f) => f.source === s.id);
    sources[s.id] = {
      name: s.name, priority: s.priority, method: s.method, enabled: s.enabled, manual: isManual,
      last_success: st.last_success || null, status: st.status || (hasData ? 'ok' : 'never'),
      records: st.records || null,
      stale: hasData && !isManual ? isStale(st, s, config.sources.freshness_hours) : false,
      has_data: hasData,
    };
  }
  if (stats && stats.stale) report.substitutions.push({ type: 'stat_week', used: stats.src, note: 'statistics are stale' });

  // Bye weeks onto players; keep only players with at least one signal (keeps the dataset compact).
  const out = [];
  for (const p of pmap.values()) {
    const hasSignal = p.rankings.length || p.market.length || p.projections.length || p.adp.length || p.weekly.length || p.last_season;
    if (!hasSignal) continue;
    p.bye_week = sched.teams[p.team]?.bye ?? null;
    delete p.sources;
    delete p.first_seen;
    out.push(p);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));

  const sourceVersions = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.last_success]));
  const dataset = {
    schema_version: DATASET_SCHEMA_VERSION,
    data_version: `${new Date().toISOString().slice(0, 10)}-${stableHash({ sourceVersions, overrides, n: out.length })}`,
    built_at: new Date().toISOString(),
    state: { season: Number(state.season), week: Number(state.week) || 0, season_type: state.season_type || 'regular', as_of: new Date().toISOString() },
    meta: { stats_source: stats?.src || null, season_stats_source: seasonStats?.src || null, projection_records: projStats, substitutions: report.substitutions },
    sources,
    teams: sched.teams,
    players: out,
    picks,
  };
  return { dataset, report };
}
