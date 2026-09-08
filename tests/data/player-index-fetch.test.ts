/**
 * The players table's index fetch, at the seam where the two wire shapes meet.
 *
 * `index-slim.json` is written by the current aggregator; a deploy from before
 * it has only `index.json`, whose rows predate the win/loss fields. The
 * fallback runs through `decodeSlimIndex` too, because a raw legacy row hands
 * the table a NaN win rate and every row reads as a dash.
 *
 * One scenario per file: the data client memoizes each path for five minutes
 * and the singleton has no reset, so a second scenario here would be answered
 * from this one's cache.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { fetchPlayerIndexSlim } from '../../src/lib/data/players.ts';
import { R2_BASE } from '../../src/lib/data/client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a legacy deploy falls back to index.json, decoded rather than raw', async () => {
  const legacy = [{ playerId: '2', name: 'Gary Oak', eventCount: 3, day2s: 1, topCuts: 1 }];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input).replace(R2_BASE, '');
    return path === '/players/index.json'
      ? new Response(JSON.stringify(legacy), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('missing', { status: 404 });
  }) as typeof globalThis.fetch;

  assert.deepEqual(await fetchPlayerIndexSlim(), [
    {
      playerId: '2',
      name: 'Gary Oak',
      eventCount: 3,
      wins: 0,
      losses: 0,
      day2s: 1,
      topCuts: 1
    }
  ]);
});
