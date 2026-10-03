// MY TEAM — optional saved teams (rosters), each linked to a league: best lineup, bench, picks, depth, one-click
// "trade away" and trade targets by roster need. The trade page uses the league's active team for lineup impact
// ("your starters before → after"). Everything works without it.

import { h, clear, fmtValue, fmtAge, fmt1, posBadge, confBadge, injuryBadge, toast, openModal } from '../dom.js';
import { app, getValuations, activeProfile, allProfiles, setProfile, playerData, myRoster, saveMyRoster, load, save, isPlainObject, isStringArray,
  allTeams, teamsFor, activeTeam, setActiveTeam, createTeam, updateTeam, deleteTeam, opponentsFor, upsertOpponents } from '../state.js';
import { finderPanel } from './trade-finder.js';
import { bestLineup, expectationInputs, expectedLineupPoints, rosterTargets } from '../../core/roster.js';
import { assetSearchBox, buildSearchIndex, searchAssets } from '../search.js';
import { openPlayer, openPickDetail } from './player-modal.js';
import { parsePickAssetId, pickDisplayName } from '../../core/pick-labels.js';
import { sleeperPickIds, sleeperHasPicks } from '../sleeper-import.js';

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

  const leagueName = (id) => allProfiles().find((p) => p.id === id)?.name;
  /** Team picker, like the league profiles: this league's teams first, then teams saved for other leagues. */
  function teamBar() {
    const team = activeTeam(profile);
    const mine = teamsFor(profile);
    const others = allTeams().filter((t) => t.profileId !== profile.id);
    const pick = (e) => {
      const t = allTeams().find((x) => x.id === e.target.value);
      if (!t) return;
      if (t.profileId === profile.id) { setActiveTeam(t.id, profile); return; }
      const target = allProfiles().find((p) => p.id === t.profileId);
      if (target) { save(`team.active.${target.id}`, t.id); setProfile(target.id); toast(`Switched to "${t.name}" and its league, ${target.name}.`); return; }
      // Its league profile was deleted: give the team to this league instead.
      updateTeam(t.id, { profileId: profile.id }); setActiveTeam(t.id, profile);
      toast(`"${t.name}" was saved for a league that no longer exists; it now uses ${profile.name}.`, 'warn');
    };
    const sel = h('select', { 'aria-label': 'Saved team', onchange: pick },
      !team ? h('option', { value: '' }, 'No saved team yet') : null,
      mine.length ? h('optgroup', { label: `${profile.name}` }, mine.map((t) => h('option', { value: t.id, selected: team && t.id === team.id ? true : null }, `${t.name} (${t.ids.length})`))) : null,
      others.length ? h('optgroup', { label: 'Other leagues (switches the league)' }, others.map((t) => h('option', { value: t.id }, `${t.name} — ${leagueName(t.profileId) || 'deleted league'}`))) : null);
    const ask = (q, def) => { const v = prompt(q, def); return v === null ? null : v.trim().slice(0, 80) || null; };
    return h('div.team-bar.flex.no-print', {},
      h('label.small.muted', {}, 'Team ', sel),
      h('button.btn.btn-sm', { onclick: () => { const n = ask(`Name for the new team (${profile.name})`, `Team ${mine.length + 1}`); if (n) { createTeam({ name: n }, profile); toast(`Created "${n}". Add players below, import from Sleeper or paste a list.`); } } }, '＋ New team'),
      team ? h('button.btn.btn-sm', { onclick: () => { const n = ask('Rename team', team.name); if (n) { updateTeam(team.id, { name: n }); roster = myRoster(profile); draw(); } } }, 'Rename') : null,
      team ? h('button.btn.btn-sm', { title: 'Save a copy of this team (e.g. to try out a different roster)', onclick: () => { const n = ask('Name for the copy', `${team.name} — copy`); if (n) createTeam({ name: n, ids: team.ids, source: team.source ?? null }, profile); } }, 'Copy') : null,
      team ? h('label.small.muted', { title: 'The league whose settings value this team' }, 'League ',
        h('select', { 'aria-label': 'League of this team', onchange: (e) => { updateTeam(team.id, { profileId: e.target.value }); save(`team.active.${e.target.value}`, team.id); setProfile(e.target.value); toast(`"${team.name}" now uses ${leagueName(e.target.value)}.`); } },
          allProfiles().map((p) => h('option', { value: p.id, selected: p.id === profile.id ? true : null }, p.name)))) : null,
      team ? h('button.btn.btn-sm.btn-danger', { onclick: () => { if (confirm(`Delete the team "${team.name}"? Its roster is removed; your league settings stay.`)) { deleteTeam(team.id); toast(`Deleted "${team.name}".`); } } }, 'Delete') : null);
  }

  function draw() {
    clear(head); clear(body);
    const assets = roster.ids.map((id) => result.getAsset(id)).filter(Boolean);
    const missing = roster.ids.filter((id) => !result.getAsset(id));
    const team = activeTeam(profile);
    head.append(
      h('div.panel-head', {}, h('h2', {}, 'My Team', team ? h('span.muted', { style: { fontWeight: 600 } }, ` — ${team.name}`) : null),
        h('div.flex.no-print', {},
          h('button.btn.btn-sm', { onclick: sleeperDialog }, 'Import from Sleeper'),
          h('button.btn.btn-sm', { onclick: pasteDialog }, 'Paste a list'),
          roster.ids.length ? h('button.btn.btn-sm.btn-danger', { onclick: () => { if (confirm(`Remove every player and pick from "${team?.name || 'My Team'}"? The team itself stays saved.`)) setIds([], { source: null }); } }, 'Clear') : null)),
      teamBar(),
      h('p.small.muted', {}, 'Optional. Save as many teams as you like — each uses a league\'s settings (here ', h('strong', {}, profile.name), `, ${app.mode} values). The Trade page uses the league's selected team to show how a trade changes your starting lineup. Saved in this browser and by the app on this computer.`),
      assetSearchBox({
        getResult: () => result,
        includePicks: app.mode === 'dynasty',
        taken: () => new Map(roster.ids.filter((id) => !/^pick:\d{4}:\d+(?::(?:early|mid|late))?$/.test(id)).map((id) => [id, 'your roster'])),
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
    const team2 = activeTeam(profile);
    finder = team2 ? finderPanel({ result, profile, team: team2, expected: rosterExpectation(), onChange: () => { roster = myRoster(profile); draw(); } }) : null;
    if (finder) body.append(finder);
    body.append(targetsPanel(L), opponentsPanel());
  }

  let finder = null;
  /** Other teams of this league saved for the trade finder (from Sleeper): count and remove. */
  function opponentsPanel() {
    const opp = opponentsFor(profile);
    if (!opp.length) return h('p.small.muted.mt.no-print', {}, 'Tip: import your league from Sleeper with "Also save the other teams" — the trade finder then also checks what each offer does to the other team\'s lineup.');
    return h('details.panel.mt.no-print', {}, h('summary', {}, h('strong', {}, `Other teams in this league (${opp.length})`), h('span.small.muted', {}, ' — used by the trade finder to judge the other side')),
      h('ul.small', {}, opp.map((t) => h('li', {}, `${t.name} — ${t.ids.length} players`, t.updated_at ? h('span.muted', {}, ` (saved ${new Date(t.updated_at).toLocaleDateString()})`) : null))),
      h('button.btn.btn-sm.btn-danger', { onclick: () => { if (confirm(`Remove the ${opp.length} saved rosters of the other teams in this league?`)) { for (const t of opp) deleteTeam(t.id); } } }, 'Remove them'));
  }

  // ---- Trade targets by roster need (F46) ----
  const TARGET_KEY = `myteam.targets.${app.mode}`;
  const targetCache = new Map();
  function targetsPanel(L) {
    const ex = rosterExpectation();
    const panel = h('section.panel.mt.targets', { 'aria-label': 'Trade targets by roster need' });
    panel.append(h('div.panel-head', {}, h('h3', {}, 'Trade targets for your roster')));
    if (!ex) { panel.append(h('p.small.muted', {}, 'Needs redraft projections, which are not in the current data.')); return panel; }
    // Default value band: up to what the bench and picks are worth — roughly what you could offer without giving up a
    // starter. Remembered per mode once changed.
    const benchPlusPicks = L.bench.reduce((s, a) => s + a.value, 0) + roster.ids.map((id) => result.getAsset(id)).filter((a) => a && a.kind === 'pick').reduce((s, a) => s + a.value, 0);
    const saved = load(TARGET_KEY, {}, isPlainObject);
    const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
    const band = { min: num(saved.min) ?? 0, max: num(saved.max) ?? (benchPlusPicks > 0 ? Math.round(benchPlusPicks / 10) * 10 : null), pos: typeof saved.pos === 'string' ? saved.pos : '' };
    const minIn = h('input', { type: 'number', min: 0, step: 50, value: band.min || '', placeholder: '0', 'aria-label': 'Minimum value', style: { width: '6.5rem' } });
    const maxIn = h('input', { type: 'number', min: 0, step: 50, value: band.max ?? '', placeholder: 'any', 'aria-label': 'Maximum value', style: { width: '6.5rem' } });
    const set = (patch) => { save(TARGET_KEY, { ...load(TARGET_KEY, {}, isPlainObject), ...patch }); draw(); };
    panel.append(h('p.small.muted', {}, 'Players on other NFL rosters who would add the most ', h('strong', {}, 'expected lineup points per week'),
      ' to this team — each one added on top of your roster, with missed games and your bench as cover (the measure that best predicted how trades turned out in historical league simulations). ',
      app.mode === 'dynasty' ? 'Points are this season\'s; dynasty values also price future seasons. ' : '',
      'A measure of fit, not advice: the Trade page shows what the full trade does.'),
      h('div.flex.no-print', {},
        h('label.small', {}, 'Value from ', minIn), h('label.small', {}, 'to ', maxIn),
        h('button.btn.btn-sm', { onclick: () => set({ min: num(minIn.value), max: maxIn.value === '' ? '' : num(maxIn.value) }) }, 'Apply'),
        benchPlusPicks > 0 ? h('button.btn.btn-sm', { title: 'Up to the value of your bench and picks — roughly what you could offer without giving up a starter', onclick: () => set({ min: null, max: null }) }, `Bench + picks (${fmtValue(benchPlusPicks)})`) : null,
        h('button.btn.btn-sm', { onclick: () => set({ min: null, max: '' }) }, 'Any value')));
    const key = `${roster.ids.join(',')}|${band.min}|${band.max}`;
    if (!targetCache.has(key)) targetCache.set(key, rosterTargets(result, roster.ids, ex, { minValue: band.min, maxValue: band.max ?? Infinity, limit: 200 }));
    const T = targetCache.get(key);
    if (T.base === null) { panel.append(h('p.small.muted', {}, 'No lineup to improve yet.')); return panel; }
    const posFilter = T.byPosition.some((p) => p.position === band.pos) ? band.pos : '';
    panel.append(h('div.kpis.mt-s', {}, kpi('Your expected lineup points / week', fmt1(T.base), `value band ${fmtValue(band.min)}–${band.max === null ? 'any' : fmtValue(band.max)}`)),
      h('h4.mt', {}, 'Where an upgrade helps most'),
      h('div.chips.need-chips', { role: 'group', 'aria-label': 'Positions by gain' },
        h('button.chip', { 'aria-pressed': String(!posFilter), onclick: () => set({ pos: '' }) }, 'All positions'),
        T.byPosition.map((p) => h('button.chip', { 'aria-pressed': String(posFilter === p.position), title: p.best ? `Best in the band: ${p.best.asset.name}, +${fmt1(p.best.gain)} points/week. You roster ${p.rostered} ${p.position}, ${p.starters} starting.` : `No player in the value band adds lineup points at ${p.position}.`, onclick: () => set({ pos: p.position }) },
          h('strong', {}, p.position), ' ', p.best ? `up to +${fmt1(p.best.gain)}/wk` : 'no gain', h('span.muted', {}, ` · ${p.rostered} rostered`)))));
    const rows = T.targets.filter((t) => !posFilter || t.asset.position === posFilter).slice(0, 15);
    if (!rows.length) { panel.append(h('p.small.muted.mt-s', {}, 'No player in this value band would add lineup points — try a wider band.')); return panel; }
    panel.append(h('div.table-wrap.mt-s', {}, h('table.data', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', {}, 'Team'), h('th.num', {}, 'Age'), h('th.num', { title: 'Expected lineup points per week this player would add to this team' }, '+ Pts/wk'), h('th.num', {}, 'Value'), h('th.num', { title: 'Points per week added per 1,000 of value: how much lineup help per unit of trade value' }, 'Pts/wk per 1,000'), h('th', {}, ''))),
      h('tbody', {}, rows.map((t) => h('tr', {},
        h('td', {}, h('div.flex', { style: { gap: '.4rem', flexWrap: 'nowrap' } }, posBadge(t.asset.position), h('button.linklike.bold', { type: 'button', onclick: () => openPlayer(t.asset.id) }, t.asset.name), injuryBadge(playerData(t.asset.id)?.injury && { status: playerData(t.asset.id).injury.status || playerData(t.asset.id).injury.official_status }))),
        h('td.small', {}, `${t.asset.team}${t.asset.posRank ? ` · ${t.asset.position}${t.asset.posRank}` : ''}`),
        h('td.num', {}, fmtAge(t.asset.age)),
        h('td.num.bold', {}, `+${fmt1(t.gain)}`),
        h('td.num', {}, fmtValue(t.asset.value)),
        h('td.num', {}, fmt1(t.perThousand)),
        h('td.nowrap.no-print', {}, finder ? h('button.btn.btn-xs', { title: 'Let the trade finder suggest fair packages from your roster for this player', onclick: () => finder.setTarget(t.asset.id) }, 'Find packages') : null, ' ',
          h('button.btn.btn-xs', { title: 'Start a trade where you receive this player', onclick: () => tradeFor(t.asset.id) }, 'Trade for'))))))),
    h('p.tiny.muted.mt-s', {}, `Scored: the ${40} most valuable players per position inside the value band (NFL free agents left out). Each gain assumes nobody leaves your roster.`));
    return panel;
  }

  // "Trade for" a target: I receive it, so it goes on my side of the trade.
  function tradeFor(id) {
    const key = `trade.${app.mode}`;
    let t = load(key, { a: [], b: [] }, (x) => isPlainObject(x) && isStringArray(x.a) && isStringArray(x.b));
    const current = [...t.a, ...t.b];
    if (current.length && !current.some((x) => roster.ids.includes(x)) && confirm(`Start a new trade for ${nameOf(id)}?\n\nOK = new trade · Cancel = add to the trade you are building`)) t = { a: [], b: [], me: t.me };
    const me = t.me === 'b' ? 'b' : 'a';
    if (![...t.a, ...t.b].includes(id)) t[me].push(id);
    t.me = me;
    save(key, t);
    location.hash = '#/trade';
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
        const added = [], notFound = [], already = [];
        const ids = [...roster.ids];
        const generic = (id) => /^pick:\d{4}:\d+(?::(?:early|mid|late))?$/.test(id);
        for (const line of ta.value.split(/\n|;/).map((x) => x.replace(/^[\s\d.)-]+|\s*\(.*\)\s*$/g, '').trim()).filter(Boolean)) {
          // Best match WITHOUT excluding the roster: a repeated line must not quietly add the next-best name.
          const hit = searchAssets(index, line, { limit: 1, includePicks: app.mode === 'dynasty', result })[0];
          if (!hit) notFound.push(line);
          else if (ids.includes(hit.id) && !generic(hit.id)) already.push(hit.name);
          else { ids.push(hit.id); added.push(`${line} → ${hit.name}`); }
        }
        setIds(ids, { source: roster.source || 'paste' });
        close();
        toast(`Added ${added.length}.${already.length ? ` Already on your roster: ${already.slice(0, 6).join(', ')}${already.length > 6 ? ' …' : ''}.` : ''}${notFound.length ? ` Not found: ${notFound.slice(0, 8).join(', ')}${notFound.length > 8 ? ' …' : ''}.` : ''} Check the matches below.`, notFound.length ? 'warn' : 'ok', 8000);
      };
      return h('div.modal-body', {},
        h('div.flex-between', {}, h('h3', { style: { margin: 0 } }, 'Paste your roster'), h('button.btn.btn-sm', { onclick: close, 'aria-label': 'Close' }, '×')),
        h('p.small.muted', {}, 'One player per line, copied from any site (ESPN, Yahoo, NFL…). Each line is matched with the same search as the trade builder — check the result. Picks: "2027 1st".'),
        ta, h('div.flex.mt', {}, h('button.btn.btn-primary', { onclick: run }, 'Add to My Team')));
    });
  }

  /** Rookie picks each Sleeper team owns (dynasty/keeper leagues), as this app's pick ids. Never blocks the player import. */
  async function sleeperPicks(id, rosters) {
    const none = (note = null) => ({ ids: new Map(), note });
    const dyn = getValuations('dynasty');
    const valued = dyn ? [...dyn.assets.values()].filter((a) => a.kind === 'pick').map((a) => parsePickAssetId(a.id)).filter(Boolean) : [];
    if (!valued.length) return none();
    try {
      const get = async (u) => { const r = await fetch(`https://api.sleeper.app/v1/league/${id}${u}`); if (!r.ok) throw new Error(`Sleeper returned ${r.status}`); return r.json(); };
      const league = await get('');
      if (!sleeperHasPicks(league)) return none();
      const [tradedPicks, drafts] = await Promise.all([get('/traded_picks'), get('/drafts')]);
      const seasons = [...new Set(valued.map((d) => d.season))].sort();
      const appRounds = Math.max(...valued.map((d) => d.round));
      const rounds = Math.min(appRounds, Number(league.settings?.draft_rounds) || appRounds);
      return { ids: sleeperPickIds({ rosters, tradedPicks, drafts, seasons, rounds }), note: null };
    } catch (e) {
      return none(`Draft picks could not be read (${e.message}) — add them with the search box.`);
    }
  }

  function sleeperDialog() {
    openModal((close) => {
      const lid = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Sleeper league ID', placeholder: 'League ID (the number in your Sleeper league URL)', value: profile.source?.platform === 'sleeper' ? profile.source.league_id : '', style: { width: '100%' } });
      const out = h('div.mt');
      const cur = activeTeam(profile);
      // A filled team is kept by default: the import becomes a new saved team named after the Sleeper team.
      const asNew = h('input', { type: 'checkbox', checked: Boolean(cur && cur.ids.length) });
      const withOthers = h('input', { type: 'checkbox', checked: true });
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
          const picksBy = await sleeperPicks(id, rosters);
          const byUser = new Map((Array.isArray(users) ? users : []).map((u) => [u.user_id, u]));
          const bySleeper = new Map((app.dataset.players || []).filter((p) => p.ids?.sleeper).map((p) => [String(p.ids.sleeper), p.cid]));
          const teamsOf = rosters.map((r) => {
            const u = byUser.get(r.owner_id);
            const label = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
            const ids = [...new Set([...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])].map(String))];
            const picks = picksBy.ids.get(Number(r.roster_id)) || [];
            return { r, label, ids, picks, cids: [...ids.map((x) => bySleeper.get(x)).filter(Boolean), ...picks] };
          });
          clear(out).append(h('p.small', {}, 'Which team is yours?'), h('div.stack', {}, teamsOf.map(({ r, label, ids, picks, cids }) => h('button.btn', { style: { justifyContent: 'space-between', width: '100%' }, onclick: () => {
            const meta = { source: 'sleeper', sleeper_league: id, sleeper_roster_id: r.roster_id, team_name: label };
            // The other teams first (no re-render yet): saved as opponents for the trade finder, updated if saved before.
            const others = withOthers.checked ? upsertOpponents(teamsOf.filter((x) => x.r.roster_id !== r.roster_id).map((x) => ({ name: x.label, ids: x.cids, source: 'sleeper', sleeper_league: id, sleeper_roster_id: x.r.roster_id, team_name: x.label })), profile) : null;
            // My team: the same Sleeper team saved before is refreshed in place; otherwise a new team or the current one.
            const same = teamsFor(profile).find((t) => t.sleeper_league === id && t.sleeper_roster_id === r.roster_id);
            if (same) { updateTeam(same.id, { ...meta, ids: cids }); setActiveTeam(same.id, profile); }
            else if (asNew.checked || !activeTeam(profile)) createTeam({ name: label, ...meta, ids: cids }, profile);
            else setIds(cids, meta);
            roster = myRoster(profile);
            close();
            const nPlayers = cids.length - picks.length;
            toast(`${same ? 'Refreshed' : 'Imported'} ${nPlayers} of ${ids.length} players${picks.length ? ` and ${picks.length} draft pick${picks.length === 1 ? '' : 's'}` : ''} from "${label}".${others ? ` Other teams: ${others.added} saved, ${others.updated} refreshed.` : ''}${nPlayers < ids.length ? ' Unmatched players are not in the current player database.' : ''}${picksBy.note ? ` ${picksBy.note}` : ''}`, nPlayers < ids.length || picksBy.note ? 'warn' : 'ok', 9000);
          } }, h('span.bold', {}, label), h('span.small.muted', {}, `${ids.length} players${picks.length ? ` · ${picks.length} picks` : ''}`)))));
        } catch (e) {
          clear(out).append(h('p.small', {}, `Could not load the league: ${e.message}. Check the ID and your internet connection.`));
        }
      };
      return h('div.modal-body', {},
        h('div.flex-between', {}, h('h3', { style: { margin: 0 } }, 'Import your roster from Sleeper'), h('button.btn.btn-sm', { onclick: close, 'aria-label': 'Close' }, '×')),
        h('p.small.muted', {}, 'Reads the league\'s public team list from Sleeper (no login). Dynasty and keeper leagues: each team\'s rookie draft picks come along (traded picks included; exact slots once Sleeper has the draft order).'),
        h('div.flex', { style: { flexWrap: 'nowrap' } }, lid, h('button.btn.btn-primary', { onclick: loadTeams }, 'Load teams')),
        cur ? h('label.small.mt-s', { style: { display: 'block' } }, asNew, ` Save as a new team (otherwise "${cur.name}" is replaced; a team imported from the same Sleeper team before is always refreshed)`) : null,
        h('label.small.mt-s', { style: { display: 'block' } }, withOthers, ' Also save the other teams of this league (the trade finder then checks what an offer does to their lineup)'), out);
    });
  }

  draw();
}
