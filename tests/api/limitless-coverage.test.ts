import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchLimitlessJson } from '../../shared/api/limitless.ts';

// Test-only global used by limitless key resolution fallbacks.
declare global {
  // eslint-disable-next-line vars-on-top
  var __LIMITLESS_API_KEY__: string | undefined;
}

const originalFetch = globalThis.fetch;
const originalGlobalKey = globalThis.__LIMITLESS_API_KEY__;
const originalEnvKey = process.env.LIMITLESS_API_KEY;

interface Sent {
  url: string;
  headers: Headers;
}
let sent: Sent[] = [];

/** Answer every fetch with `response`, recording what was asked for. */
function upstream(status: number, contentType: string, body: string) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, headers: new Headers(init?.headers) });
    const response = new Response(body, { status, headers: { 'content-type': contentType } });
    // The error path logs response.url, which a constructed Response leaves empty.
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }) as typeof fetch;
}

beforeEach(() => {
  sent = [];
  delete globalThis.__LIMITLESS_API_KEY__;
  delete process.env.LIMITLESS_API_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.__LIMITLESS_API_KEY__ = originalGlobalKey;
  if (originalEnvKey === undefined) {
    delete process.env.LIMITLESS_API_KEY;
  } else {
    process.env.LIMITLESS_API_KEY = originalEnvKey;
  }
});

test('fetchLimitlessJson builds the query from either param form and sends the key only as a header', async () => {
  const cases: Array<[Parameters<typeof fetchLimitlessJson>[1], string]> = [
    [{ searchParams: { game: 'PTCG', limit: 10, empty: null, undef: undefined } }, '?game=PTCG&limit=10'],
    [{ searchParams: new URLSearchParams({ game: 'PTCG' }) }, '?game=PTCG']
  ];
  globalThis.__LIMITLESS_API_KEY__ = 'test-key';
  upstream(200, 'application/json', '{"tournaments":[]}');
  for (const [options, search] of cases) {
    sent = [];
    assert.deepEqual(await fetchLimitlessJson('/tournaments', options), { tournaments: [] });
    const url = new URL(sent[0]?.url ?? '');
    assert.equal(`${url.origin}${url.pathname}`, 'https://play.limitlesstcg.com/api/tournaments');
    assert.equal(url.search, search);
    assert.equal(sent[0]?.headers.get('X-Access-Key'), 'test-key');
  }
});

test('fetchLimitlessJson resolves the key from env, then process.env, then the global', async () => {
  upstream(200, 'application/json', '{}');
  globalThis.__LIMITLESS_API_KEY__ = 'global-key';
  process.env.LIMITLESS_API_KEY = 'process-key';
  await fetchLimitlessJson('/test', { env: { LIMITLESS_API_KEY: 'direct-key' } });
  await fetchLimitlessJson('/test', { env: {} });
  delete process.env.LIMITLESS_API_KEY;
  await fetchLimitlessJson('/test', { env: {} });
  assert.deepEqual(
    sent.map(s => s.headers.get('X-Access-Key')),
    ['direct-key', 'process-key', 'global-key']
  );
});

test('fetchLimitlessJson throws before any fetch when no API key is configured', async () => {
  upstream(200, 'application/json', '{}');
  await assert.rejects(() => fetchLimitlessJson('/tournaments', { env: {} }), { message: /API key not configured/i });
  assert.equal(sent.length, 0);
});

test('fetchLimitlessJson throws with a status for a non-ok or non-JSON response', async () => {
  globalThis.__LIMITLESS_API_KEY__ = 'test-key';
  const cases: Array<[number, string, string, RegExp, number]> = [
    [500, 'text/plain', 'Server Error', /failed with 500/, 500],
    [200, 'text/html', '<html>Not JSON</html>', /unexpected content-type/, 500]
  ];
  for (const [status, contentType, body, message, expected] of cases) {
    upstream(status, contentType, body);
    await assert.rejects(
      () => fetchLimitlessJson('/test'),
      (err: Error & { status?: number; body?: string }) => {
        assert.match(err.message, message);
        assert.equal(err.status, expected);
        assert.equal(err.body, body);
        return true;
      }
    );
  }
});
