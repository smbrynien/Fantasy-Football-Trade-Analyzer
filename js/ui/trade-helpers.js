// Trade-page wording and link helpers (pure functions: no DOM, unit-tested in tests/trade-helpers.test.js).
// They only rephrase analyzeTrade() output; no value is computed here.

import { fmtValue } from './dom.js';

export const NEUTRAL = { A: 'Team A', B: 'Team B', a: 'A', b: 'B' };

/**
 * Side names. With "which side is you?" set, Team A/B become "Your team"/"Their team" (short: You/Them) — the way
 * people think about an offer. `me` is 'a', 'b' or anything else (neutral).
 */
export function sideNames(me) {
  if (me === 'a') return { A: 'Your team', B: 'Their team', a: 'You', b: 'Them' };
  if (me === 'b') return { A: 'Their team', B: 'Your team', a: 'Them', b: 'You' };
  return NEUTRAL;
}

// "Your team" mid-sentence → "your team"; "Team A" stays as is.
export const mid = (name) => (/^Team [AB]$/.test(name) ? name : name[0].toLowerCase() + name.slice(1));

/** Rewrite "Team A"/"Team B" in engine-written text (notes, interpretation) with the side names. */
export function relabel(text, N = NEUTRAL) {
  if (N === NEUTRAL) return text;
  return String(text).replace(/Team ([AB])\b/g, (m, x, i, str) => {
    const name = N[x];
    const before = str.slice(0, i).trimEnd();
    return !before || /[.:!?(]$/.test(before) ? name : mid(name);
  });
}

/** Who receives more, in a few characters: "B +6,160" / "You +6,160" / "even". */
export function leadText(diff, N = NEUTRAL) {
  const r = Math.round(Math.abs(diff) / 10) * 10;
  return r === 0 ? 'even' : `${diff > 0 ? N.a : N.b} +${fmtValue(r)}`;
}

/** Plain-language headline for the verdict (the model's own z-score levels; wording only). */
export function verdictHeadline(ana, N = NEUTRAL) {
  const team = ana.diff > 0 ? N.A : N.B;
  const gap = fmtValue(Math.abs(ana.diff));
  const pct = `${Math.abs(ana.pct * 100).toFixed(0)}%`;
  const unc = `±${fmtValue(ana.sigmaDiff)}`;
  switch (ana.assessment.level) {
    case 'incomplete': return { label: 'Add assets to both sides', sub: 'The verdict appears once each team receives something.' };
    case 'even': return { label: 'Close — roughly fair', sub: `The ${gap}-point gap is within the model's uncertainty (${unc}).` };
    case 'lean': return { label: `Leans ${mid(team)}`, sub: `${team} receives ${gap} more (${pct}) — beyond the uncertainty (${unc}), but only modestly.` };
    default: return { label: `${team} clearly ahead`, sub: `${team} receives ${gap} more (${pct}), about ${ana.z.toFixed(1)}× the uncertainty (${unc}).` };
  }
}

/** Cross-check against market values alone: do the trade markets point the same way as the blended model? */
export function marketCheck(ana, N = NEUTRAL) {
  const m = ana.signalDiffs.find((s) => s.key === 'market');
  if (!m || (!m.a && !m.b)) return null;
  const close = Math.abs(m.diff) <= ana.sigmaDiff;
  const modelClose = ana.assessment.level === 'even';
  const who = mid(m.diff > 0 ? N.A : N.B);
  const lead = leadText(m.diff, N);
  if (close && modelClose) return { cls: 'agree', text: 'market values alone also call this close.' };
  if (close) return { cls: 'differ', text: `market values alone call this close (${lead}); the model's projections and stats create the gap.` };
  if (modelClose) return { cls: 'differ', text: `market values alone favour ${who} (${lead}); the model's other signals pull it back to even.` };
  if (Math.sign(m.diff) === Math.sign(ana.diff)) return { cls: 'agree', text: `market values alone agree (${lead} before the package adjustment).` };
  return { cls: 'disagree', text: `market values alone favour ${who} (${lead}), the opposite of the model. Worth a closer look: open each player's "Why this value?".` };
}

/** Trade from a shared link: #/trade?m=dynasty&a=id1,id2&b=id3 (ids URL-encoded). Null when the URL has none. */
export function tradeFromHash(hash) {
  const q = new URLSearchParams(String(hash || '').split('?')[1] || '');
  if (!q.has('a') && !q.has('b')) return null;
  const ids = (k) => (q.get(k) || '').split(',').map((x) => { try { return decodeURIComponent(x).trim(); } catch { return ''; } }).filter((x) => x && x.length <= 80).slice(0, 25);
  return { a: ids('a'), b: ids('b') };
}

/** The hash part of a shareable trade link (inverse of tradeFromHash). */
export function tradeHash(mode, a, b) {
  const enc = (ids) => ids.map(encodeURIComponent).join(',');
  return `#/trade?m=${mode}&a=${enc(a)}&b=${enc(b)}`;
}
