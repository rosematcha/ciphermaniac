/** Every Pokémon as a deck can be named for it, and the sprite a deck named so draws. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SPECIES_LABELS, speciesIcons } from '../../shared/pokemon/species.ts';

test('every species of the National Dex is named, once', () => {
  for (const label of ['Bulbasaur', 'Tyrantrum', 'Pecharunt', 'Iron Valiant', 'Tapu Koko', 'Great Tusk']) {
    assert.ok(SPECIES_LABELS.includes(label), label);
  }
  assert.equal(new Set(SPECIES_LABELS).size, SPECIES_LABELS.length);
});

test('names a slug cannot spell are written as the cards write them', () => {
  for (const label of [
    "Farfetch'd",
    'Mr. Mime',
    'Porygon-Z',
    'Ho-Oh',
    'Type: Null',
    'Flabébé',
    'Chien-Pao',
    'Nidoran ♀'
  ]) {
    assert.ok(SPECIES_LABELS.includes(label), label);
  }
  assert.ok(!SPECIES_LABELS.includes('Porygon Z'));
  assert.ok(!SPECIES_LABELS.includes('Mr Mime'));
});

test('Mega and regional forms are named as the icon map names them, other forms not at all', () => {
  for (const label of [
    'Mega Lucario',
    'Mega Charizard X',
    'Hisuian Arcanine',
    'Alolan Vulpix',
    'Galarian Mr. Mime',
    'Paldean Wooper'
  ]) {
    assert.ok(SPECIES_LABELS.includes(label), label);
  }
  for (const label of ['Charizard (Gmax)', 'Rotom Heat', 'Gmax Charizard', 'Darmanitan Galar Zen']) {
    assert.ok(!SPECIES_LABELS.includes(label), label);
  }
  assert.ok(!SPECIES_LABELS.some(label => /gmax|primal|therian/i.test(label)));
});

test('a deck named for one Pokémon draws its sprite, however the name is typed', () => {
  assert.deepEqual(speciesIcons('Tyrantrum'), ['tyrantrum']);
  assert.deepEqual(speciesIcons('tyrantrum'), ['tyrantrum']);
  assert.deepEqual(speciesIcons('Mr Mime'), ['mr-mime']);
  assert.deepEqual(speciesIcons('Flabebe'), ['flabebe']);
  assert.deepEqual(speciesIcons('Hisuian Arcanine'), ['arcanine-hisui']);
  assert.deepEqual(speciesIcons('Mega Charizard X'), ['charizard-mega-x']);
});

test('a deck named for anything more than one Pokémon draws nothing from here', () => {
  assert.deepEqual(speciesIcons('Tyrantrum Box'), []);
  assert.deepEqual(speciesIcons('Dragapult Dusknoir'), []);
  assert.deepEqual(speciesIcons(''), []);
  assert.deepEqual(speciesIcons(null), []);
});
