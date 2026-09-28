/**
 * Pasted decklists: PTCGL's export reads section by section, bare lists read
 * too, and a list that breaks the size or copy rules says how.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isBasicEnergy, parseDecklist } from '../../shared/tournament/decklist.ts';

const PTCGL = `Pokémon: 12
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
1 Fezandipiti ex SFA 38

Trainer: 40
4 Arven SVI 166
4 Iono PAL 185
4 Ultra Ball SVI 196
4 Rare Candy SVI 191
4 Buddy-Buddy Poffin TEF 144
4 Nest Ball SVI 181
4 Counter Catcher PAR 160
4 Night Stretcher SFA 61
4 Professor's Research JTG 155
4 Boss's Orders PAL 172

Energy: 8
4 Basic {P} Energy SVE 5
4 Fire Energy SVE 2

Total Cards: 60`;

test('reads a PTCGL export into sections', () => {
  const deck = parseDecklist(PTCGL);
  assert.equal(deck.total, 60);
  assert.deepEqual(deck.problems, []);
  assert.deepEqual(deck.cards[0], { count: 4, name: 'Dreepy', set: 'TWM', number: '128', section: 'pokemon' });
  assert.equal(deck.cards.find(card => card.name === "Professor's Research")?.section, 'trainer');
  assert.equal(deck.cards.at(-1)?.section, 'energy');
});

test('reads bare lines with no headers or set codes', () => {
  const deck = parseDecklist('4 Ultra Ball\n2 Psychic Energy');
  assert.deepEqual(
    deck.cards.map(card => [card.count, card.name, card.set, card.section]),
    [
      [4, 'Ultra Ball', '', 'pokemon'],
      [2, 'Psychic Energy', '', 'energy']
    ]
  );
});

test('reports the wrong size, too many copies and unread lines', () => {
  const deck = parseDecklist('5 Iono PAL 185\n3 Iono PAL 254\nsome note');
  assert.equal(deck.total, 8);
  assert.deepEqual(deck.unread, ['some note']);
  assert.deepEqual(deck.problems, [
    '8 cards (a deck is 60)',
    '8 copies of Iono (the limit is 4)',
    '1 line not read as a card'
  ]);
});

test('basic energy is exempt from the copy limit', () => {
  assert.ok(isBasicEnergy('Basic {D} Energy'));
  assert.ok(isBasicEnergy('Darkness Energy'));
  assert.ok(!isBasicEnergy('Jet Energy'));
  const deck = parseDecklist('10 Basic {P} Energy SVE 5');
  assert.ok(!deck.problems.some(problem => problem.includes('copies')));
});
