/**
 * tests/utils/search-fold.test.ts
 * foldSearch: diacritic-insensitive, case-insensitive search comparison.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { foldSearch } from '../../src/utils/searchFold.ts';

test('folds case and diacritics so plain queries match accented names', () => {
  assert.strictEqual(foldSearch('Pokégear 3.0'), 'pokegear 3.0');
  assert.ok(foldSearch('Pokégear 3.0').includes(foldSearch('Pokegear')));
  assert.ok(foldSearch('Poké Ball').includes(foldSearch('poke ball')));
  assert.ok(foldSearch('Genesect ex').includes(foldSearch('GENESECT')));
});

test('leaves plain ASCII untouched apart from case', () => {
  assert.strictEqual(foldSearch('Boss’s Orders'), 'boss’s orders');
  assert.strictEqual(foldSearch('Rare Candy'), 'rare candy');
});
