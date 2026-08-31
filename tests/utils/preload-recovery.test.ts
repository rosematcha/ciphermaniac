/**
 * Recovery from a lazy chunk that a deploy removed.
 *
 * The DOM side is a listener and a reload; the part worth pinning is the
 * guard, since getting it wrong means either a blank route (never reload) or a
 * reload loop (always reload).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RELOAD_GUARD_MS, shouldReloadAfterPreloadError } from '../../src/lib/preloadRecovery.ts';

const NOW = 1_800_000_000_000;

test('the first preload failure reloads', () => {
  assert.equal(shouldReloadAfterPreloadError(null, NOW), true);
});

test('a second failure straight after the reload does not loop', () => {
  assert.equal(shouldReloadAfterPreloadError(NOW - 1_000, NOW), false);
  assert.equal(shouldReloadAfterPreloadError(NOW - (RELOAD_GUARD_MS - 1), NOW), false);
});

test('a failure long after the last reload is a new deploy, so it reloads again', () => {
  assert.equal(shouldReloadAfterPreloadError(NOW - RELOAD_GUARD_MS, NOW), true);
  assert.equal(shouldReloadAfterPreloadError(NOW - 60 * 60_000, NOW), true);
});

test('unreadable guard state reloads rather than giving up', () => {
  assert.equal(shouldReloadAfterPreloadError(Number.NaN, NOW), true);
});
