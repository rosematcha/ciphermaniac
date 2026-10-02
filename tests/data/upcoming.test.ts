import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchUpcomingTournaments } from '../../src/lib/data';
import { createDataClient, dataClient } from '../../src/lib/data/client';
import { fetchUpcoming } from '../../src/lib/data/tournaments';

const payload = { refreshedAt: '2026-10-02', source: 'Limitless', events: [] };

function setup(status = 200) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify(payload), { status: url.endsWith('upcoming.json') ? status : 200 });
  };
  const client = createDataClient({ baseUrl: 'https://data.test', fetch: fetchImpl });
  return { calls, client, fetchImpl };
}

test('upcoming reads R2 through the shared transport and deduplicates concurrent home visits', async () => {
  const options = setup();
  const results = await Promise.all([fetchUpcoming(options), fetchUpcoming(options)]);
  assert.deepEqual(results, [payload, payload]);
  assert.deepEqual(options.calls, ['https://data.test/upcoming.json']);
});

test('upcoming falls back to the API on a missing static object', async () => {
  const options = setup(404);
  assert.deepEqual(await fetchUpcoming(options), payload);
  assert.deepEqual(options.calls, ['https://data.test/upcoming.json', '/api/limitless/upcoming']);
});

test('upcoming uses the API directly in local development', async () => {
  const options = setup();
  assert.deepEqual(await fetchUpcoming({ ...options, local: true }), payload);
  assert.deepEqual(options.calls, ['/api/limitless/upcoming']);
});

test('upcoming storage errors return null without multiplying API traffic', async () => {
  const options = setup(503);
  assert.equal(await fetchUpcoming(options), null);
  assert.deepEqual(options.calls, ['https://data.test/upcoming.json']);
});

test('upcoming API status, network and JSON failures return null', async () => {
  for (const fetchImpl of [
    async () => new Response('', { status: 502 }),
    async () => {
      throw new Error('timeout');
    },
    async () => new Response('invalid JSON')
  ]) {
    assert.equal(await fetchUpcoming({ local: true, fetchImpl }), null);
  }
});

test('the public home-page fetcher reads storage through the default client', async t => {
  dataClient.clearCache();
  t.after(() => dataClient.clearCache());
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.ok(url.endsWith('/upcoming.json'));
    return new Response(JSON.stringify(payload));
  });
  assert.deepEqual(await fetchUpcomingTournaments(), payload);
  assert.deepEqual(await fetchUpcomingTournaments(), payload);
  assert.equal(fetchMock.mock.calls.length, 1);
});
