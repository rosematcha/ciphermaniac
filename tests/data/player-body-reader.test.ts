import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerBodyReader } from '../../src/lib/data/playerBodyReader';
import { fetchPlayerDecks, fetchPlayerProfile } from '../../src/lib/data/players';

const target = '/releases/v1/players/aaaaaaaaaaaa/42/profile.json';
test('a release resolves player bodies through its immutable shard, including optional misses', async () => {
  const requests: string[] = [];
  const read = createPlayerBodyReader({
    routed: true,
    legacy: async () => {
      throw new Error('must not read mutable data');
    },
    routes: async path => {
      requests.push(path);
      return { '42/profile.json': target };
    },
    immutable: async <T>(path: string) => {
      requests.push(path);
      return { name: 'Player' } as T;
    }
  });
  assert.deepEqual(await read('42', 'profile'), { name: 'Player' });
  assert.match(requests[0], /\/players\/_routes\/[a-f0-9]{2}\.json/);
  assert.equal(requests[1], target);
  assert.equal(await read('43', 'profile'), null);
});

test('invalid references and corrupt routing fail instead of falling back to mutable data', async () => {
  const read = createPlayerBodyReader({
    routed: true,
    legacy: async () => null,
    routes: async () => ({ '42/profile.json': '/players/42/profile.json' }),
    immutable: async () => {
      throw new Error('unexpected');
    }
  });
  await assert.rejects(read('42', 'profile'), /Invalid immutable/);
});

test('legacy player exports remain usable before the first routed release', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async input =>
    new Response(JSON.stringify({ requested: String(input) }), { headers: { 'content-type': 'application/json' } });
  try {
    assert.match(JSON.stringify(await fetchPlayerProfile('42')), /42\/profile.json/);
    assert.match(JSON.stringify(await fetchPlayerDecks('42')), /42\/decks.json/);
  } finally {
    globalThis.fetch = saved;
  }
});
