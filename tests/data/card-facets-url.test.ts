import test from 'node:test';
import assert from 'node:assert/strict';

import { cardFacetsUrl } from '../../src/lib/data/cardFacets.ts';

test('card facets use the shared release-aware URL resolver', () => {
  assert.equal(
    cardFacetsUrl(path => `/releases/v1/assets/test${path.slice('/assets'.length)}`),
    '/releases/v1/assets/test/data/card-facets.json'
  );
});
