/** Which badges an account's counts and grants come to, and in what order. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { badgesOf, tierOf } from '../../shared/accounts/achievements.ts';

test('a tier starts at its threshold, and a count short of the first earns nothing', () => {
  assert.equal(tierOf('played', 0), 0);
  assert.equal(tierOf('played', 1), 1, 'a first event is the first tier');
  assert.equal(tierOf('played', 4), 1);
  assert.equal(tierOf('played', 5), 2);
  assert.equal(tierOf('played', 100), 4);
  assert.equal(tierOf('played', 5000), 4, 'the top tier has no ceiling');
  assert.equal(tierOf('traveler', 1), 0, 'one city is home');
  assert.equal(tierOf('traveler', 2), 1);
});

test('badges held outright come first, then counted ones in catalog order, skipping any unearned', () => {
  const badges = badgesOf({ staffed: 12, played: 3, won: 0, traveler: 1 }, new Set(['early', 'creator', 'unknown']));
  assert.deepEqual(badges, [
    { key: 'creator' },
    { key: 'early' },
    { key: 'played', count: 3, tier: 1 },
    { key: 'staffed', count: 12, tier: 2 }
  ]);
});

test('an account with nothing earned shows no badges', () => {
  assert.deepEqual(badgesOf({}, new Set()), []);
});
