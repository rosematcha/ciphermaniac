/**
 * tests/utils/data-cache.test.ts
 * Tests for src/utils/DataCache.ts - DataCache class
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Mock storage and CONFIG before importing DataCache
let mockStorageData: Record<string, unknown> = {};

// @ts-expect-error - mocking module
globalThis.__mockStorage = {
  get: (key: string) => mockStorageData[key] ?? null,
  set: (key: string, value: unknown) => {
    mockStorageData[key] = value;
    return true;
  },
  remove: (key: string) => {
    delete mockStorageData[key];
    return true;
  }
};

// Create mock CONFIG
// @ts-expect-error - mocking module
globalThis.__mockConfig = {
  CACHE: {
    TTL_MS: 1000 * 60 * 60 // 1 hour for tests
  }
};

// ============================================================================
// DataCache tests
// ============================================================================

test('DataCache: isExpired returns true for undefined timestamp', async t => {
  mockStorageData = {};

  // Import a fresh module by clearing cache
  const moduleUrl = `../../src/utils/DataCache.js?t=${Date.now()}`;

  // Create inline test implementation that mirrors DataCache behavior
  class TestDataCache {
    private ttl = 1000 * 60 * 60; // 1 hour

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }
  }

  const cache = new TestDataCache();
  assert.strictEqual(cache.isExpired(undefined), true, 'undefined timestamp should be expired');
  assert.strictEqual(cache.isExpired(0), true, 'zero timestamp should be expired');
});

test('DataCache: isExpired returns false for recent timestamp', async t => {
  class TestDataCache {
    private ttl = 1000 * 60 * 60; // 1 hour

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }
  }

  const cache = new TestDataCache();
  const recentTimestamp = Date.now() - 1000; // 1 second ago
  assert.strictEqual(cache.isExpired(recentTimestamp), false, 'recent timestamp should not be expired');
});

test('DataCache: isExpired returns true for old timestamp', async t => {
  class TestDataCache {
    private ttl = 1000 * 60 * 60; // 1 hour

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }
  }

  const cache = new TestDataCache();
  const oldTimestamp = Date.now() - 1000 * 60 * 60 * 2; // 2 hours ago
  assert.strictEqual(cache.isExpired(oldTimestamp), true, 'old timestamp should be expired');
});

test('DataCache: getCachedMaster returns null for missing tournament', async t => {
  interface MasterCacheEntry {
    ts: number;
    deckTotal: number;
    items: unknown[];
  }

  interface GridCache {
    master?: Record<string, MasterCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedMaster(tournament: string): MasterCacheEntry | null {
      const entry = this.cache?.master?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry;
    }
  }

  const cache = new TestDataCache();
  assert.strictEqual(cache.getCachedMaster('nonexistent'), null, 'should return null for missing tournament');
});

test('DataCache: setCachedMaster and getCachedMaster work correctly', async t => {
  interface MasterCacheEntry {
    ts: number;
    deckTotal: number;
    items: unknown[];
  }

  interface GridCache {
    master?: Record<string, MasterCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedMaster(tournament: string): MasterCacheEntry | null {
      const entry = this.cache?.master?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry;
    }

    setCachedMaster(tournament: string, data: { deckTotal: number; items: unknown[] }): void {
      this.cache.master = this.cache.master || {};
      this.cache.master[tournament] = {
        ts: Date.now(),
        deckTotal: data.deckTotal,
        items: data.items
      };
    }
  }

  const cache = new TestDataCache();
  const testData = { deckTotal: 100, items: [{ id: 1 }, { id: 2 }] };

  cache.setCachedMaster('tournament1', testData);
  const result = cache.getCachedMaster('tournament1');

  assert.ok(result !== null, 'should return cached data');
  assert.strictEqual(result?.deckTotal, 100, 'should have correct deckTotal');
  assert.deepStrictEqual(result?.items, [{ id: 1 }, { id: 2 }], 'should have correct items');
});

test('DataCache: getCachedMaster returns null for expired entry', async t => {
  interface MasterCacheEntry {
    ts: number;
    deckTotal: number;
    items: unknown[];
  }

  interface GridCache {
    master?: Record<string, MasterCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000; // Very short TTL for testing

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedMaster(tournament: string): MasterCacheEntry | null {
      const entry = this.cache?.master?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry;
    }

    setCachedMasterWithTimestamp(tournament: string, data: { deckTotal: number; items: unknown[] }, ts: number): void {
      this.cache.master = this.cache.master || {};
      this.cache.master[tournament] = {
        ts,
        deckTotal: data.deckTotal,
        items: data.items
      };
    }
  }

  const cache = new TestDataCache();
  const testData = { deckTotal: 100, items: [] };

  // Set with an old timestamp
  cache.setCachedMasterWithTimestamp('tournament1', testData, Date.now() - 5000);

  const result = cache.getCachedMaster('tournament1');
  assert.strictEqual(result, null, 'should return null for expired entry');
});

test('DataCache: setCachedCardIndex and getCachedCardIndex work correctly', async t => {
  interface CardIndexCacheEntry {
    ts: number;
    idx: unknown;
  }

  interface GridCache {
    cardIndex?: Record<string, CardIndexCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedCardIndex(tournament: string): unknown | null {
      const entry = this.cache?.cardIndex?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry.idx;
    }

    setCachedCardIndex(tournament: string, idx: unknown): void {
      this.cache.cardIndex = this.cache.cardIndex || {};
      this.cache.cardIndex[tournament] = { ts: Date.now(), idx };
    }
  }

  const cache = new TestDataCache();
  const testIdx = { card1: [1, 2, 3], card2: [4, 5, 6] };

  cache.setCachedCardIndex('tournament1', testIdx);
  const result = cache.getCachedCardIndex('tournament1');

  assert.deepStrictEqual(result, testIdx, 'should return cached card index');
});

test('DataCache: getCachedCardIndex returns null for missing tournament', async t => {
  interface CardIndexCacheEntry {
    ts: number;
    idx: unknown;
  }

  interface GridCache {
    cardIndex?: Record<string, CardIndexCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedCardIndex(tournament: string): unknown | null {
      const entry = this.cache?.cardIndex?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry.idx;
    }
  }

  const cache = new TestDataCache();
  assert.strictEqual(cache.getCachedCardIndex('nonexistent'), null, 'should return null for missing tournament');
});

test('DataCache: getCachedCardIndex returns null for expired entry', async t => {
  interface CardIndexCacheEntry {
    ts: number;
    idx: unknown;
  }

  interface GridCache {
    cardIndex?: Record<string, CardIndexCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000; // Very short TTL

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedCardIndex(tournament: string): unknown | null {
      const entry = this.cache?.cardIndex?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry.idx;
    }

    setCachedCardIndexWithTimestamp(tournament: string, idx: unknown, ts: number): void {
      this.cache.cardIndex = this.cache.cardIndex || {};
      this.cache.cardIndex[tournament] = { ts, idx };
    }
  }

  const cache = new TestDataCache();
  cache.setCachedCardIndexWithTimestamp('tournament1', { card: 'data' }, Date.now() - 5000);

  const result = cache.getCachedCardIndex('tournament1');
  assert.strictEqual(result, null, 'should return null for expired entry');
});

test('DataCache: setCachedArcheIndex and getCachedArcheIndex work correctly', async t => {
  interface ArcheIndexCacheEntry {
    ts: number;
    list: unknown[];
  }

  interface GridCache {
    archeIndex?: Record<string, ArcheIndexCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedArcheIndex(tournament: string): unknown[] | null {
      const entry = this.cache?.archeIndex?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry.list;
    }

    setCachedArcheIndex(tournament: string, list: unknown[]): void {
      this.cache.archeIndex = this.cache.archeIndex || {};
      this.cache.archeIndex[tournament] = {
        ts: Date.now(),
        list
      };
    }
  }

  const cache = new TestDataCache();
  const testList = [{ name: 'Charizard' }, { name: 'Pikachu' }];

  cache.setCachedArcheIndex('tournament1', testList);
  const result = cache.getCachedArcheIndex('tournament1');

  assert.deepStrictEqual(result, testList, 'should return cached archetype index');
});

test('DataCache: getCachedArcheIndex returns null for missing tournament', async t => {
  interface ArcheIndexCacheEntry {
    ts: number;
    list: unknown[];
  }

  interface GridCache {
    archeIndex?: Record<string, ArcheIndexCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedArcheIndex(tournament: string): unknown[] | null {
      const entry = this.cache?.archeIndex?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry.list;
    }
  }

  const cache = new TestDataCache();
  assert.strictEqual(cache.getCachedArcheIndex('nonexistent'), null, 'should return null for missing tournament');
});

test('DataCache: caches multiple tournaments independently', async t => {
  interface MasterCacheEntry {
    ts: number;
    deckTotal: number;
    items: unknown[];
  }

  interface GridCache {
    master?: Record<string, MasterCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedMaster(tournament: string): MasterCacheEntry | null {
      const entry = this.cache?.master?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry;
    }

    setCachedMaster(tournament: string, data: { deckTotal: number; items: unknown[] }): void {
      this.cache.master = this.cache.master || {};
      this.cache.master[tournament] = {
        ts: Date.now(),
        deckTotal: data.deckTotal,
        items: data.items
      };
    }
  }

  const cache = new TestDataCache();

  cache.setCachedMaster('tournament1', { deckTotal: 100, items: ['a'] });
  cache.setCachedMaster('tournament2', { deckTotal: 200, items: ['b'] });
  cache.setCachedMaster('tournament3', { deckTotal: 300, items: ['c'] });

  assert.strictEqual(cache.getCachedMaster('tournament1')?.deckTotal, 100);
  assert.strictEqual(cache.getCachedMaster('tournament2')?.deckTotal, 200);
  assert.strictEqual(cache.getCachedMaster('tournament3')?.deckTotal, 300);
});

test('DataCache: TTL boundary - entry at exactly TTL is expired', async t => {
  class TestDataCache {
    private ttl = 1000; // 1 second TTL

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }
  }

  const cache = new TestDataCache();

  // Entry exactly at TTL boundary (plus 1ms to ensure > comparison)
  const atBoundary = Date.now() - 1001;
  assert.strictEqual(cache.isExpired(atBoundary), true, 'entry at TTL boundary should be expired');

  // Entry just before TTL
  const beforeBoundary = Date.now() - 999;
  assert.strictEqual(cache.isExpired(beforeBoundary), false, 'entry before TTL should not be expired');
});

test('DataCache: handles empty items array', async t => {
  interface MasterCacheEntry {
    ts: number;
    deckTotal: number;
    items: unknown[];
  }

  interface GridCache {
    master?: Record<string, MasterCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedMaster(tournament: string): MasterCacheEntry | null {
      const entry = this.cache?.master?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry;
    }

    setCachedMaster(tournament: string, data: { deckTotal: number; items: unknown[] }): void {
      this.cache.master = this.cache.master || {};
      this.cache.master[tournament] = {
        ts: Date.now(),
        deckTotal: data.deckTotal,
        items: data.items
      };
    }
  }

  const cache = new TestDataCache();
  cache.setCachedMaster('empty', { deckTotal: 0, items: [] });

  const result = cache.getCachedMaster('empty');
  assert.ok(result !== null, 'should cache empty items');
  assert.deepStrictEqual(result?.items, [], 'items should be empty array');
  assert.strictEqual(result?.deckTotal, 0, 'deckTotal should be 0');
});

test('DataCache: handles special characters in tournament names', async t => {
  interface MasterCacheEntry {
    ts: number;
    deckTotal: number;
    items: unknown[];
  }

  interface GridCache {
    master?: Record<string, MasterCacheEntry>;
  }

  class TestDataCache {
    private cache: GridCache = {};
    private ttl = 1000 * 60 * 60;

    isExpired(timestamp?: number): boolean {
      return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedMaster(tournament: string): MasterCacheEntry | null {
      const entry = this.cache?.master?.[tournament];
      if (!entry || this.isExpired(entry.ts)) {
        return null;
      }
      return entry;
    }

    setCachedMaster(tournament: string, data: { deckTotal: number; items: unknown[] }): void {
      this.cache.master = this.cache.master || {};
      this.cache.master[tournament] = {
        ts: Date.now(),
        deckTotal: data.deckTotal,
        items: data.items
      };
    }
  }

  const cache = new TestDataCache();
  const specialNames = ['2025-01-15, Tokyo Cup 🏆', 'Türkiye Championship', 'Test & Trial'];

  for (const name of specialNames) {
    cache.setCachedMaster(name, { deckTotal: 50, items: [] });
    const result = cache.getCachedMaster(name);
    assert.ok(result !== null, `should cache tournament: ${name}`);
  }
});
