// Data ingestion: CSV parsing, manual-import column mapping, validation, pick labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseCSVRows, toCSV, detectDelimiter } from '../js/core/util/csv.js';
import { parseUpload, autoMapColumns, applyMapping, toNormalized, validateRows } from '../js/core/import/mapper.js';
import { parsePickLabel, pickAssetId, parsePickAssetId } from '../js/core/pick-labels.js';
import { readConfig } from './fixtures/make-dataset.js';

const specs = readConfig('import-specs.json');
const spec = (id) => specs.specs.find((s) => s.id === id);

test('valid CSV with quotes, escaped quotes, BOM, CRLF and NA', () => {
  const txt = '﻿Name,Team,Note\r\n"Smith, John",DET,"He said ""hi"""\r\nJa\'Marr Chase,CIN,NA\r\n';
  const r = parseCSV(txt);
  assert.deepEqual(r.headers, ['Name', 'Team', 'Note']);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].Name, 'Smith, John');
  assert.equal(r.records[0].Note, 'He said "hi"');
  assert.equal(r.records[1].Note, null);
});

test('malformed CSV: unterminated quote throws a clear error; ragged rows warn', () => {
  assert.throws(() => parseCSVRows('a,b\n"x,1\n'), /unterminated/i);
  const r = parseCSV('a,b\n1,2,3\n4\n');
  assert.equal(r.warnings.length, 2);
});

test('delimiter detection (tab, semicolon) and round-trip serialization', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  const csv = toCSV([{ a: 'x,y', b: 1 }, { a: 'q"r', b: null }]);
  const back = parseCSV(csv);
  assert.equal(back.records[0].a, 'x,y');
  assert.equal(back.records[1].a, 'q"r');
});

test('auto column mapping understands aliases (FantasyPros export headers)', () => {
  const s = spec('fantasypros_rankings');
  const m = autoMapColumns(['RK', 'TIERS', 'PLAYER NAME', 'TEAM', 'POS', 'BEST', 'WORST', 'AVG.', 'STD.DEV'], s, specs.common_aliases);
  assert.equal(m.mapping.rank, 'RK');
  assert.equal(m.mapping.player_name, 'PLAYER NAME');
  assert.equal(m.mapping.position, 'POS');
  assert.equal(m.mapping.best, 'BEST');
  assert.deepEqual(m.missingRequired, []);
  const m2 = autoMapColumns(['Player', 'ECR', 'Pos'], s, specs.common_aliases);
  assert.equal(m2.mapping.rank, 'ECR');
  assert.equal(m2.mapping.player_name, 'Player');
});

test('missing required fields are reported (file level and row level)', () => {
  const s = spec('ktc_values');
  const m = autoMapColumns(['Player', 'Team'], s, specs.common_aliases);
  assert.deepEqual(m.missingRequired, ['value']);
  const { rows, errors } = applyMapping([{ Player: 'A', Value: '10' }, { Player: 'B', Value: '' }, { Player: 'C', Value: 'abc' }], { player_name: 'Player', value: 'Value' }, s);
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 2);
});

test('duplicates, positional-rank labels and pick rows are handled', () => {
  const s = spec('ktc_values');
  const parsed = parseUpload("Player,Position,Value\nJa'Marr Chase,WR,9998\nJa'Marr Chase,WR,9998\n2027 Early 1st,RDP,6400\nSomeone,XX,10\n");
  const map = autoMapColumns(parsed.headers, s, specs.common_aliases).mapping;
  const { rows } = applyMapping(parsed.records, map, s);
  const norm = toNormalized(rows, s, { dynasty: true, qb: 'sf' });
  assert.equal(norm.picks.length, 1);
  assert.equal(norm.picks[0].season, 2027);
  assert.equal(norm.picks[0].bucket, 'early');
  const v = validateRows(norm, s);
  assert.ok(v.issues.some((i) => i.duplicate));
  assert.ok(v.issues.some((i) => /no recognised position/.test(i.message)));
  const fp = spec('fantasypros_rankings');
  const n2 = toNormalized([{ _row: 2, player_name: 'X', rank: 3, position: 'RB12' }], fp, { kind: 'ros' });
  assert.equal(n2.players[0].position, 'RB');
  assert.equal(n2.players[0].pos_rank, 12);
});

test('JSON uploads (array or {players:[...]}) are accepted', () => {
  assert.equal(parseUpload('[{"Player":"A","Value":1}]').records.length, 1);
  assert.equal(parseUpload('{"players":[{"Player":"A","Value":1},{"Player":"B","Value":2}]}').records.length, 2);
  assert.ok(parseUpload('{"foo": 1}', 'x.json').error);
});

test('pick label parsing covers all source styles', () => {
  assert.deepEqual(parsePickLabel('2027 1st (Early)'), { season: 2027, round: 1, slot: null, bucket: 'early', range: null });
  assert.deepEqual(parsePickLabel('2027 Late 2nd'), { season: 2027, round: 2, slot: null, bucket: 'late', range: null });
  assert.deepEqual(parsePickLabel('2026 Pick 1.04'), { season: 2026, round: 1, slot: 4, bucket: null, range: null });
  assert.deepEqual(parsePickLabel('2028 1st'), { season: 2028, round: 1, slot: null, bucket: null, range: null });
  assert.equal(parsePickLabel('George Pickens'), null);
  const id = pickAssetId({ season: 2027, round: 1, range: [3, 7] });
  assert.equal(id, 'pick:2027:1:r3-7');
  assert.deepEqual(parsePickAssetId(id).range, [3, 7]);
});

// ---- BUG_AUDIT I1/I2 + fuzzing of the import pipeline ----
import { toNumber as toNum } from '../js/core/util/csv.js';
const [pu, amc, am, tn, vr] = [parseUpload, autoMapColumns, applyMapping, toNormalized, validateRows];
const importSpecs = specs;

test('numbers: decimal commas are decimals, 3-digit comma groups are thousands (BUG_AUDIT I2)', () => {
  assert.equal(toNum('12,5'), 12.5);
  assert.equal(toNum('0,85'), 0.85);
  assert.equal(toNum('-3,25'), -3.25);
  assert.equal(toNum('1,234'), 1234);
  assert.equal(toNum('12,345.6'), 12345.6);
  assert.equal(toNum('1,234,567'), 1234567);
  assert.equal(toNum('$1,250'), 1250);
  assert.equal(toNum('7.5'), 7.5);
  for (const bad of ['abc', '1,2,3', '--5', '', null, 'NaN', 'Infinity', '1e400']) assert.equal(toNum(bad), null, String(bad));
});

test('import validation: rows with error-level problems are invalid and never committed (BUG_AUDIT I1)', () => {
  const rspec = spec('rankings_generic');
  const parsed = pu('player_name,position,team,rank\nA Player,WR,CIN,0\nB Player,WR,MIN,-3\nC Player,WR,LAR,5\n', 'r.csv');
  const { mapping } = amc(parsed.headers, rspec, importSpecs.common_aliases);
  const norm = tn(am(parsed.records, mapping, rspec).rows, rspec, { kind: 'ros' });
  const v = vr(norm, rspec);
  assert.equal(v.counts.players, 1, 'only the valid row counts');
  assert.deepEqual(norm.players.filter((p) => !p._invalid).map((p) => p.name), ['C Player']);
  assert.equal(v.issues.filter((i) => i.level === 'error').length, 2);
});

test('import pipeline fuzz: random CSV/JSON never throws and never yields non-finite numbers', () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const cells = ['', ' ', 'NA', '"', '""', '"a,b"', '12,5', '1,234', '-0', '1e309', 'NaN', '<script>x</script>', '=HYPERLINK("x")', 'José Ñúñez', '\u0000', 'WR', 'QB1', 'FA', '2027 1.01', '2028 1st', '9999', '-1', 'Ja\'Marr', 'null', '{}', '[]'];
  for (let i = 0; i < 300; i++) {
    const nCols = 1 + Math.floor(rnd() * 6), nRows = Math.floor(rnd() * 8);
    const header = Array.from({ length: nCols }, () => pick(['player_name', 'name', 'position', 'team', 'rank', 'value', 'adp', 'pick', 'age', 'x', '']));
    const lines = [header.join(pick([',', ';', '\t']))];
    for (let r = 0; r < nRows; r++) lines.push(Array.from({ length: nCols + Math.floor(rnd() * 3) - 1 }, () => pick(cells)).join(','));
    const text = rnd() < 0.2 ? JSON.stringify(Array.from({ length: nRows }, () => ({ name: pick(cells), position: pick(cells), value: pick(cells), rank: pick(cells) }))) : lines.join(pick(['\n', '\r\n']));
    for (const sp of specs.specs) {
      const parsed = pu(text, rnd() < 0.5 ? 'f.csv' : 'f.json');
      if (parsed.error) continue;
      const { mapping } = amc(parsed.headers, sp, importSpecs.common_aliases);
      const norm = tn(am(parsed.records, mapping, sp).rows, sp, {});
      vr(norm, sp);
      for (const rec of [...norm.players, ...norm.picks]) for (const [k, val] of Object.entries(rec)) if (typeof val === 'number') assert.ok(Number.isFinite(val), `${sp.id} ${k}=${val}`);
    }
  }
});

test('CSV export neutralizes spreadsheet formulas but keeps numbers (BUG_AUDIT I3)', () => {
  const out = toCSV([{ name: '=HYPERLINK("http://x","y")', a: '+1+1', b: '@SUM(A1)', c: '-12.5', d: -3, e: 'Ja\'Marr, "J"' }]);
  const row = parseCSV(out).records[0];
  assert.equal(row.name, '\'=HYPERLINK("http://x","y")');
  assert.equal(row.a, '\'+1+1');
  assert.equal(row.b, '\'@SUM(A1)');
  assert.equal(row.c, '-12.5');
  assert.equal(row.d, '-3');
  assert.equal(row.e, 'Ja\'Marr, "J"', 'quotes/commas round-trip');
});
