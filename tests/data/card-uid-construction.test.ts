/**
 * Card UID construction (DB-MASTER-PLAN Phase 6.3).
 *
 * One property, and it is the whole reason `cardUid` exists:
 *
 *   A deck-shaped card and a report-shaped card describing the SAME printing
 *   must produce the SAME UID.
 *
 * Deck artifacts carry raw printings (`TWM/95`); reports, price maps, and the
 * synonym database carry zero-padded ones (`TWM/095`). 547 of the synonym
 * database's 2,295 entries have a leading zero, so a UID assembled by
 * interpolating the fields matches on some cards and silently misses on roughly
 * a quarter of all reprint mappings — which is exactly what
 * `day2CardStatsFromDecks` was doing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cardUid,
  cardUidOrName,
  getCanonicalCardFromData,
  type SynonymDatabase
} from '../../shared/data/cardIdentity.ts';

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

test('deck-shaped and report-shaped input for one printing agree', () => {
  const printings: Array<[string, string, string | number, string | number]> = [
    // [name, set, deck-shaped number, report-shaped number]
    ['Munkidori', 'TWM', '95', '095'],
    ['Wellspring Mask Ogerpon ex', 'PRE', 27, '027'],
    ["Lillie's Clefairy ex", 'ASC', '76', '076'],
    ['Fezandipiti ex', 'SFA', 38, '038'],
    ["Boss's Orders", 'MEG', '114', '114'],
    ['Nest Ball', 'SVI', 181, '181']
  ];
  for (const [name, set, deckNumber, reportNumber] of printings) {
    assert.equal(
      cardUid(name, set, deckNumber),
      cardUid(name, set, reportNumber),
      `${name} ${set}/${deckNumber} vs ${set}/${reportNumber}`
    );
  }
});

test('a UID built from a deck card resolves through a padded synonym database', () => {
  // The exact failure mode: the database keys the variant padded, the deck
  // lists it raw. Interpolating the fields produces a key that is not there.
  const db: SynonymDatabase = {
    synonyms: { 'Wellspring Mask Ogerpon ex::PRE::027': 'Wellspring Mask Ogerpon ex::TWM::064' },
    canonicals: {}
  };
  const naive = `Wellspring Mask Ogerpon ex::PRE::27`;
  assert.equal(getCanonicalCardFromData(db, naive), naive, 'naive interpolation misses (the bug)');

  const built = cardUidOrName('Wellspring Mask Ogerpon ex', 'PRE', 27);
  assert.equal(getCanonicalCardFromData(db, built), 'Wellspring Mask Ogerpon ex::TWM::064');
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('cardUid uppercases the set, pads numeric numbers, and refuses half-specified cards', () => {
  const cases: Array<[string, string | null, string | number | null | undefined, string | null, string]> = [
    ['Nest Ball', 'SvI', '181', 'Nest Ball::SVI::181', 'set code uppercased'],
    ['X', 'ABC', '5', 'X::ABC::005', 'padded to three digits'],
    ['X', 'ABC', 5, 'X::ABC::005', 'numeric input padded'],
    ['X', 'ABC', '005', 'X::ABC::005', 'already padded'],
    ['X', 'ABC', '18a', 'X::ABC::018A', 'suffix uppercased after padding'],
    ['X', 'ABC', '1180', 'X::ABC::1180', 'already longer than three digits'],
    ['X', 'CRZ', 'gg05', 'X::CRZ::GG05', 'non-numeric uppercased, not padded'],
    ['X', 'LOR', 'TG24', 'X::LOR::TG24', 'non-numeric kept'],
    ["Boss's Orders", 'MEG', '114', "Boss's Orders::MEG::114", 'name used verbatim'],
    ['Café Cup', 'ABC', '1', 'Café Cup::ABC::001', 'non-ASCII name used verbatim'],
    ['X', '', '1', null, 'missing set'],
    ['X', 'ABC', '', null, 'missing number'],
    ['X', null, null, null, 'null set and number'],
    ['X', 'ABC', undefined, null, 'undefined number'],
    ['', 'ABC', '1', null, 'missing name']
  ];
  for (const [name, set, number, expected, label] of cases) {
    assert.equal(cardUid(name, set, number), expected, label);
  }
});

test('construction is idempotent: rebuilding from a UID s parts is a fixed point', () => {
  const first = cardUid('Munkidori', 'twm', 95);
  assert.ok(first);
  const [name, set, number] = first.split('::');
  assert.equal(cardUid(name, set, number), first);
});

// ---------------------------------------------------------------------------
// Name-only fallback
// ---------------------------------------------------------------------------

test('cardUidOrName falls back to the bare name, matching the name-only canonicals map', () => {
  assert.equal(cardUidOrName('Basic Fire Energy', null, null), 'Basic Fire Energy');
  assert.equal(cardUidOrName('Munkidori', 'TWM', 95), 'Munkidori::TWM::095');
});

test('a name-only key still resolves through the canonicals map', () => {
  const db: SynonymDatabase = {
    synonyms: {},
    canonicals: { 'Dragapult ex': 'Dragapult ex::PRE::073' }
  };
  assert.equal(getCanonicalCardFromData(db, cardUidOrName('Dragapult ex', null, null)), 'Dragapult ex::PRE::073');
});
