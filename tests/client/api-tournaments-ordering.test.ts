import test from 'node:test';
import assert from 'node:assert/strict';

import { clearApiCache, fetchTournamentsList } from '../../src/api.ts';

test('fetchTournamentsList defensively sorts dated tournaments before undated ones', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/reports/tournaments.json')) {
      return new Response(
        JSON.stringify([
          'Special Event Bologna',
          '2026-02-13, International Championship London',
          'Regional Championship Stuttgart',
          '2026-02-07, Regional Championship Santiago'
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const tournaments = await fetchTournamentsList();
    assert.deepEqual(tournaments, [
      '2026-02-13, International Championship London',
      '2026-02-07, Regional Championship Santiago',
      'Regional Championship Stuttgart',
      'Special Event Bologna'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});
