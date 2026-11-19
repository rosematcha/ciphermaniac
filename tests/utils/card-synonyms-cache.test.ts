import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { dataClient } from '../../src/lib/data/client.ts';
import type { getSynonymDatabase } from '../../src/utils/cardSynonyms.ts';

// A query suffix gives each load a fresh module instance, as a page reload does. The data
// client's in-memory cache is cleared too, so only sessionStorage survives the reload.
let reloads = 0;
const loadPage = () => {
  dataClient.clearCache();
  reloads++;
  return import(`../../src/utils/cardSynonyms.ts?load=${reloads}`) as Promise<{
    getSynonymDatabase: typeof getSynonymDatabase;
  }>;
};

function sessionStorageFor(t: TestContext): Map<string, string> {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { getItem: (key: string) => storage.get(key) ?? null, setItem: storage.set.bind(storage) }
  });
  t.after(() => Reflect.deleteProperty(globalThis, 'sessionStorage'));
  return storage;
}

test('a reload onto a new release ignores the previous release synonyms in the same tab', async t => {
  const storage = sessionStorageFor(t);
  const previous = { synonyms: { 'Old::A::1': 'Old::B::2' }, canonicals: {} };
  storage.set(
    'cardSynonymsData',
    JSON.stringify({
      cachedAt: Date.now(),
      url: 'https://r2.ciphermaniac.com/releases/v1/assets/aaaaaaaaaaaa/card-synonyms.json',
      data: previous
    })
  );
  const current = { synonyms: { 'New::A::1': 'New::B::2' }, canonicals: {} };
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(current));

  const firstLoad = await loadPage();
  assert.deepEqual(await firstLoad.getSynonymDatabase(), current);
  assert.equal(fetch.mock.callCount(), 1);

  const reload = await loadPage();
  assert.deepEqual(await reload.getSynonymDatabase(), current);
  assert.equal(fetch.mock.callCount(), 1, 'the same release reuses its cached entry');
});

test('an invalid synonyms response is neither used nor cached', async t => {
  for (const invalid of [{ error: 'unexpected document' }, { synonyms: { 'Pikachu::A::001': 42 }, canonicals: {} }]) {
    const storage = sessionStorageFor(t);
    t.mock.method(globalThis, 'fetch', async () => Response.json(invalid));

    const page = await loadPage();
    assert.deepEqual(await page.getSynonymDatabase(), { synonyms: {}, canonicals: {} });
    assert.equal(storage.size, 0);
    t.mock.restoreAll();
  }
});

test('an invalid cached entry for the current release is refetched', async t => {
  const storage = sessionStorageFor(t);
  const invalid = { synonyms: { 'Pikachu::A::001': 42 }, canonicals: {} };
  const url = dataClient.resolveUrl('/assets/card-synonyms.json');
  storage.set('cardSynonymsData', JSON.stringify({ cachedAt: Date.now(), url, data: invalid }));
  const current = { synonyms: { 'New::A::1': 'New::B::2' }, canonicals: {} };
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(current));

  const page = await loadPage();
  assert.deepEqual(await page.getSynonymDatabase(), current);
  assert.equal(fetch.mock.callCount(), 1);
});
