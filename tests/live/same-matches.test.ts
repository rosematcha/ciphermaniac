import assert from 'node:assert/strict';
import test from 'node:test';

import { sameMatches } from '../../shared/live/sameMatches.ts';
import type { LiveMatch, LiveSeat } from '../../shared/live/types.ts';

const seat: LiveSeat = { name: 'Player', country: 'US', wins: 1, losses: 0, ties: 0, points: 3 };
const match: LiveMatch = { table: 1, complete: false, seats: [seat] };

test('every published seat field participates in change detection', () => {
  const changes: LiveSeat[] = [
    { ...seat, name: 'Other' },
    { ...seat, country: 'CA' },
    { ...seat, wins: 2 },
    { ...seat, losses: 1 },
    { ...seat, ties: 1 },
    { ...seat, points: 4 },
    { ...seat, result: 'win' },
    { ...seat, dropped: true }
  ];
  for (const changed of changes) {
    const after = [{ ...match, seats: [changed] }];
    assert.equal(sameMatches([match], after), false);
    assert.equal(sameMatches(after, [match]), false);
  }
  assert.equal(sameMatches([match], structuredClone([match])), true);
});

test('table, confirmation, submitted results, seat order and match counts are compared', () => {
  const changes: LiveMatch[][] = [
    [{ ...match, table: 2 }],
    [{ ...match, complete: true }],
    [{ ...match, submitted: 'p1' }],
    [{ ...match, seats: [] }],
    [{ ...match, seats: [seat, seat] }],
    [],
    [match, match]
  ];
  for (const after of changes) {
    assert.equal(sameMatches([match], after), false);
  }
  const other = { ...seat, name: 'Other' };
  assert.equal(sameMatches([{ ...match, seats: [seat, other] }], [{ ...match, seats: [other, seat] }]), false);
  assert.equal(sameMatches([], []), true);
});
