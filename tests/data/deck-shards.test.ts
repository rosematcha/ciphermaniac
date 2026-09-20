import assert from 'node:assert/strict';
import test from 'node:test';

import { partitionDecks } from '../../.github/scripts/lib/build/deckShards';

test('deck shards cover the corpus exactly once', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const other = { id: 'other' };
  const shards = partitionDecks(
    [a, b, other],
    [
      { base: 'A', decks: [a] },
      { base: 'B', decks: [b] }
    ]
  );
  assert.deepEqual(shards, [
    { path: 'archetypes/A/decks.json', decks: [a] },
    { path: 'archetypes/B/decks.json', decks: [b] },
    { path: 'decks/other.json', decks: [other] }
  ]);
});

test('deck shards reject duplicate or foreign rows', () => {
  const deck = { id: 'a' };
  assert.throws(() => partitionDecks([deck], [{ base: 'A', decks: [deck, deck] }]), /not a disjoint subset/);
  assert.throws(() => partitionDecks([deck], [{ base: 'A', decks: [{ id: 'foreign' }] }]), /not a disjoint subset/);
});
