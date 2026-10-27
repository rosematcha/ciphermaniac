/**
 * The selector's scope list: the online meta, majors, and every published
 * format. One scenario per file: the data client memoizes each path.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { fetchScopeKeys } from '../../src/lib/data/reports.ts';
import { R2_ORIGIN as R2_BASE } from '../../src/lib/constants.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('published formats join the scope keys after the events', async () => {
  const bodies: Record<string, unknown> = {
    '/reports/tournaments.json': ['2026-10-24, Regional Championship Puebla'],
    '/reports/Formats/index.json': {
      generatedAt: '2026-10-27T12:00:00.000Z',
      formats: [{ id: 'rspk', label: 'RS-PK', window: 'last 60 days', events: 9, decks: 90 }]
    }
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const body = bodies[String(input).replace(R2_BASE, '')];
    return body
      ? new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('missing', { status: 404 });
  }) as typeof globalThis.fetch;

  assert.deepEqual(await fetchScopeKeys(), [
    'Online - Last 14 Days',
    '2026-10-24, Regional Championship Puebla',
    'format:rspk'
  ]);
});
