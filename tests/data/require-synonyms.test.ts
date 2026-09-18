/**
 * requireSynonymDatabase: pipeline jobs that merge printings refuse to run on
 * a missing or empty synonym database instead of degrading to raw identities.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { requireSynonymDatabase } from '../../shared/data/cardIdentity.ts';

test('returns a populated database unchanged', () => {
  const db = { synonyms: { 'Ultra Ball::30C::128': 'Ultra Ball::MEG::131' }, canonicals: {} };
  assert.equal(requireSynonymDatabase(db, 'key'), db);
});

test('throws when the asset was not found', () => {
  assert.throws(() => requireSynonymDatabase(null, 'assets/card-synonyms.json'), /assets\/card-synonyms\.json/);
});

test('throws when the asset has no synonyms', () => {
  assert.throws(() => requireSynonymDatabase({ synonyms: {}, canonicals: {} }, 'key'), /missing or empty/);
  assert.throws(() => requireSynonymDatabase({ canonicals: {} }, 'key'), /missing or empty/);
});
