import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchReportResource } from '../../src/api.ts';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

// Network failure and retry/backoff behavior smoke tests

test('fetchReportResource handles 500 and returns a rejected promise', async () => {
  mockFetch({
    predicate: (input: RequestInfo) => String(input).includes('fail-500'),
    status: 500,
    body: 'server error'
  } as any);

  let caught = false;
  try {
    await fetchReportResource('fail-500', 'fail500', 'object', 'fail');
  } catch {
    caught = true;
  }
  assert.ok(caught, 'Expected fetchReportResource to throw on 500');

  restoreFetch();
});

test('fetchReportResource supports transient 429 then success pattern', async () => {
  let called = 0;
  mockFetch({
    predicate: (input: RequestInfo) => String(input).includes('throttle'),
    handler: async (_req: RequestInfo) => {
      called++;
      if (called === 1) {
        return { status: 429, body: 'too many' } as any;
      }
      return { status: 200, body: JSON.stringify({ ok: true }) } as any;
    }
  } as any);

  const report = await fetchReportResource('throttle', 'throttle', 'object', 'throttle');
  assert.ok(report && typeof report === 'object');
  restoreFetch();
});
