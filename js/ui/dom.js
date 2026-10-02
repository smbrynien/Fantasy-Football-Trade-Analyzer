// Tiny DOM toolkit: h() element builder, formatting helpers, toasts, modals, downloads.

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// ---------- formatting ----------
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Trade values are rounded to the nearest 10 for display: 7,000 vs 6,990 is not a meaningful distinction. */
export function fmtValue(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return nf0.format(Math.round(v / 10) * 10);
}
export function fmtInt(v) { return v === null || v === undefined || !Number.isFinite(v) ? '—' : nf0.format(Math.round(v)); }
export function fmt1(v) { return v === null || v === undefined || !Number.isFinite(v) ? '—' : nf1.format(v); }
export function fmtSigned(v) { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; const r = Math.round(v / 10) * 10; return (r > 0 ? '+' : r < 0 ? '−' : '±') + nf0.format(Math.abs(r)); }
export function fmtPct(v, d = 1) { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`; }
export function fmtPctPlain(v, d = 0) { return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`; }
export function fmtAge(a) { return a === null || a === undefined || !Number.isFinite(a) ? '—' : a.toFixed(1); }
export function fmtRange(r) { return r ? `${fmtValue(r[0])}–${fmtValue(r[1])}` : '—'; }

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------- feedback ----------
export function toast(msg, kind = 'ok', ms = 4000) {
  const root = document.getElementById('toast-root');
  const t = h('div.toast', { class: kind }, msg);
  root.append(t);
  setTimeout(() => t.remove(), ms);
}

export function openModal(content, { onClose, wide } = {}) {
  const root = document.getElementById('modal-root');
  const opener = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', esc);
    if (onClose) onClose();
    // Accessibility: return focus to whatever opened the dialog (keyboard users otherwise land at the page top).
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  };
  const esc = (e) => {
    if (e.key === 'Escape') { if (backdrop === root.lastElementChild) close(); return; } // only the topmost dialog
    if (e.key !== 'Tab') return;
    // Keep Tab focus inside the dialog instead of moving to controls behind the backdrop.
    const f = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true', style: wide ? { width: 'min(1200px, 100%)' } : null });
  const backdrop = h('div.modal-backdrop', { onclick: (e) => { if (e.target === backdrop) close(); } }, modal);
  append(modal, [typeof content === 'function' ? content(close) : content]);
  root.append(backdrop);
  document.addEventListener('keydown', esc);
  const f = modal.querySelector('button, input, select');
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
  return close;
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function posBadge(pos) { return h('span.pos', { class: `pos-${pos}` }, pos === 'PICK' ? 'PICK' : pos); }

export function confBadge(conf) {
  if (!conf) return h('span.faint', {}, '—');
  return h('span.conf', { class: `conf-${conf.label}`, title: (conf.reasons || []).join('\n') || 'Good coverage and agreement' }, h('i'), conf.label);
}

export function injuryBadge(inj) {
  const s = inj && inj.status;
  if (!s) return null;
  const short = { Questionable: 'Q', Doubtful: 'D', Out: 'OUT', IR: 'IR', PUP: 'PUP', NFI: 'NFI', Suspended: 'SUS', COV: 'COV', DNR: 'DNR' }[s] || s;
  return h('span.inj', { class: s === 'Questionable' ? 'q' : '', title: `${s}${inj.source === 'official' ? ' (official injury report)' : ' (reported status)'}` }, short);
}

export function statusIcon(st) {
  const m = { ok: '✓', warning: '⚠', partial: '⚠', error: '✕', quarantined: '⛔', never: '○', skipped: '↷', 'never synced': '○', 'not imported': '○', manual: '✎' };
  return h('span.status-icon', { class: `st-${String(st).split(' ')[0]}` }, m[st] || '•');
}
