/** The deck pickers' list for an event: the format's archetypes with the event's own decks laid over them. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { eventDecks, withEventDecks } from '../../src/pages/tournaments/eventDecks.ts';

const FORMAT = [
  { label: 'Dark Tyranitar', icons: ['tyranitar'], percent: 14, played: true },
  { label: 'Gardevoir', icons: ['gardevoir'] }
];

test('the event’s decks count as played, and ones the format lacks join the list', () => {
  const decks = withEventDecks(FORMAT, ['Gardevoir', 'Mono Water', 'Mono Water']);
  assert.deepEqual(decks, [
    FORMAT[0],
    { label: 'Gardevoir', icons: ['gardevoir'], played: true },
    { label: 'Mono Water', played: true }
  ]);
  assert.deepEqual(withEventDecks(FORMAT, []), FORMAT, 'no decks entered leaves the format’s list as it is');
});

test('every picker on a page shares one list while nothing changes', () => {
  const first = eventDecks(FORMAT, ['Gardevoir']);
  assert.equal(eventDecks(FORMAT, ['Gardevoir']), first);
  assert.notEqual(eventDecks(FORMAT, ['Gardevoir', 'Mono Water']), first, 'a deck entered makes a new list');
  assert.notEqual(eventDecks([...FORMAT], ['Gardevoir']), first, 'as does a new format list');
});
