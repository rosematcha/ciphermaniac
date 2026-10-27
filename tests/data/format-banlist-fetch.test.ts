/**
 * The card page's ban list read. One scenario per file: the data client
 * memoizes each path.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { fetchFormatBanlist } from '../../src/lib/data/reports.ts';
import { R2_ORIGIN as R2_BASE } from '../../src/lib/constants.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a format reads its ban list; any other scope and a missing list read as none', async () => {
  const prints = [{ name: 'Forretress', set: 'LA', number: '28' }];
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input).replace(R2_BASE, '');
    asked.push(path);
    return path === '/reports/Formats/eternal/banlist.json'
      ? new Response(JSON.stringify({ source: 'test', fetchedAt: '', prints }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      : new Response('missing', { status: 404 });
  }) as typeof globalThis.fetch;

  assert.deepEqual(await fetchFormatBanlist('format:eternal'), prints);
  assert.deepEqual(await fetchFormatBanlist('format:rspk'), []);
  assert.deepEqual(await fetchFormatBanlist('Online - Last 14 Days'), []);
  assert.ok(!asked.some(path => path.includes('Online')), 'a non-format scope never asks for a ban list');
});
