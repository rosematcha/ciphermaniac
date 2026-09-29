/**
 * tests/shared/reportUtils.test.ts
 * Tests for shared/reportUtils - report generation utilities shared across frontend and backend
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignRanks,
  calculatePercentage,
  composeCategoryPath,
  createDistFromHistogram,
  createDistributionFromCounts,
  sortReportItems
} from '../../shared/reportUtils';

test('calculatePercentage rounds to 2 decimal places and returns 0 for a non-positive denominator', () => {
  const cases: Array<[number, number, number]> = [
    [50, 100, 50],
    [1, 3, 33.33],
    [2, 3, 66.67],
    [50, 50, 100],
    [1, 1000, 0.1],
    [1, 10000, 0.01],
    [50, 0, 0],
    [50, -10, 0]
  ];
  for (const [numerator, denominator, expected] of cases) {
    assert.strictEqual(calculatePercentage(numerator, denominator), expected, `${numerator}/${denominator}`);
  }
});

test('createDistFromHistogram builds a distribution sorted by copies ascending', () => {
  const histogram = new Map<number, number>([
    [3, 3],
    [1, 5],
    [2, 10]
  ]);
  assert.deepStrictEqual(createDistFromHistogram(histogram, 18), [
    { copies: 1, players: 5, percent: 27.78 },
    { copies: 2, players: 10, percent: 55.56 },
    { copies: 3, players: 3, percent: 16.67 }
  ]);
  assert.deepStrictEqual(createDistFromHistogram(new Map(), 0), []);
});

test('createDistributionFromCounts buckets raw counts, treating non-numeric values as zero copies', () => {
  assert.deepStrictEqual(createDistributionFromCounts([1, 2, 2, 3, 2, 1], 6), [
    { copies: 1, players: 2, percent: 33.33 },
    { copies: 2, players: 3, percent: 50 },
    { copies: 3, players: 1, percent: 16.67 }
  ]);
  // At runtime, we might receive bad data. The function converts values via Number().
  assert.deepStrictEqual(createDistributionFromCounts(['x', 0, 2] as unknown as number[], 3)[0], {
    copies: 0,
    players: 2,
    percent: 66.67
  });
});

test('composeCategoryPath builds category/subtype slugs, or an empty string without a category', () => {
  const cases: Array<[string | null | undefined, string | null, string | null, string]> = [
    ['Pokemon', null, null, 'pokemon'],
    ['POKEMON', null, null, 'pokemon'],
    ['Trainer', 'Supporter', null, 'trainer/supporter'],
    ['Trainer', 'Item', null, 'trainer/item'],
    ['Trainer', 'Stadium', null, 'trainer/stadium'],
    ['Trainer', 'Tool', null, 'trainer/tool'],
    ['Energy', null, 'Basic', 'energy/basic'],
    ['Energy', null, 'Special', 'energy/special'],
    [null, null, null, ''],
    ['', null, null, ''],
    [undefined, null, null, '']
  ];
  for (const [category, trainerType, energyType, expected] of cases) {
    assert.strictEqual(
      composeCategoryPath(category, trainerType, energyType),
      expected,
      `${category}/${trainerType}/${energyType}`
    );
  }
});

test('composeCategoryPath appends acespec to the real trainer subtype, or flat when it is unknown', () => {
  assert.strictEqual(composeCategoryPath('Trainer', 'Tool', null, { aceSpec: true }), 'trainer/tool/acespec');
  // Prime Catcher is an Item and Grand Tree a Stadium — neither becomes a tool.
  assert.strictEqual(composeCategoryPath('Trainer', 'Item', null, { aceSpec: true }), 'trainer/item/acespec');
  assert.strictEqual(composeCategoryPath('Trainer', 'Stadium', null, { aceSpec: true }), 'trainer/stadium/acespec');
  assert.strictEqual(composeCategoryPath('Trainer', null, null, { aceSpec: true }), 'trainer/acespec');
});

test('sortReportItems sorts by pct descending, then found, then name', () => {
  const items = [
    { pct: 50, found: 10, name: 'Card B' },
    { pct: 75, found: 15, name: 'Card A' },
    { pct: 50, found: 10, name: 'Card A' },
    { pct: 50, found: 15, name: 'Card C' }
  ];

  const result = sortReportItems(items);

  assert.strictEqual(result[0].name, 'Card A'); // 75%
  assert.strictEqual(result[1].name, 'Card C'); // 50%, 15 found
  assert.strictEqual(result[2].name, 'Card A'); // 50%, 10 found, name A
  assert.strictEqual(result[3].name, 'Card B'); // 50%, 10 found, name B
});

test('sortReportItems does not mutate original array', () => {
  const items = [
    { pct: 25, found: 5, name: 'Card B' },
    { pct: 75, found: 15, name: 'Card A' }
  ];
  const originalFirst = items[0];

  sortReportItems(items);

  assert.strictEqual(items[0], originalFirst);
});

test('assignRanks adds 1-based rank to items', () => {
  assert.deepStrictEqual(assignRanks([{ name: 'First' }, { name: 'Second' }, { name: 'Third' }]), [
    { name: 'First', rank: 1 },
    { name: 'Second', rank: 2 },
    { name: 'Third', rank: 3 }
  ]);
  assert.deepStrictEqual(assignRanks([]), []);
});
