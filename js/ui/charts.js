// Minimal SVG line chart (no dependencies). series: [{label, color, points:[[x,y],...], dashed, breaks}]
// breaks: x values where the line must not be connected across (e.g. model-version changes);
// markers: [{x, label}] vertical reference lines.

import { svg, h } from './dom.js';

export function lineChart(series, { width = 640, height = 220, xLabel = '', yLabel = '', xFormat = (x) => x, yFormat = (y) => Math.round(y), yMin = null, band = null, markers = [] } = {}) {
  const pad = { l: 48, r: 12, t: 12, b: 30 };
  const all = series.flatMap((s) => s.points.filter((p) => p[1] !== null && p[1] !== undefined && Number.isFinite(p[1])));
  const wrap = h('div');
  if (!all.length) { wrap.append(h('p.muted.small', {}, 'Not enough data to chart yet.')); return wrap; }
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const xsRange = [...xs, ...markers.map((m) => m.x).filter(Number.isFinite)];
  if (band) for (const b of band.points) ys.push(b[1], b[2]);
  let x0 = Math.min(...xsRange), x1 = Math.max(...xsRange);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  let y0 = yMin !== null ? yMin : Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { const pad0 = Math.max(1, Math.abs(y1) * 0.1); y0 = yMin !== null ? yMin : y0 - pad0; y1 += pad0; }
  const yr = y1 - y0; y1 += yr * 0.06; if (yMin === null) y0 -= yr * 0.06;
  // "nice" tick step so labels are round numbers
  const rawStep = (y1 - y0) / 4;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) || rawStep;
  y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
  if (yMin !== null) y0 = Math.max(y0, yMin);
  const X = (x) => pad.l + ((x - x0) / (x1 - x0)) * (width - pad.l - pad.r);
  const Y = (y) => height - pad.b - ((y - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const g = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': yLabel || 'chart' });
  const nTicks = Math.round((y1 - y0) / step);
  for (let i = 0; i <= nTicks; i++) {
    const yv = y0 + step * i;
    g.append(svg('line', { x1: pad.l, x2: width - pad.r, y1: Y(yv), y2: Y(yv), class: 'grid' }));
    g.append(svg('text', { x: pad.l - 6, y: Y(yv) + 4, 'text-anchor': 'end' }, yFormat(yv)));
  }
  const uniqX = [...new Set(xs)].sort((a, b) => a - b);
  const xStep = Math.max(1, Math.ceil(uniqX.length / 8));
  let lastLabelX = -Infinity;
  uniqX.forEach((xv, i) => { if ((i % xStep === 0 || i === uniqX.length - 1) && X(xv) - lastLabelX > 46 && (lastLabelX = X(xv))) g.append(svg('text', { x: X(xv), y: height - 10, 'text-anchor': 'middle' }, xFormat(xv))); });
  if (band && band.points.length > 1) {
    const top = band.points.map((p) => `${X(p[0])},${Y(p[2])}`);
    const bot = band.points.slice().reverse().map((p) => `${X(p[0])},${Y(p[1])}`);
    g.append(svg('polygon', { points: [...top, ...bot].join(' '), fill: band.color, opacity: 0.15 }));
  }
  for (const m of markers) {
    if (!(m.x >= x0 && m.x <= x1)) continue;
    g.append(svg('line', { x1: X(m.x), x2: X(m.x), y1: pad.t, y2: height - pad.b, class: 'marker' }));
    const nearRight = X(m.x) > width - pad.r - 80; // keep the label inside the chart
    if (m.label) g.append(svg('text', { x: X(m.x) + (nearRight ? -4 : 4), y: pad.t + 10, 'text-anchor': nearRight ? 'end' : 'start', class: 'marker-label' }, m.label));
  }
  for (const s of series) {
    const pts = s.points.filter((p) => p[1] !== null && p[1] !== undefined && Number.isFinite(p[1]));
    if (!pts.length) continue;
    const runs = [[pts[0]]];
    for (let i = 1; i < pts.length; i++) {
      if ((s.breaks || []).some((b) => pts[i - 1][0] < b && b <= pts[i][0])) runs.push([]);
      runs[runs.length - 1].push(pts[i]);
    }
    for (const run of runs) if (run.length > 1) g.append(svg('polyline', { points: run.map((p) => `${X(p[0])},${Y(p[1])}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.2, 'stroke-dasharray': s.dashed ? '5 4' : null, 'stroke-linejoin': 'round' }));
    for (const p of pts) g.append(svg('circle', { cx: X(p[0]), cy: Y(p[1]), r: pts.length > 30 ? 1.5 : 3, fill: s.color }, svg('title', {}, `${s.label}: ${xFormat(p[0])} → ${yFormat(p[1])}`)));
  }
  if (yLabel) g.append(svg('text', { x: 4, y: 10 }, yLabel));
  wrap.append(g);
  if (series.length > 1 || band) {
    wrap.append(h('div.legend', {}, series.map((s) => h('span', {}, h('i', { style: { background: s.color } }), s.label)), band ? h('span', {}, h('i', { style: { background: band.color, opacity: 0.4, height: '8px' } }), band.label) : null));
  }
  if (xLabel) wrap.append(h('div.tiny.muted.center', {}, xLabel));
  return wrap;
}
