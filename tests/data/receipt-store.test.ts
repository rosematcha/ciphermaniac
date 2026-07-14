/**
 * tests/data/receipt-store.test.ts
 * Publication safety: immutable writes, read-back verify, receipt written last.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { type CandidateOutput, type ObjectStore, publishOutputs, receiptStoreFrom, writeReceipt } from '../../shared/data/build/receiptStore.ts';
import { sha256HexString } from '../../shared/data/hash.ts';

/** In-memory object store with create-only semantics + failure injection. */
class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, string>();
  /** Keys whose read-back should return corrupted content (failure injection). */
  corrupt = new Set<string>();
  /** When set, putIfAbsent throws for this key (simulated upload failure). */
  failPut: string | null = null;

  async putIfAbsent(key: string, body: string): Promise<void> {
    if (this.failPut === key) throw new Error(`injected upload failure for ${key}`);
    if (this.objects.has(key)) throw new Error(`conflict: ${key} exists`);
    this.objects.set(key, body);
  }
  async get(key: string): Promise<string | null> {
    const body = this.objects.get(key) ?? null;
    // Same-length tamper so the length check passes and the hash check fires.
    if (body !== null && this.corrupt.has(key)) return [...body].reverse().join('');
    return body;
  }
  async put(key: string, body: string): Promise<void> {
    this.objects.set(key, body);
  }
}

const hashOf = (body: string): string => `sha256:${sha256HexString(body)}`;

function candidate(name: string, key: string, body: string): CandidateOutput {
  return { name, key, body, sha256: hashOf(body) };
}

test('publishes immutable outputs, verifies, and reports records', async () => {
  const store = new MemoryObjectStore();
  const result = await publishOutputs(store, [candidate('cardUsage', 'releases/v1/events/e/abc/cardUsage.json', '{"usage":{}}')], hashOf);
  assert.strictEqual(result.outputs.cardUsage.key, 'releases/v1/events/e/abc/cardUsage.json');
  assert.strictEqual(result.outputs.cardUsage.bytes, 12);
  assert.ok(result.outputs.cardUsage.sha256.startsWith('sha256:'));
});

test('a body-upload failure prevents a receipt from ever being written', async () => {
  const store = new MemoryObjectStore();
  store.failPut = 'releases/v1/x/master.json';
  await assert.rejects(
    () => publishOutputs(store, [candidate('master', 'releases/v1/x/master.json', '{}')], hashOf),
    /injected upload failure/
  );
  // The caller never reaches writeReceipt, so no receipt object exists.
  assert.strictEqual(store.objects.has('build/v1/nodes/x/key.json'), false);
});

test('a read-back hash mismatch aborts before the receipt', async () => {
  const store = new MemoryObjectStore();
  const key = 'releases/v1/x/decks.json';
  store.corrupt.add(key);
  await assert.rejects(() => publishOutputs(store, [candidate('decks', key, '[]')], hashOf), /read-back hash mismatch/);
});

test('re-publishing identical content is idempotent (no conflict)', async () => {
  const store = new MemoryObjectStore();
  const c = candidate('m', 'releases/v1/x/m.json', '{"a":1}');
  await publishOutputs(store, [c], hashOf);
  await publishOutputs(store, [c], hashOf); // second run: object present + identical
  assert.strictEqual(store.objects.get('releases/v1/x/m.json'), '{"a":1}');
});

test('re-publishing different content at an immutable key is rejected', async () => {
  const store = new MemoryObjectStore();
  await publishOutputs(store, [candidate('m', 'releases/v1/x/m.json', '{"a":1}')], hashOf);
  await assert.rejects(() => publishOutputs(store, [candidate('m', 'releases/v1/x/m.json', '{"a":2}')], hashOf), /different content/);
});

test('the receipt is the last write and is then resolvable for planning', async () => {
  const store = new MemoryObjectStore();
  const { outputs } = await publishOutputs(store, [candidate('m', 'releases/v1/x/m.json', '{}')], hashOf);
  const keyFor = (node: string, nodeKey: string): string => `build/v1/nodes/${node}/${nodeKey}.json`;
  await writeReceipt(store, { schemaVersion: 1, node: 'event:x', nodeKey: 'sha256:k', builder: 'v1', inputs: {}, outputs, completedAt: 't' }, keyFor('event:x', 'sha256:k'));
  const planningStore = receiptStoreFrom(store, keyFor);
  const receipt = await planningStore.get('event:x', 'sha256:k');
  assert.ok(receipt);
  assert.strictEqual(receipt.outputs.m.key, 'releases/v1/x/m.json');
  assert.strictEqual(await planningStore.get('event:x', 'sha256:other'), null);
});
