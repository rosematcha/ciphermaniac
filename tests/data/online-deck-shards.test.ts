import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOnlineDecks } from '../../.github/scripts/lib/build/onlineDecks';

function reader(values: Record<string, unknown>) {
  return { read: async <T>(key: string) => (values[key] as T | undefined) ?? null };
}

test('online deck shards form one complete corpus without a duplicate full body', async () => {
  const root = 'online';
  const values = {
    [`${root}/decks/index.json`]: ['archetypes/A/decks.json', 'decks/other.json'],
    [`${root}/archetypes/A/decks.json`]: [{ id: 'a' }],
    [`${root}/decks/other.json`]: [{ id: 'other' }]
  };
  assert.deepEqual(await loadOnlineDecks(reader(values), root), [{ id: 'a' }, { id: 'other' }]);
});

test('online deck shard reads fail closed and only fall back before the index migration', async () => {
  await assert.rejects(loadOnlineDecks(reader({ 'online/decks/index.json': ['../escape.json'] }), 'online'), /Invalid/);
  await assert.rejects(
    loadOnlineDecks(reader({ 'online/decks/index.json': ['archetypes/A/decks.json'] }), 'online'),
    /Missing/
  );
  assert.deepEqual(await loadOnlineDecks(reader({ 'online/decks.json': [{ id: 'legacy' }] }), 'online'), [
    { id: 'legacy' }
  ]);
});
