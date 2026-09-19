/** The stored live schedule: anything unreadable is no schedule, and a stored one ages out. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isStoredScheduleFresh, parseStoredSchedule } from '../../src/lib/liveSchedule.ts';

const STORED = { fetchedAt: 1_000, schedule: { generatedAt: '2026-09-19T00:00:00Z', events: [] } };

test('only a stored schedule parses as one', () => {
  assert.deepEqual(parseStoredSchedule(JSON.stringify(STORED)), STORED);
  for (const raw of [null, '', 'not json', '{}', '{"fetchedAt":"1","schedule":{"events":[]}}', '{"fetchedAt":1}']) {
    assert.equal(parseStoredSchedule(raw), null);
  }
});

test('a stored schedule is fresh for six hours', () => {
  const sixHours = 6 * 3_600_000;
  assert.equal(isStoredScheduleFresh(STORED, 1_000 + sixHours - 1), true);
  assert.equal(isStoredScheduleFresh(STORED, 1_000 + sixHours), false);
  assert.equal(isStoredScheduleFresh(null, 1_000), false);
});
