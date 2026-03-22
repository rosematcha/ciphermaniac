import test from 'node:test';
import assert from 'node:assert/strict';

import { clearApiCache, fetchPlayerMatches } from '../../src/api.ts';

const SAMPLE_RESPONSE = [
  {
    id: '1:r1',
    playerId: 1,
    round: 1,
    outcome: 'win'
  }
];

test('fetchPlayerMatches requests encoded playerMatches.json path', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.includes('/reports/2026-02-27%2C%20Regional%20Championship%20Seattle/playerMatches.json')) {
      return new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const result = await fetchPlayerMatches('2026-02-27, Regional Championship Seattle');
    assert.equal(result.length, 1);
    assert.ok(
      urls.some(url => url.includes('/reports/2026-02-27%2C%20Regional%20Championship%20Seattle/playerMatches.json'))
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});

test('fetchPlayerMatches uses cached response for repeated calls', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/reports/Test%20Regional/playerMatches.json')) {
      fetchCount += 1;
      return new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const first = await fetchPlayerMatches('Test Regional');
    const second = await fetchPlayerMatches('Test Regional');

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});
