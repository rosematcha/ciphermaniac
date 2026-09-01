/**
 * Earnings table ranking.
 *
 * The three lenses read different amounts off the same records, and two of
 * them can legitimately exclude a player — someone who never cashed in the
 * selected season must drop out of the table rather than rank at $0.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bestSeason,
  type EarningsRow,
  formatEarnings,
  rankByLens,
  shortSeasonLabel
} from '../../src/utils/earningsRanking.ts';
import type { EarningsPlayer } from '../../shared/earningsTypes.ts';

function player(name: string, seasons: Record<string, number>): EarningsPlayer {
  return {
    id: name.toLowerCase(),
    name,
    country: 'US',
    seasons,
    total: Object.values(seasons).reduce((sum, v) => sum + v, 0)
  };
}

const ROSTER: EarningsPlayer[] = [
  player('Ada', { 2526: 10000, 2425: 5000 }),
  player('Bo', { 2526: 4000, 2425: 20000 }),
  player('Cy', { 2425: 9000 })
];

const names = (rows: EarningsRow[]) => rows.map(r => r.player.name);
const amounts = (rows: EarningsRow[]) => rows.map(r => r.amount);

test('career lens ranks by the summed total', () => {
  const rows = rankByLens(ROSTER, 'career', '2526');
  assert.deepEqual(names(rows), ['Bo', 'Ada', 'Cy']);
  assert.deepEqual(amounts(rows), [24000, 15000, 9000]);
  // Career amounts span seasons, so no single season explains them.
  assert.deepEqual(
    rows.map(r => r.seasonKey),
    [null, null, null]
  );
});

test("best-season lens ranks by each player's single best year and names it", () => {
  const rows = rankByLens(ROSTER, 'best', '2526');
  assert.deepEqual(names(rows), ['Bo', 'Ada', 'Cy']);
  assert.deepEqual(amounts(rows), [20000, 10000, 9000]);
  assert.deepEqual(
    rows.map(r => r.seasonKey),
    ['2425', '2526', '2425']
  );
});

test('season lens drops players who did not cash that season', () => {
  const rows = rankByLens(ROSTER, 'season', '2526');
  assert.deepEqual(names(rows), ['Ada', 'Bo']);
  assert.deepEqual(amounts(rows), [10000, 4000]);
});

test('ties share a rank and the next distinct amount skips', () => {
  const tied = [player('Ada', { 2526: 5000 }), player('Bo', { 2526: 5000 }), player('Cy', { 2526: 1000 })];
  const rows = rankByLens(tied, 'season', '2526');
  assert.deepEqual(
    rows.map(r => r.rank),
    [1, 1, 3]
  );
});

test('equal amounts order by name so a lens switch is stable', () => {
  const tied = [player('Zoe', { 2526: 5000 }), player('Ada', { 2526: 5000 })];
  assert.deepEqual(names(rankByLens(tied, 'season', '2526')), ['Ada', 'Zoe']);
});

test('a player with no seasons at all has no best season and no career row', () => {
  const empty = player('Nil', {});
  assert.equal(bestSeason(empty), null);
  assert.deepEqual(names(rankByLens([empty], 'best', '2526')), []);
});

test('amounts render as whole dollars with thousands separators', () => {
  assert.equal(formatEarnings(77000), '$77,000');
  assert.equal(formatEarnings(750), '$750');
});

test('season labels shorten to a two-digit second year', () => {
  assert.equal(shortSeasonLabel('2025–2026'), '2025–26');
  assert.equal(shortSeasonLabel('2025-2026'), '2025–26');
  // Anything that isn't a four-digit span passes through untouched.
  assert.equal(shortSeasonLabel('Modern era'), 'Modern era');
});
