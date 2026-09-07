import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configurePrefetch, prefetchRoute } from '../../src/lib/prefetch';

test('prefetch deduplicates successful loads and ignores unknown routes', async () => {
  let calls = 0;
  configurePrefetch({
    '/cards': async () => {
      calls++;
    }
  });
  prefetchRoute('/unknown');
  prefetchRoute('/cards');
  prefetchRoute('/cards');
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('a failed prefetch can be retried', async () => {
  let calls = 0;
  configurePrefetch({
    '/cards': async () => {
      calls++;
      if (calls === 1) {
        throw new Error('offline');
      }
    }
  });
  prefetchRoute('/cards');
  await Promise.resolve();
  prefetchRoute('/cards');
  await Promise.resolve();
  assert.equal(calls, 2);
});
