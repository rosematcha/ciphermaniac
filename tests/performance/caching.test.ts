import test from 'node:test';
import assert from 'node:assert/strict';

import { DataCache } from '../../src/utils/DataCache.ts';

// Basic DataCache behavior: set/get and TTL expiry

test('DataCache set and get cached master', () => {
  const cache = new DataCache();
  const tournament = 'T1';
  const data = { deckTotal: 10, items: [{ id: 'd1' }] };
  cache.setCachedMaster(tournament, data);
  const got = cache.getCachedMaster(tournament);
  assert.ok(got !== null);
  assert.strictEqual(got!.deckTotal, 10);
});

test('DataCache TTL expiry respects configured TTL', async () => {
  const cache = new DataCache();
  const tournament = 'T2';
  const data = { deckTotal: 1, items: [] };
  cache.setCachedMaster(tournament, data);
  const got = cache.getCachedMaster(tournament);
  assert.ok(got !== null);

  // Temporarily simulate expiry by directly manipulating internal ttl (testing-only)
  // @ts-ignore
  cache.ttl = 1; // 1ms
  await new Promise(resolve => {
    setTimeout(resolve, 5);
  });
  const expired = cache.getCachedMaster(tournament);
  assert.strictEqual(expired, null);
});

// Ensure methods tolerate unknown keys

test('DataCache handles missing entries gracefully', () => {
  const cache = new DataCache();
  const missing = cache.getCachedMaster('NOPE');
  assert.strictEqual(missing, null);
});
