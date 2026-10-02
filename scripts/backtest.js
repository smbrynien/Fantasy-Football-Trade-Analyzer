#!/usr/bin/env node
// Backtests consensus signals against what actually happened, and writes reports/backtest.json (shown on the Model page).
//
//   npm run backtest      (uses the same cached downloads as `npm run calibrate`)
//
// 1. Preseason redraft ECR (FantasyPros PPR cheat sheets, last scrape before Sept 8) vs actual PPR season points,
//    compared with a naive baseline (last season's PPR points per game).
// 2. Preseason dynasty ECR vs realised 3-season PPR surplus.
// Spearman rank correlations; higher = ranking order matched reality better. No claim of predictive precision.

import path from 'node:path';
import { ROOT } from '../server/lib/paths.js';
import { writeJSON } from '../server/lib/store.js';
import { loadSeasons, loadCSV, streamECRArchive, replacementBySeason } from './lib/history-data.js';
import { spearman, mean } from '../js/core/util/stats.js';
import { toNumber } from '../js/core/util/csv.js';

const POS = ['QB', 'RB', 'WR', 'TE'];
const TOP = { QB: 24, RB: 48, WR: 60, TE: 24 };
const r3 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

console.log('Loading seasons 2018-2025 …');
const { seasons } = await loadSeasons(2018, 2025);
const ids = await loadCSV('db_playerids.csv', 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv');
const fpToGsis = new Map(ids.filter((r) => r.fantasypros_id && r.gsis_id).map((r) => [r.fantasypros_id, r.gsis_id]));
const seasonRow = (gsis, y) => (seasons.get(gsis) || []).find((r) => r.season === y);

console.log('Streaming FantasyPros ECR archive …');
const rows = await streamECRArchive((o) => {
  const p = o.fp_page || '';
  const d = o.scrape_date || '';
  if (!/-(0[78])-|-09-0[1-7]/.test(d)) return false;
  return /ppr-cheatsheets/.test(p) || /dynasty-overall/.test(p);
});

function latestList(year, re) {
  const rs = rows.filter((r) => r.scrape_date.startsWith(String(year)) && re.test(r.fp_page));
  if (!rs.length) return null;
  const last = rs.map((r) => r.scrape_date).sort().pop();
  return { date: last, rows: rs.filter((r) => r.scrape_date === last) };
}

// ---------- 1. redraft ----------
const redraftRows = [];
const byPos = {};
for (let y = 2019; y <= 2025; y++) {
  const list = latestList(y, /ppr-cheatsheets/);
  if (!list) continue;
  for (const pos of POS) {
    const ranked = list.rows.filter((r) => r.pos === pos).map((r) => ({ ecr: toNumber(r.ecr), gsis: fpToGsis.get(r.id) })).filter((r) => r.ecr !== null && r.gsis).sort((a, b) => a.ecr - b.ecr).slice(0, TOP[pos]);
    const pairs = ranked.map((r) => {
      const cur = seasonRow(r.gsis, y), prev = seasonRow(r.gsis, y - 1);
      return { ecr: r.ecr, pts: cur ? cur.pts : 0, prevPPG: prev && prev.games >= 6 ? prev.ppg : null };
    });
    const rhoECR = spearman(pairs.map((p) => -p.ecr), pairs.map((p) => p.pts));
    const withPrev = pairs.filter((p) => p.prevPPG !== null);
    const rhoPrevSame = spearman(withPrev.map((p) => -p.ecr), withPrev.map((p) => p.pts));
    const rhoPrev = spearman(withPrev.map((p) => p.prevPPG), withPrev.map((p) => p.pts));
    redraftRows.push([`${y} ${pos}`, pairs.length, r3(rhoECR), withPrev.length, r3(rhoPrevSame), r3(rhoPrev)]);
    (byPos[pos] ||= []).push({ ecr: rhoECR, ecrSame: rhoPrevSame, prev: rhoPrev });
  }
}
const redraftSummary = POS.map((p) => [p, (byPos[p] || []).length, r3(mean(byPos[p].map((x) => x.ecr))), r3(mean(byPos[p].map((x) => x.ecrSame))), r3(mean(byPos[p].map((x) => x.prev)))]);

// ---------- 2. dynasty ----------
const repl = replacementBySeason(seasons);
const dynRows = [];
for (let y = 2020; y <= 2023; y++) {
  const list = latestList(y, /dynasty-overall/);
  if (!list) continue;
  const ranked = list.rows.map((r) => ({ ecr: toNumber(r.ecr), gsis: fpToGsis.get(r.id), pos: r.pos })).filter((r) => r.ecr !== null && r.gsis && POS.includes(r.pos)).sort((a, b) => a.ecr - b.ecr).slice(0, 150);
  const outs = ranked.map((r) => {
    let v = 0;
    for (let k = 0; k < 3; k++) { const row = seasonRow(r.gsis, y + k); if (row) v += Math.pow(0.82, k) * Math.max(0, row.pts - (repl[y + k]?.[r.pos] ?? 0)); }
    const prev = seasonRow(r.gsis, y - 1);
    return { ecr: r.ecr, v, prevPPG: prev && prev.games >= 6 ? prev.ppg : null };
  });
  const lastSeason = y + 2 <= 2025;
  dynRows.push([`${y} (top 150)`, outs.length, r3(spearman(outs.map((o) => -o.ecr), outs.map((o) => o.v))), r3(spearman(outs.filter((o) => o.prevPPG !== null).map((o) => o.prevPPG), outs.filter((o) => o.prevPPG !== null).map((o) => o.v))), lastSeason ? '3 seasons' : 'partial']);
}

const avgECR = mean(Object.values(byPos).flat().map((x) => x.ecrSame).filter(Number.isFinite));
const avgPrev = mean(Object.values(byPos).flat().map((x) => x.prev).filter(Number.isFinite));
const report = {
  generated_at: new Date().toISOString(),
  method: 'Spearman rank correlation between a pre-season ordering and realised fantasy production (PPR). Sources: FantasyPros ECR archive (DynastyProcess db_fpecr), nflverse season stats. "Same players" restricts ECR to players who also have a last-season baseline, so both columns are compared on identical samples.',
  sections: [
    { title: 'Redraft: preseason ECR vs actual points — average by position', columns: ['Position', 'Seasons', 'ECR ρ (all ranked)', 'ECR ρ (same players)', 'Last-season PPG ρ'], rows: redraftSummary, note: `Players ranked in the top ${Object.entries(TOP).map(([k, v]) => `${k}${v}`).join('/')} by preseason ECR.` },
    { title: 'Redraft: by season and position', columns: ['Season', 'n', 'ECR ρ', 'n (with baseline)', 'ECR ρ (same)', 'Last-season ρ'], rows: redraftRows },
    { title: 'Dynasty: preseason dynasty ECR vs realised 3-season surplus', columns: ['Season', 'n', 'ECR ρ', 'Last-season PPG ρ', 'Window'], rows: dynRows },
  ],
  conclusions: [
    `On identical samples, preseason expert consensus ordered players with an average ρ of ${r3(avgECR)} vs ${r3(avgPrev)} for last season's PPG alone — consensus carries information beyond raw production, but correlations well below 1 mean single rankings should not be treated as precise.`,
    'This supports giving consensus substantial weight preseason, adding production as the season progresses (phase-aware weights), and exposing uncertainty rather than single-number certainty.',
    'Not tested (no free historical data): projection sources, ADP and trade-market values. Value history is recorded from each sync going forward so these can be evaluated later.',
  ],
};
await writeJSON(path.join(ROOT, 'reports', 'backtest.json'), report, { pretty: true });
console.log(JSON.stringify(redraftSummary), '\n', JSON.stringify(dynRows), '\n', report.conclusions[0]);
