/**
 * The live readers: the keys the page asks for have to be the keys the poller
 * writes, every read has to revalidate (the zone hands browsers a cache lifetime
 * of hours), and an event with nothing posted is an empty state, not an error.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { liveKeys } from '../../shared/live/tick.ts';
import type { LiveEvent } from '../../shared/live/types.ts';
import { fetchLiveIndex, fetchLiveRound } from '../../src/lib/data/live.ts';

const EVENT = { labsCode: '9999' } as LiveEvent;
const realFetch = globalThis.fetch;
const requested: { url: string; cache?: RequestCache }[] = [];

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requested.push({ url: String(input), cache: init?.cache });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  requested.length = 0;
});

test('the index is read from the key the poller publishes, revalidating', async () => {
  stubFetch(200, { labsCode: '9999', round: 3 });
  assert.equal((await fetchLiveIndex('9999'))?.round, 3);
  assert.ok(requested[0].url.endsWith(`/${liveKeys.index(EVENT)}`), requested[0].url);
  assert.equal(requested[0].cache, 'no-cache');
});

test('a round is read from its own file, and one not posted is null', async () => {
  stubFetch(404, {});
  assert.equal(await fetchLiveRound('9999', 4), null);
  assert.ok(requested[0].url.endsWith(`/${liveKeys.round(EVENT, 4)}`), requested[0].url);
});
