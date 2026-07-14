/**
 * tests/data/build-loop.test.ts
 * Build-loop engine: builds dirty nodes, writes receipts, converges, no-op reruns.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { type BuildNode } from '../../shared/data/build/graph.ts';
import { type ObjectStore } from '../../shared/data/build/receiptStore.ts';
import { type NodeBuilder, runBuildLoop } from '../../shared/data/build/buildLoop.ts';
import { sha256Hex, sha256HexString } from '../../shared/data/hash.ts';

class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, string>();
  async putIfAbsent(key: string, body: string): Promise<void> {
    if (this.objects.has(key)) throw new Error(`conflict: ${key}`);
    this.objects.set(key, body);
  }
  async get(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }
  async put(key: string, body: string): Promise<void> {
    this.objects.set(key, body);
  }
}

const hashBody = (body: string): string => `sha256:${sha256HexString(body)}`;

function graph(synonymsHash: string): BuildNode[] {
  return [
    { name: 'synonyms', dependsOn: [], keySpec: { contractVersion: 1, builderVersion: 'syn-v1' }, sourceHashes: { catalog: synonymsHash } },
    { name: 'event-core', dependsOn: [], keySpec: { contractVersion: 1, builderVersion: 'core-v1' }, sourceHashes: { normalizedEvent: 'sha256:evt' } },
    { name: 'event-indexes', dependsOn: ['event-core', 'synonyms'], keySpec: { contractVersion: 1, builderVersion: 'idx-v1' } }
  ];
}

/** A builder that writes one immutable output keyed by the node's content key. */
function builderFor(name: string): NodeBuilder {
  return planned => {
    const key = `releases/v1/${name}/${planned.nodeKey.slice(7, 15)}/body.json`;
    const body = JSON.stringify({ node: name, key: planned.nodeKey });
    return [{ name: 'body', key, body, sha256: hashBody(body) }];
  };
}

function builders(): Record<string, NodeBuilder> {
  return { synonyms: builderFor('synonyms'), 'event-core': builderFor('event-core'), 'event-indexes': builderFor('event-indexes') };
}

test('first run builds every node and writes receipts', async () => {
  const store = new MemoryObjectStore();
  const result = await runBuildLoop(graph('sha256:s1'), store, sha256Hex, hashBody, { builders: builders(), completedAt: '2026-07-13T00:00:00Z' });
  assert.deepStrictEqual(result.built.sort(), ['event-core', 'event-indexes', 'synonyms']);
  assert.strictEqual(result.finalPlan.dirty.length, 0);
  // Receipts exist for each node.
  assert.ok([...store.objects.keys()].some(k => k.startsWith('build/v1/nodes/synonyms/')));
});

test('a no-input-change rerun builds nothing and uploads no serving objects', async () => {
  const store = new MemoryObjectStore();
  const nodes = graph('sha256:s1');
  await runBuildLoop(nodes, store, sha256Hex, hashBody, { builders: builders(), completedAt: 't' });
  const before = store.objects.size;
  const rerun = await runBuildLoop(nodes, store, sha256Hex, hashBody, { builders: builders(), completedAt: 't' });
  assert.deepStrictEqual(rerun.built, []);
  assert.strictEqual(store.objects.size, before, 'no new objects written');
});

test('a synonym-only change rebuilds only its descendants', async () => {
  const store = new MemoryObjectStore();
  await runBuildLoop(graph('sha256:s1'), store, sha256Hex, hashBody, { builders: builders(), completedAt: 't' });
  const rerun = await runBuildLoop(graph('sha256:s2'), store, sha256Hex, hashBody, { builders: builders(), completedAt: 't' });
  assert.deepStrictEqual(rerun.built.sort(), ['event-indexes', 'synonyms']);
});

test('plan mode reports dirty nodes without writing', async () => {
  const store = new MemoryObjectStore();
  const result = await runBuildLoop(graph('sha256:s1'), store, sha256Hex, hashBody, { builders: builders(), completedAt: 't', planOnly: true });
  assert.deepStrictEqual(result.finalPlan.dirty.sort(), ['event-core', 'event-indexes', 'synonyms']);
  assert.strictEqual(store.objects.size, 0, 'plan mode writes nothing');
  assert.deepStrictEqual(result.built, []);
});

test('a dirty node without a registered builder is an error', async () => {
  const store = new MemoryObjectStore();
  const partial = { synonyms: builderFor('synonyms'), 'event-core': builderFor('event-core') };
  await assert.rejects(
    () => runBuildLoop(graph('sha256:s1'), store, sha256Hex, hashBody, { builders: partial, completedAt: 't' }),
    /no builder registered for dirty node "event-indexes"/
  );
});
