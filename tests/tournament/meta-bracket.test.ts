/**
 * The home page's bracket: seeded 1v8, 4v5, 2v7, 3v6, each match to the deck
 * its record favours, the higher seed when the data says nothing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { favoured, playOutBracket } from '../../src/lib/tournament/metaBracket.ts';

const SEEDS = [
  'Dragapult',
  "N's Zoroark",
  'Dragapult Dusknoir',
  'Alakazam',
  'Slowking',
  'Excadrill',
  'Blaziken',
  'Crustle'
];

/** Crustle beats Dragapult and Alakazam but loses to Excadrill; Excadrill beats Dusknoir and Zoroark. */
const RATES: Record<string, Record<string, number>> = {
  Crustle: { Dragapult: 66, Alakazam: 53, Excadrill: 28 },
  Dragapult: { Crustle: 31 },
  Alakazam: { Slowking: 66, Crustle: 44 },
  Slowking: { Alakazam: 28 },
  Excadrill: { 'Dragapult Dusknoir': 55, "N's Zoroark": 54, Crustle: 71 },
  'Dragapult Dusknoir': { Excadrill: 42 },
  "N's Zoroark": { Blaziken: 49, Excadrill: 43 },
  Blaziken: { "N's Zoroark": 46 }
};
const rate = (a: string, b: string) => RATES[a]?.[b] ?? null;

test('each match goes to the deck its record favours', () => {
  assert.equal(favoured('Dragapult', 'Crustle', rate), 'Crustle');
  assert.equal(favoured('Alakazam', 'Slowking', rate), 'Alakazam');
  assert.equal(favoured('Dragapult', 'Slowking', rate), 'Dragapult', 'no record: the higher seed');
});

test('the bracket is seeded 1v8, 4v5, 2v7, 3v6 and played out to a champion', () => {
  const bracket = playOutBracket(SEEDS, rate);
  assert.ok(bracket);
  assert.deepEqual(bracket.quarterfinals, [
    ['Dragapult', 'Crustle'],
    ['Alakazam', 'Slowking'],
    ["N's Zoroark", 'Blaziken'],
    ['Dragapult Dusknoir', 'Excadrill']
  ]);
  assert.deepEqual(bracket.semifinals, [
    ['Crustle', 'Alakazam'],
    ["N's Zoroark", 'Excadrill']
  ]);
  assert.deepEqual(bracket.final, ['Crustle', 'Excadrill']);
  assert.equal(bracket.champion, 'Excadrill');
  assert.equal(playOutBracket(SEEDS.slice(0, 7), rate), null, 'eight decks or no bracket');
});
