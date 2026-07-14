/**
 * tests/data/semantic-hash.test.ts
 * Verification matrix: volatile fetch timestamps do not affect semantic hashes;
 * meaningful data changes do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { sha256Hex, semanticHash } from '../../shared/data/hash.ts';
import { stripVolatile, VOLATILE_KEYS } from '../../shared/data/canonicalJson.ts';

const event = {
  schemaVersion: 1,
  eventId: 'labs:0001',
  decks: [{ deckId: 'd1', cards: [{ uid: 'A::SET::001', count: 2 }] }],
  meta: { name: 'X', updatedAt: '2026-07-13T00:00:00Z' },
  sourceRevisions: [{ source: 'labs', entityId: '0001', sourceHash: 'abc', fetchedAt: '2026-07-13T00:00:00Z' }]
};

test('a volatile-timestamp-only change does NOT change the semantic hash', () => {
  const refetched = {
    ...event,
    meta: { ...event.meta, updatedAt: '2026-07-20T09:30:00Z' },
    sourceRevisions: [{ ...event.sourceRevisions[0], fetchedAt: '2026-07-20T09:30:00Z' }]
  };
  assert.strictEqual(semanticHash(event), semanticHash(refetched));
  // sha256Hex (non-semantic) DOES change — that's why node keys must use semanticHash.
  assert.notStrictEqual(sha256Hex(event), sha256Hex(refetched));
});

test('a meaningful data change DOES change the semantic hash', () => {
  const changed = { ...event, decks: [{ deckId: 'd1', cards: [{ uid: 'A::SET::001', count: 3 }] }] };
  assert.notStrictEqual(semanticHash(event), semanticHash(changed));
});

test('stripVolatile removes exactly the volatile keys, recursively, preserving array order', () => {
  const stripped = stripVolatile({ a: 1, fetchedAt: 't', nested: [{ updatedAt: 't', keep: 2 }], order: [3, 1, 2] }) as Record<string, unknown>;
  assert.deepStrictEqual(stripped, { a: 1, nested: [{ keep: 2 }], order: [3, 1, 2] });
  assert.ok(VOLATILE_KEYS.includes('fetchedAt') && VOLATILE_KEYS.includes('updatedAt'));
});
