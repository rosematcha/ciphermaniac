import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchCardFacets } from '../../src/lib/data/cardFacets.ts';

test('with no facet artifact and no evolution data, facets are empty and every miss is released', async () => {
  // An unread body holds its request open in the browser, so the page never
  // reaches network idle; Lighthouse then waits out its whole load timeout.
  const responses: Response[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const response = new Response('not found', { status: 404 });
    responses.push(response);
    return response;
  };
  try {
    assert.equal((await fetchCardFacets()).size, 0);
  } finally {
    globalThis.fetch = original;
  }
  // card-facets.json, then evolves-from.json, then card-types.json.
  assert.deepEqual(
    responses.map(response => response.bodyUsed),
    [true, true, true]
  );
});
