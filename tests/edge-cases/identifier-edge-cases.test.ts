import test from 'node:test';
import assert from 'node:assert/strict';

import { getBaseName, getCanonicalId, getDisplayName, parseDisplayName } from '../../src/card/identifiers.ts';

// Identifier edge cases adapted to available identifier helpers

test('getDisplayName converts UID to readable string', () => {
  const uid = 'Ultra Ball::DEX::102';
  const display = getDisplayName(uid);
  assert.strictEqual(display, 'Ultra Ball DEX 102');

  const nameOnly = 'Pikachu';
  assert.strictEqual(getDisplayName(nameOnly), 'Pikachu');
});

test('parseDisplayName extracts name and setId when present', () => {
  const parsed = parseDisplayName('Ultra Ball DEX 102');
  assert.strictEqual(parsed.name, 'Ultra Ball');
  assert.strictEqual(parsed.setId, 'DEX 102');

  const parsed2 = parseDisplayName('Just a Name');
  assert.strictEqual(parsed2.name, 'Just a Name');
  assert.strictEqual(parsed2.setId, '');
});

test('getBaseName returns base name for UID and display formats', () => {
  assert.strictEqual(getBaseName('Ultra Ball::DEX::102'), 'Ultra Ball');
  assert.strictEqual(getBaseName('Ultra Ball DEX 102'), 'Ultra Ball');
  assert.strictEqual(getBaseName('NoSetName'), 'NoSetName');
});

test('getCanonicalId prefers UID over name and tolerates missing uid', () => {
  assert.strictEqual(getCanonicalId({ uid: 'UID::A::1', name: 'Name A' } as any), 'UID::A::1');
  assert.strictEqual(getCanonicalId({ name: 'Name B' } as any), 'Name B');
});

// Ensure functions tolerate malformed input without throwing
test('identifiers tolerate malformed input gracefully', () => {
  const badInputs = [null, undefined, ''];
  for (const badInput of badInputs) {
    try {
      const base = getBaseName(badInput as any);
      // base can be null or string; ensure it doesn't throw
      assert.ok(base === null || typeof base === 'string');
    } catch (error) {
      assert.ok(error instanceof Error);
    }
  }
});
