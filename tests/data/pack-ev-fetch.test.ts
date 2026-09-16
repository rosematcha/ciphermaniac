/**
 * The pack-EV readers: the keys the page asks R2 for have to be the keys the
 * job writes, and a set that hasn't been published yet is an empty state, not
 * an error page.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { fetchPackEvIndex, fetchPackEvSet } from '../../src/lib/data/packEv.ts';
import { PACK_EV_INDEX_KEY, PACK_EV_PREFIX } from '../../.github/scripts/lib/packEv.ts';

const realFetch = globalThis.fetch;
const requested: string[] = [];

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  requested.length = 0;
});

test('the index is read from the key the job publishes', async () => {
  stubFetch(200, { generatedAt: '2026-09-16T00:00:00.000Z', sets: [] });
  const index = await fetchPackEvIndex();
  assert.deepEqual(index?.sets, []);
  assert.ok(requested[0].endsWith(`/${PACK_EV_INDEX_KEY}`), requested[0]);
});

test('a set is read from its own shard, and a missing one is null', async () => {
  stubFetch(404, {});
  assert.equal(await fetchPackEvSet('ZZZ'), null);
  assert.ok(requested[0].endsWith(`/${PACK_EV_PREFIX}ZZZ.json`), requested[0]);
});
