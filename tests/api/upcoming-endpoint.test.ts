import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequest, onRequestOptions } from '../../functions/api/limitless/upcoming.ts';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers.ts';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/upcoming');

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtureRoot, `${name}.html`), 'utf8');
}

const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');

afterEach(() => {
  if (originalCaches) {
    Object.defineProperty(globalThis, 'caches', originalCaches);
  } else {
    Reflect.deleteProperty(globalThis, 'caches');
  }
  restoreFetch();
  mock.restoreAll();
});

test('upcoming OPTIONS exposes the cacheable CORS contract', async () => {
  const response = await onRequestOptions();

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), null);
  assert.equal(response.headers.get('Access-Control-Max-Age'), '86400');
});

test('upcoming GET forwards a browser-like request and returns parsed events with cache headers', async () => {
  const html = await fixture('normal');
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  mockFetch({
    predicate: (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return true;
    },
    status: 200,
    body: html
  });

  const response = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  const payload = (await response.json()) as { events: Array<{ name: string }>; source: string; refreshedAt: string };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600, s-maxage=21600');
  assert.equal(requestedUrl, 'https://limitlesstcg.com/tournaments/upcoming?game=PTCG');
  assert.match(
    String(requestedInit?.headers && (requestedInit.headers as Record<string, string>)['User-Agent']),
    /Ciphermaniac/
  );
  assert.equal(payload.events.length, 3);
  assert.equal(payload.events[0]?.name, 'World Championships 2026');
  assert.equal(payload.source, 'https://limitlesstcg.com/tournaments/upcoming?game=PTCG');
  assert.match(payload.refreshedAt, /^2026|^20/);
});

test('upcoming GET warns about a structurally broken schedule, not a legitimately empty one', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  for (const [name, warning] of [
    ['renamed-attributes', /markup may have changed/],
    ['empty', undefined]
  ] as const) {
    warn.mock.resetCalls();
    mockFetch({ status: 200, body: await fixture(name) });
    const response = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
    const payload = (await response.json()) as { events: unknown[]; parseWarning?: string };
    assert.equal(response.status, 200, name);
    assert.deepEqual(payload.events, [], name);
    if (warning) {
      assert.match(payload.parseWarning ?? '', warning);
    } else {
      assert.equal(payload.parseWarning, undefined, name);
    }
    assert.equal(warn.mock.calls.length, warning ? 1 : 0, name);
  }
});

test('upcoming GET turns upstream status and network failures into 502 JSON errors', async () => {
  mockFetch({ status: 503, body: 'upstream unavailable' });
  const upstream = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  assert.equal(upstream.status, 502);
  assert.match(String(((await upstream.json()) as { error: string }).error), /Upstream 503/);

  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connection reset');
  });
  const network = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  assert.equal(network.status, 502);
  assert.match(String(((await network.json()) as { error: string }).error), /connection reset/);
});

function edgeCache() {
  const stored = new Map<string, Response>();
  const match = mock.fn(async (request: Request) => stored.get(request.url)?.clone());
  const put = mock.fn(async (request: Request, response: Response) => {
    stored.set(request.url, response.clone());
  });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: { match, put } } });
  return { stored, match, put };
}

test('upcoming serves the published R2 object using either bucket binding without fetching Limitless', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not scrape');
  });
  for (const binding of ['BUCKET', 'REPORTS']) {
    const get = mock.fn(async (key: string) => {
      assert.equal(key, 'upcoming.json');
      return { text: async () => JSON.stringify({ events: [], refreshedAt: 'saved', source: 'Limitless' }) };
    });
    const response = await onRequest({
      request: new Request('https://ciphermaniac.test/api/limitless/upcoming'),
      env: { [binding]: { get } }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(((await response.json()) as { refreshedAt: string }).refreshedAt, 'saved');
    assert.equal(get.mock.calls.length, 1);
  }
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('upcoming caches published responses and normalizes query strings before reading R2', async () => {
  const cache = edgeCache();
  const get = mock.fn(async () => ({ text: async () => '{"events":[]}' }));
  const pending: Promise<unknown>[] = [];
  const context = {
    request: new Request('https://ciphermaniac.test/api/limitless/upcoming?first=1'),
    env: { REPORTS: { get } },
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    }
  };
  const first = await onRequest(context);
  await Promise.all(pending);
  const second = await onRequest({
    ...context,
    request: new Request('https://ciphermaniac.test/api/limitless/upcoming?second=2')
  });
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(get.mock.calls.length, 1);
  assert.equal(cache.put.mock.calls.length, 1);
  assert.equal(second.headers.get('Cache-Control'), 'public, max-age=3600, s-maxage=21600');
  cache.stored.clear(); // Model eviction/TTL expiry: the next hit reads storage again.
  await onRequest(context);
  assert.equal(get.mock.calls.length, 2);
  await Promise.all(pending);
});

test('upcoming scrapes once and caches when the published object is missing', async () => {
  const cache = edgeCache();
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(await fixture('normal')));
  const get = mock.fn(async () => null);
  const context = {
    request: new Request('https://ciphermaniac.test/api/limitless/upcoming'),
    env: { BUCKET: { get } }
  };
  await onRequest(context);
  const response = await onRequest(context);
  assert.equal(((await response.json()) as { events: unknown[] }).events.length, 3);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(get.mock.calls.length, 1);
  assert.equal(cache.put.mock.calls.length, 1);
});

test('upcoming never caches upstream errors', async () => {
  const cache = edgeCache();
  mockFetch({ status: 429, body: 'rate limited' });
  const context = { request: new Request('https://ciphermaniac.test/api/limitless/upcoming') };
  assert.equal((await onRequest(context)).status, 502);
  assert.equal((await onRequest(context)).status, 502);
  assert.equal(cache.put.mock.calls.length, 0);
});

test('upcoming cache failures still serve published data', async () => {
  const cache = edgeCache();
  mock.method(console, 'warn', () => undefined);
  mock.method(globalThis.caches.default, 'match', async () => {
    throw new Error('cache unavailable');
  });
  mock.method(globalThis.caches.default, 'put', async () => {
    throw new Error('cache full');
  });
  const response = await onRequest({
    request: new Request('https://ciphermaniac.test/api/limitless/upcoming'),
    env: { REPORTS: { get: async () => ({ text: async () => '{"events":[]}' }) } }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { events: [] });
  assert.equal(cache.stored.size, 0);
});

test('upcoming storage failures are uncached and never trigger an upstream scrape', async () => {
  const cache = edgeCache();
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not scrape');
  });
  const response = await onRequest({
    request: new Request('https://ciphermaniac.test/api/limitless/upcoming'),
    env: {
      BUCKET: {
        get: async () => {
          throw new Error('R2 unavailable');
        }
      }
    }
  });
  assert.equal(response.status, 502);
  assert.match(String(((await response.json()) as { error: string }).error), /R2 unavailable/);
  assert.equal(cache.put.mock.calls.length, 0);
  assert.equal(fetchMock.mock.calls.length, 0);
});
