/**
 * The players page's first-page preview. A top.json the table could not render is dropped, so
 * the page waits for the full index rather than painting broken rows.
 *
 * One scenario per file: the data client memoizes each path and the singleton has no reset.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { fetchPlayerTop } from '../../src/lib/data/players.ts';
import { R2_ORIGIN as R2_BASE } from '../../src/lib/constants.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a preview row whose ID no link can encode is dropped whole', async () => {
  const good = {
    playerId: '1',
    name: 'Ash',
    eventCount: 3,
    wins: 5,
    losses: 2,
    day2s: 1,
    topCuts: 1,
    tournamentWins: 0
  };
  const top = [good, { ...good, playerId: '\ud800' }];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input).replace(R2_BASE, '');
    return path === '/players/top.json'
      ? new Response(JSON.stringify(top), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('missing', { status: 404 });
  }) as typeof globalThis.fetch;

  assert.equal(await fetchPlayerTop(), null);
});
