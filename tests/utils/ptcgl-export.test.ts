import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPtcglDeck, type PtcglEntry, ptcglNumber, ptcglSection } from '../../src/utils/ptcglExport.ts';

test('ptcglNumber strips leading zeros but keeps suffixes', () => {
  assert.equal(ptcglNumber('002'), '2');
  assert.equal(ptcglNumber('007'), '7');
  assert.equal(ptcglNumber('118'), '118');
  assert.equal(ptcglNumber('118A'), '118A');
  assert.equal(ptcglNumber(185), '185');
  assert.equal(ptcglNumber(''), '');
  assert.equal(ptcglNumber(undefined), '');
});

test('ptcglSection routes flat and deep categories alike', () => {
  assert.equal(ptcglSection({ category: 'pokemon' }), 'pokemon');
  assert.equal(ptcglSection({ category: 'trainer' }), 'trainer');
  assert.equal(ptcglSection({ category: 'trainer/supporter' }), 'trainer');
  assert.equal(ptcglSection({ category: 'energy' }), 'energy');
  assert.equal(ptcglSection({ category: 'energy/basic' }), 'energy');
  // Falls back to supertype, then defaults to pokemon.
  assert.equal(ptcglSection({ supertype: 'Trainer' }), 'trainer');
  assert.equal(ptcglSection({}), 'pokemon');
});

test('buildPtcglDeck groups sections with totals and a footer', () => {
  const entries: PtcglEntry[] = [
    { name: 'Charizard ex', set: 'OBF', number: '125', category: 'pokemon', count: 3 },
    { name: 'Charmander', set: 'MEW', number: '004', category: 'pokemon', count: 3 },
    { name: 'Iono', set: 'PAL', number: '185', category: 'trainer/supporter', count: 4 },
    { name: 'Fire Energy', set: 'SVE', number: '002', category: 'energy/basic', count: 9 }
  ];
  const { text, total, sections } = buildPtcglDeck(entries);

  assert.equal(sections.pokemon, 6);
  assert.equal(sections.trainer, 4);
  assert.equal(sections.energy, 9);
  assert.equal(total, 19);

  assert.match(text, /^Pokémon: 6\n/);
  assert.ok(text.includes('Trainer: 4\n'));
  assert.ok(text.includes('Energy: 9\n'));
  assert.ok(text.endsWith('Total Cards: 19'));
  // Zero-stripped numbers and uppercased sets.
  assert.ok(text.includes('4 Iono PAL 185'));
  assert.ok(text.includes('3 Charmander MEW 4'));
  assert.ok(text.includes('9 Fire Energy SVE 2'));
});

test('buildPtcglDeck sorts within a section by count then name', () => {
  const { text } = buildPtcglDeck([
    { name: 'Arven', set: 'OBF', number: '186', category: 'trainer', count: 4 },
    { name: 'Boss’s Orders', set: 'PAL', number: '172', category: 'trainer', count: 2 },
    { name: 'Iono', set: 'PAL', number: '185', category: 'trainer', count: 4 }
  ]);
  const trainerLines = text.split('\n').filter(l => /^\d+ /.test(l));
  // 4-counts first (Arven before Iono alphabetically), then the 2-count.
  assert.deepEqual(trainerLines, ['4 Arven OBF 186', '4 Iono PAL 185', '2 Boss’s Orders PAL 172']);
});

test('buildPtcglDeck falls back to a bare line when set/number missing', () => {
  const { text } = buildPtcglDeck([{ name: 'Basic Fire Energy', category: 'energy', count: 6 }]);
  assert.ok(text.includes('6 Basic Fire Energy'));
  assert.ok(text.endsWith('Total Cards: 6'));
});

test('buildPtcglDeck skips zero/invalid counts and handles an empty list', () => {
  const { text, total } = buildPtcglDeck([{ name: 'Ghost', set: 'X', number: '1', count: 0 }]);
  assert.equal(total, 0);
  assert.equal(text, 'Total Cards: 0');
});
