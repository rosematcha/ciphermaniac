import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatRecord,
  ordinal,
  placementLabel,
  shortDateParts,
  winPercent,
  winPercentLabel
} from '../../src/lib/format.ts';
import type { TournamentParticipant } from '../../src/types/index.ts';

function participant(overrides: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return { tpId: 1, name: 'Test Player', ...overrides };
}

test('shortDateParts splits a date into the short month and the day of month, and is null for a missing or invalid one', () => {
  const date = new Date(2026, 5, 12);
  assert.deepEqual(shortDateParts(date), {
    month: date.toLocaleDateString(undefined, { month: 'short' }),
    day: date.toLocaleDateString(undefined, { day: 'numeric' })
  });
  assert.equal(shortDateParts(null), null);
  assert.equal(shortDateParts(new Date(Number.NaN)), null);
});

test('formatRecord treats missing fields as 0 once at least one value is reported, else an em dash', () => {
  const cases = [
    [{}, '—'],
    [{ wins: null, losses: null, ties: null }, '—'],
    [{ wins: 3 }, '3-0-0'],
    [{ losses: 2 }, '0-2-0'],
    [{ ties: 1 }, '0-0-1'],
    [{ wins: 6, losses: 2, ties: 1 }, '6-2-1']
  ] as const;
  for (const [overrides, expected] of cases) {
    assert.equal(formatRecord(participant(overrides)), expected, JSON.stringify(overrides));
  }
});

test('winPercent excludes ties and rounds to a whole percent, and is null for an unplayed record', () => {
  assert.equal(winPercent(330, 126), 72);
  assert.equal(winPercent(3, 1), 75);
  // Ties never enter the denominator: 6-2-1 is the same 75% as 6-2-0.
  assert.equal(winPercent(6, 2), 75);
  assert.equal(winPercent(0, 0), null);
  assert.equal(winPercentLabel(330, 126), '72%');
  assert.equal(winPercentLabel(0, 0), '—');
});

test('ordinal suffixes placements, giving every teen a th whatever its last digit', () => {
  const cases = [
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [111, '111th'],
    [113, '113th'],
    [21, '21st'],
    [22, '22nd'],
    [103, '103rd'],
    [1699, '1699th']
  ] as const;
  for (const [n, expected] of cases) {
    assert.equal(ordinal(n), expected);
  }
});

test('placementLabel renders an em dash for an unplaced entry', () => {
  assert.equal(placementLabel(null), '—');
  assert.equal(placementLabel(undefined), '—');
  assert.equal(placementLabel(46), '46th');
});
