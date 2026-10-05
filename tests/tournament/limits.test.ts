/** The date a Community organizer's event holds. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { eventDay, organizerToday } from '../../shared/tournament/limits.ts';

test('an event is on the date its start time names, or the organizer’s today without one', () => {
  assert.equal(eventDay('2026-10-09T19:30', '2026-10-04'), '2026-10-09');
  assert.equal(eventDay('', '2026-10-04'), '2026-10-04');
  assert.equal(eventDay('soon', '2026-10-04'), '2026-10-04');
});

test('the organizer’s today is their browser’s when it is within a day of the server’s', () => {
  const now = Date.parse('2026-10-04T02:00:00Z');
  assert.equal(organizerToday('2026-10-03', now), '2026-10-03', 'still Saturday in Texas');
  assert.equal(organizerToday('2026-10-05', now), '2026-10-05', 'already Monday somewhere');
  assert.equal(organizerToday('2026-10-07', now), '2026-10-04', 'no time zone is three days ahead');
  assert.equal(organizerToday('tomorrow', now), '2026-10-04');
  assert.equal(organizerToday(undefined, now), '2026-10-04');
});
