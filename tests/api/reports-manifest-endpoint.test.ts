import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet, resolveMasterPath } from '../../functions/reports/[tournament]/manifest.json.ts';
import { composeRelease } from '../../shared/data/build/release.ts';

test('reports manifest resolves masters through the embedded event release', () => {
  const release = composeRelease({
    releaseId: 'release-test',
    publishedAt: '2026-09-11T00:00:00Z',
    roots: {
      online: '/releases/v1/online/a',
      trends: '/releases/v1/trends/b',
      players: '/releases/v1/players/c',
      prices: '/releases/v1/prices/d',
      catalogs: '/releases/v1/catalogs/e',
      snapshots: '/releases/v1/snapshots/f',
      assets: '/releases/v1/assets/g'
    },
    events: { '2026-01-01, Test': '/releases/v1/events/test/h' }
  });
  assert.equal(resolveMasterPath('2026-01-01, Test', release), '/releases/v1/events/test/h/master.json');
  assert.equal(resolveMasterPath('missing', release), null);
});

test('reports manifest endpoint reports master size without an obsolete tournament database', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();

    if (method === 'HEAD' && url.includes('/master.json')) {
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': '123456',
          'last-modified': 'Mon, 02 Mar 2026 00:00:00 GMT'
        }
      });
    }

    return new Response(null, { status: 404 });
  }) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/reports/Online%20-%20Last%2014%20Days/manifest.json');
    const response = await onRequestGet({
      request,
      params: { tournament: 'Online - Last 14 Days' }
    });

    assert.strictEqual(response.status, 200);
    const payload = (await response.json()) as {
      hasTournamentDb: boolean;
      assets: { masterBytes: number; updatedAt: string; dbBytes?: number };
    };

    assert.strictEqual(payload.hasTournamentDb, false);
    assert.strictEqual(payload.assets.masterBytes, 123456);
    assert.ok(typeof payload.assets.updatedAt === 'string' && payload.assets.updatedAt.length > 0);
    assert.strictEqual(payload.assets.dbBytes, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- P-18: storage failures must not be masked as a 404 ---

async function callManifest(status: number | 'network'): Promise<Response> {
  // Both master mirrors resolve the same way, simulating a total storage outage.
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (status === 'network') {
      throw new Error('connection reset');
    }
    return new Response(null, { status });
  }) as typeof fetch;
  try {
    const request = new Request('https://ciphermaniac.com/reports/Some%20Event/manifest.json');
    return await onRequestGet({ request, params: { tournament: 'Some Event' } });
  } finally {
    globalThis.fetch = original;
  }
}

test('reports manifest returns 503 (not 404) when master probe 5xxs', async () => {
  const response = await callManifest(500);
  assert.strictEqual(response.status, 503);
  assert.strictEqual(response.headers.get('Cache-Control'), 'no-store');
});

test('reports manifest returns 503 when master probe hits a network error', async () => {
  const response = await callManifest('network');
  assert.strictEqual(response.status, 503);
});

test('reports manifest still returns 404 when the report is genuinely absent', async () => {
  const response = await callManifest(404);
  assert.strictEqual(response.status, 404);
});
