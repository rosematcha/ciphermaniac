/**
 * The Set Impact file is a same-origin build artifact, not an R2 report, so
 * its reader must ask for the root path and surface a failed response as an
 * error the page can show, never as an empty table.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { fetchSetImpact } from '../../src/lib/data/setImpact.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(response: Response): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return response;
  }) as typeof globalThis.fetch;
  return urls;
}

test('reads the same-origin set impact file', async () => {
  const payload = { generatedAt: '2026-09-22T00:00:00.000Z', rotations: [], events: [], sets: [] };
  const urls = stubFetch(new Response(JSON.stringify(payload), { status: 200 }));
  assert.deepEqual(await fetchSetImpact(), payload);
  assert.deepEqual(urls, ['/set-impact.json']);
});

test('a failed response throws with the status', async () => {
  stubFetch(new Response('missing', { status: 404 }));
  await assert.rejects(fetchSetImpact(), /set-impact\.json: 404/);
});
