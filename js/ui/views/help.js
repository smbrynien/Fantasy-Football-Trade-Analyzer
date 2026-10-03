// HELP — plain-language guide for people who just want to evaluate a trade.

import { h, toast } from '../dom.js';
import { save } from '../state.js';

export function welcomeCard(onDismiss) {
  // Short on purpose: on a phone the old card was ~510 px tall and pushed the trade builder below the fold.
  return h('section.panel.welcome', { 'aria-label': 'Welcome' },
    h('div.flex-between', {}, h('h2', { style: { margin: 0, fontSize: '1.1rem' } }, '👋 Evaluate a trade in 3 steps'), onDismiss ? h('button.btn.btn-sm', { onclick: onDismiss }, 'Got it — hide') : null),
    h('ol.welcome-steps', {},
      h('li', {}, h('strong', {}, 'Redraft or Dynasty: '), 'the switch at the top. Redraft = this season only; dynasty = players kept for years.'),
      h('li', {}, h('strong', {}, 'Your league: '), 'pick the closest preset in the drop-down at the top, or match your league exactly in ', h('a', { href: '#/settings' }, 'Settings'), ' (Sleeper import available).'),
      h('li', {}, h('strong', {}, 'Add players '), 'to each side. The verdict appears below; click a name to see why it has that value.')),
    h('p.tiny.muted', {}, 'Data refreshes automatically when the app starts. More: ', h('a', { href: '#/help' }, 'Help'), '.'));
}

const QA = [
  ['How do I start the app next time?', 'Double-click the same "Start Trade Analyzer" file you used the first time. A small black window opens — keep it open while you use the app (closing it stops the app). Your browser opens the app automatically.'],
  ['Does it work without internet?', 'Yes. The app keeps the last downloaded data on your computer. Without internet you just can\'t refresh it.'],
  ['What do the numbers mean?', 'Every player and draft pick gets a trade value on the same scale (about 10,000 for the very best asset). Add up each side to compare. Small differences don\'t matter — the "± number" under each value shows how much the sources disagree about it. That is the uncertainty of the estimate, not of the season: real outcomes spread much wider (a player\'s page shows the range players with similar projections actually finished in).'],
  ['What does the verdict mean?', 'In redraft the verdict follows how often trades with the same value margin worked out in leagues replayed on real 2020–2025 seasons: "Close — roughly fair" when the side getting more came out ahead less than 60% of the time (margins up to about a quarter), "Leans Team X" for 60–70%, "Team X clearly ahead" for 70% or more (about half again as much value). In dynasty, where seasons long enough to check don\'t exist, it compares the gap with the model\'s ± uncertainty. "Market check" says whether trade-market values alone point the same way. It never says "good" or "bad" by itself: your team\'s needs matter too.'],
  ['What does "went Team B\'s way about 60% of the time" mean?', 'In redraft, under the verdict: we simulated thousands of trades in leagues replayed on real 2020–2025 weekly scores, and this is how often a trade with the same value margin left the side receiving more value with more lineup points by season\'s end. Even a "clearly ahead" trade went the other way about 3 times in 10 — injuries and breakouts decide a lot. Use it as a sense of how much luck is involved, not as a forecast for this trade. It is not shown in dynasty (no data long enough to check it).'],
  ['The trade is lopsided — how do I fix it?', 'Under the verdict, "Even it out" lists players (and in dynasty, draft picks) that would bring the trade closest to even if the side that gets less also received them. Click one to add it. It already accounts for the package adjustment. With only one side filled in, the same box shows "Value matches": single assets worth about the same. Open "Two assets together" for pairs that do the same job — a player plus a pick, two picks ("two 2027 1sts") or two players. These are value comparisons, not predictions of what a league-mate will accept.'],
  ['How do I compare counteroffers?', 'Click "+ Compare" on the trade analysis to keep the current version as the original. Change the trade (or use Even it out), then "+ Compare" again for each counteroffer. "Compare counteroffers" below the analysis lists every version side by side with its verdict, who gets more and — with My Team — the change to your starting lineup; added assets are marked "+" and removed ones struck through. "Load" puts a version back into the builder; click a name to rename it. Up to 8 versions per mode, kept in this browser.'],
  ['What is "My Team" and do I need it?', 'Optional. Add your roster (search, paste a list from any site, or import your Sleeper team) and set "Which side is you?" on the Trade page. The trade then shows your starting lineup before and after (lineup value, and expected lineup points per week — counting how often players miss games and your bench filling in), who moves in or out of your lineup, and depth changes, plus how often teams whose expected lineup changed that much actually gained over a season in historical simulations; "Even it out" suggests assets from your own roster when you are the one who should add. Everything else works without it.'],
  ['How do I share a trade?', 'Trade analysis → Share: "Copy summary" gives plain text for your league chat; "Copy link" gives a link that re-opens the same trade in this app; you can also download CSV/JSON or print.'],
  ['Why is my 3-for-1 trade worth less than the sum?', 'You can only start so many players. Extra players you receive mostly sit on your bench, so the app charges a "package adjustment" for them. The trade screen shows the exact math.'],
  ['Can I use it on my phone?', 'The app runs on your computer, so your phone has to reach that computer over your home Wi-Fi. Start it from a terminal with HOST=0.0.0.0 npm start, then open http://<your computer\'s address>:5177 on the phone (the start window prints the address). Only do this on a network you trust: anyone on it could open the app, run syncs and change settings. Without that, "Share → Copy text" sends a readable summary of any trade to your phone or league chat. Keyboard tip on a computer: press / to jump to the search box.'],
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
      welcomeCard(null).querySelector('ol').cloneNode(true),
      h('button.btn.btn-sm', { style: { whiteSpace: 'normal' }, onclick: () => { save('welcomeDismissed', false); toast('The welcome tips will show on the Trade page again.'); } }, 'Show the welcome tips on the Trade page again')),
    h('div.panel', {}, h('h2', {}, 'Common questions'),
      QA.map(([q, a]) => h('details.qa', {}, h('summary', {}, q), h('p', {}, a)))),
    h('div.panel', {}, h('h2', {}, 'Where to find things'),
      h('ul', {},
        h('li', {}, h('a', { href: '#/trade' }, 'Trade'), ' — build and compare a trade.'),
        h('li', {}, h('a', { href: '#/team' }, 'My Team'), ' — optional: your roster, so trades show how your starting lineup changes.'),
        h('li', {}, h('a', { href: '#/players' }, 'Players'), ' — every player\'s value; click column titles to sort, use the filters to narrow down.'),
        h('li', {}, h('a', { href: '#/compare' }, 'Compare'), ' — put several players side by side.'),
        h('li', {}, 'Rookies & Picks (Dynasty only) — rookie values and draft-pick values.'),
        h('li', {}, h('a', { href: '#/data' }, 'Data'), ' — refresh data, see which sources worked, import files.'),
        h('li', {}, h('a', { href: '#/settings' }, 'Settings'), ' — your league\'s teams, scoring and roster.'),
        h('li', {}, h('a', { href: '#/model' }, 'Model'), ' — how the math works (for the curious).'))));
}
