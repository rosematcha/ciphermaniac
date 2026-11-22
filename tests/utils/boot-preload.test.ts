import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { dataClient } from '../../src/lib/data/client.ts';
import { preloadRoute } from '../../src/lib/bootPreload.ts';

/** The files a boot preload asks for, by path below the data origin. */
function requests(t: TestContext, stored: string | null = null): string[] {
  dataClient.clearCache();
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    requested.push(decodeURIComponent(new URL(String(input)).pathname));
    return new Response(null, { status: 404 });
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => stored }
  });
  t.after(() => Reflect.deleteProperty(globalThis, 'localStorage'));
  return requested;
}

async function settle(): Promise<void> {
  await new Promise(resolve => {
    setImmediate(resolve);
  });
}

test('a cold card page starts its scope and card data at boot', async t => {
  const requested = requests(t);
  preloadRoute('/cards/meg/114', '');
  await settle();
  for (const file of ['master.json', 'cardUsage.json', 'prices.json', 'card-synonyms-slim.json', 'MEG.json']) {
    assert.ok(
      requested.some(path => path.endsWith(`/${file}`)),
      `${file} was not requested: ${requested.join(', ')}`
    );
  }
});

test('a cold archetype page starts its report, index, trends and prices at boot', async t => {
  const requested = requests(t);
  preloadRoute('/archetypes/Dragapult%20ex', '');
  await settle();
  assert.ok(requested.some(path => path.includes('/archetypes/Dragapult ex/')));
  assert.ok(requested.some(path => path.endsWith('/archetypes/index.json')));
  assert.ok(requested.some(path => path.endsWith('/prices-meta.json')));
});

test('scope data waits for the page when the scope is not known up front', async t => {
  for (const [stored, search] of [
    [null, '?scope=2026-10-31-regional-championship-gdansk'],
    [null, '?tour=2026-06-12%2C%20International%20Championship%20New%20Orleans'],
    ['2026-06-12, International Championship New Orleans', '']
  ] as const) {
    const requested = requests(t, stored);
    preloadRoute('/cards/MEG/114', search);
    await settle();
    assert.ok(!requested.some(path => path.endsWith('/master.json')), `${stored ?? search}: ${requested.join(', ')}`);
    assert.ok(requested.some(path => path.endsWith('/prices.json')));
    t.mock.restoreAll();
  }
});

test('other routes and malformed paths start nothing and never throw', async t => {
  const requested = requests(t);
  for (const path of [
    '/',
    '/cards',
    '/players/12',
    '/players/compare',
    '/cards/MEG/114/extra',
    '/archetypes/%E0%A4%A'
  ]) {
    preloadRoute(path, '');
  }
  await settle();
  assert.deepEqual(requested, []);
});

test('a cold players page starts its first page and its index at boot', async t => {
  const requested = requests(t);
  preloadRoute('/players', '');
  await settle();
  assert.ok(requested.some(path => path.endsWith('/players/top.json')));
  assert.ok(requested.some(path => path.endsWith('/players/index-slim.json')));
});
