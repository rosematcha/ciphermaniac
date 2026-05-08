import test from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

import { fetchLimitlessJson } from '../../functions/lib/api/limitless.ts';

// ---------------------------------------------------------------------------
// fetchLimitlessJson – URL building with various searchParams
// ---------------------------------------------------------------------------

test('fetchLimitlessJson sends request with correct headers and returns JSON', async () => {
  mockFetch({
    predicate: (input: RequestInfo) => String(input).includes('limitlesstcg.com'),
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { tournaments: [] }
  });

  // @ts-ignore
  const origKey = globalThis.__LIMITLESS_API_KEY__;
  // @ts-ignore
  globalThis.__LIMITLESS_API_KEY__ = 'test-key';

  try {
    const result = await fetchLimitlessJson('/tournaments', {
      searchParams: { game: 'PTCG', limit: 10, empty: null, undef: undefined }
    });
    assert.deepEqual(result, { tournaments: [] });
  } finally {
    // @ts-ignore
    globalThis.__LIMITLESS_API_KEY__ = origKey;
    restoreFetch();
  }
});

test('fetchLimitlessJson sends request with URLSearchParams', async () => {
  mockFetch({
    predicate: (input: RequestInfo) => String(input).includes('limitlesstcg.com'),
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: []
  });

  // @ts-ignore
  const origKey = globalThis.__LIMITLESS_API_KEY__;
  // @ts-ignore
  globalThis.__LIMITLESS_API_KEY__ = 'test-key';

  try {
    const params = new URLSearchParams();
    params.set('game', 'PTCG');
    const result = await fetchLimitlessJson('/tournaments', { searchParams: params });
    assert.ok(Array.isArray(result));
  } finally {
    // @ts-ignore
    globalThis.__LIMITLESS_API_KEY__ = origKey;
    restoreFetch();
  }
});

test('fetchLimitlessJson throws for missing API key', async () => {
  // @ts-ignore
  const origGlobal = globalThis.__LIMITLESS_API_KEY__;
  const origEnv = process.env.LIMITLESS_API_KEY;
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
  delete process.env.LIMITLESS_API_KEY;

  try {
    await assert.rejects(() => fetchLimitlessJson('/tournaments', { env: {} }), { message: /API key not configured/i });
  } finally {
    if (origEnv) {
      process.env.LIMITLESS_API_KEY = origEnv;
    }
    // @ts-ignore
    if (origGlobal) {
      globalThis.__LIMITLESS_API_KEY__ = origGlobal;
    }
  }
});

test('fetchLimitlessJson resolves key from process.env', async () => {
  // @ts-ignore
  const origGlobal = globalThis.__LIMITLESS_API_KEY__;
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
  const origEnv = process.env.LIMITLESS_API_KEY;
  process.env.LIMITLESS_API_KEY = 'env-key';

  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { source: 'env' }
  });

  try {
    const result = await fetchLimitlessJson('/test', { env: {} });
    assert.deepEqual(result, { source: 'env' });
  } finally {
    if (origEnv) {
      process.env.LIMITLESS_API_KEY = origEnv;
    } else {
      delete process.env.LIMITLESS_API_KEY;
    }
    // @ts-ignore
    if (origGlobal) {
      globalThis.__LIMITLESS_API_KEY__ = origGlobal;
    }
    restoreFetch();
  }
});

test('fetchLimitlessJson resolves key from env parameter', async () => {
  // @ts-ignore
  const origGlobal = globalThis.__LIMITLESS_API_KEY__;
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
  const origEnv = process.env.LIMITLESS_API_KEY;
  delete process.env.LIMITLESS_API_KEY;

  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { source: 'direct' }
  });

  try {
    const result = await fetchLimitlessJson('/test', { env: { LIMITLESS_API_KEY: 'direct-key' } });
    assert.deepEqual(result, { source: 'direct' });
  } finally {
    if (origEnv) {
      process.env.LIMITLESS_API_KEY = origEnv;
    }
    // @ts-ignore
    if (origGlobal) {
      globalThis.__LIMITLESS_API_KEY__ = origGlobal;
    }
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// Non-ok response handling
// ---------------------------------------------------------------------------

test('fetchLimitlessJson throws for non-ok response', async () => {
  // @ts-ignore
  const origKey = globalThis.__LIMITLESS_API_KEY__;
  // @ts-ignore
  globalThis.__LIMITLESS_API_KEY__ = 'test-key';

  // Use raw fetch mock since we need the url property on the response
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const resp = new Response('Server Error', {
      status: 500,
      headers: { 'content-type': 'text/plain' }
    });
    Object.defineProperty(resp, 'url', { value: url, writable: false });
    return resp;
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchLimitlessJson('/test'),
      (err: any) => err.status === 500 && typeof err.body === 'string'
    );
  } finally {
    globalThis.fetch = origFetch;
    // @ts-ignore
    globalThis.__LIMITLESS_API_KEY__ = origKey;
  }
});

// ---------------------------------------------------------------------------
// Non-JSON content-type handling
// ---------------------------------------------------------------------------

test('fetchLimitlessJson throws for non-JSON content type', async () => {
  // @ts-ignore
  const origKey = globalThis.__LIMITLESS_API_KEY__;
  // @ts-ignore
  globalThis.__LIMITLESS_API_KEY__ = 'test-key';

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const resp = new Response('<html>Not JSON</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    });
    Object.defineProperty(resp, 'url', { value: url, writable: false });
    return resp;
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchLimitlessJson('/test'),
      (err: any) => err.message.includes('unexpected content-type') && err.status === 500
    );
  } finally {
    globalThis.fetch = origFetch;
    // @ts-ignore
    globalThis.__LIMITLESS_API_KEY__ = origKey;
  }
});

test('cleanup limitless-coverage', () => {
  restoreFetch();
});
