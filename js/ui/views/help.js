// HELP — plain-language guide for people who just want to evaluate a trade.

import { h } from '../dom.js';

export function welcomeCard(onDismiss) {
  return h('section.panel.welcome', { 'aria-label': 'Welcome' },
    h('div.flex-between', {}, h('h2', { style: { margin: 0 } }, '👋 Welcome! Evaluate a trade in 3 steps'), h('button.btn.btn-sm', { onclick: onDismiss }, 'Got it — hide this')),
    h('ol.welcome-steps', {},
      h('li', {}, h('strong', {}, 'Pick your league type '), 'with the big ', h('strong', {}, 'REDRAFT / DYNASTY'), ' switch at the top. Redraft = this season only. Dynasty = you keep players for years.'),
      h('li', {}, h('strong', {}, 'Pick your league settings '), 'in the drop-down at the top (e.g. "12 Team — 1QB — PPR"). Not sure? Leave the default. You can match your exact league later in ', h('a', { href: '#/settings' }, 'Settings'), '.'),
      h('li', {}, h('strong', {}, 'Type player names '), 'under ', h('strong', {}, 'Team A receives'), ' and ', h('strong', {}, 'Team B receives'), '. The verdict and the reasons appear underneath. Click any player\'s name to see why they have that value.')),
    h('p.small.muted', {}, 'Data refreshes automatically when you start the app; you can also press the green ', h('strong', {}, 'Sync All'), ' button. More help: ', h('a', { href: '#/help' }, 'Help page'), '.'));
}

const QA = [
  ['How do I start the app next time?', 'Double-click the same "Start Trade Analyzer" file you used the first time. A small black window opens — keep it open while you use the app (closing it stops the app). Your browser opens the app automatically.'],
  ['Does it work without internet?', 'Yes. The app keeps the last downloaded data on your computer. Without internet you just can\'t refresh it.'],
  ['What do the numbers mean?', 'Every player and draft pick gets a trade value on the same scale (about 10,000 for the very best asset). Add up each side to compare. Small differences don\'t matter — the "± number" under each value shows how uncertain it is.'],
  ['What does "Interpretation" mean?', '"Close" means the difference is smaller than the model\'s uncertainty — the trade is roughly fair. "Leans" means one side gets somewhat more. "Clearly" means a big gap. It never says "good" or "bad" by itself: your team\'s needs matter too.'],
  ['Why is my 3-for-1 trade worth less than the sum?', 'You can only start so many players. Extra players you receive mostly sit on your bench, so the app charges a "package adjustment" for them. The trade screen shows the exact math.'],
  ['How do I add draft picks? (Dynasty)', 'Type "2027 1st" or "1.04" in the search box, or use the "Add pick" drop-downs (year, round, slot). If you don\'t know where the pick will land, choose "Slot unknown" or Early/Mid/Late.'],
  ['How do I set up MY league?', 'Settings → League / Scoring / Roster. Change anything; your changes are saved automatically as your own profile. If you play on Sleeper, click "Import from Sleeper league" and paste your league ID (the long number in your league\'s web address).'],
  ['Where do the values come from?', 'From many free sources combined: expert rankings, projections, real trade data, draft position and actual stats. Click a player → "Why this value?" to see every part. The Data tab shows each source\'s status.'],
  ['A source shows a red ✕ — is something broken?', 'Usually a website was temporarily unavailable. The app keeps using that source\'s last good data and everything still works. Press Sync All later to retry.'],
  ['Can I use KeepTradeCut values?', 'Yes, but by hand (their rules forbid automatic downloading): Data → Manual Import → "KeepTradeCut Values" has step-by-step instructions.'],
  ['How do I get a newer version?', 'Download the latest ZIP from the project\'s GitHub "Releases" page and unzip it. Your saved league settings stay in your browser.'],
];

export function renderHelp(root) {
  root.append(
    h('div.panel', {},
      h('h2', {}, 'Help'),
      h('p', {}, 'This app tells you how much each player and draft pick is worth in YOUR league and whether a trade is fair — and explains why.'),
      h('h3.mt', {}, 'The basics'),
      welcomeCard(null).querySelector('ol').cloneNode(true)),
    h('div.panel', {}, h('h2', {}, 'Common questions'),
      QA.map(([q, a]) => h('details.qa', {}, h('summary', {}, q), h('p', {}, a)))),
    h('div.panel', {}, h('h2', {}, 'Where to find things'),
      h('ul', {},
        h('li', {}, h('a', { href: '#/trade' }, 'Trade'), ' — build and compare a trade.'),
        h('li', {}, h('a', { href: '#/players' }, 'Players'), ' — every player\'s value; click column titles to sort, use the filters to narrow down.'),
        h('li', {}, h('a', { href: '#/compare' }, 'Compare'), ' — put several players side by side.'),
        h('li', {}, 'Rookies & Picks (Dynasty only) — rookie values and draft-pick values.'),
        h('li', {}, h('a', { href: '#/data' }, 'Data'), ' — refresh data, see which sources worked, import files.'),
        h('li', {}, h('a', { href: '#/settings' }, 'Settings'), ' — your league\'s teams, scoring and roster.'),
        h('li', {}, h('a', { href: '#/model' }, 'Model'), ' — how the math works (for the curious).'))));
}
