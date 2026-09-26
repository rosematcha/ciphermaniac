/**
 * The live readers: the keys the page asks for have to be the keys the poller
 * writes, every read has to revalidate (the zone hands browsers a cache lifetime
 * of hours), and an event with nothing posted is an empty state, not an error.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { liveKeys } from '../../shared/live/tick.ts';
import type { LiveEvent, LiveIndex } from '../../shared/live/types.ts';
import { LIVE_SCHEDULE_KEY } from '../../shared/live/schedule.ts';
import { liveReportsKey } from '../../shared/live/reports.ts';
import {
  fetchLiveIndex,
  fetchLiveReports,
  fetchLiveRound,
  fetchLiveSchedule,
  submitDeckReports
} from '../../src/lib/data/live.ts';
import { roundVersion } from '../../src/lib/liveRounds.ts';

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

test('the current round is read under the index hash, a round the event has left under its plain key', async () => {
  const index = { round: 7, hash: 'abc' } as LiveIndex;
  stubFetch(200, { round: 7, matches: [] });
  await fetchLiveRound('test-2027', 7, roundVersion(index, 7));
  await fetchLiveRound('test-2027', 6, roundVersion(index, 6));
  assert.ok(requested[0].url.endsWith(`/${liveKeys.round(EVENT, 7)}?v=abc`), requested[0].url);
  assert.ok(requested[1].url.endsWith(`/${liveKeys.round(EVENT, 6)}`), requested[1].url);
  assert.equal(requested[0].cache, 'no-cache');
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

test('reports are posted to the endpoint as one batch, and the answer is what each seat now shows', async () => {
  const seats = ['ada lovelace|GB', 'grace hopper|US'];
  const reports = seats.map(seat => ({ slug: 'test-2027', seat, archetype: 'Dragapult', voter: 'a'.repeat(16) }));
  const updatedAt = '2026-09-26T12:00:00.000Z';
  stubFetch(200, { archetypes: { [seats[0]]: null, [seats[1]]: 'Dragapult' }, updatedAt });
  assert.deepEqual(await submitDeckReports(reports), {
    archetypes: { [seats[0]]: null, [seats[1]]: 'Dragapult' },
    updatedAt
  });
  assert.equal(requested[0].url, '/api/live/report');
  stubFetch(429, { error: 'Too many reports' });
  await assert.rejects(submitDeckReports(reports), /429/);
});

test('every label in the archetype icon map is offered for reports', async () => {
  const { fetchArchetypeLabels } = await import('../../src/lib/data/archetypes.ts');
  stubFetch(200, { Ceruledge: ['ceruledge'], "Ethan's Typhlosion": ['typhlosion'] });
  assert.deepEqual(await fetchArchetypeLabels(), ['Ceruledge', "Ethan's Typhlosion"]);
});
