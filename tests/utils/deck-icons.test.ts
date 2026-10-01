/** A reported deck's sprites: its own, the icon map's, then a Pokémon's once the species have loaded. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadArchetypeIconMap } from '../../src/lib/data/archetypes';
import { deckIcons, loadSpecies } from '../../src/lib/deckIcons';

test('a deck draws its own sprites, then the icon map’s, before any Pokémon’s', async () => {
  await loadArchetypeIconMap(async () => ({ Pikachu: ['pikachu-gmax'] }));
  assert.deepEqual(deckIcons({ label: 'Tyrantrum', icons: ['tyrunt'] }), ['tyrunt']);
  assert.deepEqual(deckIcons({ label: 'Pikachu' }), ['pikachu-gmax']);
});

test('a deck named for one Pokémon draws its sprite once the species have loaded', async () => {
  await loadArchetypeIconMap(async () => ({}));
  assert.deepEqual(deckIcons({ label: 'Tyrantrum' }), [], 'nothing until they have');
  const species = await loadSpecies();
  assert.equal(await loadSpecies(), species, 'loaded once');
  assert.deepEqual(deckIcons({ label: 'Tyrantrum' }), ['tyrantrum']);
  assert.deepEqual(deckIcons({ label: 'Homebrew Box' }), []);
});
