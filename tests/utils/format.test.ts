import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatRecord,
  ordinal,
  ordinalSuffix,
  placementLabel,
  winPercent,
  winPercentLabel
} from '../../src/lib/format.ts';
import type { TournamentParticipant } from '../../src/types/index.ts';

function participant(overrides: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return { tpId: 1, name: 'Test Player', ...overrides };
}

test('formatRecord returns an em dash when wins, losses, and ties are all missing', () => {
  assert.equal(formatRecord(participant()), '—');
  assert.equal(formatRecord(participant({ wins: null, losses: null, ties: null })), '—');
});

test('formatRecord treats missing fields as 0 once at least one value is reported', () => {
  assert.equal(formatRecord(participant({ wins: 3 })), '3-0-0');
  assert.equal(formatRecord(participant({ losses: 2 })), '0-2-0');
  assert.equal(formatRecord(participant({ ties: 1 })), '0-0-1');
});

test('formatRecord renders a full record as-is', () => {
  assert.equal(formatRecord(participant({ wins: 6, losses: 2, ties: 1 })), '6-2-1');
});

test('winPercent excludes ties and rounds to a whole percent', () => {
  assert.equal(winPercent(330, 126), 72);
  assert.equal(winPercent(3, 1), 75);
  // Ties never enter the denominator: 6-2-1 is the same 75% as 6-2-0.
  assert.equal(winPercent(6, 2), 75);
});

test('winPercent is null for an unplayed record', () => {
  assert.equal(winPercent(0, 0), null);
});

test('winPercentLabel renders a percent, em dash when unplayed', () => {
  assert.equal(winPercentLabel(330, 126), '72%');
  assert.equal(winPercentLabel(0, 0), '—');
});

test('ordinal suffixes the usual 1st/2nd/3rd/4th', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
});

test('ordinal gives every teen a th, whatever its last digit', () => {
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(111), '111th');
  assert.equal(ordinal(113), '113th');
});

test('ordinal keeps suffixing past the teens', () => {
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(22), '22nd');
  assert.equal(ordinal(103), '103rd');
  assert.equal(ordinal(1699), '1699th');
});

test('placementLabel renders an em dash for an unplaced entry', () => {
  assert.equal(placementLabel(null), '—');
  assert.equal(placementLabel(undefined), '—');
  assert.equal(placementLabel(46), '46th');
});

test('ordinalSuffix is the suffix alone, for callers that print their own numeral', () => {
  assert.equal(ordinalSuffix(1), 'st');
  assert.equal(ordinalSuffix(12), 'th');
  assert.equal(ordinalSuffix(23), 'rd');
  assert.equal(ordinalSuffix(1699), 'th');
  // The four-digit case this exists for: the caller groups, we suffix.
  assert.equal(`${(1699).toLocaleString('en-US')}${ordinalSuffix(1699)}`, '1,699th');
});
