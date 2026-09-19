/**
 * The live readers: the keys the page asks for have to be the keys the poller
 * writes, every read has to revalidate (the zone hands browsers a cache lifetime
 * of hours), and an event with nothing posted is an empty state, not an error.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { liveKeys } from '../../shared/live/tick.ts';
import type { LiveEvent } from '../../shared/live/types.ts';
import { LIVE_SCHEDULE_KEY } from '../../shared/live/schedule.ts';
import { liveReportsKey } from '../../shared/live/reports.ts';
import {
  fetchLiveIndex,
  fetchLiveReports,
  fetchLiveRound,
  fetchLiveSchedule,
  submitDeckReport
} from '../../src/lib/data/live.ts';

const EVENT = { slug: 'test-2027' } as LiveEvent;
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
  stubFetch(200, { slug: 'test-2027', round: 3 });
  assert.equal((await fetchLiveIndex('test-2027'))?.round, 3);
  assert.ok(requested[0].url.endsWith(`/${liveKeys.index(EVENT)}`), requested[0].url);
  assert.equal(requested[0].cache, 'no-cache');
});

test('a round is read from its own file, and one not posted is null', async () => {
  stubFetch(404, {});
  assert.equal(await fetchLiveRound('test-2027', 4), null);
  assert.ok(requested[0].url.endsWith(`/${liveKeys.round(EVENT, 4)}`), requested[0].url);
});

test('the schedule is read from the key the poller publishes', async () => {
  stubFetch(200, { generatedAt: '2026-09-19T00:00:00Z', events: [] });
  assert.deepEqual((await fetchLiveSchedule())?.events, []);
  assert.ok(requested[0].url.endsWith(`/${LIVE_SCHEDULE_KEY}`), requested[0].url);
});

test('reports are read from the key the endpoint publishes', async () => {
  stubFetch(200, { updatedAt: '', decks: { 'ada lovelace|GB': 'Dragapult' } });
  assert.deepEqual((await fetchLiveReports('test-2027'))?.decks, { 'ada lovelace|GB': 'Dragapult' });
  assert.ok(requested[0].url.endsWith(`/${liveReportsKey('test-2027')}`), requested[0].url);
});

test('a report is posted to the endpoint, and its answer is what the seat now shows', async () => {
  const report = { slug: 'test-2027', seat: 'ada lovelace|GB', archetype: 'Dragapult', voter: 'a'.repeat(16) };
  stubFetch(200, { archetype: null });
  assert.equal(await submitDeckReport(report), null);
  assert.equal(requested[0].url, '/api/live/report');
  stubFetch(429, { error: 'Too many reports' });
  await assert.rejects(submitDeckReport(report), /429/);
});
