// League scoring engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScoring, scoreStats } from '../js/core/scoring.js';
import { readConfig } from './fixtures/make-dataset.js';

const defaults = readConfig('league-defaults.json');
const sc = (preset, custom = {}) => resolveScoring({ scoring_preset: preset, scoring: custom }, defaults);
const wr = { rec: 6, rec_yd: 80, rec_td: 1, fum_lost: 0 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('PPR / half PPR / standard', () => {
  close(scoreStats(wr, 'WR', sc('ppr'), { perGame: true }).points, 6 + 8 + 6);
  close(scoreStats(wr, 'WR', sc('half_ppr'), { perGame: true }).points, 3 + 8 + 6);
  close(scoreStats(wr, 'WR', sc('standard'), { perGame: true }).points, 8 + 6);
});

test('QB passing scoring and custom 6-pt pass TD', () => {
  const qb = { pass_yd: 300, pass_td: 2, pass_int: 1, rush_yd: 20 };
  close(scoreStats(qb, 'QB', sc('ppr'), { perGame: true }).points, 12 + 8 - 2 + 2);
  close(scoreStats(qb, 'QB', sc('ppr', { pass_td: 6 }), { perGame: true }).points, 12 + 12 - 2 + 2);
});

test('TE premium applies only to tight ends', () => {
  const s = sc('ppr', { bonus_rec_te: 0.5 });
  close(scoreStats(wr, 'TE', s, { perGame: true }).points, 20 + 3);
  close(scoreStats(wr, 'WR', s, { perGame: true }).points, 20);
});

test('first downs: used when present, estimated from yards when missing', () => {
  const s = sc('ppr', { rec_fd: 0.5 });
  close(scoreStats({ ...wr, rec_fd: 4 }, 'WR', s, { perGame: true }).points, 22);
  const est = scoreStats(wr, 'WR', s, { perGame: true });
  assert.ok(est.estimated.includes('rec_fd'));
  assert.ok(est.points > 20 && est.points < 23);
});

test('yardage bonuses: exact per game, expected value for aggregates', () => {
  const s = sc('ppr', { bonuses: [{ stat: 'rec_yd', threshold: 100, points: 3 }] });
  close(scoreStats({ rec: 5, rec_yd: 120 }, 'WR', s, { perGame: true }).points, 5 + 12 + 3);
  close(scoreStats({ rec: 5, rec_yd: 80 }, 'WR', s, { perGame: true }).points, 5 + 8);
  const agg = scoreStats({ rec: 50, rec_yd: 900 }, 'WR', s, { games: 10 }).points; // 90 yds/game avg → some bonus probability
  assert.ok(agg > 50 + 90 && agg < 50 + 90 + 30);
});

test('K/DEF use source points; missing stats give null (not zero)', () => {
  assert.equal(scoreStats({ fp_src: 9.5 }, 'K', sc('ppr')).points, 9.5);
  assert.equal(scoreStats({}, 'K', sc('ppr')).points, null);
  assert.equal(scoreStats({}, 'WR', sc('ppr')).points, null);
});
