// Trade finder — "I want Player X: what could I offer?" From MY roster, the packages of 1–3 assets that the model
// calls fair for BOTH sides and that improve my team the most, a few diverse options rather than one.
//
//   fair      analyzeTrade (exact package adjustment) calls the trade close ("even"), and my value edge stays inside
//             [−maxOverpay, +maxEdge]: I may pay a little more than the target is worth, never take much more.
//   minimal   no throw-ins: if a smaller part of the package is already enough for the other side, the bigger one only
//             overpays (giving more away can never improve my lineup) and is dropped.
//   improves  redraft: expected lineup points per week after − before (audit E12's best predictor of trade outcomes);
//             dynasty: value of my best starting lineup after − before (dynasty values price future seasons).
//   diverse   each of my assets appears in at most `maxUses` of the options shown.
//
// Read-only: uses the existing values and analyzeTrade; nothing here changes a value. It cannot know the other
// team's roster or willingness — "fair" is the model's value balance, not a prediction that they accept.

import { analyzeTrade } from './valuation/trade.js';
import { getAsset } from './valuation/engine.js';
import { bestLineup, expectedLineupPoints } from './roster.js';

export const FINDER_DEFAULTS = Object.freeze({
  maxAssets: 3,      // largest package from my roster
  limit: 5,          // options returned
  maxEdge: 0.05,     // I may receive at most 5% more value than I give (fair to them)
  maxOverpay: 0.15,  // I may give at most 15% more value than I receive (fair to me)
  minGain: 0.1,      // redraft: at least +0.1 expected lineup points per week
  minLineupGain: 1,  // dynasty: lineup value must rise
  maxUses: 2,        // diversity: one of my assets in at most 2 options
  maxCandidates: 30, // my most valuable assets considered (a roster beyond that adds only tiny pieces)
  rank: 'auto',      // 'auto' (redraft: expected points, dynasty: lineup value) | 'expected' | 'lineupValue' | 'even'
  minimal: true,     // drop packages with a throw-in (audit E14 compares false)
  includeAll: false, // also return every fair package (audits)
  theirMinGain: null, // with their roster: drop packages that cost THEIR expected lineup more than this (pts/week)
  sizePenalty: 0,    // ranking: pts/week (dynasty: value) subtracted per asset beyond the first (audit E14 tests > 0)
  // With their roster: 'sum' ranks by my + their gain (E14: +6.5 / +5.9 season points for them on two seeds, my change
  // +0.2 / −1.6, not significant); 'mine' ignores them; 'min' ranks by the smaller gain (cost me 4.6 on one seed).
  mutualRank: 'sum',
});

/** Fairness presets for the UI (E14: 'strict' is the default; 'balanced' and 'close' let me take a little more value). */
// E14 (two seeds): balanced was about neutral for the other team; "close" cost them ~7 season points vs strict.
export const FAIRNESS = Object.freeze({
  strict: { label: 'Strict — you receive at most 5% more value', maxEdge: 0.05 },
  balanced: { label: 'Balanced — at most 10% more', maxEdge: 0.10 },
  close: { label: 'Model\'s "close" — anything the verdict calls close (costs the other team more)', maxEdge: 1 },
});

const brief = (a) => ({ id: a.id, name: a.name, kind: a.kind, position: a.position, team: a.team || null, value: a.value, age: a.age ?? null });

/** All index combinations of size 1..k of n items (my roster as a multiset: two identical generic picks are two items). */
function* combinations(n, k) {
  const idx = [];
  function* rec(start) {
    if (idx.length) yield [...idx];
    if (idx.length === k) return;
    for (let i = start; i < n; i++) { idx.push(i); yield* rec(i + 1); idx.pop(); }
  }
  yield* rec(0);
}

/**
 * @param result    computeValuations() output (current mode)
 * @param rosterIds my roster (asset ids; duplicates allowed for generic picks)
 * @param targetId  the asset I want (a player or pick not on my roster)
 * @param expected  expectationInputs(redraft valuations) — required for the redraft gain; optional in dynasty
 * @param keep      asset ids never offered
 * @returns {{ ok, reason?, target, mode, metric, base, options: [...], alternatives: [...], stats }}
 */
export function findTradePackages(result, rosterIds, targetId, { expected = null, keep = [], theirs = null, ...opts } = {}) {
  const o = { ...FINDER_DEFAULTS, ...opts };
  const target = getAsset(result, targetId);
  const fail = (reason) => ({ ok: false, reason, target: target ? brief(target) : null, options: [], alternatives: [], stats: null });
  if (!target || !(target.value > 0)) return fail('The asset you want has no value in this mode with the current data.');
  if (rosterIds.includes(targetId)) return fail(`${target.name} is already on your roster.`);
  const redraft = result.mode !== 'dynasty';
  if (redraft && !expected) return fail('Expected lineup points need redraft projections, which are not in the current data.');
  const league = result.league;
  const mine = rosterIds.map((id) => getAsset(result, id)).filter(Boolean);
  if (!mine.some((a) => a.kind === 'player')) return fail('Add your players to this team first.');

  // Candidate assets to give: valued, not protected, most valuable first (multiset — keep duplicates of generic picks).
  const keepSet = new Set(keep);
  const pool = mine.filter((a) => a.value > 0 && !keepSet.has(a.id)).sort((x, y) => y.value - x.value || String(x.id).localeCompare(String(y.id))).slice(0, o.maxCandidates);
  if (!pool.length) return fail('Every asset on this team is marked "never offer".');

  // My team before; "after" = without the package, with the target.
  const without = (give) => { const out = [...mine]; for (const g of give) { const i = out.indexOf(g); if (i >= 0) out.splice(i, 1); } return out; };
  const lineupValue = (xs) => bestLineup(xs, league).starters.reduce((s, a) => s + a.value, 0);
  const pts = (xs) => (expected ? expectedLineupPoints(xs, league, expected) : null);
  const base = { expected: pts(mine), lineupValue: lineupValue(mine) };

  // Score every package once (exact analyzeTrade: I am side A and receive the target; they receive the package).
  const seen = new Map(); // sorted id key → evaluation
  const keyOf = (ids) => [...ids].sort().join('|');
  let evaluated = 0;
  const evaluate = (give) => {
    const ids = give.map((a) => a.id);
    const key = keyOf(ids);
    if (seen.has(key)) return seen.get(key);
    const ana = analyzeTrade(result, [target.id], ids);
    evaluated++;
    const ev = { key, give, ids, pct: ana.pct, level: ana.assessment.level, mine: ana.sides[0].adjusted, theirs: ana.sides[1].adjusted, outcome: ana.outcome };
    // "Enough" for the other side — the package alone would already be acceptable to them: they receive at least as
    // much value, or I receive a little more but within maxEdge and the verdict still calls it close. (Testing only
    // the band made every superset of any single asset a "throw-in" once the band was wide — audit E14 current data.)
    ev.enough = ev.pct <= 0 || (ev.pct <= o.maxEdge && ev.level === 'even');
    ev.fair = ev.enough && ev.pct >= -o.maxOverpay && ev.level === 'even';
    seen.set(key, ev);
    return ev;
  };
  const evals = [];
  // Two identical generic picks make some packages appear twice (pick #1 or pick #2): score and keep each once.
  for (const idx of combinations(pool.length, o.maxAssets)) {
    const give = idx.map((i) => pool[i]);
    const fresh = !seen.has(keyOf(give.map((a) => a.id)));
    const ev = evaluate(give);
    if (fresh) evals.push(ev);
  }

  // Minimal: no proper subset is already enough (so nothing in the package is a throw-in).
  const subsetsEnough = (ev) => {
    if (ev.give.length < 2) return false;
    for (const idx of combinations(ev.give.length, ev.give.length - 1)) {
      if (idx.length === ev.give.length) continue;
      const sub = seen.get(keyOf(idx.map((i) => ev.ids[i])));
      if (sub && sub.enough) return true;
    }
    return false;
  };
  const fair = evals.filter((ev) => ev.fair && (!o.minimal || !subsetsEnough(ev)));

  // Improvement of MY team for each fair package — and, when the owner's roster is known (`theirs`), of THEIRS.
  const them = theirs ? theirs.map((id) => getAsset(result, id)).filter(Boolean) : null;
  const themBase = them ? { expected: pts(them), lineupValue: lineupValue(them) } : null;
  for (const ev of fair) {
    const after = [...without(ev.give), target];
    ev.lineupValueGain = lineupValue(after) - base.lineupValue;
    ev.expectedGain = expected ? pts(after) - base.expected : null;
    ev.gain = redraft ? ev.expectedGain : ev.lineupValueGain;
    if (them) {
      // They receive more players than they send: they must drop down to their roster size (lowest values go, as the
      // E6/E14 simulation does) — counting the extra bench players as free injury cover overstated their gain.
      const sent = [...them]; const i = sent.findIndex((a) => a.id === target.id); if (i >= 0) sent.splice(i, 1);
      let theirAfter = [...sent, ...ev.give];
      if (theirAfter.length > them.length) theirAfter = [...theirAfter].sort((x, y) => y.value - x.value || String(x.id).localeCompare(String(y.id))).slice(0, them.length);
      ev.theirExpectedGain = expected ? pts(theirAfter) - themBase.expected : null;
      ev.theirLineupValueGain = lineupValue(theirAfter) - themBase.lineupValue;
      ev.theirGain = redraft ? ev.theirExpectedGain : ev.theirLineupValueGain;
    }
  }
  // 'even' ranks by how balanced the value is (a value-only baseline for the audit), the others by my team's gain.
  const metric = o.rank === 'auto' ? (redraft ? 'expected' : 'lineupValue') : o.rank;
  for (const ev of fair) {
    ev.rankKey = metric === 'even' ? -Math.abs(ev.pct) : metric === 'expected' ? (ev.expectedGain ?? -Infinity) : ev.lineupValueGain;
    if (them && metric !== 'even' && o.mutualRank !== 'mine') ev.rankKey = o.mutualRank === 'sum' ? ev.gain + ev.theirGain : Math.min(ev.gain, ev.theirGain);
    if (metric !== 'even' && o.sizePenalty) ev.rankKey -= o.sizePenalty * (ev.give.length - 1);
  }
  const better = (x, y) => y.rankKey - x.rankKey || y.gain - x.gain || x.give.length - y.give.length || Math.abs(x.pct) - Math.abs(y.pct) || x.key.localeCompare(y.key);
  fair.sort(better);
  const improving = fair.filter((ev) => (redraft ? ev.gain >= o.minGain : ev.gain >= o.minLineupGain)
    && (!them || o.theirMinGain === null || ev.theirGain >= o.theirMinGain));

  // Diverse selection: each of my assets in at most maxUses options.
  const pick = (list, n) => {
    const uses = new Map();
    const out = [];
    for (const ev of list) {
      if (out.length >= n) break;
      if (ev.ids.some((id) => (uses.get(id) || 0) >= o.maxUses)) continue;
      for (const id of new Set(ev.ids)) uses.set(id, (uses.get(id) || 0) + 1);
      out.push(ev);
    }
    return out;
  };
  const shape = (ev) => ({
    give: ev.give.map(brief), ids: ev.ids,
    pct: ev.pct, level: ev.level, mine: ev.mine, theirs: ev.theirs, outcome: ev.outcome,
    expectedGain: ev.expectedGain, lineupValueGain: ev.lineupValueGain, gain: ev.gain,
    ...(them ? { theirExpectedGain: ev.theirExpectedGain, theirLineupValueGain: ev.theirLineupValueGain, theirGain: ev.theirGain } : {}),
  });
  const options = pick(improving, o.limit).map(shape);
  // Nothing both fair and improving: the fair packages that cost my team least, labelled as such by the UI.
  const alternatives = options.length ? [] : pick(fair, Math.min(3, o.limit)).map(shape);
  return {
    ok: true, target: brief(target), mode: result.mode, metric, base, theirBase: themBase, options, alternatives,
    stats: { pool: pool.length, packages: evals.length, evaluated, fair: fair.length, improving: improving.length },
    ...(o.includeAll ? { all: fair.map(shape) } : {}),
  };
}
