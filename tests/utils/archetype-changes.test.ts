import test from 'node:test';
import assert from 'node:assert/strict';

import { rangeText, weeklyChanges } from '../../src/pages/archetypePage/changesModel.ts';
import { type ArchetypeTrends, parseArchetypeTrends, type TrendCard } from '../../src/lib/data/archetypeTrends.ts';
import type { CardItem } from '../../src/types/index.ts';

/** One day in each week: last week's lists, then this week's. */
function trends(lastWeek: number, thisWeek: number, cards: TrendCard[]): ArchetypeTrends {
  return {
    days: [
      { date: '2026-11-10', lists: lastWeek },
      { date: '2026-11-17', lists: thisWeek }
    ],
    windowEnd: '2026-11-17',
    cards,
    matchups: null
  };
}

/** A printing in `before` of last week's lists and `after` of this week's. */
const card = (name: string, set: string, before: number, after: number, number = '001'): TrendCard => ({
  name,
  set,
  number,
  lists: [before, after]
});

const item = (name: string, set: string, extra: Partial<CardItem> = {}): CardItem => ({
  name,
  set,
  number: '001',
  found: 1,
  total: 1,
  pct: 1,
  category: 'pokemon',
  ...extra
});

test('a change is clear only when the test says so, and the range shows it', () => {
  const { rows } = weeklyChanges(
    trends(40, 40, [card('Tasty Rice Ball', 'MEG', 10, 20), card('Crispin', 'SCR', 12, 16), card('Eri', 'TEF', 0, 1)]),
    []
  );
  const rice = rows.find(row => row.name === 'Tasty Rice Ball')!;
  const crispin = rows.find(row => row.name === 'Crispin')!;
  // 25% → 50% on 40 lists a week is past the wobble; 30% → 40% is not.
  assert.equal(rice.clear, true);
  assert.ok(rice.low > 0);
  assert.equal(crispin.clear, false);
  assert.ok(crispin.low < 0 && crispin.high > 0);
  // One list in forty is noise on a card nobody plays, so it isn't listed at all.
  assert.deepEqual(
    rows.map(row => row.name),
    ['Tasty Rice Ball', 'Crispin']
  );
});

test('a week under 20 lists shows no changes', () => {
  const changes = weeklyChanges(trends(40, 19, [card('Tasty Rice Ball', 'MEG', 10, 19)]), []);
  assert.equal(changes.thisWeek.lists, 19);
  assert.deepEqual(changes.rows, []);
});

test('an evolution line that moved together is one row under its top stage', () => {
  const items = [item('Dwebble', 'DRI'), item('Crustle', 'DRI', { evolvesFrom: 'Dwebble' })];
  const together = weeklyChanges(
    trends(40, 40, [card('Dwebble', 'DRI', 10, 20), card('Crustle', 'DRI', 10, 21)]),
    items
  );
  assert.deepEqual(
    together.rows.map(row => [row.name, row.line]),
    [['Crustle', ['Dwebble']]]
  );
  const apart = weeklyChanges(trends(40, 40, [card('Dwebble', 'DRI', 10, 30), card('Crustle', 'DRI', 10, 20)]), items);
  assert.equal(apart.rows.length, 2);
});

test('a clear change never folds under one that could be noise, nor under one too small to show', () => {
  const items = [item('Dwebble', 'DRI'), item('Crustle', 'DRI', { evolvesFrom: 'Dwebble' })];
  // Dwebble 0 → 7 of 40 is clear; Crustle 6 → 13 moved as much but could be noise.
  const noisyTop = weeklyChanges(trends(40, 40, [card('Dwebble', 'DRI', 0, 7), card('Crustle', 'DRI', 6, 13)]), items);
  assert.deepEqual(
    noisyTop.rows.map(row => [row.name, row.line]),
    [
      ['Dwebble', []],
      ['Crustle', []]
    ]
  );
  // 400 lists a week: Dwebble 390 → 400 is clear; Crustle 200 → 210 is too small to show.
  const hiddenTop = weeklyChanges(
    trends(400, 400, [card('Dwebble', 'DRI', 390, 400), card('Crustle', 'DRI', 200, 210)]),
    items
  );
  assert.deepEqual(
    hiddenTop.rows.map(row => row.name),
    ['Dwebble']
  );
});

test("with few lists in a cell, Fisher's exact test decides what is clear", () => {
  // One list in 20 after none in 200: p = 0.091, so it could be noise.
  const lucky = weeklyChanges(trends(200, 20, [card('Budew', 'PRE', 0, 1)]), []).rows;
  assert.deepEqual(
    lucky.map(row => [row.name, row.clear]),
    [['Budew', false]]
  );
  // None in 20 to 8 in 20: p = 0.003, clear though the counts are small.
  const [clear] = weeklyChanges(trends(20, 20, [card('Mew ex', 'MEW', 0, 8)]), []).rows;
  assert.equal(clear.clear, true);
});

test('a clear change of exactly two points is shown', () => {
  // 1% → 3% of 1,000 lists is 1.9999999999999998 points in floating point.
  const { rows } = weeklyChanges(trends(1000, 1000, [card('Eri', 'TEF', 10, 30)]), []);
  assert.deepEqual(
    rows.map(row => [row.name, row.clear]),
    [['Eri', true]]
  );
});

test('a 95% range end that rounds to zero reads 0%', () => {
  assert.equal(rangeText({ low: -0.3, high: 18.2, clear: false }), '95% range 0% to +18%, could be noise');
  assert.equal(rangeText({ low: 2.4, high: 9.6, clear: true }), '95% range +2% to +10%');
});

test('this week ends on the scope window, so a deck that stopped appearing has too few lists', () => {
  const quiet = { ...trends(40, 40, [card('Tasty Rice Ball', 'MEG', 10, 20)]), windowEnd: '2026-11-24' };
  const changes = weeklyChanges(quiet, []);
  assert.deepEqual(
    [changes.thisWeek.start, changes.thisWeek.end, changes.thisWeek.lists],
    ['2026-11-18', '2026-11-24', 0]
  );
  assert.deepEqual(changes.rows, []);
});

test('the 95% range stops only at 100 points, and a faded range crosses the centre line', () => {
  // 0 → 2 of 22 lists (9%) could be noise, so its range reaches past no change.
  const small = weeklyChanges(trends(22, 22, [card('Tapu Bulu', 'TEU', 0, 2), card('Eri', 'TEF', 22, 0)]), []).rows;
  const bulu = small.find(row => row.name === 'Tapu Bulu')!;
  assert.deepEqual([Math.round(bulu.after), bulu.clear], [9, false]);
  assert.ok(bulu.low < 0 && bulu.high > 0);
  assert.equal(small.find(row => row.name === 'Eri')!.low, -100);
  // 0 → 30 of 100 is +20 to +40, not cut off at this week's 30%.
  const [mew] = weeklyChanges(trends(100, 100, [card('Mew ex', 'MEW', 0, 30)]), []).rows;
  assert.deepEqual([Math.round(mew.low), Math.round(mew.high)], [20, 40]);
});

test('an older or partly bad trends file keeps the parts that read', () => {
  const matchup = { opponent: 'Crustle', wins: 3, losses: 1, ties: 0, total: 4, winRate: 75 };
  const older = parseArchetypeTrends({ matchups: { Crustle: matchup } });
  assert.deepEqual(older?.matchups, { Crustle: matchup });
  assert.equal(older?.days, null);

  const eri = { name: 'Eri', set: 'TEF', number: '146', timeline: { 0: { all: { count: 2 } } } };
  const partly = parseArchetypeTrends({
    meta: { windowEnd: '2026-11-17' },
    days: [{ date: '2026-11-17', totals: { all: 3 } }],
    cards: {
      'Eri::TEF::146': eri,
      'Bad::TEF::001': { ...eri, name: 'Bad', timeline: { 0: { all: { count: 'three' } } } }
    },
    matchups: { Crustle: matchup, Broken: { opponent: 'Broken' } }
  });
  assert.deepEqual(partly?.cards, [{ name: 'Eri', set: 'TEF', number: '146', lists: [2] }]);
  assert.deepEqual(Object.keys(partly?.matchups ?? {}), ['Crustle']);
  assert.equal(partly?.windowEnd, '2026-11-17');
});
