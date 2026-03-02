import test from 'node:test';
import assert from 'node:assert/strict';

import { __setApiTestHooks, clearApiCache, fetchReport } from '../../src/api.ts';

test('fetchReport skips SQLite when manifest says tournament db is unavailable', async () => {
  clearApiCache();

  let loadDatabaseCalls = 0;
  const originalFetch = globalThis.fetch;

  __setApiTestHooks({
    fetchTournamentManifest: async () => ({
      hasTournamentDb: false,
      assets: {
        masterBytes: 120,
        updatedAt: '2026-03-02T00:00:00.000Z'
      }
    }),
    loadDatabase: async () => {
      loadDatabaseCalls += 1;
      throw new Error('loadDatabase should not be called when manifest hasTournamentDb=false');
    }
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/master.json')) {
      return new Response(
        JSON.stringify({
          deckTotal: 2,
          items: []
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const report = await fetchReport('Online - Last 14 Days');
    assert.strictEqual(report.deckTotal, 2);
    assert.strictEqual(loadDatabaseCalls, 0, 'SQLite loader should be skipped by manifest gate');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});
