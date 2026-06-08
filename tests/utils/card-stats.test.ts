import test from 'node:test';
import assert from 'node:assert/strict';

import { averageCopies, averageCopiesValue, roundedCopies } from '../../src/lib/cardStats.ts';

test('averageCopiesValue computes a weighted mean', () => {
  // 1 player @1, 3 players @4 → (1 + 12) / 4 = 3.25
  const v = averageCopiesValue({
    dist: [
      { copies: 1, players: 1 },
      { copies: 4, players: 3 }
    ]
  });
  assert.equal(v, 3.25);
});

test('averageCopiesValue returns null without a usable distribution', () => {
  assert.equal(averageCopiesValue({}), null);
  assert.equal(averageCopiesValue({ dist: [] }), null);
  assert.equal(averageCopiesValue({ dist: [{ copies: 2, players: 0 }] }), null);
});

test('averageCopies formats to two decimals or an em dash', () => {
  assert.equal(averageCopies({ dist: [{ copies: 2, players: 2 }] }), '2.00');
  assert.equal(averageCopies({}), '—');
});

test('roundedCopies rounds half up and floors at 1', () => {
  assert.equal(roundedCopies({ category: 'pokemon' }, 1.5), 2);
  assert.equal(roundedCopies({ category: 'pokemon' }, 1.4), 1);
  assert.equal(roundedCopies({ category: 'pokemon' }, 0.2), 1);
});

test('roundedCopies caps non-energy at 4 but leaves basic energy uncapped', () => {
  assert.equal(roundedCopies({ category: 'pokemon' }, 5.1), 4);
  assert.equal(roundedCopies({ category: 'trainer/item' }, 9), 4);
  assert.equal(roundedCopies({ category: 'energy/basic' }, 9), 9);
  assert.equal(roundedCopies({ supertype: 'Energy' }, 6.3), 6);
});
