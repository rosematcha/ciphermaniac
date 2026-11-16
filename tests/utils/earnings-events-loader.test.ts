import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchEarningsEvents } from '../../src/lib/data/earnings';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a failed event-detail request is not cached, so the next expand retries', async () => {
  const statuses = [503, 200];
  let calls = 0;
  globalThis.fetch = async () => {
    const status = statuses[calls++] ?? 200;
    return new Response(status === 200 ? '{"events":{}}' : 'down', { status });
  };

  await assert.rejects(fetchEarningsEvents(), /Failed to fetch \/earnings-events\.json: 503/);
  assert.deepEqual(await fetchEarningsEvents(), { events: {} });
  assert.equal(calls, 2);
});
