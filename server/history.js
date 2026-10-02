// Value history. After each successful build we record, per player, the model value in the reference league
// (redraft + dynasty), the raw FantasyCalc market values, FantasyPros consensus ranks and ROS projection.
// History only grows from real syncs — nothing is back-filled or interpolated.

import { P } from './lib/paths.js';
import { readJSON, writeJSON } from './lib/store.js';
import { computeValuations } from '../js/core/valuation/engine.js';

const MAX_ENTRIES = 500;

function pickMarket(p, dynasty, hs) {
  const f = hs.market_format || {};
  const m = (p.market || []).find((x) => x.src === hs.market_source && x.dynasty === dynasty && x.qb === (f.qb || '1qb') && (f.ppr === undefined || x.ppr === f.ppr) && (f.teams === undefined || x.teams === f.teams));
  return m ? m.value : null;
}
function pickRank(p, kind, hs, scope = 'overall') {
  const r = (p.rankings || []).find((x) => x.src === hs.consensus_source && x.kind === kind && x.scope === scope && x.qb === '1qb');
  return r ? r.ecr : null;
}

export async function updateHistory(dataset, config) {
  const cfg = { model: config.model, leagueDefaults: config.leagueDefaults, sources: config.sources, calibration: config.calibration };
  const ref = config.model.reference_league;
  const league = { id: 'history-reference', name: 'Reference', teams: ref.teams, scoring_preset: ref.scoring_preset, roster: ref.roster };
  const hs = config.sources.history_series || {};
  const h = (await readJSON(P.history, null)) || { schema_version: 1, entries: [], series: {} };
  if (h.entries.length && h.entries[h.entries.length - 1].data_version === dataset.data_version) return h; // already recorded
  const red = computeValuations({ dataset, league, mode: 'redraft', config: cfg });
  const dyn = computeValuations({ dataset, league, mode: 'dynasty', config: cfg });
  const idx = h.entries.length;
  h.entries.push({ t: dataset.built_at, data_version: dataset.data_version, model_version: config.model.model_version, week: dataset.state.week, season: dataset.state.season });
  const pad = (arr) => { while (arr.length < idx) arr.push(null); return arr; };
  for (const p of dataset.players) {
    const r = red.assets.get(p.cid), d = dyn.assets.get(p.cid);
    const s = (h.series[p.cid] ||= { name: p.name, pos: p.position, r: [], d: [], mr: [], md: [], er: [], ed: [], proj: [] });
    s.name = p.name;
    pad(s.r).push(r ? Math.round(r.value) : null);
    pad(s.d).push(d ? Math.round(d.value) : null);
    pad(s.mr).push(pickMarket(p, false, hs));
    pad(s.md).push(pickMarket(p, true, hs));
    pad(s.er).push(pickRank(p, 'ros', hs) ?? pickRank(p, 'redraft', hs));
    pad(s.ed).push(pickRank(p, 'dynasty', hs));
    pad(s.proj).push(r && r.details?.projection?.points ? Math.round(r.details.projection.points * 10) / 10 : null);
  }
  for (const s of Object.values(h.series)) for (const k of ['r', 'd', 'mr', 'md', 'er', 'ed', 'proj']) { pad(s[k]); if (s[k].length === idx) s[k].push(null); }
  if (h.entries.length > MAX_ENTRIES) {
    const cut = h.entries.length - MAX_ENTRIES;
    h.entries = h.entries.slice(cut);
    for (const s of Object.values(h.series)) for (const k of Object.keys(s)) if (Array.isArray(s[k])) s[k] = s[k].slice(cut);
  }
  await writeJSON(P.history, h);
  return h;
}
