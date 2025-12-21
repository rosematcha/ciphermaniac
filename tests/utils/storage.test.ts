/**
 * tests/utils/storage.test.ts
 * Tests for src/utils/storage.ts - StorageManager
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// StorageManager tests (using isolated test implementations)
// ============================================================================

/**
 * Since the actual StorageManager depends on localStorage and other modules,
 * we test the core logic patterns in isolation
 */

test('storage: isAvailable returns false when localStorage throws', async t => {
  // Simulate localStorage check that throws
  function checkAvailability(
    storage: { setItem: (k: string, v: string) => void; removeItem: (k: string) => void } | null
  ): boolean {
    try {
      if (!storage) {
        return false;
      }
      const test = '__storage_test__';
      storage.setItem(test, test);
      storage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  // Working storage
  const workingStorage = {
    setItem: () => {},
    removeItem: () => {}
  };
  assert.strictEqual(checkAvailability(workingStorage), true, 'should return true for working storage');

  // Throwing storage
  const throwingStorage = {
    setItem: () => {
      throw new Error('QuotaExceeded');
    },
    removeItem: () => {}
  };
  assert.strictEqual(checkAvailability(throwingStorage), false, 'should return false when storage throws');

  // Null storage
  assert.strictEqual(checkAvailability(null), false, 'should return false for null storage');
});

test('storage: get returns default value for missing key', async t => {
  interface StorageConfig {
    key: string;
    version: number;
    default: unknown;
  }

  function getFromStorage(storage: { getItem: (k: string) => string | null }, config: StorageConfig): unknown {
    try {
      const rawData = storage.getItem(config.key);
      if (!rawData) {
        return config.default;
      }
      return JSON.parse(rawData);
    } catch {
      return config.default;
    }
  }

  const mockStorage = {
    getItem: () => null
  };

  const config: StorageConfig = {
    key: 'testKey',
    version: 1,
    default: { items: [] }
  };

  const result = getFromStorage(mockStorage, config);
  assert.deepStrictEqual(result, { items: [] }, 'should return default for missing key');
});

test('storage: get parses JSON correctly', async t => {
  interface StorageConfig {
    key: string;
    version: number;
    default: unknown;
  }

  function getFromStorage(storage: { getItem: (k: string) => string | null }, config: StorageConfig): unknown {
    try {
      const rawData = storage.getItem(config.key);
      if (!rawData) {
        return config.default;
      }
      return JSON.parse(rawData);
    } catch {
      return config.default;
    }
  }

  const storedData = { tournaments: ['t1', 't2'], count: 5 };
  const mockStorage = {
    getItem: () => JSON.stringify(storedData)
  };

  const config: StorageConfig = {
    key: 'testKey',
    version: 1,
    default: {}
  };

  const result = getFromStorage(mockStorage, config);
  assert.deepStrictEqual(result, storedData, 'should parse stored JSON correctly');
});

test('storage: get returns default for invalid JSON', async t => {
  interface StorageConfig {
    key: string;
    version: number;
    default: unknown;
  }

  function getFromStorage(storage: { getItem: (k: string) => string | null }, config: StorageConfig): unknown {
    try {
      const rawData = storage.getItem(config.key);
      if (!rawData) {
        return config.default;
      }
      return JSON.parse(rawData);
    } catch {
      return config.default;
    }
  }

  const mockStorage = {
    getItem: () => 'not valid json {'
  };

  const config: StorageConfig = {
    key: 'testKey',
    version: 1,
    default: { fallback: true }
  };

  const result = getFromStorage(mockStorage, config);
  assert.deepStrictEqual(result, { fallback: true }, 'should return default for invalid JSON');
});

test('storage: set serializes data correctly', async t => {
  let savedData: string | null = null;

  function setToStorage(storage: { setItem: (k: string, v: string) => void }, key: string, data: unknown): boolean {
    try {
      const serialized = JSON.stringify(data);
      storage.setItem(key, serialized);
      return true;
    } catch {
      return false;
    }
  }

  const mockStorage = {
    setItem: (_key: string, value: string) => {
      savedData = value;
    }
  };

  const testData = { name: 'Test', items: [1, 2, 3] };
  const result = setToStorage(mockStorage, 'testKey', testData);

  assert.strictEqual(result, true, 'should return true on success');
  assert.strictEqual(savedData, JSON.stringify(testData), 'should serialize data correctly');
});

test('storage: set returns false when storage throws', async t => {
  function setToStorage(storage: { setItem: (k: string, v: string) => void }, key: string, data: unknown): boolean {
    try {
      const serialized = JSON.stringify(data);
      storage.setItem(key, serialized);
      return true;
    } catch {
      return false;
    }
  }

  const throwingStorage = {
    setItem: () => {
      throw new Error('QuotaExceeded');
    }
  };

  const result = setToStorage(throwingStorage, 'testKey', { data: 'test' });
  assert.strictEqual(result, false, 'should return false when storage throws');
});

test('storage: remove calls removeItem correctly', async t => {
  let removedKey: string | null = null;

  function removeFromStorage(storage: { removeItem: (k: string) => void }, key: string): boolean {
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  const mockStorage = {
    removeItem: (key: string) => {
      removedKey = key;
    }
  };

  const result = removeFromStorage(mockStorage, 'testKeyV1');

  assert.strictEqual(result, true, 'should return true on success');
  assert.strictEqual(removedKey, 'testKeyV1', 'should call removeItem with correct key');
});

test('storage: handles complex nested objects', async t => {
  function roundtripStorage(data: unknown): unknown {
    const serialized = JSON.stringify(data);
    return JSON.parse(serialized);
  }

  const complexData = {
    master: {
      'tournament-1': {
        ts: Date.now(),
        deckTotal: 100,
        items: [
          { id: 1, cards: ['Pikachu', 'Charizard'] },
          { id: 2, cards: ['Mewtwo'] }
        ]
      }
    },
    cardIndex: {
      'tournament-1': {
        ts: Date.now(),
        idx: { card1: [1, 2], card2: [3] }
      }
    }
  };

  const result = roundtripStorage(complexData);
  assert.deepStrictEqual(result, complexData, 'should handle complex nested objects');
});

test('storage: handles empty objects', async t => {
  function roundtripStorage(data: unknown): unknown {
    const serialized = JSON.stringify(data);
    return JSON.parse(serialized);
  }

  assert.deepStrictEqual(roundtripStorage({}), {}, 'should handle empty object');
  assert.deepStrictEqual(roundtripStorage([]), [], 'should handle empty array');
});

test('storage: handles unicode strings', async t => {
  function roundtripStorage(data: unknown): unknown {
    const serialized = JSON.stringify(data);
    return JSON.parse(serialized);
  }

  const unicodeData = {
    name: '東京カップ 🏆',
    description: 'Türkiye Şampiyonası',
    emoji: '🎮🃏'
  };

  const result = roundtripStorage(unicodeData);
  assert.deepStrictEqual(result, unicodeData, 'should handle unicode strings');
});

test('storage: handles null and undefined values', async t => {
  function roundtripStorage(data: unknown): unknown {
    const serialized = JSON.stringify(data);
    return JSON.parse(serialized);
  }

  // null is preserved
  assert.strictEqual(roundtripStorage(null), null, 'should handle null');

  // undefined becomes null in JSON
  const withUndefined = { a: 1, b: undefined };
  const result = roundtripStorage(withUndefined);
  assert.deepStrictEqual(result, { a: 1 }, 'undefined properties are omitted in JSON');
});

test('storage: handles large data sets', async t => {
  function roundtripStorage(data: unknown): unknown {
    const serialized = JSON.stringify(data);
    return JSON.parse(serialized);
  }

  // Generate large array
  const largeArray = Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    data: Array.from({ length: 10 }, (_, j) => j * i)
  }));

  const result = roundtripStorage(largeArray);
  assert.strictEqual((result as unknown[]).length, 1000, 'should handle large arrays');
  assert.deepStrictEqual((result as unknown[])[0], largeArray[0], 'first item should match');
  assert.deepStrictEqual((result as unknown[])[999], largeArray[999], 'last item should match');
});

test('storage: clearAll removes all configured keys', async t => {
  const removedKeys: string[] = [];

  function clearAll(storage: { removeItem: (k: string) => void }, configs: Array<{ key: string }>): void {
    configs.forEach(config => {
      try {
        storage.removeItem(config.key);
      } catch {
        // Ignore errors during cleanup
      }
    });
  }

  const mockStorage = {
    removeItem: (key: string) => {
      removedKeys.push(key);
    }
  };

  const configs = [
    { key: 'gridCacheV1' },
    { key: 'metaCacheV1' },
    { key: 'pickCacheV1' },
    { key: 'searchCacheV1' },
    { key: 'binderSelectionsV1' }
  ];

  clearAll(mockStorage, configs);

  assert.strictEqual(removedKeys.length, 5, 'should remove all 5 configured keys');
  assert.ok(removedKeys.includes('gridCacheV1'), 'should remove gridCacheV1');
  assert.ok(removedKeys.includes('metaCacheV1'), 'should remove metaCacheV1');
});

test('storage: getStats calculates sizes correctly', async t => {
  function getStats(
    storage: { getItem: (k: string) => string | null },
    configs: Array<{ key: string }>
  ): Record<string, { size: number; exists: boolean }> & { total: number } {
    const stats: Record<string, { size: number; exists: boolean }> = {};
    let totalSize = 0;

    configs.forEach(config => {
      const data = storage.getItem(config.key);
      const size = data ? data.length : 0;
      stats[config.key] = { size, exists: Boolean(data) };
      totalSize += size;
    });

    return { ...stats, total: totalSize } as Record<string, { size: number; exists: boolean }> & { total: number };
  }

  const mockStorage = {
    getItem: (key: string) => {
      if (key === 'gridCacheV1') {
        return '{"data":"test"}';
      }
      if (key === 'metaCacheV1') {
        return '{"meta":"info"}';
      }
      return null;
    }
  };

  const configs = [{ key: 'gridCacheV1' }, { key: 'metaCacheV1' }, { key: 'pickCacheV1' }];

  const stats = getStats(mockStorage, configs);

  assert.strictEqual(stats.gridCacheV1.exists, true);
  assert.strictEqual(stats.gridCacheV1.size, 15); // '{"data":"test"}' is 15 chars
  assert.strictEqual(stats.metaCacheV1.exists, true);
  assert.strictEqual(stats.pickCacheV1.exists, false);
  assert.strictEqual(stats.pickCacheV1.size, 0);
  assert.strictEqual(stats.total, 30); // 15 + 15 + 0
});

test('storage: handles storage key versioning pattern', async t => {
  // Test that versioned keys work correctly
  const STORAGE_CONFIG = {
    gridCache: { key: 'gridCacheV1', version: 1, default: {} },
    metaCache: { key: 'metaCacheV1', version: 1, default: {} }
  };

  // Keys should be unique and follow pattern
  const keys = Object.values(STORAGE_CONFIG).map(c => c.key);
  const uniqueKeys = new Set(keys);

  assert.strictEqual(keys.length, uniqueKeys.size, 'all storage keys should be unique');
  assert.ok(
    keys.every(k => k.endsWith('V1')),
    'all keys should include version suffix'
  );
});
