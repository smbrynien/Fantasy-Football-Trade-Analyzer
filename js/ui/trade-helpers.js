// Trade-page wording and link helpers (pure functions: no DOM, unit-tested in tests/trade-helpers.test.js).
// They only rephrase analyzeTrade() output; no value is computed here.

import { fmtValue } from './dom.js';

/** Who receives more, in a few characters: "B +6,160" / "even". */
export function leadText(diff) {
  const r = Math.round(Math.abs(diff) / 10) * 10;
  return r === 0 ? 'even' : `${diff > 0 ? 'A' : 'B'} +${fmtValue(r)}`;
}

/** Plain-language headline for the verdict (the model's own z-score levels; wording only). */
export function verdictHeadline(ana) {
  const team = ana.diff > 0 ? 'Team A' : 'Team B';
  const gap = fmtValue(Math.abs(ana.diff));
  const pct = `${Math.abs(ana.pct * 100).toFixed(0)}%`;
  const unc = `±${fmtValue(ana.sigmaDiff)}`;
  switch (ana.assessment.level) {
    case 'incomplete': return { label: 'Add assets to both sides', sub: 'The verdict appears once each team receives something.' };
    case 'even': return { label: 'Close — roughly fair', sub: `The ${gap}-point gap is within the model's uncertainty (${unc}).` };
    case 'lean': return { label: `Leans ${team}`, sub: `${team} receives ${gap} more (${pct}) — beyond the uncertainty (${unc}), but only modestly.` };
    default: return { label: `${team} clearly ahead`, sub: `${team} receives ${gap} more (${pct}), about ${ana.z.toFixed(1)}× the uncertainty (${unc}).` };
  }
}

/** Cross-check against market values alone: do the trade markets point the same way as the blended model? */
export function marketCheck(ana) {
  const m = ana.signalDiffs.find((s) => s.key === 'market');
  if (!m || (!m.a && !m.b)) return null;
  const close = Math.abs(m.diff) <= ana.sigmaDiff;
  const modelClose = ana.assessment.level === 'even';
  const who = m.diff > 0 ? 'Team A' : 'Team B';
  if (close && modelClose) return { cls: 'agree', text: 'market values alone also call this close.' };
  if (close) return { cls: 'differ', text: `market values alone call this close (${leadText(m.diff)}); the model's projections and stats create the gap.` };
  if (modelClose) return { cls: 'differ', text: `market values alone favour ${who} (${leadText(m.diff)}); the model's other signals pull it back to even.` };
  if (Math.sign(m.diff) === Math.sign(ana.diff)) return { cls: 'agree', text: `market values alone agree (${leadText(m.diff)} before the package adjustment).` };
  return { cls: 'disagree', text: `market values alone favour ${who} (${leadText(m.diff)}), the opposite of the model. Worth a closer look: open each player's "Why this value?".` };
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
