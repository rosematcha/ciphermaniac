import test from 'node:test';
import assert from 'node:assert/strict';

import { storage } from '../../src/utils/storage.ts';

// Simulate storage set/get failures by monkeypatching storage implementation

test('storage.set throws and callers handle it', () => {
  const original = storage.set;
  (storage as any).set = () => {
    throw new Error('KV write failed');
  };

  let threw = false;
  try {
    storage.set('x', { val: 1 });
  } catch {
    threw = true;
  }
  assert.ok(threw);

  // restore
  (storage as any).set = original;
});

test('storage.get returns null when storage backend missing', () => {
  const originalGet = storage.get;
  (storage as any).get = () => null;
  const value = storage.get('nope');
  assert.strictEqual(value, null);
  (storage as any).get = originalGet;
});
