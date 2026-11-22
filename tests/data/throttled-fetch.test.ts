import assert from 'node:assert/strict';
import test from 'node:test';

import { createThrottledFetch } from '../../.github/scripts/lib/throttledFetch.ts';

function host(statuses: number[], retryAfter?: string) {
  const waits: number[] = [];
  let calls = 0;
  const throttled = createThrottledFetch({
    retries: 2,
    limit: 1,
    wait: async ms => {
      waits.push(ms);
    },
    fetch: async () => {
      const status = statuses[Math.min(calls, statuses.length - 1)];
      calls += 1;
      return new Response(null, { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} });
    }
  });
  return { throttled, waits, calls: () => calls };
}

test('throttling is waited out, as long as Retry-After asks, and other answers pass straight through', async () => {
  const slowed = host([429, 503, 200], '3');
  assert.equal((await slowed.throttled.fetch('https://example.test/a')).status, 200);
  assert.deepEqual(slowed.waits, [3000, 3000]);

  const missing = host([404]);
  assert.equal((await missing.throttled.fetch('https://example.test/b')).status, 404);
  assert.equal(missing.calls(), 1);
  assert.deepEqual(missing.waits, []);

  const backoff = host([429, 200]);
  await backoff.throttled.fetch('https://example.test/c');
  assert.deepEqual(backoff.waits, [2000]);
});

test('pages still refused after every retry are counted against the limit', async () => {
  const refusing = host([429]);
  assert.equal((await refusing.throttled.fetch('https://example.test/a')).status, 429);
  assert.equal(refusing.calls(), 3);
  refusing.throttled.assertWithinLimit();
  await refusing.throttled.fetch('https://example.test/b');
  assert.throws(() => refusing.throttled.assertWithinLimit(), /2 requests stayed throttled/);
});
