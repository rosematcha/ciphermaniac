/**
 * The online meta reads prices cut to its own cards, everything else reads the
 * whole file, and releases from before the cut, or a cut built for other cards,
 * fall back to it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { dataClient } from '../../src/lib/data/client.ts';
import { fetchPricesFor, fetchPrintPrices } from '../../src/lib/data/prices.ts';

const WHOLE = { 'Iono::PAF::237': { price: 3 }, 'Lost Vacuum::CRZ::162': { price: 1.5 } };
const META = { 'Iono::PAF::237': { price: 3 } };
const SHOWN = ['Iono::PAF::237', 'Unpriced::SET::001', null];

function serve(files: Record<string, unknown>): string[] {
  const requested: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    requested.push(path);
    const body = files[path];
    if (body instanceof Response) {
      return Promise.resolve(body);
    }
    return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : Response.json(body));
  };
  dataClient.clearCache();
  return requested;
}

test('the online meta reads its cut, other sources and older releases read every price', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const both = {
    '/reports/prices.json': { cardPrices: WHOLE },
    '/reports/prices-meta.json': { cardPrices: META, unpriced: ['Unpriced::SET::001'] }
  };

  let requested = serve(both);
  assert.deepEqual(await fetchPricesFor('Online - Last 14 Days', SHOWN), META);
  assert.deepEqual(requested, ['/reports/prices-meta.json']);

  requested = serve(both);
  assert.deepEqual(await fetchPricesFor('Online - Last 14 Days', [...SHOWN, 'Lost Vacuum::CRZ::162']), WHOLE);
  assert.deepEqual(requested, ['/reports/prices-meta.json', '/reports/prices.json']);

  requested = serve(both);
  assert.deepEqual(await fetchPricesFor('2026-06-12, International Championship New Orleans', SHOWN), WHOLE);
  assert.deepEqual(requested, ['/reports/prices.json']);

  serve({ '/reports/prices.json': { cardPrices: WHOLE } });
  assert.deepEqual(await fetchPricesFor('Online - Last 14 Days', SHOWN), WHOLE);

  for (const broken of [new Response('{"cardPrices":{', { status: 200 }), new Response(null, { status: 503 })]) {
    requested = serve({ '/reports/prices.json': { cardPrices: WHOLE }, '/reports/prices-meta.json': broken });
    assert.deepEqual(await fetchPricesFor('Online - Last 14 Days', SHOWN), WHOLE);
    assert.deepEqual(requested, ['/reports/prices-meta.json', '/reports/prices.json']);
  }
});

test('print prices come from their own file, or null where the synonym database still holds them', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  serve({ '/assets/card-prints.json': { prints: { 'Iono::PAF::237': 3, 'Iono::PAL::185': null } } });
  assert.deepEqual(await fetchPrintPrices(), { 'Iono::PAF::237': 3, 'Iono::PAL::185': null });
  serve({ '/assets/card-prints.json': { prints: 'not a map' } });
  assert.equal(await fetchPrintPrices(), null);
  serve({});
  assert.equal(await fetchPrintPrices(), null);
});
