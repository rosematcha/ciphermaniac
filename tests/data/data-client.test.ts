/**
 * Characterization tests for the browser data transport.
 *
 * These pin the behavior `src/lib/data.ts` has always had — dedupe, TTL,
 * eviction on failure, optional-vs-required 404 handling, release-path
 * resolution, and missing-release-body recovery — so the decomposition of that
 * module cannot change it by accident. Written against the injected seams, not
 * against the app's globals.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDataClient, type DataClientOptions, FETCH_TTL_MS, R2_BASE } from '../../src/lib/data/client.ts';

/** A controllable clock, so TTL behavior is asserted rather than slept through. */
function makeClock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    }
  };
}

interface StubCall {
  url: string;
  init?: RequestInit;
}

/** A fetch stub that records calls and answers from a path → response table. */
function makeFetch(table: Record<string, () => Response | Promise<Response>>, fallback?: () => Response) {
  const calls: StubCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [needle, respond] of Object.entries(table)) {
      if (url.includes(needle)) {
        return respond();
      }
    }
    return fallback ? fallback() : new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A client with every seam stubbed to an inert default. */
function client(options: DataClientOptions = {}) {
  return createDataClient({
    resolvePath: p => p,
    isReleaseBodyPath: () => false,
    recoverFromMissingBody: () => false,
    useLocalOrigin: () => false,
    ...options
  });
}

// ---------------------------------------------------------------------------
// Success and URL construction
// ---------------------------------------------------------------------------

test('a successful fetch returns the parsed body from the R2 origin', async () => {
  const { impl, calls } = makeFetch({ '/reports/x.json': () => json({ ok: 1 }) });
  const c = client({ fetch: impl });
  assert.deepEqual(await c.fetchJson('/reports/x.json'), { ok: 1 });
  assert.equal(calls[0].url, `${R2_BASE}/reports/x.json`);
  assert.equal((calls[0].init as RequestInit).mode, 'cors', 'CORS mode is required for cross-origin R2 reads');
});

test('a local-origin path skips the R2 base', async () => {
  const { impl, calls } = makeFetch({ Snapshots: () => json([]) });
  const c = client({ fetch: impl, useLocalOrigin: p => p.startsWith('/reports/Snapshots/') });
  await c.fetchJson('/reports/Snapshots/2026-01-01/master.json');
  assert.equal(calls[0].url, '/reports/Snapshots/2026-01-01/master.json');
});

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

test('a required fetch rejects on 404 with the URL and status in the message', async () => {
  const { impl } = makeFetch({}, () => new Response('gone', { status: 404, statusText: 'Not Found' }));
  await assert.rejects(client({ fetch: impl }).fetchJson('/reports/missing.json'), /missing\.json: 404/);
});

test('an optional fetch resolves to null on 404', async () => {
  const { impl } = makeFetch({}, () => new Response('gone', { status: 404 }));
  assert.equal(await client({ fetch: impl }).fetchJsonOptional('/reports/missing.json'), null);
});

test('an optional fetch still rejects on a non-404 error', async () => {
  const { impl } = makeFetch({}, () => new Response('boom', { status: 500, statusText: 'Server Error' }));
  await assert.rejects(client({ fetch: impl }).fetchJsonOptional('/reports/x.json'), /500/);
});

test('a transport failure propagates rather than resolving to null', async () => {
  const impl = (async () => {
    throw new TypeError('network down');
  }) as typeof globalThis.fetch;
  await assert.rejects(client({ fetch: impl }).fetchJsonOptional('/reports/x.json'), /network down/);
});

// ---------------------------------------------------------------------------
// Dedupe and TTL
// ---------------------------------------------------------------------------

test('concurrent requests for one URL share a single fetch', async () => {
  let resolveBody: (v: Response) => void = () => {};
  const gate = new Promise<Response>(resolve => {
    resolveBody = resolve;
  });
  const { impl, calls } = makeFetch({ '/reports/x.json': () => gate });
  const c = client({ fetch: impl });

  const all = Promise.all([
    c.fetchJson('/reports/x.json'),
    c.fetchJson('/reports/x.json'),
    c.fetchJson('/reports/x.json')
  ]);
  resolveBody(json({ ok: 1 }));
  const results = await all;

  assert.equal(calls.length, 1, 'three callers, one download');
  assert.deepEqual(results, [{ ok: 1 }, { ok: 1 }, { ok: 1 }]);
});

test('a resolved response is reused within the TTL', async () => {
  const clock = makeClock();
  const { impl, calls } = makeFetch({ '/reports/x.json': () => json({ ok: 1 }) });
  const c = client({ fetch: impl, now: clock.now });

  await c.fetchJson('/reports/x.json');
  clock.advance(FETCH_TTL_MS - 1);
  await c.fetchJson('/reports/x.json');
  assert.equal(calls.length, 1);
});

test('a resolved response is refetched after the TTL expires', async () => {
  const clock = makeClock();
  const { impl, calls } = makeFetch({ '/reports/x.json': () => json({ ok: 1 }) });
  const c = client({ fetch: impl, now: clock.now });

  await c.fetchJson('/reports/x.json');
  clock.advance(FETCH_TTL_MS + 1);
  await c.fetchJson('/reports/x.json');
  assert.equal(calls.length, 2, 'a tab left open across the daily update must see fresh data');
});

test('different paths do not share a cache entry', async () => {
  const { impl, calls } = makeFetch({
    '/reports/a.json': () => json({ a: 1 }),
    '/reports/b.json': () => json({ b: 2 })
  });
  const c = client({ fetch: impl });
  assert.deepEqual(await c.fetchJson('/reports/a.json'), { a: 1 });
  assert.deepEqual(await c.fetchJson('/reports/b.json'), { b: 2 });
  assert.equal(calls.length, 2);
});

test('an optional miss is cached like any other resolved response', async () => {
  const { impl, calls } = makeFetch({}, () => new Response('gone', { status: 404 }));
  const c = client({ fetch: impl });
  assert.equal(await c.fetchJsonOptional('/reports/x.json'), null);
  assert.equal(await c.fetchJsonOptional('/reports/x.json'), null);
  assert.equal(calls.length, 1, 'a known-absent optional artifact is not re-requested every render');
});

// ---------------------------------------------------------------------------
// Failure eviction — a retry must actually retry
// ---------------------------------------------------------------------------

test('a rejected request is evicted so a retry hits the network', async () => {
  let attempt = 0;
  const impl = (async () => {
    attempt += 1;
    return attempt === 1 ? new Response('boom', { status: 500 }) : json({ ok: 1 });
  }) as typeof globalThis.fetch;
  const c = client({ fetch: impl });

  await assert.rejects(c.fetchJson('/reports/x.json'));
  assert.deepEqual(await c.fetchJson('/reports/x.json'), { ok: 1 });
  assert.equal(attempt, 2);
});

test('eviction on failure does not remove a newer entry for the same URL', async () => {
  // A slow failing request must not evict the successful retry that replaced it.
  let releaseFirst: (v: Response) => void = () => {};
  const first = new Promise<Response>(resolve => {
    releaseFirst = resolve;
  });
  let call = 0;
  const impl = (async () => {
    call += 1;
    return call === 1 ? first : json({ ok: 2 });
  }) as typeof globalThis.fetch;

  const clock = makeClock();
  const c = client({ fetch: impl, now: clock.now });

  const failing = c.fetchJson('/reports/x.json');
  // Push the in-flight entry past its expiry so the retry starts a new one.
  clock.advance(FETCH_TTL_MS + 1);
  releaseFirst(new Response('boom', { status: 500 }));
  await assert.rejects(failing);

  assert.deepEqual(await c.fetchJson('/reports/x.json'), { ok: 2 });
});

test('expired entries are swept on insert rather than accumulating', async () => {
  const clock = makeClock();
  const { impl } = makeFetch({}, () => json({ ok: 1 }));
  const c = client({ fetch: impl, now: clock.now });

  await c.fetchJson('/reports/a.json');
  await c.fetchJson('/reports/b.json');
  assert.equal(c.cacheSize, 2);

  clock.advance(FETCH_TTL_MS + 1);
  await c.fetchJson('/reports/c.json');
  assert.equal(c.cacheSize, 1, 'multi-MB payloads must not be held for the session');
});

// ---------------------------------------------------------------------------
// Release-path resolution
// ---------------------------------------------------------------------------

test('paths go through the release resolver before being fetched', async () => {
  const { impl, calls } = makeFetch({}, () => json({ ok: 1 }));
  const c = client({
    fetch: impl,
    resolvePath: p => (p === '/reports/Online - Last 14 Days/master.json' ? '/releases/v1/abc/online/master.json' : p)
  });
  await c.fetchJson('/reports/Online - Last 14 Days/master.json');
  assert.equal(calls[0].url, `${R2_BASE}/releases/v1/abc/online/master.json`);
});

test('the cache is keyed by the RESOLVED url, so two legacy paths sharing a release body share a fetch', async () => {
  const { impl, calls } = makeFetch({}, () => json({ ok: 1 }));
  const c = client({ fetch: impl, resolvePath: () => '/releases/v1/abc/shared.json' });
  await c.fetchJson('/reports/a.json');
  await c.fetchJson('/reports/b.json');
  assert.equal(calls.length, 1);
});

test('resolveUrl reports the url a fetch would use', () => {
  const c = client({ resolvePath: () => '/releases/v1/abc/x.json' });
  assert.equal(c.resolveUrl('/reports/x.json'), `${R2_BASE}/releases/v1/abc/x.json`);
});

// ---------------------------------------------------------------------------
// Missing immutable release body
// ---------------------------------------------------------------------------

test('a 404 on an immutable release body starts recovery and never resolves', async () => {
  const { impl } = makeFetch({}, () => new Response('gone', { status: 404 }));
  let recovered = 0;
  const c = client({
    fetch: impl,
    resolvePath: () => '/releases/v1/abc/master.json',
    isReleaseBodyPath: p => p.startsWith('/releases/v1/'),
    recoverFromMissingBody: () => {
      recovered += 1;
      return true;
    }
  });

  const pending = c.fetchJson('/reports/master.json');
  const settled = await Promise.race([pending.then(() => 'settled'), Promise.resolve('pending')]);
  assert.equal(settled, 'pending', 'a navigation is underway; the caller must not see a value or an error');
  assert.equal(recovered, 1);
});

test('a release-body 404 that cannot recover falls back to normal 404 handling', async () => {
  const { impl } = makeFetch({}, () => new Response('gone', { status: 404, statusText: 'Not Found' }));
  const c = client({
    fetch: impl,
    resolvePath: () => '/releases/v1/abc/master.json',
    isReleaseBodyPath: () => true,
    recoverFromMissingBody: () => false
  });
  await assert.rejects(c.fetchJson('/reports/master.json'), /404/);
  assert.equal(await c.fetchJsonOptional('/reports/optional.json'), null);
});

test('a 404 on a legacy path never triggers release recovery', async () => {
  const { impl } = makeFetch({}, () => new Response('gone', { status: 404 }));
  let recovered = 0;
  const c = client({
    fetch: impl,
    isReleaseBodyPath: () => false,
    recoverFromMissingBody: () => {
      recovered += 1;
      return true;
    }
  });
  assert.equal(await c.fetchJsonOptional('/players/1/profile.json'), null);
  assert.equal(recovered, 0, 'per-player bodies pass through to legacy; a miss there is normal');
});

test('a non-404 error on a release body is an error, not a recovery', async () => {
  const { impl } = makeFetch({}, () => new Response('boom', { status: 500, statusText: 'Server Error' }));
  let recovered = 0;
  const c = client({
    fetch: impl,
    isReleaseBodyPath: () => true,
    recoverFromMissingBody: () => {
      recovered += 1;
      return true;
    }
  });
  await assert.rejects(c.fetchJson('/reports/x.json'), /500/);
  assert.equal(recovered, 0);
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

test('two clients do not share a cache', async () => {
  const { impl, calls } = makeFetch({}, () => json({ ok: 1 }));
  await client({ fetch: impl }).fetchJson('/reports/x.json');
  await client({ fetch: impl }).fetchJson('/reports/x.json');
  assert.equal(calls.length, 2);
});

test('clearCache forces the next request back to the network', async () => {
  const { impl, calls } = makeFetch({}, () => json({ ok: 1 }));
  const c = client({ fetch: impl });
  await c.fetchJson('/reports/x.json');
  c.clearCache();
  await c.fetchJson('/reports/x.json');
  assert.equal(calls.length, 2);
});
