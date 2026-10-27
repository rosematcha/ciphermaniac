/**
 * Before the format producer first publishes there is no formats index, and
 * the selector must show no Other group rather than fail. One scenario per
 * file: the data client memoizes each path.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { fetchFormatsList } from '../../src/lib/data/reports.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a missing formats index reads as no formats', async () => {
  globalThis.fetch = (async () => new Response('missing', { status: 404 })) as typeof globalThis.fetch;
  assert.deepEqual(await fetchFormatsList(), []);
});
