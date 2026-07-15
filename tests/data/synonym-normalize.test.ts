/**
 * tests/data/synonym-normalize.test.ts
 * normalizeSynonymDatabase: flatten cycles + chains to one terminal canonical,
 * so getCanonicalCardFromData (single-hop) is always terminal and the edge
 * card redirect cannot 301-loop.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getCanonicalCardFromData, normalizeSynonymDatabase } from '../../shared/data/cardIdentity.ts';

test('breaks a 2-cycle by keeping the most-referenced node as canonical', () => {
  // Dragapult-shaped: four variants point at PRE::073, plus a stale PRE::073 -> TWM::130 back-edge.
  const db = {
    synonyms: {
      'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073',
      'Dragapult ex::TWM::200': 'Dragapult ex::PRE::073',
      'Dragapult ex::PRE::165': 'Dragapult ex::PRE::073',
      'Dragapult ex::ASC::160': 'Dragapult ex::PRE::073',
      'Dragapult ex::PRE::073': 'Dragapult ex::TWM::130' // stale reverse edge -> cycle
    },
    canonicals: {}
  };
  const flat = normalizeSynonymDatabase(db);
  // PRE::073 has the most in-edges -> it wins and is no longer a key.
  assert.strictEqual(flat.synonyms['Dragapult ex::PRE::073'], undefined);
  for (const variant of ['TWM::130', 'TWM::200', 'PRE::165', 'ASC::160'].map(s => `Dragapult ex::${s}`)) {
    assert.strictEqual(flat.synonyms[variant], 'Dragapult ex::PRE::073');
  }
  // Single-hop resolution is now terminal in BOTH directions (no loop).
  assert.strictEqual(getCanonicalCardFromData(flat, 'Dragapult ex::TWM::130'), 'Dragapult ex::PRE::073');
  assert.strictEqual(getCanonicalCardFromData(flat, 'Dragapult ex::PRE::073'), 'Dragapult ex::PRE::073');
});

test('flattens a multi-hop chain A->B->C so every node resolves to C in one hop', () => {
  const db = { synonyms: { A: 'B', B: 'C', X: 'C' }, canonicals: {} };
  const flat = normalizeSynonymDatabase(db);
  // C has in-degree 2 (B, X) vs B in-degree 1 (A) -> C is canonical.
  assert.strictEqual(flat.synonyms.A, 'C');
  assert.strictEqual(flat.synonyms.B, 'C');
  assert.strictEqual(flat.synonyms.X, 'C');
  assert.strictEqual(flat.synonyms.C, undefined);
  assert.strictEqual(getCanonicalCardFromData(flat, 'A'), 'C');
});

test('pure 2-cycle with equal in-degree breaks deterministically by smallest UID', () => {
  const flat = normalizeSynonymDatabase({ synonyms: { B: 'A', A: 'B' }, canonicals: {} });
  assert.strictEqual(flat.synonyms.B, 'A'); // 'A' < 'B'
  assert.strictEqual(flat.synonyms.A, undefined);
});

test('re-points name canonicals to the terminal UID and is idempotent', () => {
  const db = { synonyms: { A: 'B', B: 'C' }, canonicals: { Foo: 'B' } };
  const once = normalizeSynonymDatabase(db);
  assert.strictEqual(once.canonicals.Foo, 'C');
  const twice = normalizeSynonymDatabase(once);
  assert.deepStrictEqual(twice.synonyms, once.synonyms);
  assert.deepStrictEqual(twice.canonicals, once.canonicals);
});

test('leaves an already-flat map unchanged and preserves prints', () => {
  const db = { synonyms: { A: 'C', B: 'C' }, canonicals: { N: 'C' }, prints: { C: 1.5 } };
  const flat = normalizeSynonymDatabase(db);
  assert.deepStrictEqual(flat.synonyms, { A: 'C', B: 'C' });
  assert.deepStrictEqual(flat.prints, { C: 1.5 });
});
