// MY TEAM — optional roster for the active league: best lineup, bench, picks, depth, and one-click "trade away".
// The trade page uses it for lineup impact ("your starters before → after"). Everything works without it.

import { h, clear, fmtValue, fmtAge, fmt1, posBadge, confBadge, injuryBadge, toast, openModal } from '../dom.js';
import { app, getValuations, activeProfile, playerData, myRoster, saveMyRoster, load, save, isPlainObject, isStringArray } from '../state.js';
import { bestLineup, expectationInputs, expectedLineupPoints } from '../../core/roster.js';
import { assetSearchBox, buildSearchIndex, searchAssets } from '../search.js';
import { openPlayer, openPickDetail } from './player-modal.js';
import { parsePickAssetId, pickDisplayName } from '../../core/pick-labels.js';

const SLOT_LABEL = { FLEX: 'FLEX', SUPERFLEX: 'SF' };

/** Projected points per game (redraft projection rate) — the "weekly points" of a lineup. */
export function pointsPerGame(id) {
  const a = getValuations('redraft')?.assets.get(id);
  const r = a?.details?.projection?.rate;
  return Number.isFinite(r) ? r : null;
}

const expCache = new WeakMap();
/** Inputs for expected lineup points (redraft rates, availability, waiver level), cached per redraft valuation run. */
export function rosterExpectation() {
  const red = getValuations('redraft');
  if (!red) return null;
  if (!expCache.has(red)) expCache.set(red, expectationInputs(red));
  return expCache.get(red);
}

export function renderTeam(root) {
  const result = getValuations();
  if (!result) return;
  const profile = activeProfile();
  let roster = myRoster(profile);
  const nameOf = (id) => playerData(id)?.name || (parsePickAssetId(id) ? pickDisplayName(parsePickAssetId(id)) : id);

  const head = h('div.panel');
  const body = h('div');
  root.append(head, body);

  function setIds(ids, meta) { saveMyRoster(ids, meta, profile); roster = myRoster(profile); draw(); }

  function draw() {
    clear(head); clear(body);
    const assets = roster.ids.map((id) => result.getAsset(id)).filter(Boolean);
    const missing = roster.ids.filter((id) => !result.getAsset(id));
    head.append(
      h('div.panel-head', {}, h('h2', {}, 'My Team'),
        h('div.flex.no-print', {},
          h('button.btn.btn-sm', { onclick: sleeperDialog }, 'Import from Sleeper'),
          h('button.btn.btn-sm', { onclick: pasteDialog }, 'Paste a list'),
          roster.ids.length ? h('button.btn.btn-sm.btn-danger', { onclick: () => { if (confirm('Remove every player and pick from My Team for this league?')) setIds([], { source: null }); } }, 'Clear') : null)),
      h('p.small.muted', {}, 'Optional. Your roster for ', h('strong', {}, profile.name), ` (${app.mode} values). With it, the Trade page shows how a trade changes your starting lineup. Saved in this browser, per league.`),
      assetSearchBox({
        getResult: () => result,
        includePicks: app.mode === 'dynasty',
        exclude: () => new Set(roster.ids.filter((id) => !/^pick:\d{4}:\d+(?::(?:early|mid|late))?$/.test(id))),
        placeholder: app.mode === 'dynasty' ? 'Add a player or pick to your roster (e.g. "chase", "2027 1st")' : 'Add a player to your roster',
        onPick: (a) => setIds([...roster.ids, a.id], { source: roster.source || 'manual' }),
      }));
    if (!assets.length) {
      body.append(h('div.panel.center.muted.mt', {},
        h('p', {}, 'No roster yet. Add players above, import your Sleeper team, or paste a list of names (one per line) from any site.'),
        h('p.small', {}, 'You can skip this entirely — the trade calculator works the same without it.')));
      return;
    }
    const L = bestLineup(assets, result.league);
    const pts = (xs) => xs.reduce((s, a) => s + (pointsPerGame(a.id) ?? 0), 0);
    const players = assets.filter((a) => a.kind === 'player');
    const picks = assets.filter((a) => a.kind === 'pick');
    body.append(h('div.kpis.mt', {},
      kpi('Starting lineup value', fmtValue(L.starters.reduce((s, a) => s + a.value, 0)), `${L.starters.length} starters${L.emptySlots.length ? ` · ${L.emptySlots.length} empty slot(s): ${L.emptySlots.join(', ')}` : ''}`),
      kpi('Projected points / game', fmt1(pts(L.starters)), 'starters, rest-of-season projection rate'),
      (() => { const ex = rosterExpectation(); const v = ex ? expectedLineupPoints(assets, result.league, ex) : null; return v !== null ? kpi('Expected lineup points / week', fmt1(v), 'missed games, your bench as cover; empty slots at waiver level') : null; })(),
      kpi('Bench value', fmtValue(L.bench.reduce((s, a) => s + a.value, 0)), `${L.bench.length} player(s)`),
      app.mode === 'dynasty' ? kpi('Value-weighted age', fmtAge(weightedAge(players)), 'all rostered players') : null,
      picks.length ? kpi('Draft picks', fmtValue(picks.reduce((s, a) => s + a.value, 0)), `${picks.length} pick(s)`) : null));
    if (missing.length) body.append(h('p.small.muted.mt', {}, `Not valued in ${app.mode} with current data (kept in your list): ${missing.map(nameOf).join(', ')}.`));

    const row = (a, slot) => {
      const p = a.kind === 'player' ? playerData(a.id) : null;
      return h('tr', {},
        h('td.small.muted', {}, slot ? (SLOT_LABEL[slot] || slot) : ''),
        h('td', {}, h('div.flex', { style: { gap: '.4rem', flexWrap: 'nowrap' } }, posBadge(a.position),
          h('button.linklike.bold', { type: 'button', onclick: () => (a.kind === 'player' ? openPlayer(a.id) : openPickDetail(a.id)) }, a.name),
          p ? injuryBadge(p.injury && { status: p.injury.status || p.injury.official_status }) : null)),
        h('td.small.hide-mobile', {}, a.kind === 'player' ? `${a.team || 'FA'}${a.posRank ? ` · ${a.position}${a.posRank}` : ''}` : 'pick'),
        h('td.num.hide-mobile', {}, a.kind === 'player' ? fmtAge(a.age) : ''),
        h('td.num.hide-mobile', {}, a.kind === 'player' ? fmt1(pointsPerGame(a.id)) : ''),
        h('td.num.bold', {}, fmtValue(a.value)),
        h('td.hide-mobile', {}, confBadge(a.confidence)),
        h('td.nowrap.no-print', {},
          h('button.btn.btn-xs', { title: 'Start a trade offering this asset', onclick: () => tradeAway(a.id) }, 'Trade'), ' ',
          h('button.btn.btn-xs', { 'aria-label': `Remove ${a.name} from My Team`, title: 'Remove', onclick: () => { const i = roster.ids.indexOf(a.id); if (i >= 0) setIds(roster.ids.filter((_, k) => k !== i)); } }, '×')));
    };
    const table = (title, rows) => h('div.panel.mt', {}, h('h3', {}, title), h('div.table-wrap', {}, h('table.data', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Slot'), h('th', {}, 'Player'), h('th.hide-mobile', {}, 'Team'), h('th.num.hide-mobile', {}, 'Age'), h('th.num.hide-mobile', { title: 'Projected points per game (rest of season)' }, 'Pts/g'), h('th.num', {}, 'Value'), h('th.hide-mobile', {}, 'Confidence'), h('th', {}, ''))),
      h('tbody', {}, rows))));
    body.append(table('Starting lineup', L.slots.map((s) => (s.asset ? row(s.asset, s.slot) : h('tr', {}, h('td.small.muted', {}, SLOT_LABEL[s.slot] || s.slot), h('td.muted', { colspan: 7 }, 'empty — no eligible player on your roster'))))));
    if (L.bench.length) body.append(table('Bench', L.bench.map((a) => row(a, ''))));
    if (picks.length) body.append(table('Draft picks', picks.sort((x, y) => y.value - x.value).map((a) => row(a, ''))));
    body.append(h('div.panel.mt', {}, h('h3', {}, 'Depth by position'),
      h('div.chips', {}, ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter((p) => (result.league.roster[p] || 0) > 0 || players.some((a) => a.position === p)).map((p) => {
        const n = players.filter((a) => a.position === p).length;
        const st = L.starters.filter((a) => a.position === p).length;
        return h('span.chip', { title: `${n} rostered, ${st} in your best lineup` }, `${p} ${n} (${st} starting)`);
      })),
      h('p.tiny.muted.mt-s', {}, 'Best lineup = highest-valued eligible players for each starting slot (dedicated slots first, then FLEX, then Superflex), using this league\'s values.')));
  }

  // "Trade" on a rostered asset: you give it, so it goes to the side the OTHER team receives.
  function tradeAway(id) {
    const key = `trade.${app.mode}`;
    let t = load(key, { a: [], b: [] }, (x) => isPlainObject(x) && isStringArray(x.a) && isStringArray(x.b));
    // A trade in progress that has nothing to do with my roster: start fresh unless the user wants to add to it.
    const current = [...t.a, ...t.b];
    if (current.length && !current.some((x) => roster.ids.includes(x)) && confirm(`Start a new trade offering ${nameOf(id)}?\n\nOK = new trade · Cancel = add to the trade you are building`)) t = { a: [], b: [], me: t.me };
    const me = t.me === 'b' ? 'b' : 'a';
    const other = me === 'a' ? 'b' : 'a';
    if (![...t.a, ...t.b].includes(id)) t[other].push(id);
    t.me = me;
    save(key, t);
    location.hash = '#/trade';
  }

  function weightedAge(players) {
    const xs = players.filter((a) => Number.isFinite(a.age) && a.value > 0);
    const w = xs.reduce((s, a) => s + a.value, 0);
    return w > 0 ? xs.reduce((s, a) => s + a.age * a.value, 0) / w : null;
  }

  function kpi(k, v, s) { return h('div.kpi', {}, h('div.k', {}, k), h('div.v', {}, v), h('div.s', {}, s)); }

  function pasteDialog() {
    openModal((close) => {
      const ta = h('textarea', { rows: 12, 'aria-label': 'Player names, one per line', placeholder: 'Justin Jefferson\nBijan Robinson\nDET RB …', style: { width: '100%', fontFamily: 'inherit' } });
      const run = () => {
        const index = buildSearchIndex(result);
        const added = [], notFound = [];
        const ids = [...roster.ids];
        for (const line of ta.value.split(/\n|;/).map((x) => x.replace(/^[\s\d.)-]+|\s*\(.*\)\s*$/g, '').trim()).filter(Boolean)) {
          const hit = searchAssets(index, line, { limit: 1, includePicks: app.mode === 'dynasty', result, exclude: new Set(ids) })[0];
          if (hit) { ids.push(hit.id); added.push(`${line} → ${hit.name}`); } else notFound.push(line);
        }
        setIds(ids, { source: roster.source || 'paste' });
        close();
        toast(`Added ${added.length}.${notFound.length ? ` Not found: ${notFound.slice(0, 8).join(', ')}${notFound.length > 8 ? ' …' : ''}.` : ''} Check the matches below.`, notFound.length ? 'warn' : 'ok', 8000);
      };
      return h('div.modal-body', {},
        h('div.flex-between', {}, h('h3', { style: { margin: 0 } }, 'Paste your roster'), h('button.btn.btn-sm', { onclick: close, 'aria-label': 'Close' }, '×')),
        h('p.small.muted', {}, 'One player per line, copied from any site (ESPN, Yahoo, NFL…). Each line is matched with the same search as the trade builder — check the result. Picks: "2027 1st".'),
        ta, h('div.flex.mt', {}, h('button.btn.btn-primary', { onclick: run }, 'Add to My Team')));
    });
  }

  function sleeperDialog() {
    openModal((close) => {
      const lid = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Sleeper league ID', placeholder: 'League ID (the number in your Sleeper league URL)', value: profile.source?.platform === 'sleeper' ? profile.source.league_id : '', style: { width: '100%' } });
      const out = h('div.mt');
      const loadTeams = async () => {
        const id = lid.value.trim();
        if (!/^\d{5,25}$/.test(id)) { clear(out).append(h('p.small', {}, 'Enter the numeric league ID.')); return; }
        clear(out).append(h('p.small.muted', {}, 'Loading teams…'));
        try {
          const [users, rosters] = await Promise.all([`https://api.sleeper.app/v1/league/${id}/users`, `https://api.sleeper.app/v1/league/${id}/rosters`].map(async (u) => {
            const r = await fetch(u);
            if (!r.ok) throw new Error(`Sleeper returned ${r.status}`);
            return r.json();
          }));
          if (!Array.isArray(rosters) || !rosters.length) throw new Error('no teams found for that league ID');
          const byUser = new Map((Array.isArray(users) ? users : []).map((u) => [u.user_id, u]));
          const bySleeper = new Map((app.dataset.players || []).filter((p) => p.ids?.sleeper).map((p) => [String(p.ids.sleeper), p.cid]));
          clear(out).append(h('p.small', {}, 'Which team is yours?'), h('div.stack', {}, rosters.map((r) => {
            const u = byUser.get(r.owner_id);
            const label = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
            const ids = [...new Set([...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])].map(String))];
            return h('button.btn', { style: { justifyContent: 'space-between', width: '100%' }, onclick: () => {
              const cids = ids.map((x) => bySleeper.get(x)).filter(Boolean);
              setIds(cids, { source: 'sleeper', sleeper_league: id, team_name: label });
              close();
              toast(`Imported ${cids.length} of ${ids.length} players from "${label}".${cids.length < ids.length ? ' Unmatched players are not in the current player database.' : ''} Draft picks aren't imported — add them with the search box.`, cids.length < ids.length ? 'warn' : 'ok', 8000);
            } }, h('span.bold', {}, label), h('span.small.muted', {}, `${ids.length} players`));
          })));
        } catch (e) {
          clear(out).append(h('p.small', {}, `Could not load the league: ${e.message}. Check the ID and your internet connection.`));
        }
      };
      return h('div.modal-body', {},
        h('div.flex-between', {}, h('h3', { style: { margin: 0 } }, 'Import your roster from Sleeper'), h('button.btn.btn-sm', { onclick: close, 'aria-label': 'Close' }, '×')),
        h('p.small.muted', {}, 'Reads the league\'s public team list from Sleeper (no login). Your current My Team list for this league is replaced.'),
        h('div.flex', { style: { flexWrap: 'nowrap' } }, lid, h('button.btn.btn-primary', { onclick: loadTeams }, 'Load teams')), out);
    });
  }

  draw();
}
