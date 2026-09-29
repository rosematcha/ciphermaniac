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

test('a preload failure reloads unless the last reload was within the guard window', () => {
  const cases = [
    ['the first preload failure reloads', null, true],
    ['a second failure straight after the reload does not loop', NOW - 1_000, false],
    ['a failure just inside the guard does not loop', NOW - (RELOAD_GUARD_MS - 1), false],
    // A failure long after the last reload is a new deploy.
    ['a failure at the guard edge reloads again', NOW - RELOAD_GUARD_MS, true],
    ['a failure an hour later reloads again', NOW - 60 * 60_000, true],
    ['unreadable guard state reloads rather than giving up', Number.NaN, true]
  ] as const;
  for (const [name, lastReload, expected] of cases) {
    assert.equal(shouldReloadAfterPreloadError(lastReload, NOW), expected, name);
  }
});
