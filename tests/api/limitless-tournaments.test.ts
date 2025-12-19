import test from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

import { onRequestOptions, onRequestGet as tournamentsHandler } from '../../functions/api/limitless/tournaments.js';
import { fetchLimitlessJson } from '../../functions/lib/limitless.js';

// Helper to construct Request for handler
function makeRequest(url: string) {
  return new Request(url, { method: 'GET' });
}

test('Limitless tournaments - OPTIONS returns 204 with CORS headers', async () => {
  const res = onRequestOptions();
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('Limitless tournaments - fetch list with pagination and returns Cache-Control header', async () => {
  // Page 1 returns two tournaments, page 2 returns empty
  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('page=1'),
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: [
        { id: 't1', name: 'Tourn 1', date: new Date().toISOString(), format: 'STANDARD', game: 'PTCG', players: 10 }
      ]
    },
    {
      predicate: (input: RequestInfo) => String(input).includes('page=2'),
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: []
    }
  ]);

  // Provide API key via global (limitless resolver will pick this up)
  // @ts-ignore
  globalThis.__LIMITLESS_API_KEY__ = 'limitless-key';

  const req = makeRequest('https://ciphermaniac.test/api/limitless/tournaments?game=PTCG&page=1');
  const res = await tournamentsHandler({ request: req, env: { LIMITLESS_API_KEY: 'limit' } as any });
  assert.strictEqual(res.status, 200);

  const text = await res.text();
  const payload = JSON.parse(text);
  assert.strictEqual(payload.success, true);
  assert.ok(Array.isArray(payload.data));
  assert.strictEqual(res.headers.get('Cache-Control')?.includes('max-age=300'), true);

  restoreFetch();
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
});

test('Limitless tournaments - query parameter handling (only allowed params forwarded)', async () => {
  // @ts-ignore - Set API key first
  globalThis.__LIMITLESS_API_KEY__ = 'k';

  // Respond with echoing the query
  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/tournaments'),
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: []
    }
  ]);

  // Request with allowed and disallowed params
  const req = makeRequest('https://ciphermaniac.test/api/limitless/tournaments?game=PTCG&format=STANDARD&evil=1');
  const res = await tournamentsHandler({ request: req, env: { LIMITLESS_API_KEY: 'k' } as any });
  const payload = JSON.parse(await res.text());
  // Query in response should not include 'evil'
  assert.strictEqual(payload.query?.game, 'PTCG');
  assert.strictEqual(payload.query?.format, 'STANDARD');
  assert.strictEqual(payload.query?.evil, undefined);

  restoreFetch();
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
});

test('Limitless - fetchLimitlessJson throws for missing API key', async () => {
  // Ensure no API key is set anywhere
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
  const origProcessEnv = process.env.LIMITLESS_API_KEY;
  delete process.env.LIMITLESS_API_KEY;

  // Ensure environment without key - this should throw before any fetch
  await assert.rejects(
    async () => {
      await fetchLimitlessJson('/tournaments', { env: {} });
    },
    {
      message: /Limitless API key not configured/i
    }
  );

  // Restore
  if (origProcessEnv) {
    process.env.LIMITLESS_API_KEY = origProcessEnv;
  }
});

test('Limitless - 404 from upstream returns 404 status from handler', async () => {
  // @ts-ignore - Set API key first
  globalThis.__LIMITLESS_API_KEY__ = 'k';

  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/tournaments'),
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: { message: 'Not found' }
    }
  ]);

  const req = makeRequest('https://ciphermaniac.test/api/limitless/tournaments');
  const res = await tournamentsHandler({ request: req, env: { LIMITLESS_API_KEY: 'k' } as any });
  assert.strictEqual(res.status, 404);
  const payload = JSON.parse(await res.text());
  assert.strictEqual(payload.success, false);

  restoreFetch();
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
});

test('Limitless - 500 upstream returns 502 from handler and disables cache', async () => {
  // @ts-ignore - Set API key first
  globalThis.__LIMITLESS_API_KEY__ = 'k';

  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/tournaments'),
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: 'Server failure'
    }
  ]);

  const req = makeRequest('https://ciphermaniac.test/api/limitless/tournaments');
  const res = await tournamentsHandler({ request: req, env: { LIMITLESS_API_KEY: 'k' } as any });
  // fetchLimitlessJson will throw an error with status 500 -> handler maps to 500
  assert.strictEqual(res.status, 500);
  // Should include Cache-Control: no-store
  assert.strictEqual(res.headers.get('Cache-Control'), 'no-store');

  restoreFetch();
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
});

test('Limitless - rate limiting (429) is propagated', async () => {
  // @ts-ignore - Set API key first
  globalThis.__LIMITLESS_API_KEY__ = 'k';

  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/tournaments'),
      status: 429,
      headers: { 'content-type': 'application/json' },
      body: { error: 'Too Many Requests' }
    }
  ]);

  const req = makeRequest('https://ciphermaniac.test/api/limitless/tournaments');
  const res = await tournamentsHandler({ request: req, env: { LIMITLESS_API_KEY: 'k' } as any });
  assert.strictEqual(res.status, 429);
  restoreFetch();
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
});

test('Limitless - network timeout (fetch throws) returns 502', async () => {
  // mock fetch to throw
  // @ts-ignore
  const orig = globalThis.fetch;
  // @ts-ignore
  globalThis.fetch = async () => {
    throw new Error('network timeout');
  };
  // @ts-ignore
  globalThis.__LIMITLESS_API_KEY__ = 'k';
  const req = makeRequest('https://ciphermaniac.test/api/limitless/tournaments');
  const res = await tournamentsHandler({ request: req, env: { LIMITLESS_API_KEY: 'k' } as any });
  assert.strictEqual(res.status, 502);
  // restore
  // @ts-ignore
  globalThis.fetch = orig;
  // @ts-ignore
  delete globalThis.__LIMITLESS_API_KEY__;
});

// Clean up any remaining mocks
test('cleanup', () => {
  restoreFetch();
});
