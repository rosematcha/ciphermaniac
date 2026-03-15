import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from '../../functions/reports/[tournament]/manifest.json.ts';

test('reports manifest endpoint reports master size and db availability', async () => {
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

    if (method === 'HEAD' && url.includes('/tournament.db')) {
      return new Response(null, { status: 404 });
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
