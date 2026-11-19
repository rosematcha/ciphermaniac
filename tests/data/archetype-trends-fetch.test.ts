/**
 * The archetype page's Matchups tab and Changes tab read one `trends.json`.
 *
 * One scenario per file: the data client memoizes each path for five minutes
 * and the singleton has no reset.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { fetchArchetypeMatchupsOnline, fetchArchetypeTrends } from '../../src/lib/data/matchups.ts';
import { ONLINE_META_NAME } from '../../src/lib/constants.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('the matchups and the weekly changes share one download', async () => {
  const record = { opponent: 'Crustle', wins: 3, losses: 1, ties: 0, total: 4, winRate: 75 };
  const body = { days: [{ date: '2026-11-17', totals: { all: 4 } }], cards: {}, matchups: { Crustle: record } };
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;

  assert.deepEqual(await fetchArchetypeMatchupsOnline(ONLINE_META_NAME, 'Mega_Golisopod'), { Crustle: record });
  assert.deepEqual((await fetchArchetypeTrends(ONLINE_META_NAME, 'Mega_Golisopod'))?.days, [
    { date: '2026-11-17', lists: 4 }
  ]);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/archetypes\/Mega_Golisopod\/trends\.json$/);
});
