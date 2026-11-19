import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { dataClient } from '../../src/lib/data/client.ts';
import type { getSynonymDatabase } from '../../src/utils/cardSynonyms.ts';

// A query suffix gives each load a fresh module instance, as a page reload does.
let reloads = 0;
const loadPage = () => {
  dataClient.clearCache();
  reloads++;
  return import(`../../src/utils/cardSynonyms.ts?slim=${reloads}`) as Promise<{
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

function serve(t: TestContext, files: Record<string, unknown>): string[] {
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const name = new URL(String(input)).pathname.split('/').pop() ?? '';
    requested.push(name);
    const body = files[name];
    if (body instanceof Response) {
      return body;
    }
    return name in files ? Response.json(body) : new Response(null, { status: 404 });
  });
  return requested;
}

const FULL = {
  synonyms: { 'Iono::PAL::269': 'Iono::PAL::185' },
  canonicals: { Iono: 'Iono::PAL::185' },
  prints: { 'Iono::PAL::185': 0.25, 'Iono::PAL::269': 12 }
};
const SLIM = { synonyms: FULL.synonyms, canonicals: FULL.canonicals };

test('the slim synonyms are read when valid, and the full file otherwise', async t => {
  sessionStorageFor(t);
  let requested = serve(t, { 'card-synonyms-slim.json': SLIM, 'card-synonyms.json': FULL });
  assert.deepEqual(await (await loadPage()).getSynonymDatabase(), SLIM);
  assert.deepEqual(requested, ['card-synonyms-slim.json']);

  t.mock.restoreAll();
  sessionStorageFor(t);
  requested = serve(t, { 'card-synonyms-slim.json': {}, 'card-synonyms.json': FULL });
  assert.deepEqual(await (await loadPage()).getSynonymDatabase(), FULL);
  assert.deepEqual(requested, ['card-synonyms-slim.json', 'card-synonyms.json']);
});

test('a slim file that fails to load or parse falls back to the full file', async t => {
  for (const broken of [new Response('{"synonyms":{', { status: 200 }), new Response(null, { status: 503 })]) {
    t.mock.restoreAll();
    sessionStorageFor(t);
    const requested = serve(t, { 'card-synonyms-slim.json': broken, 'card-synonyms.json': FULL });
    assert.deepEqual(await (await loadPage()).getSynonymDatabase(), FULL);
    assert.deepEqual(requested, ['card-synonyms-slim.json', 'card-synonyms.json']);
  }
});

test('a slim entry cached under another release does not hide an older release full file', async t => {
  const storage = sessionStorageFor(t);
  storage.set(
    'cardSynonymsData',
    JSON.stringify({
      cachedAt: Date.now(),
      url: 'https://r2.ciphermaniac.com/releases/v1/assets/bbbbbbbbbbbb/card-synonyms-slim.json',
      data: SLIM
    })
  );
  serve(t, { 'card-synonyms.json': FULL });
  const db = await (await loadPage()).getSynonymDatabase();
  assert.deepEqual(db.prints, FULL.prints);
});
