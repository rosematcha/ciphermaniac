/** Two Pokémon typed into the one deck box. */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as species from '../../shared/pokemon/species.ts';
import type { ReportedDeck } from '../../src/pages/live/reportedDeck.ts';
import { pairSearch } from '../../src/pages/live/deckPairs.ts';

const ranking = {
  weight: (deck: ReportedDeck) => deck.percent ?? 0,
  tier: (deck: ReportedDeck) => (deck.played ? 0 : 1)
};
const decks: ReportedDeck[] = [
  { label: 'Dragapult Dusknoir', percent: 12, played: true },
  { label: 'Dragapult ex', percent: 8, played: true },
  ...species.SPECIES_LABELS.map(label => ({ label }))
];
const labels = (query: string) => pairSearch(decks, query, species, ranking)?.map(deck => deck.label);

test('leaves a query alone until a whole Pokémon and a space are typed', () => {
  assert.equal(pairSearch(decks, 'Tyrantr', species, ranking), undefined);
  assert.equal(pairSearch(decks, 'Tyrantrum', species, ranking), undefined);
});

test('offers the second Pokémon the way the first was found', () => {
  const found = labels('Tyrantrum B') ?? [];
  assert.equal(found.length, 8);
  assert.ok(found.every(label => label.startsWith('Tyrantrum B')));
  assert.deepEqual(labels('Tyrantrum Bud'), ['Tyrantrum Budew']);
});

test('puts the archetype the site names ahead of made-up pairs', () => {
  const found = labels('Dragapult D') ?? [];
  assert.equal(found[0], 'Dragapult Dusknoir');
  assert.ok(found.slice(1).every(label => label.startsWith('Dragapult D')));
  assert.ok(labels('Dragapult Ditt')?.includes('Dragapult Ditto'));
  assert.equal(found.filter(label => label === 'Dragapult Dusknoir').length, 1);
});

test('offers a named pair typed backwards as that archetype', () => {
  const found = pairSearch(decks, 'Dusknoir Dragap', species, ranking) ?? [];
  assert.equal(found[0]?.label, 'Dragapult Dusknoir');
  assert.equal(found[0]?.pair, undefined);
});

test('a made-up pair is saved in one order whichever was typed first', () => {
  const [deck] = pairSearch(decks, 'Tyrantrum Barbarac', species, ranking) ?? [];
  assert.deepEqual(deck, { label: 'Tyrantrum Barbaracle', pair: 'Barbaracle Tyrantrum' });
});

test('stops at two Pokémon', () => {
  assert.deepEqual(labels('Tyrantrum Barbaracle B'), []);
});
