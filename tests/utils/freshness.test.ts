import test from 'node:test';
import assert from 'node:assert/strict';

import { absoluteIso, relativeTimeAgo } from '../../src/lib/freshness.ts';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');

test('relativeTimeAgo uses coarse, stable units at each boundary', () => {
  assert.equal(relativeTimeAgo('2026-09-07T11:59:30.000Z', NOW), 'less than a minute');
  assert.equal(relativeTimeAgo('2026-09-07T11:59:00.000Z', NOW), '1 minute');
  assert.equal(relativeTimeAgo('2026-09-07T11:00:00.000Z', NOW), '1 hour');
  assert.equal(relativeTimeAgo('2026-09-06T12:00:00.000Z', NOW), '1 day');
});

test('relativeTimeAgo floors elapsed time and never reports a future timestamp', () => {
  assert.equal(relativeTimeAgo('2026-09-07T10:31:59.000Z', NOW), '1 hour');
  assert.equal(relativeTimeAgo('2026-09-07T13:00:00.000Z', NOW), 'less than a minute');
});

test('relativeTimeAgo returns null for an invalid timestamp', () => {
  assert.equal(relativeTimeAgo('not-a-date', NOW), null);
});

test('absoluteIso canonicalizes valid timestamps and preserves invalid input', () => {
  assert.equal(absoluteIso('2026-09-07T07:00:00-05:00'), '2026-09-07T12:00:00.000Z');
  assert.equal(absoluteIso('not-a-date'), 'not-a-date');
});
