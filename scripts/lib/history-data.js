// Shared historical-data loader for calibration and backtesting (downloads are cached in scripts/.cache).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { ROOT } from '../../server/lib/paths.js';
import { createHttp } from '../../server/lib/http.js';
import { parseCSV, parseCSVRows, toNumber } from '../../js/core/util/csv.js';
import { mapNflverseStats } from '../../adapters/nflverse.js';
import { scoreStats, resolveScoring } from '../../js/core/scoring.js';
import { normalizePosition } from '../../js/core/util/positions.js';
import { readJSONSync } from '../../server/lib/store.js';

export const CACHE = path.join(ROOT, 'scripts', '.cache');
const http = createHttp({ timeoutMs: 300000 });

export async function cached(name, url) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return file;
  await fsp.mkdir(CACHE, { recursive: true });
  process.stdout.write(`  downloading ${name} … `);
  const buf = await http.buffer(url);
  await fsp.writeFile(file, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  return file;
}

export async function loadCSV(name, url) {
  const f = await cached(name, url);
  return parseCSV(await fsp.readFile(f, 'utf8')).records;
}

const pprScoring = resolveScoring({ scoring_preset: 'ppr', scoring: {} }, readJSONSync(path.join(ROOT, 'config', 'league-defaults.json')));

export function ageAt(birth, season) {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00Z');
  const d = new Date(Date.UTC(season, 8, 1)); // Sept 1
  return (d - b) / (365.2425 * 864e5);
}

/** Load seasonal PPR rows for [from..to]: Map gsis → [{season, pos, games, pts, ppg, age}] plus player meta. */
export async function loadSeasons(from, to) {
  const players = await loadCSV('players.csv', 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv');
  const meta = new Map(players.map((p) => [p.gsis_id, p]));
  const seasons = new Map();
  for (let y = from; y <= to; y++) {
    const rows = await loadCSV(`stats_player_reg_${y}.csv`, `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${y}.csv`);
    for (const r of rows) {
      const pos = normalizePosition(r.position);
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      const games = toNumber(r.games) || 0;
      if (!games) continue;
      const pts = scoreStats(mapNflverseStats(r), pos, pprScoring, { games }).points || 0;
      const m = meta.get(r.player_id);
      const row = { gsis: r.player_id, season: y, pos, games, pts, ppg: pts / games, age: ageAt(m?.birth_date, y), name: r.player_display_name };
      if (!seasons.has(r.player_id)) seasons.set(r.player_id, []);
      seasons.get(r.player_id).push(row);
    }
  }
  for (const arr of seasons.values()) arr.sort((a, b) => a.season - b.season);
  return { seasons, meta };
}

/** Stream the DynastyProcess FantasyPros ECR archive, keeping rows that pass `filter(row)` (row = header-keyed object). */
export async function streamECRArchive(filter) {
  const f = await cached('db_fpecr.csv.gz', 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr.csv.gz');
  const rl = readline.createInterface({ input: fs.createReadStream(f).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header = null;
  const out = [];
  for await (const line of rl) {
    if (!header) { header = parseCSVRows(line)[0]; continue; }
    const cells = parseCSVRows(line)[0];
    if (!cells) continue;
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i] === 'NA' ? null : cells[i]; });
    if (filter(o)) out.push(o);
  }
  return out;
}

/** Season-level fixed replacement (12-team, 1QB/2RB/3WR/1TE/1FLEX-ish) in PPR points, per season & position. */
export function replacementBySeason(seasons) {
  const by = {};
  for (const arr of seasons.values()) for (const r of arr) ((by[r.season] ||= {})[r.pos] ||= []).push(r.pts);
  const rank = { QB: 12, RB: 30, WR: 42, TE: 12 };
  const out = {};
  for (const [s, posMap] of Object.entries(by)) {
    out[s] = {};
    for (const [p, list] of Object.entries(posMap)) {
      list.sort((a, b) => b - a);
      out[s][p] = list[Math.min(rank[p], list.length) - 1] || 0;
    }
  }
  return out;
}
