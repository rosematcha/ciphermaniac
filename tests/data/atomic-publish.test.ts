/**
 * tests/data/atomic-publish.test.ts
 * Verification matrix (atomic serving): a failure at ANY point before the final
 * pointer update leaves the channel pointing at the PREVIOUS release. The
 * pointer (the user-facing activation) is only moved after every body is
 * published, verified, and the receipt written.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { type CandidateOutput, type ObjectStore, publishOutputs, writeReceipt } from '../../shared/data/build/receiptStore.ts';
import { type ConditionalPointerStore, type PointerState, updatePointer } from '../../shared/data/build/channel.ts';
import { sha256HexString } from '../../shared/data/hash.ts';

const hashOf = (b: string): string => `sha256:${sha256HexString(b)}`;

class Store implements ObjectStore, ConditionalPointerStore<{ releaseId: string }> {
  readonly objects = new Map<string, string>();
  failPut: string | null = null;
  private pointer: PointerState<{ releaseId: string }> | null = null;
  private seq = 0;

  async putIfAbsent(key: string, body: string): Promise<void> {
    if (this.failPut === key) throw new Error(`injected failure at ${key}`);
    if (this.objects.has(key)) throw new Error(`conflict ${key}`);
    this.objects.set(key, body);
  }
  async get(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }
  async put(key: string, body: string): Promise<void> {
    this.objects.set(key, body);
  }
  async read(): Promise<PointerState<{ releaseId: string }> | null> {
    return this.pointer ? { ...this.pointer } : null;
  }
  async createIfAbsent(_key: string, value: { releaseId: string }): Promise<void> {
    this.pointer = { value, etag: `e${++this.seq}` };
  }
  async writeIfMatch(_key: string, value: { releaseId: string }, _etag: string): Promise<void> {
    this.pointer = { value, etag: `e${++this.seq}` };
  }
}

/** Publish a release's candidates, receipt, then move the channel pointer LAST. */
async function publishRelease(store: Store, releaseId: string, candidates: CandidateOutput[]): Promise<void> {
  const { outputs } = await publishOutputs(store, candidates, hashOf);
  await writeReceipt(store, { schemaVersion: 1, node: `release:${releaseId}`, nodeKey: `sha256:${releaseId}`, builder: 'v1', inputs: {}, outputs, completedAt: 't' }, `build/v1/nodes/release:${releaseId}.json`);
  await updatePointer(store, 'build/v1/channels/production.json', () => ({ releaseId }));
}

function candidatesFor(releaseId: string): CandidateOutput[] {
  return ['master.json', 'decks.json', 'cardUsage.json'].map((p, i) => {
    const key = `releases/v1/online/${releaseId}/${p}`;
    const body = `{"r":"${releaseId}","i":${i}}`;
    return { name: p, key, body, sha256: hashOf(body) };
  });
}

test('a failure at each candidate position leaves the pointer at the previous release', async () => {
  const store = new Store();
  // Release A succeeds and becomes active.
  await publishRelease(store, 'A', candidatesFor('A'));
  assert.strictEqual((await store.read())?.value.releaseId, 'A');

  const bCandidates = candidatesFor('B');
  for (const failAt of bCandidates.map(c => c.key)) {
    const attempt = new Store();
    // Rebuild state with A active in a fresh store for isolation.
    await publishRelease(attempt, 'A', candidatesFor('A'));
    attempt.failPut = failAt;
    await assert.rejects(() => publishRelease(attempt, 'B', bCandidates), /injected failure/);
    // The pointer never moved: A is still the active release.
    assert.strictEqual((await attempt.read())?.value.releaseId, 'A', `pointer moved despite failure at ${failAt}`);
    // No receipt for B was written.
    assert.strictEqual(attempt.objects.has('build/v1/nodes/release:B.json'), false);
  }
});

test('only a fully successful publish advances the pointer', async () => {
  const store = new Store();
  await publishRelease(store, 'A', candidatesFor('A'));
  await publishRelease(store, 'B', candidatesFor('B'));
  assert.strictEqual((await store.read())?.value.releaseId, 'B');
});
