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

test('Retry-After as an HTTP date is honored, and a wait past a minute counts as refused at once', async () => {
  const soon = new Date(Date.now() + 30_000).toUTCString();
  const dated = host([429, 200], soon);
  assert.equal((await dated.throttled.fetch('https://example.test/a')).status, 200);
  assert.equal(dated.waits.length, 1);
  assert.ok(dated.waits[0] > 25_000 && dated.waits[0] <= 30_000, String(dated.waits[0]));

  for (const later of ['120', new Date(Date.now() + 120_000).toUTCString()]) {
    const closed = host([429, 200], later);
    assert.equal((await closed.throttled.fetch('https://example.test/b')).status, 429, later);
    assert.deepEqual(closed.waits, []);
    assert.equal(closed.calls(), 1);
  }
});

test('a host asking for a long wait gets no retry and no further requests, and the run fails', async () => {
  const { throttled, waits, calls } = host([429, 200], '120');
  assert.deepEqual(await throttled.get('https://example.test/a', undefined, 3), { response: null, throttled: true });
  assert.equal(calls(), 1);
  assert.deepEqual(waits, []);
  assert.equal(throttled.exhausted(), true);
  assert.deepEqual(await throttled.get('https://example.test/b', undefined, 3), { response: null, throttled: false });
  assert.equal(calls(), 1, 'nothing more is sent once the host closed');
  assert.throws(() => throttled.assertWithinLimit(), /longer wait/);
});

test('other failures are retried with a short backoff, and a success comes back', async () => {
  const { throttled, waits } = host([500, 404, 200]);
  assert.equal((await throttled.get('https://example.test/a', undefined, 3)).response?.status, 200);
  assert.deepEqual(waits, [500, 1000]);
  const missing = host([404]);
  assert.deepEqual(await missing.throttled.get('https://example.test/b', undefined, 2), {
    response: null,
    throttled: false
  });
  assert.equal(missing.calls(), 2);
});

test('a worker asleep when the host closes the run does not ask again when it wakes', async () => {
  let release: () => void = () => {};
  const parked = new Promise<void>(resolve => {
    release = resolve;
  });
  const sent: string[] = [];
  const throttled = createThrottledFetch({
    wait: () => parked,
    fetch: async input => {
      sent.push(String(input));
      return new Response(null, {
        status: 429,
        headers: { 'retry-after': String(input).endsWith('/a') ? '1' : '120' }
      });
    }
  });
  const sleeping = throttled.fetch('https://example.test/a');
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  await throttled.fetch('https://example.test/b');
  assert.equal(throttled.exhausted(), true);
  release();
  assert.equal((await sleeping).status, 429);
  assert.deepEqual(sent, ['https://example.test/a', 'https://example.test/b']);
});

test('a blank Retry-After backs off rather than retrying at once', async () => {
  const { throttled, waits } = host([429, 200], '   ');
  await throttled.fetch('https://example.test/a');
  assert.deepEqual(waits, [2000]);
});

test('a failed prefetch stops the other workers from starting more work', async () => {
  let started = 0;
  await assert.rejects(
    prefetchAll(
      Array.from({ length: 100 }, (_, index) => index),
      async index => {
        started += 1;
        if (index === 0) {
          throw new Error('body terminated');
        }
        await new Promise(resolve => {
          setTimeout(resolve, 2);
        });
      },
      { concurrency: 4, stop: () => false }
    ),
    /body terminated/
  );
  assert.ok(started <= 4, `${started} items started`);
});

test('a success that lands after a sibling request was refused is still the success of that request', async () => {
  let releaseOk: () => void = () => {};
  const okHeld = new Promise<void>(resolve => {
    releaseOk = resolve;
  });
  const throttled = createThrottledFetch({
    retries: 0,
    limit: 5,
    wait: async () => {},
    fetch: async input => {
      if (String(input).endsWith('/ok')) {
        await okHeld;
        return new Response('table', { status: 200 });
      }
      return new Response(null, { status: 429 });
    }
  });
  const ok = throttled.get('https://example.test/ok', undefined, 2);
  const refused = await throttled.get('https://example.test/refused', undefined, 2);
  assert.equal(refused.throttled, true);
  releaseOk();
  const result = await ok;
  assert.equal(result.throttled, false);
  assert.equal(await result.response?.text(), 'table');
});

test('a discarded 404 and a waited-out 429 have their bodies cancelled, so the socket is reused', async () => {
  const statuses = [429, 200, 404];
  let cancelled = 0;
  const throttled = createThrottledFetch({
    wait: async () => {},
    fetch: async () => {
      const body = new ReadableStream({
        cancel() {
          cancelled += 1;
        }
      });
      return new Response(body, { status: statuses.shift() ?? 404 });
    }
  });
  assert.equal((await throttled.get('https://host/a')).response?.status, 200);
  assert.equal(cancelled, 1);
  assert.equal((await throttled.get('https://host/b', undefined, 1)).response, null);
  assert.equal(cancelled, 2);
});
