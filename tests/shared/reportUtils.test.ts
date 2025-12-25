/**
 * tests/shared/reportUtils.test.ts
 * Tests for shared/reportUtils.ts - report generation utilities shared across frontend and backend
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignRanks,
  calculatePercentage,
  composeCategoryPath,
  createDistributionFromCounts,
  createDistributionFromHistogram,
  sortReportItems
} from '../../shared/reportUtils.js';

// ============================================================================
// calculatePercentage tests
// ============================================================================

test('calculatePercentage returns correct percentage with 2 decimal places', () => {
  assert.strictEqual(calculatePercentage(50, 100), 50);
  assert.strictEqual(calculatePercentage(1, 3), 33.33);
  assert.strictEqual(calculatePercentage(2, 3), 66.67);
  assert.strictEqual(calculatePercentage(25, 100), 25);
});

test('calculatePercentage returns 0 when denominator is 0 or negative', () => {
  assert.strictEqual(calculatePercentage(50, 0), 0);
  assert.strictEqual(calculatePercentage(50, -10), 0);
});

test('calculatePercentage handles 100% correctly', () => {
  assert.strictEqual(calculatePercentage(100, 100), 100);
  assert.strictEqual(calculatePercentage(50, 50), 100);
});

test('calculatePercentage handles small percentages', () => {
  assert.strictEqual(calculatePercentage(1, 1000), 0.1);
  assert.strictEqual(calculatePercentage(1, 10000), 0.01);
});

// ============================================================================
// createDistributionFromHistogram tests
// ============================================================================

test('createDistributionFromHistogram creates correct distribution', () => {
  const histogram = new Map<number, number>([
    [1, 5],
    [2, 10],
    [3, 3]
  ]);
  const result = createDistributionFromHistogram(histogram, 18);

  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result[0], { copies: 1, players: 5, percent: 27.78 });
  assert.deepStrictEqual(result[1], { copies: 2, players: 10, percent: 55.56 });
  assert.deepStrictEqual(result[2], { copies: 3, players: 3, percent: 16.67 });
});

test('createDistributionFromHistogram sorts by copies ascending', () => {
  const histogram = new Map<number, number>([
    [4, 2],
    [1, 5],
    [2, 3]
  ]);
  const result = createDistributionFromHistogram(histogram, 10);

  assert.strictEqual(result[0].copies, 1);
  assert.strictEqual(result[1].copies, 2);
  assert.strictEqual(result[2].copies, 4);
});

test('createDistributionFromHistogram handles empty histogram', () => {
  const histogram = new Map<number, number>();
  const result = createDistributionFromHistogram(histogram, 0);

  assert.strictEqual(result.length, 0);
});

// ============================================================================
// createDistributionFromCounts tests
// ============================================================================

test('createDistributionFromCounts creates distribution from raw counts', () => {
  const counts = [1, 2, 2, 3, 2, 1];
  const result = createDistributionFromCounts(counts, 6);

  assert.strictEqual(result.length, 3);
  // 2 players with 1 copy, 3 players with 2 copies, 1 player with 3 copies
  assert.deepStrictEqual(result[0], { copies: 1, players: 2, percent: 33.33 });
  assert.deepStrictEqual(result[1], { copies: 2, players: 3, percent: 50 });
  assert.deepStrictEqual(result[2], { copies: 3, players: 1, percent: 16.67 });
});

test('createDistributionFromCounts handles non-numeric values at runtime', () => {
  // At runtime, we might receive bad data. The function converts values via Number()
  const counts = [1, 0, 2, 0, 2] as number[];
  const result = createDistributionFromCounts(counts, 5);

  // 0s become 0
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].copies, 0);
  assert.strictEqual(result[0].players, 2);
});

// ============================================================================
// composeCategoryPath tests
// ============================================================================

test('composeCategoryPath creates pokemon path', () => {
  assert.strictEqual(composeCategoryPath('Pokemon', null, null), 'pokemon');
  assert.strictEqual(composeCategoryPath('POKEMON', null, null), 'pokemon');
});

test('composeCategoryPath creates trainer paths with subtypes', () => {
  assert.strictEqual(composeCategoryPath('Trainer', 'Supporter', null), 'trainer/supporter');
  assert.strictEqual(composeCategoryPath('Trainer', 'Item', null), 'trainer/item');
  assert.strictEqual(composeCategoryPath('Trainer', 'Stadium', null), 'trainer/stadium');
  assert.strictEqual(composeCategoryPath('Trainer', 'Tool', null), 'trainer/tool');
});

test('composeCategoryPath handles ace spec tools', () => {
  const result = composeCategoryPath('Trainer', 'Tool', null, { aceSpec: true });
  assert.strictEqual(result, 'trainer/tool/acespec');
});

test('composeCategoryPath adds tool for ace spec without explicit tool type', () => {
  const result = composeCategoryPath('Trainer', null, null, { aceSpec: true });
  assert.strictEqual(result, 'trainer/tool/acespec');
});

test('composeCategoryPath creates energy paths', () => {
  assert.strictEqual(composeCategoryPath('Energy', null, 'Basic'), 'energy/basic');
  assert.strictEqual(composeCategoryPath('Energy', null, 'Special'), 'energy/special');
});

test('composeCategoryPath returns empty string for null/empty category', () => {
  assert.strictEqual(composeCategoryPath(null, null, null), '');
  assert.strictEqual(composeCategoryPath('', null, null), '');
  assert.strictEqual(composeCategoryPath(undefined, null, null), '');
});

// ============================================================================
// sortReportItems tests
// ============================================================================

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

// ============================================================================
// assignRanks tests
// ============================================================================

test('assignRanks adds 1-based rank to items', () => {
  const items = [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }];

  const result = assignRanks(items);

  assert.strictEqual(result[0].rank, 1);
  assert.strictEqual(result[1].rank, 2);
  assert.strictEqual(result[2].rank, 3);
  assert.strictEqual(result[0].name, 'First');
});

test('assignRanks handles empty array', () => {
  const result = assignRanks([]);
  assert.strictEqual(result.length, 0);
});
