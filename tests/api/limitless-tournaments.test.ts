import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestOptions, onRequestGet as tournamentsHandler } from '../../functions/api/limitless/tournaments.js';

const originalFetch = globalThis.fetch;
const ENV = { LIMITLESS_API_KEY: 'test-key' } as never;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Answer every upstream call with `status` and `body`, recording the URLs asked for. */
function upstream(status: number, body: unknown = []): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const response = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    // The error path logs response.url, which a constructed Response leaves empty.
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }) as typeof globalThis.fetch;
  return requested;
}

function get(query = ''): Promise<Response> {
  return tournamentsHandler({
    request: new Request(`https://ciphermaniac.test/api/limitless/tournaments${query ? `?${query}` : ''}`),
    env: ENV
  });
}

test('Limitless tournaments - OPTIONS returns 204 with CORS headers', () => {
  const res = onRequestOptions();
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('Limitless tournaments - forwards only allowed params, normalized, and caches the answer', async () => {
  const tournaments = [{ id: 't1', name: 'Tourn 1' }];
  const requested = upstream(200, tournaments);
  const res = await get('game=PTCG&format=STANDARD&evil=1&limit=050&page=3');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('Cache-Control')?.includes('max-age=300'), true);
  const forwarded = new URL(requested[0] ?? '').searchParams;
  assert.deepStrictEqual(Object.fromEntries(forwarded), {
    game: 'PTCG',
    format: 'STANDARD',
    limit: '50',
    page: '3'
  });
  const payload = (await res.json()) as { success: boolean; query: Record<string, string>; data: unknown };
  assert.strictEqual(payload.success, true);
  assert.deepStrictEqual(payload.query, Object.fromEntries(forwarded));
  assert.deepStrictEqual(payload.data, tournaments);
});

test('Limitless tournaments - upstream failures keep their status, or 502, and are never cached', async () => {
  for (const status of [404, 429, 500]) {
    upstream(status, { error: 'upstream' });
    const res = await get();
    assert.strictEqual(res.status, status);
    assert.strictEqual(res.headers.get('Cache-Control'), 'no-store', String(status));
    assert.strictEqual(((await res.json()) as { success: boolean }).success, false);
  }
  globalThis.fetch = (async () => {
    throw new Error('network timeout');
  }) as typeof globalThis.fetch;
  const res = await get();
  assert.strictEqual(res.status, 502, 'a network failure');
  assert.strictEqual(res.headers.get('Cache-Control'), 'no-store');
});

// --- Phase 9.3: numeric proxy params are bounded, not forwarded verbatim ---

test('Limitless tournaments - out-of-range limit/page are rejected before the upstream call', async () => {
  const requested = upstream(200, {});
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=1000000',
    'limit=-5',
    'limit=abc',
    'limit=2.5',
    'page=0',
    'page=-1',
    'page=501',
    `format=${'x'.repeat(65)}`
  ]) {
    const response = await get(query);
    assert.strictEqual(response.status, 400, `${query} was accepted`);
  }
  assert.strictEqual(requested.length, 0, 'a rejected request must not reach Limitless');
});

test('Limitless tournaments - boundary values are accepted', async () => {
  upstream(200, { data: [] });
  for (const query of ['limit=1', 'limit=100', 'page=1', 'page=500']) {
    const response = await get(query);
    assert.strictEqual(response.status, 200, `${query} was rejected`);
  }
});
