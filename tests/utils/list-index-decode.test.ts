import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeListIndex } from '../../src/lib/data/lists.ts';
import type { ListIndexPayload } from '../../shared/data/reports/listIndex.ts';

const PAYLOAD = {
  schemaVersion: 1,
  tags: ['winner', 'top8', 'top25'],
  archetypes: ['Dragapult', 'Gardevoir', 'Dragapult Dusknoir'],
  events: [['t1', 'Weekly', '2026-10-20', 64]],
  cards: [
    ["Boss's Orders", 'MEG', '114', 'trainer'],
    ['Dreepy', 'TWM', '128', 'pokemon']
  ],
  decks: [
    ['A', 'US', 1, 0, 0, 0b111, [0, 2, 1, 4]],
    ['B', 'JP', 2, 1, 0, 0b010, [1, 3]],
    ['C', 'BR', 3, 2, 0, 0b100, [0, 1]],
    ['D', 'US', 4, 0, 9, 0, [7, 1, 0, 3]],
    ['E', 'CA', 0, 5, 0, 0b001, []]
  ]
} as unknown as ListIndexPayload;

test('decoding only kept archetypes yields the same records, ids and order as filtering afterwards', () => {
  const all = decodeListIndex(PAYLOAD, null);
  assert.deepEqual(
    all.map(record => record.id),
    [0, 1, 2, 3, 4]
  );
  for (const keep of [
    (label: string) => label === 'Dragapult',
    (label: string) => label.startsWith('Dragapult'),
    (label: string) => label === '',
    () => false
  ]) {
    assert.deepEqual(
      decodeListIndex(PAYLOAD, null, keep),
      all.filter(record => keep(record.archetype))
    );
  }
  assert.deepEqual([...all[0].tags], ['winner', 'top8', 'top25']);
});
