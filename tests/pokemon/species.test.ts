/** Every Pokémon as a deck can be named for it, and the sprite a deck named so draws. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPairLabel,
  pairLabel,
  pairLead,
  SPECIES_LABELS,
  speciesIcons,
  speciesPair
} from '../../shared/pokemon/species.ts';

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

test('a deck named for anything but one Pokémon or two draws nothing from here', () => {
  assert.deepEqual(speciesIcons('Tyrantrum Box'), []);
  assert.deepEqual(speciesIcons('Dragapult Dusknoir Ditto'), []);
  assert.deepEqual(speciesIcons(''), []);
  assert.deepEqual(speciesIcons(null), []);
});

test('a query leads with a Pokémon only once its whole name and a space are typed', () => {
  assert.equal(pairLead('Tyrantr'), null);
  assert.equal(pairLead('Tyrantrum'), null);
  assert.deepEqual(pairLead('Tyrantrum '), { lead: 'Tyrantrum', tail: '' });
  assert.deepEqual(pairLead('tyrantrum B'), { lead: 'Tyrantrum', tail: 'B' });
  assert.equal(pairLead('Iron V'), null);
  assert.deepEqual(pairLead('Iron Valiant Mi'), { lead: 'Iron Valiant', tail: 'Mi' });
});

test('a pair is saved under one label whichever Pokémon was typed first', () => {
  assert.equal(pairLabel('Tyrantrum', 'Barbaracle'), 'Barbaracle Tyrantrum');
  assert.equal(pairLabel('Barbaracle', 'Tyrantrum'), 'Barbaracle Tyrantrum');
  assert.ok(isPairLabel('Barbaracle Tyrantrum'));
  assert.ok(!isPairLabel('Tyrantrum Barbaracle'));
  assert.ok(!isPairLabel('Tyrantrum'));
  assert.ok(!isPairLabel('Tyrantrum Box'));
  assert.deepEqual(speciesPair('Iron Valiant Mr. Mime'), ['Iron Valiant', 'Mr. Mime']);
});

test('a pair draws both sprites', () => {
  assert.deepEqual(speciesIcons('Barbaracle Tyrantrum'), ['barbaracle', 'tyrantrum']);
});
