// Asset search (players + picks). Matches partial names, team abbreviations and positions, e.g.
// "jef", "det rb", "wr min", "2027 1st", "1.04".

import { h, clear, fmtValue, posBadge, injuryBadge } from './dom.js';
import { nameKey } from '../core/util/names.js';
import { TEAMS } from '../core/util/teams.js';
import { parsePickLabel, pickAssetId } from '../core/pick-labels.js';
import { playerData } from './state.js';

const POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'PICK']);
const TEAM_SET = new Set(TEAMS);
const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

export function buildSearchIndex(result) {
  const items = [];
  for (const a of result.assets.values()) {
    if (a.kind === 'pick' && a.descriptor && a.descriptor.slot === null && a.descriptor.bucket === null) items.push({ a, key: nameKey(a.name), pick: true });
    else if (a.kind === 'pick') items.push({ a, key: nameKey(a.name), pick: true, secondary: true });
    else items.push({ a, key: nameKey(a.name), last: nameKey(a.name).split(' ').slice(-1)[0] });
  }
  items.sort((x, y) => y.a.value - x.a.value);
  return items;
}

export function searchAssets(index, q, { limit = 12, includePicks = true, exclude = new Set(), result } = {}) {
  const raw = q.trim();
  if (!raw) return [];
  // Name suffixes are stripped from indexed names (nameKey), so drop them from the query too ("beckham jr" found nothing).
  const words = raw.split(/\s+/).filter((t) => !SUFFIX.test(t));
  const tokens = words.map((t) => t.toUpperCase());
  const posF = tokens.filter((t) => POS.has(t));
  const teamF = tokens.filter((t) => TEAM_SET.has(t) && !POS.has(t));
  const textTokens = words.filter((t) => !POS.has(t.toUpperCase()) && !TEAM_SET.has(t.toUpperCase())).map((t) => nameKey(t)).filter(Boolean);
  // A team code is also a name prefix while typing ("min" → Minshew, not only Vikings): match either.
  const teamOk = (it) => !teamF.length || teamF.some((t) => it.a.team === t || it.key.split(' ').some((w) => w.startsWith(t.toLowerCase())));
  const out = [];
  // pick expressions
  if (includePicks && result && result.picks) {
    const m = raw.match(/^(\d{4})?\s*(\d)\.(\d{1,2})$/);
    if (m) {
      const season = m[1] ? Number(m[1]) : result.picks.upcoming;
      const id = pickAssetId({ season, round: Number(m[2]), slot: Number(m[3]) });
      const a = result.getAsset(id);
      if (a && !exclude.has(a.id)) out.push(a);
    } else {
      const d = parsePickLabel(raw);
      if (d) { const a = result.getAsset(pickAssetId(d)); if (a && !exclude.has(a.id)) out.push(a); }
    }
  }
  for (const it of index) {
    if (out.length >= limit) break;
    if (exclude.has(it.a.id)) continue;
    if (it.pick && !includePicks) continue;
    if (it.secondary && !/\d/.test(raw)) continue;
    if (posF.length && !posF.includes(it.a.position)) continue;
    if (!teamOk(it)) continue;
    if (textTokens.length && !textTokens.every((t) => it.key.includes(t))) continue;
    if (!textTokens.length && !posF.length && !teamF.length) continue;
    out.push(it.a);
  }
  // prefer prefix matches on last/first name
  if (textTokens.length === 1) {
    const t = textTokens[0];
    out.sort((x, y) => {
      const px = nameKey(x.name).split(' ').some((w) => w.startsWith(t)) ? 0 : 1;
      const py = nameKey(y.name).split(' ').some((w) => w.startsWith(t)) ? 0 : 1;
      return px - py || y.value - x.value;
    });
  }
  // The parsed pick expression and the index can yield the same asset: show it once.
  const seen = new Set();
  return out.filter((a) => !seen.has(a.id) && seen.add(a.id)).slice(0, limit);
}

export function assetSearchBox({ getResult, onPick, placeholder = 'Search player, team or position…', includePicks = true, exclude = () => new Set() }) {
  let index = null, indexFor = null, hl = 0, results = [];
  const input = h('input', { type: 'search', placeholder, autocomplete: 'off', 'aria-label': placeholder, spellcheck: 'false' });
  const list = h('div.search-results', { hidden: true, role: 'listbox' });
  const box = h('div.search-box', {}, input, list);
  const ensure = () => { const r = getResult(); if (r !== indexFor) { index = buildSearchIndex(r); indexFor = r; } return r; };
  const choose = (a) => { onPick(a); input.value = ''; list.hidden = true; input.focus(); };
  const draw = () => {
    clear(list);
    if (!results.length) { list.hidden = !input.value.trim(); if (input.value.trim()) list.append(h('div.small.muted', { style: { padding: '.6rem' } }, 'No matches')); return; }
    results.forEach((a, i) => {
      const p = a.kind === 'player' ? playerData(a.id) : null;
      list.append(h('button', { type: 'button', role: 'option', class: i === hl ? 'hl' : '', onmousedown: (e) => { e.preventDefault(); choose(a); } },
        posBadge(a.position),
        h('span', {}, h('span.bold', {}, a.name), ' ', h('span.muted.small', {}, a.kind === 'player' ? `${a.team || 'FA'}${a.age ? ` · ${a.age.toFixed(1)}` : ''}` : 'rookie pick'), ' ', p ? injuryBadge(p.injury && { status: p.injury.status || p.injury.official_status }) : null),
        h('span.num.bold', {}, fmtValue(a.value))));
    });
    list.hidden = false;
  };
  input.addEventListener('input', () => { const r = ensure(); results = searchAssets(index, input.value, { includePicks, exclude: exclude(), result: r }); hl = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { hl = Math.min(results.length - 1, hl + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && results[hl]) { choose(results[hl]); e.preventDefault(); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('focus', () => { if (results.length) list.hidden = false; });
  return box;
}
