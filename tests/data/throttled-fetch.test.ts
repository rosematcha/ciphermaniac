import assert from 'node:assert/strict';
import test from 'node:test';

import { createThrottledFetch, prefetchAll } from '../../.github/scripts/lib/throttledFetch.ts';

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

test('prefetching keeps at most the given number of requests open and stops admitting on request', async () => {
  let open = 0;
  let peak = 0;
  const done: number[] = [];
  let stop = false;
  await prefetchAll(
    Array.from({ length: 20 }, (_, index) => index),
    async index => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise(resolve => {
        setTimeout(resolve, 2);
      });
      open -= 1;
      done.push(index);
      stop ||= index === 5;
    },
    { concurrency: 4, stop: () => stop }
  );
  assert.equal(peak, 4);
  assert.ok(done.length < 20 && done.length <= 6 + 4, `${done.length} requests ran`);
  assert.ok(done.includes(5));
});

test('a host that always throttles ends the prefetch after the limit, not after every page', async () => {
  const { throttled } = host([429]);
  let asked = 0;
  await prefetchAll(
    Array.from({ length: 1000 }, (_, index) => index),
    async index => {
      asked += 1;
      await throttled.fetch(`https://example.test/${index}`);
    },
    { concurrency: 4, stop: () => throttled.exhausted() }
  );
  assert.ok(asked <= 2 + 4, `${asked} pages asked for`);
  assert.throws(() => throttled.assertWithinLimit(), /stayed throttled/);
});
