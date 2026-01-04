import test from 'node:test';
import assert from 'node:assert/strict';

import { ParallelImageLoader } from '../../src/utils/parallelImageLoader.ts';

test('ParallelImageLoader: constructor initializes with correct defaults', () => {
  const loader = new ParallelImageLoader();
  const stats = loader.getStats();

  assert.strictEqual(stats.loading, 0, 'should have no loading images initially');
  assert.strictEqual(stats.loaded, 0, 'should have no loaded images initially');
});

test('ParallelImageLoader: clearCache resets all state', () => {
  const loader = new ParallelImageLoader();
  loader.clearCache();
  const stats = loader.getStats();

  assert.strictEqual(stats.loading, 0);
  assert.strictEqual(stats.loaded, 0);
});

test('ParallelImageLoader: loadImageParallel returns null for empty candidates', async () => {
  const loader = new ParallelImageLoader();

  const result1 = await loader.loadImageParallel([]);
  assert.strictEqual(result1, null, 'empty array should return null');

  const result2 = await loader.loadImageParallel(null as unknown as string[]);
  assert.strictEqual(result2, null, 'null should return null');
});

test('ParallelImageLoader: getStats returns current state', () => {
  const loader = new ParallelImageLoader();
  const stats = loader.getStats();

  assert.ok(typeof stats.loading === 'number');
  assert.ok(typeof stats.loaded === 'number');
  assert.ok(stats.loading >= 0);
  assert.ok(stats.loaded >= 0);
});
