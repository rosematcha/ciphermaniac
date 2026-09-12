/**
 * The Trends page's small pure helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultOnlineWindow, sliceCardMovers } from '../../src/pages/trendsPage/model.ts';

test('movers are capped per direction', () => {
  const many = Array.from({ length: 30 }, (_, i) => i);
  const out = sliceCardMovers({ rising: many, falling: many }, 12);
  assert.equal(out.rising.length, 12);
  assert.equal(out.falling.length, 12);
  assert.equal(out.rising[0], 0, 'the top movers, not a random slice');
});

test('absent mover lists become empty ones', () => {
  assert.deepEqual(sliceCardMovers(null), { rising: [], falling: [] });
  assert.deepEqual(sliceCardMovers({}), { rising: [], falling: [] });
});

// ---------------------------------------------------------------------------
// Opening window
// ---------------------------------------------------------------------------

/** Stand in for the browser's matchMedia with a fixed answer. */
function withViewport<T>(narrow: boolean, run: () => T): T {
  const g = globalThis as { window?: unknown };
  const prev = g.window;
  g.window = { matchMedia: () => ({ matches: narrow }) };
  try {
    return run();
  } finally {
    g.window = prev;
  }
}

test('the online view opens on two weeks, or one on a phone', () => {
  assert.equal(withViewport(false, defaultOnlineWindow), '14d');
  assert.equal(withViewport(true, defaultOnlineWindow), '7d');
});
