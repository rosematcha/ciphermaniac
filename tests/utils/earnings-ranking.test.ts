/**
 * Earnings table ranking.
 *
 * Two independent axes: the lens (career, every season, the current season)
 * and the basis (money as paid, or the same finishes at today's rates). Both
 * can legitimately exclude a player — someone who never cashed in the selected
 * season, or whose finishes restate to nothing — and an excluded player must
 * drop out rather than rank at $0.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { type EarningsRow, formatEarnings, rankByLens, shortSeasonLabel } from '../../src/utils/earningsRanking.ts';
import type { EarningsPlayer, EarningsTotals } from '../../shared/earningsTypes.ts';

function totals(seasons: Record<string, number>): EarningsTotals {
  return { total: Object.values(seasons).reduce((sum, v) => sum + v, 0), seasons };
}

function player(
  name: string,
  actual: Record<string, number>,
  adjusted: Record<string, number> = actual
): EarningsPlayer {
  return { id: name.toLowerCase(), name, country: 'US', actual: totals(actual), adjusted: totals(adjusted) };
}

const ROSTER: EarningsPlayer[] = [
  player('Ada', { 2526: 10000, 2425: 5000 }),
  player('Bo', { 2526: 4000, 2425: 20000 }),
  player('Cy', { 2425: 9000 })
];

const names = (rows: EarningsRow[]) => rows.map(r => r.player.name);
const amounts = (rows: EarningsRow[]) => rows.map(r => r.amount);

test('career lens ranks by the summed total', () => {
  const rows = rankByLens(ROSTER, 'career', '2526', 'actual');
  assert.deepEqual(names(rows), ['Bo', 'Ada', 'Cy']);
  assert.deepEqual(amounts(rows), [24000, 15000, 9000]);
  // Career amounts span seasons, so no single season explains them.
  assert.deepEqual(
    rows.map(r => r.seasonKey),
    [null, null, null]
  );
});

test('top-seasons lens ranks every season separately, so one player can repeat', () => {
  const rows = rankByLens(ROSTER, 'top-seasons', '2526', 'actual');
  // Bo's $20,000 year and Ada's $10,000 year both place, and so do their
  // smaller ones — a big second season must not be hidden behind a bigger first.
  assert.deepEqual(names(rows), ['Bo', 'Ada', 'Cy', 'Ada', 'Bo']);
  assert.deepEqual(amounts(rows), [20000, 10000, 9000, 5000, 4000]);
  assert.deepEqual(
    rows.map(r => r.seasonKey),
    ['2425', '2526', '2425', '2425', '2526']
  );
});

test('current-season lens drops players who did not cash that season', () => {
  const rows = rankByLens(ROSTER, 'current', '2526', 'actual');
  assert.deepEqual(names(rows), ['Ada', 'Bo']);
  assert.deepEqual(amounts(rows), [10000, 4000]);
});

test('the adjusted basis re-ranks on restated money', () => {
  const roster = [
    // Paid little at the time, but the finishes restate high.
    player('Legacy', { 1314: 3000 }, { 1314: 40000 }),
    player('Modern', { 2526: 30000 }, { 2526: 30000 })
  ];
  assert.deepEqual(names(rankByLens(roster, 'career', '2526', 'actual')), ['Modern', 'Legacy']);
  assert.deepEqual(names(rankByLens(roster, 'career', '2526', 'adjusted')), ['Legacy', 'Modern']);
});

test('a player with money under only one basis drops out of the other', () => {
  // Placed into today's paying bracket at an event that paid nothing then.
  const roster = [player('Unpaid', {}, { 1516: 2000 })];
  assert.deepEqual(names(rankByLens(roster, 'career', '2526', 'adjusted')), ['Unpaid']);
  assert.deepEqual(names(rankByLens(roster, 'career', '2526', 'actual')), []);
  assert.deepEqual(names(rankByLens(roster, 'top-seasons', '2526', 'actual')), []);
});

test('ties share a rank and the next distinct amount skips', () => {
  const tied = [player('Ada', { 2526: 5000 }), player('Bo', { 2526: 5000 }), player('Cy', { 2526: 1000 })];
  const rows = rankByLens(tied, 'current', '2526', 'actual');
  assert.deepEqual(
    rows.map(r => r.rank),
    [1, 1, 3]
  );
});

test('equal amounts order by name so a lens switch is stable', () => {
  const tied = [player('Zoe', { 2526: 5000 }), player('Ada', { 2526: 5000 })];
  assert.deepEqual(names(rankByLens(tied, 'current', '2526', 'actual')), ['Ada', 'Zoe']);
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
