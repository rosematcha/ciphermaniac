import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache, withCachedFetch } from '../../src/utils/cache';

describe('TtlCache', () => {
  it('stores and retrieves data', () => {
    const cache = new TtlCache<string>({ ttl: 5000 });
    cache.set('a', 'hello');
    assert.equal(cache.get('a'), 'hello');
    assert.equal(cache.has('a'), true);
    assert.equal(cache.size, 1);
  });

  it('returns undefined for missing keys', () => {
    const cache = new TtlCache({ ttl: 5000 });
    assert.equal(cache.get('missing'), undefined);
    assert.equal(cache.has('missing'), false);
  });

  it('expires entries after TTL', () => {
    const cache = new TtlCache<string>({ ttl: 1 });
    cache.set('a', 'hello', 0); // expired immediately (ttl=0)
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.has('a'), false);
  });

  it('stores and retrieves pending promises', async () => {
    const cache = new TtlCache<string>({ ttl: 5000 });
    const promise = Promise.resolve('value');
    cache.setPending('a', promise);
    assert.equal(cache.getPromise('a'), promise);
    assert.equal(await cache.getPromise('a'), 'value');
  });

  it('deletes entries', () => {
    const cache = new TtlCache<string>({ ttl: 5000 });
    cache.set('a', 'hello');
    assert.equal(cache.delete('a'), true);
    assert.equal(cache.get('a'), undefined);
  });

  it('clears all entries', () => {
    const cache = new TtlCache<string>({ ttl: 5000 });
    cache.set('a', 'hello');
    cache.set('b', 'world');
    cache.clear();
    assert.equal(cache.size, 0);
  });

  it('prunes expired entries when maxEntries threshold exceeded', () => {
    const cache = new TtlCache<string>({ ttl: 5000, maxEntries: 2 });
    cache.set('a', 'hello', 0); // expires immediately
    cache.set('b', 'world', 0); // expires immediately
    // Adding a third triggers prune, which removes the two expired ones
    cache.set('c', 'fresh');
    assert.equal(cache.size, 1);
    assert.equal(cache.get('c'), 'fresh');
  });

  it('evicts oldest non-pending entries when pruning', () => {
    const cache = new TtlCache<string>({ ttl: 60000, maxEntries: 2 });
    cache.set('old', 'first');
    cache.set('newer', 'second');
    cache.set('newest', 'third'); // triggers prune
    assert.equal(cache.size, 2);
    assert.equal(cache.get('old'), undefined);
    assert.equal(cache.get('newest'), 'third');
  });

  it('does not prune pending entries', () => {
    const cache = new TtlCache<string>({ ttl: 60000, maxEntries: 1 });
    cache.setPending('inflight', new Promise(() => {})); // never resolves
    cache.set('data', 'value'); // triggers prune
    assert.equal(cache.getPromise('inflight') !== undefined, true);
  });

  it('allows per-entry TTL override', () => {
    const cache = new TtlCache<string>({ ttl: 0 }); // default TTL = instant expiry
    cache.set('a', 'hello', 60000); // but this entry has 60s TTL
    assert.equal(cache.get('a'), 'hello');
  });
});

describe('withCachedFetch', () => {
  it('caches successful fetches', async () => {
    const cache = new TtlCache<string>({ ttl: 5000 });
    let calls = 0;
    const fetcher = async (key: string) => {
      calls += 1;
      return `result-${key}`;
    };
    const cachedFetch = withCachedFetch(cache, fetcher);

    const r1 = await cachedFetch('x');
    const r2 = await cachedFetch('x');
    assert.equal(r1, 'result-x');
    assert.equal(r2, 'result-x');
    assert.equal(calls, 1); // only one actual fetch
  });

  it('deduplicates concurrent in-flight requests', async () => {
    const cache = new TtlCache<string>({ ttl: 5000 });
    let calls = 0;
    let resolve!: (v: string) => void;
    const fetcher = async () => {
      calls += 1;
      return new Promise<string>(r => {
        resolve = r;
      });
    };
    const cachedFetch = withCachedFetch(cache, fetcher);

    const p1 = cachedFetch('key');
    const p2 = cachedFetch('key');
    resolve('done');
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 'done');
    assert.equal(r2, 'done');
    assert.equal(calls, 1);
  });

  it('removes cache entry on fetch failure', async () => {
    const cache = new TtlCache<string>({ ttl: 5000 });
    const fetcher = async () => {
      throw new Error('network error');
    };
    const cachedFetch = withCachedFetch(cache, fetcher);

    await assert.rejects(cachedFetch('fail'), { message: 'network error' });
    assert.equal(cache.has('fail'), false);
  });
});
