// TRADE FINDER (My Team) — "I want this player or pick: what could I offer?" Search a target; the finder lists a few
// packages from the active team that the model calls fair for both sides and that improve this team most
// (js/core/trade-finder.js; evidence in docs/MODEL_AUDIT.md §22, audit E14). When the owner's roster is saved (e.g. every
// team of a Sleeper league), what each package does to THEIR lineup counts too.

import { h, clear, fmtValue, fmt1, fmtSigned, posBadge, toast } from '../dom.js';
import { app, load, save, isPlainObject, isStringArray, opponentsFor, updateTeam, playerData } from '../state.js';
import { findTradePackages, FINDER_DEFAULTS, FAIRNESS } from '../../core/trade-finder.js';
import { rosterImpact } from '../../core/roster.js';
import { assetSearchBox } from '../search.js';
import { openPlayer, openPickDetail } from './player-modal.js';

const pctText = (p) => `${Math.abs(p * 100).toFixed(1)}%`;
/** The fairness preset chosen on My Team (shared with the Trade page). */
export const finderFairness = () => { const k = load('finder.fairness', 'strict', (v) => typeof v === 'string' && v in FAIRNESS); return { key: k, ...FAIRNESS[k] }; };

/**
 * @param result   current-mode valuations
 * @param profile  active league profile
 * @param team     the active saved team (with ids, keep)
 * @param expected expectation inputs (redraft) or null
 * @param onChange called after "never offer" changes (the view redraws)
 */
export function finderPanel({ result, profile, team, expected, onChange }) {
  const KEY = `finder.target.${app.mode}.${team.id}`;
  const panel = h('section.panel.mt.finder', { 'aria-label': 'Trade finder' });
  const out = h('div');
  const keep = isStringArray(team.keep) ? team.keep : [];
  let targetId = load(KEY, null, (v) => typeof v === 'string');
  if (targetId && (team.ids.includes(targetId) || !result.getAsset(targetId))) targetId = null;
  const opponents = opponentsFor(profile);
  const ownerKey = `finder.owner.${team.id}`;
  const fairSel = h('select', { 'aria-label': 'Fairness to the other team', onchange: (e) => { save('finder.fairness', e.target.value); draw(); } },
    Object.entries(FAIRNESS).map(([k, f]) => h('option', { value: k }, f.label)));
  fairSel.value = finderFairness().key;

  panel.append(h('div.panel-head', {}, h('h3', {}, 'Trade finder: what could I offer?')),
    h('p.small.muted', {}, 'Search a player', app.mode === 'dynasty' ? ' or pick' : '', ' you want. The finder suggests packages from this team that the model calls ',
      h('strong', {}, 'fair for both sides'), ` (see "Fairness"; you never pay more than ${FINDER_DEFAULTS.maxOverpay * 100}% extra) and that `,
      h('strong', {}, app.mode === 'dynasty' ? 'raise the value of your starting lineup' : 'raise your expected lineup points per week'),
      ' the most — a few different options, never padded with throw-ins. Value math, not a prediction of what the other manager accepts.'),
    h('label.small.no-print', {}, 'Fairness to the other team ', fairSel),
    assetSearchBox({
      getResult: () => result,
      includePicks: app.mode === 'dynasty',
      taken: () => new Map(team.ids.filter((id) => !/^pick:\d{4}:\d+(?::(?:early|mid|late))?$/.test(id)).map((id) => [id, 'your roster'])),
      placeholder: app.mode === 'dynasty' ? 'Player or pick you want (e.g. "lamb", "2027 1st")' : 'Player you want (e.g. "lamb", "det wr")',
      onPick: (a) => { if (team.ids.includes(a.id)) { toast(`${a.name} is already on your team.`, 'warn'); return; } targetId = a.id; save(KEY, a.id); draw(); },
    }),
    out);

  function draw() {
    clear(out);
    if (!targetId) { out.append(h('p.small.muted.mt-s', {}, 'No target yet. Tip: "Find packages" in the trade targets below fills this in.')); return; }
    const target = result.getAsset(targetId);
    // Owner: a saved team of this league that rosters the target (auto), or the one chosen, or unknown.
    const holders = opponents.filter((t) => t.ids.includes(targetId));
    const chosen = load(ownerKey, '', (v) => typeof v === 'string');
    const owner = holders.length === 1 ? holders[0] : opponents.find((t) => t.id === chosen && t.ids.includes(targetId)) || null;
    const t0 = performance.now();
    const fair = finderFairness();
    fairSel.value = fair.key;
    const res = findTradePackages(result, team.ids, targetId, { expected, keep, theirs: owner ? owner.ids : null, maxEdge: fair.maxEdge });
    const ms = Math.round(performance.now() - t0);
    const tp = playerData(targetId);
    out.append(h('div.finder-target.mt-s', {},
      posBadge(target.position), ' ', h('button.linklike.bold', { type: 'button', onclick: () => (target.kind === 'player' ? openPlayer(target.id) : openPickDetail(target.id)) }, target.name),
      h('span.muted', {}, ` ${target.kind === 'player' ? `${target.team || 'FA'} · ${target.position}${target.posRank || ''} · ` : ''}value ${fmtValue(target.value)}`),
      ' ', h('button.btn.btn-xs', { 'aria-label': 'Clear the target', onclick: () => { targetId = null; save(KEY, null); draw(); } }, '×'),
      // Owner: found on exactly one saved roster of this league → shown; on several (stale imports) → choose; else unknown.
      holders.length > 1
        ? h('label.small.muted', { style: { marginLeft: '1rem' } }, 'Owner ',
          h('select', { 'aria-label': 'Which team owns the target', onchange: (e) => { save(ownerKey, e.target.value); draw(); } },
            h('option', { value: '' }, 'Unknown (their lineup not counted)'),
            holders.map((o) => h('option', { value: o.id, selected: owner && owner.id === o.id ? true : null }, o.name))))
        : h('span.small.muted', { style: { marginLeft: '1rem' } }, owner ? `Owner: ${owner.name} (saved roster)` : opponents.length ? 'Owner: not on a saved roster of this league — their lineup is not counted' : ''),
      tp?.team === 'FA' ? h('div.small.muted', {}, 'Not on an NFL roster — usually a waiver pickup rather than a trade.') : null));
    if (!res.ok) { out.append(h('p.small.mt-s', {}, res.reason)); return; }
    const unit = res.metric === 'expected' ? 'pts/wk' : 'lineup value';
    const fmtGain = (v) => (res.metric === 'expected' ? `${v >= 0 ? '+' : '−'}${fmt1(Math.abs(v))} pts/wk` : `${fmtSigned(v)} lineup value`);
    const list = res.options.length ? res.options : res.alternatives;
    if (!res.options.length) {
      // Would a looser fairness setting find something? Say so (the user decides how fair to be).
      const looser = Object.entries(FAIRNESS).filter(([, f]) => f.maxEdge > fair.maxEdge)
        .map(([k, f]) => [k, f, findTradePackages(result, team.ids, targetId, { expected, keep, theirs: owner ? owner.ids : null, maxEdge: f.maxEdge }).options.length]).find(([, , n]) => n > 0);
      out.append(h('div.banner-inline.mt-s', {}, h('strong', {}, 'No package from this team is both fair and an improvement. '),
        looser ? [`With fairness "${looser[1].label.split(' — ')[0]}" the finder finds ${looser[2]} — `, h('button.btn.btn-xs', { onclick: () => { save('finder.fairness', looser[0]); draw(); } }, 'Use it'), ' (you would receive a little more value than you give). '] : null,
        res.alternatives.length
          ? `The fair packages that cost your ${app.mode === 'dynasty' ? 'lineup value' : 'expected lineup'} the least are shown instead — ${target.name} probably duplicates what you already start.`
          : 'Nothing on this team adds up to a fair offer (too little value, or the pieces are marked "never offer").'));
    }
    if (owner) out.append(h('p.small.muted.mt-s', {}, `${owner.name}'s roster is saved, so the options are ranked by what they do for both teams (yours + theirs) — in historical league simulations that left the other team about 6 season points better off at no measurable cost to yours.`));
    if (!list.length) return;
    const cards = h('div.finder-options.mt-s');
    list.forEach((op, i) => {
      const impact = rosterImpact(result, team.ids, op.ids, [targetId], { expected });
      const favoured = op.pct > 0.0005 ? 'you' : op.pct < -0.0005 ? 'them' : null;
      cards.append(h('div.finder-option', { class: res.options.length ? '' : 'alt' },
        h('div.flex-between', {},
          h('strong', {}, `${res.options.length ? 'Option' : 'Fair, no gain'} ${i + 1}`),
          h('span.finder-gain', { class: op.gain > 0 ? 'good' : 'bad', title: res.metric === 'expected' ? 'Change in your expected lineup points per week (missed games and your bench as cover)' : 'Change in the value of your best starting lineup' }, fmtGain(op.gain))),
        h('div.small', {}, 'You give: ', op.give.map((g, k) => [k ? ' + ' : '', posBadge(g.position), ' ', h('button.linklike', { type: 'button', onclick: () => (g.kind === 'player' ? openPlayer(g.id) : openPickDetail(g.id)) }, g.name), h('span.muted', {}, ` ${fmtValue(g.value)}`)])),
        h('div.small.muted', {}, `Value: you get ${fmtValue(op.mine)} · they get ${fmtValue(op.theirs)} (after the package adjustment) — `,
          favoured ? `${favoured === 'you' ? 'you' : 'they'} receive ${pctText(op.pct)} more` : 'even', '; the model calls it close.',
          op.give.reduce((t, g) => t + g.value, 0) - op.theirs > 1 ? ` (${fmtValue(op.give.reduce((t, g) => t + g.value, 0))} before it: their extra players take roster spots and push someone out of their lineup.)` : ''),
        h('div.small.muted', {},
          res.metric === 'expected' ? `Your lineup value ${fmtSigned(op.lineupValueGain)}` : (op.expectedGain !== null && op.expectedGain !== undefined ? `Expected lineup ${op.expectedGain >= 0 ? '+' : '−'}${fmt1(Math.abs(op.expectedGain))} pts/wk this season` : ''),
          impact.startersIn.length || impact.startersOut.length ? ` · Into your lineup: ${impact.startersIn.map((a) => a.name).join(', ') || '—'}; out: ${impact.startersOut.map((a) => a.name).join(', ') || '—'}` : ' · your starting lineup is unchanged'),
        op.theirGain !== undefined ? h('div.small', {}, `${owner.name}: `, h('span', { class: op.theirGain >= 0 ? 'good' : 'bad' }, fmtGain(op.theirGain)), op.theirGain >= 0 ? ' — their lineup improves too' : ' — costs their lineup') : null,
        h('div.flex.mt-s.no-print', {},
          h('button.btn.btn-sm.btn-primary', { onclick: () => openInTrade(op) }, 'Open in Trade'),
          op.give.map((g) => h('button.btn.btn-xs', { title: `Never offer ${g.name} (this team)`, onclick: () => setKeep([...keep, g.id]) }, `Keep ${g.name.split(' ').slice(-1)[0]}`)))));
    });
    out.append(cards,
      keep.length ? h('p.small.mt-s.finder-keep', {}, 'Never offered: ', keep.map((id) => h('span.chip', {}, result.getAsset(id)?.name || id, ' ', h('button.linklike', { 'aria-label': `Allow offering ${result.getAsset(id)?.name || id} again`, onclick: () => setKeep(keep.filter((x) => x !== id)) }, '×'))), ' ') : null,
      h('p.tiny.muted.mt-s', {}, app.mode === 'dynasty'
        ? 'Dynasty: ranked by the value of your starting lineup. Consolidation offers like these give the other team more depth but a weaker lineup now — save their roster (Sleeper import) to rank for both teams. Not yet tested against real multi-season outcomes.'
        : 'Evidence (audit E14, historical league simulations 2021–2025): the top suggestion helped the team making it by about 6–7 points over a season on average — roughly 40% of the predicted gain, with a lot of luck trade to trade — and beat a random fair offer by 11–13 points without hurting the other team; with their roster saved, ranking for both teams left them about 6 points better off.'),
      h('p.tiny.muted.mt-s', {}, `${res.stats.packages.toLocaleString()} packages of up to ${FINDER_DEFAULTS.maxAssets} assets from your ${res.stats.pool} most valuable pieces checked in ${ms} ms; ${res.stats.fair} fair without throw-ins, ${res.stats.improving} improve this team (${unit}). Each of your assets appears in at most ${FINDER_DEFAULTS.maxUses} options.`));
  }

  function setKeep(ids) { updateTeam(team.id, { keep: [...new Set(ids)] }); onChange(); }

  function openInTrade(op) {
    const key = `trade.${app.mode}`;
    const cur = load(key, { a: [], b: [] }, (x) => isPlainObject(x) && isStringArray(x.a) && isStringArray(x.b));
    if ((cur.a.length || cur.b.length) && !confirm('Replace the trade you are building with this package?')) return;
    save(key, { a: [targetId], b: [...op.ids], me: 'a' });
    location.hash = '#/trade';
  }

  /** Called from outside (trade targets "Find packages"). */
  panel.setTarget = (id) => { targetId = id; save(KEY, id); draw(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  draw();
  return panel;
}
