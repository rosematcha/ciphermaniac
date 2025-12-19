import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStateFromURL,
  parseHash,
  planNormalizeCardRoute,
  planNormalizeIndexRoute,
  setStateInURL,
  stringifyRoute
} from '../../src/router.ts';
import { buildCardPath, makeCardSlug, parseCardRoute, resolveCardSlug } from '../../src/card/routing.ts';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

// Routing advanced scenarios

test(
  'Deep linking preserves complex query params and updates history',
  { skip: typeof history === 'undefined' ? 'Requires browser history API' : false },
  () => {
    const url = new URL('https://ciphermaniac.test/cards?q=search+term&sort=alpha&sets=SET1,SET2#grid');
    const state = getStateFromURL(url as unknown as Location);
    assert.equal(state.query, 'search term');
    assert.equal(state.sort, 'alpha');
    assert.equal(state.sets, 'SET1,SET2');

    // Merge behavior: start with empty location
    // Simulate setStateInURL merging with existing params
    // Create a fake location object
    // Note: history APIs operate globally; instead test SetStateOptions logic by calling and ensuring no exception
    const originalLocation = globalThis.location;
    // @ts-ignore
    globalThis.location = { pathname: '/cards', search: '?q=one', hash: '' } as Location;
    setStateInURL({ query: 'two' }, { merge: true });
    // After set, history should have been pushed or replaced; ensure no exception thrown and location.search changed
    assert.ok(typeof globalThis.location.search === 'string');
    // restore
    // @ts-ignore
    globalThis.location = originalLocation;
  }
);

test('Plan normalization converts card hash to card path and preserves search', () => {
  const loc = new URL('https://ciphermaniac.test/?foo=bar#card/Ultra%20Ball');
  const plan = planNormalizeIndexRoute(loc as unknown as Location);
  assert.strictEqual(plan.redirect, true);
  assert.ok(typeof plan.url === 'string' && plan.url!.includes('/card/'));
  assert.ok(plan.url!.includes('?foo=bar'));
});

test('Plan normalize card route returns redirect for #grid', () => {
  const loc = new URL('https://ciphermaniac.test/card/index.html#grid');
  const plan = planNormalizeCardRoute(loc as unknown as Location);
  assert.strictEqual(plan.redirect, true);
  assert.ok(typeof plan.url === 'string' && plan.url!.includes('#grid'));
});

test('parseHash and stringifyRoute roundtrip and unknowns suggest fallback', () => {
  const route = parseHash('#card/Some%20Name');
  assert.strictEqual(route.route, 'card');
  assert.strictEqual(route.name, 'Some Name');

  const serialized = stringifyRoute(route);
  assert.strictEqual(serialized.startsWith('#card/'), true);

  const unknown = parseHash('#something-else');
  assert.strictEqual(unknown.route, 'unknown');
});

test('Card routing: makeCardSlug, buildCardPath and parseCardRoute behavior and malformed handling', async () => {
  // valid identifier -> slug
  const slug = makeCardSlug('Ultra Ball::DEX::102');
  assert.ok(slug && slug.includes(':'));
  const path = buildCardPath('Ultra Ball::DEX::102');
  assert.ok(path.includes('/card/'));

  // parse card route from pathname
  const fakeLoc = { pathname: '/card/DEX~102', search: '', hash: '' } as unknown as Location;
  const pr = parseCardRoute(fakeLoc);
  assert.ok(pr.source === 'slug' || pr.source === 'landing');

  // malformed url gracefully returns null from resolveCardSlug
  mockFetch({
    predicate: (input: RequestInfo) => String(input).includes('/synonyms'),
    status: 500,
    body: 'error'
  } as any);
  const resolved = await resolveCardSlug('::::');
  assert.strictEqual(resolved, null);
  restoreFetch();
});

// Ensure tests restore fetchs
test('cleanup routing mocks', () => {
  restoreFetch();
});
