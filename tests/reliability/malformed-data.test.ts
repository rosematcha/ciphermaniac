import test from 'node:test';
import assert from 'node:assert/strict';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';
import { fetchReportResource } from '../../src/api.ts';

// Malformed JSON and truncated responses

test('fetchReportResource handles truncated JSON without throwing uncaught', async () => {
  mockFetch({
    predicate: (input: RequestInfo) => String(input).includes('truncated'),
    status: 200,
    body: '{"incomplete": true' // truncated
  } as any);

  let threw = false;
  try {
    await fetchReportResource('truncated', 'trunc', 'object', 'trunc');
  } catch {
    threw = true;
  }

  // library should either return a parse error or throw a controlled error
  assert.ok(threw, 'Expected controlled throw on truncated JSON');
  restoreFetch();
});
