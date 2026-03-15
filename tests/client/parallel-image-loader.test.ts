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

test('ParallelImageLoader: preloadImages dedupes duplicate candidate groups', async () => {
  class TestLoader extends ParallelImageLoader {
    public calls: string[] = [];

    override async loadImageParallel(candidates: string[]): Promise<string | null> {
      this.calls.push(candidates[0] || '');
      return candidates[0] || null;
    }
  }

  const loader = new TestLoader();
  await loader.preloadImages(
    [['https://example.com/a.png'], ['https://example.com/a.png'], ['https://example.com/b.png']],
    2
  );

  assert.deepStrictEqual(loader.calls, ['https://example.com/a.png', 'https://example.com/b.png']);
});

test('ParallelImageLoader: stale preload batches are ignored after a new batch starts', async () => {
  class TestLoader extends ParallelImageLoader {
    public calls: string[] = [];
    private firstResolve: (() => void) | null = null;

    releaseFirstCall(): void {
      if (this.firstResolve) {
        this.firstResolve();
        this.firstResolve = null;
      }
    }

    override async loadImageParallel(candidates: string[]): Promise<string | null> {
      const key = candidates[0] || '';
      this.calls.push(key);
      if (key.includes('first')) {
        await new Promise<void>(resolve => {
          this.firstResolve = resolve;
        });
      }
      return key || null;
    }
  }

  const loader = new TestLoader();
  const staleBatch = loader.startPreloadBatch();
  const stalePromise = loader.preloadImages([['first-a'], ['first-b']], 1, staleBatch);

  await Promise.resolve();
  const activeBatch = loader.startPreloadBatch();
  const activePromise = loader.preloadImages([['second-a']], 1, activeBatch);

  loader.releaseFirstCall();
  await Promise.all([stalePromise, activePromise]);

  assert.deepStrictEqual(
    loader.calls,
    ['first-a', 'second-a'],
    'stale batch should stop before scheduling remaining preload candidates'
  );
});
