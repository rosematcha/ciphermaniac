import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchReportResource } from '../../src/api.ts';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

// Simulate concurrent fetches and partial failures

test('concurrent fetches - one slow one fast and partial failure', async () => {
  // Setup all mocks in a single call - mockFetch replaces any previous mocks
  mockFetch([
    // slow
    {
      predicate: (input: RequestInfo) => String(input).includes('slow-endpoint'),
      delay: 200,
      status: 200,
      body: JSON.stringify({ ok: true }),
      headers: { 'content-type': 'application/json' }
    },
    // fast
    {
      predicate: (input: RequestInfo) => String(input).includes('fast-endpoint'),
      delay: 5,
      status: 200,
      body: JSON.stringify({ ok: true }),
      headers: { 'content-type': 'application/json' }
    },
    // failure
    {
      predicate: (input: RequestInfo) => String(input).includes('bad-endpoint'),
      status: 500,
      body: 'error',
      headers: { 'content-type': 'text/plain' }
    }
  ] as any);

  const p1 = fetchReportResource('fast-endpoint', 'fast', 'object', 'fast');
  const p2 = fetchReportResource('slow-endpoint', 'slow', 'object', 'slow');
  const p3 = fetchReportResource('bad-endpoint', 'bad', 'object', 'bad').catch(error => error);

  const results = await Promise.all([p1, p2, p3]);
  assert.ok(results[0] && results[1]);
  assert.ok(results[2] instanceof Error || results[2].status >= 400);

  restoreFetch();
});
