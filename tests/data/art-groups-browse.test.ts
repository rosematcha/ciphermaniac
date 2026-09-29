/**
 * tests/data/art-groups-browse.test.ts
 * The card-art picker offers two different lists: everything worth ranking is
 * searchable, but only the cards with enough arts to fill a board are in the
 * scroll you get before typing. Both thresholds are asserted here because the
 * split is the whole point — raising one without the other would either bury
 * the browse list under promos or make cards unfindable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type ArtCard,
  browsableArtCards,
  findArtCard,
  MIN_ARTS_TO_BROWSE,
  MIN_ARTS_TO_RANK
} from '../../src/lib/data/artGroups';

const card = (name: string, arts: number, key = `${name}::SET::1`): ArtCard => ({
  key,
  name,
  arts: Array.from({ length: arts }, (_, i) => ({ ref: `SET::${i + 1}`, set: 'SET', number: `${i + 1}` }))
});

test('the browse threshold sits above the searchable one, so browsing is a subset', () => {
  assert.ok(MIN_ARTS_TO_BROWSE > MIN_ARTS_TO_RANK);
});

test('a card is browsable from five arts up, in the order it was given', () => {
  // The catalogue arrives richest first; browsing must not reshuffle it.
  const catalogue = [card('Twenty', 20), card('Five', 5), card('Four', 4), card('Nine', 9), card('Three', 3)];
  assert.deepEqual(
    browsableArtCards(catalogue).map(c => c.name),
    ['Twenty', 'Five', 'Nine']
  );
});

test('a card is looked up by its cluster key, so one name can offer two cards', () => {
  const obf = card('Charizard ex', 7, 'Charizard ex::OBF::125');
  const mew = card('Charizard ex', 4, 'Charizard ex::MEW::006');
  assert.equal(findArtCard([obf, mew], 'Charizard ex::MEW::006'), mew);
  assert.equal(findArtCard([obf, mew], 'Charizard ex::OBF::125'), obf);
});

test('a link shared before the split still opens, on the richest cluster of that name', () => {
  // The fallback takes the first cluster in catalogue order, and the catalogue
  // is sorted richest-first — a pre-split link was built against the merged
  // entry, so the fullest list is the nearest thing to it. Asserted in both
  // fixture orders so it is the rule under test, not the fixture's luck.
  const obf = card('Charizard ex', 7, 'Charizard ex::OBF::125');
  const mew = card('Charizard ex', 4, 'Charizard ex::MEW::006');
  assert.equal(findArtCard([obf, mew], 'Charizard ex'), obf);
  assert.equal(findArtCard([mew, obf], 'Charizard ex'), mew);
});

test('an unknown subject finds nothing rather than the wrong card', () => {
  assert.equal(findArtCard([card('Iono', 6)], 'Pidgey'), undefined);
});
