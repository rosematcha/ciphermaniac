/**
 * tests/data/channel-pointer.test.ts
 * Conditional channel-pointer updates with replan-on-conflict.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { type ConditionalPointerStore, PointerConflictError, type PointerState, updatePointer } from '../../shared/data/build/channel.ts';

/** In-memory ETag store; a "poisoner" can inject one race before the retry. */
class MemoryPointerStore<T> implements ConditionalPointerStore<T> {
  private state: PointerState<T> | null = null;
  private seq = 0;
  /** When set, the next write loses its race exactly once (simulated concurrency). */
  poisonOnce = false;

  async read(_key: string): Promise<PointerState<T> | null> {
    return this.state ? { ...this.state } : null;
  }
  async createIfAbsent(_key: string, value: T): Promise<void> {
    if (this.state !== null) throw new PointerConflictError('x');
    this.state = { value, etag: `e${++this.seq}` };
  }
  async writeIfMatch(_key: string, value: T, etag: string): Promise<void> {
    if (this.poisonOnce) {
      this.poisonOnce = false;
      this.state = { value: this.state!.value, etag: `e${++this.seq}` }; // someone else moved it
      throw new PointerConflictError('x');
    }
    if (!this.state || this.state.etag !== etag) throw new PointerConflictError('x');
    this.state = { value, etag: `e${++this.seq}` };
  }
}

test('creates the pointer when absent', async () => {
  const store = new MemoryPointerStore<{ releaseId: string }>();
  const written = await updatePointer(store, 'production.json', () => ({ releaseId: 'r1' }));
  assert.deepStrictEqual(written, { releaseId: 'r1' });
});

test('updates the pointer when the ETag matches', async () => {
  const store = new MemoryPointerStore<{ n: number }>();
  await updatePointer(store, 'p', () => ({ n: 1 }));
  const written = await updatePointer(store, 'p', current => ({ n: (current?.n ?? 0) + 1 }));
  assert.deepStrictEqual(written, { n: 2 });
});

test('a conflict re-reads and retries with the fresh value (no clobber)', async () => {
  const store = new MemoryPointerStore<{ n: number }>();
  await updatePointer(store, 'p', () => ({ n: 10 }));
  store.poisonOnce = true; // first write loses the race
  let sawCurrent: number | null = null;
  const written = await updatePointer(store, 'p', current => {
    sawCurrent = current?.n ?? null;
    return { n: (current?.n ?? 0) + 1 };
  });
  // It retried after the poisoned attempt and produced a value from the re-read.
  assert.deepStrictEqual(written, { n: 11 });
  assert.strictEqual(sawCurrent, 10);
});

test('next() returning null leaves the pointer unchanged', async () => {
  const store = new MemoryPointerStore<{ n: number }>();
  await updatePointer(store, 'p', () => ({ n: 5 }));
  const result = await updatePointer(store, 'p', () => null);
  assert.deepStrictEqual(result, { n: 5 });
});

test('a persistent conflict eventually throws', async () => {
  const store: ConditionalPointerStore<number> = {
    read: async () => ({ value: 1, etag: 'stale' }),
    createIfAbsent: async () => {},
    writeIfMatch: async () => {
      throw new PointerConflictError('p');
    }
  };
  await assert.rejects(() => updatePointer(store, 'p', () => 2, { maxAttempts: 3 }), /pointer conflict/);
});
