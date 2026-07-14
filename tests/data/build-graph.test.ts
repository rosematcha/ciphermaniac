/**
 * tests/data/build-graph.test.ts
 * Content-hash build graph: node keys, dirty-node planning, receipt validation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type BuildNode,
  computeNodeKey,
  type NodeReceipt,
  planBuild,
  type ReceiptStore,
  topoSort,
  validateNodeReceipt
} from '../../shared/data/build/graph.ts';
import { sha256Hex } from '../../shared/data/hash.ts';

/** In-memory receipt store recording every node that has a receipt at a key. */
class MemoryStore implements ReceiptStore {
  private readonly receipts = new Map<string, NodeReceipt>();
  key(node: string, nodeKey: string): string {
    return `${node}@${nodeKey}`;
  }
  async get(node: string, nodeKey: string): Promise<NodeReceipt | null> {
    return this.receipts.get(this.key(node, nodeKey)) ?? null;
  }
  put(receipt: NodeReceipt): void {
    this.receipts.set(this.key(receipt.node, receipt.nodeKey), receipt);
  }
}

/** A small graph mirroring the plan: synonyms -> event indexes; source -> event. */
function graph(synonymsHash: string): BuildNode[] {
  return [
    { name: 'synonyms', dependsOn: [], keySpec: { contractVersion: 1, builderVersion: 'syn-v1' }, sourceHashes: { catalog: synonymsHash } },
    { name: 'event-core', dependsOn: [], keySpec: { contractVersion: 1, builderVersion: 'core-v1' }, sourceHashes: { normalizedEvent: 'sha256:evt' } },
    { name: 'event-indexes', dependsOn: ['event-core', 'synonyms'], keySpec: { contractVersion: 1, builderVersion: 'idx-v1' } },
    { name: 'majors-trends', dependsOn: ['event-core', 'synonyms'], keySpec: { contractVersion: 1, builderVersion: 'majors-v1' } },
    { name: 'players', dependsOn: ['event-core'], keySpec: { contractVersion: 1, builderVersion: 'players-v1' } }
  ];
}

/** Record receipts for every node in a plan, so a re-plan sees them clean. */
async function seedReceipts(store: MemoryStore, nodes: BuildNode[]): Promise<void> {
  const plan = await planBuild(nodes, store, sha256Hex);
  for (const node of plan.nodes) {
    store.put({ schemaVersion: 1, node: node.name, nodeKey: node.nodeKey, builder: 'x', inputs: {}, outputs: {}, completedAt: '2026-07-13T00:00:00Z' });
  }
}

test('computeNodeKey is order-insensitive over dependency hashes', () => {
  const a = computeNodeKey({ contractVersion: 1, builderVersion: 'v1', dependencyHashes: { b: 'h2', a: 'h1' } }, sha256Hex);
  const b = computeNodeKey({ contractVersion: 1, builderVersion: 'v1', dependencyHashes: { a: 'h1', b: 'h2' } }, sha256Hex);
  assert.strictEqual(a, b);
});

test('a builder-version change changes only that node key', () => {
  const base = computeNodeKey({ contractVersion: 1, builderVersion: 'v1', dependencyHashes: { d: 'h' } }, sha256Hex);
  const bumped = computeNodeKey({ contractVersion: 1, builderVersion: 'v2', dependencyHashes: { d: 'h' } }, sha256Hex);
  assert.notStrictEqual(base, bumped);
});

test('topoSort throws on cycles and unknown dependencies', () => {
  assert.throws(() => topoSort([
    { name: 'a', dependsOn: ['b'], keySpec: { contractVersion: 1, builderVersion: 'v' } },
    { name: 'b', dependsOn: ['a'], keySpec: { contractVersion: 1, builderVersion: 'v' } }
  ]), /cycle/);
  assert.throws(() => topoSort([
    { name: 'a', dependsOn: ['ghost'], keySpec: { contractVersion: 1, builderVersion: 'v' } }
  ]), /unknown build node/);
});

test('first plan marks every node dirty (leaves no-receipt, dependents dependency-dirty)', async () => {
  const store = new MemoryStore();
  const plan = await planBuild(graph('sha256:syn1'), store, sha256Hex);
  assert.deepStrictEqual(plan.dirty.sort(), ['event-core', 'event-indexes', 'majors-trends', 'players', 'synonyms']);
  const byName = new Map(plan.nodes.map(node => [node.name, node]));
  assert.strictEqual(byName.get('synonyms')?.reason, 'no-receipt');
  assert.strictEqual(byName.get('event-core')?.reason, 'no-receipt');
  assert.strictEqual(byName.get('event-indexes')?.reason, 'dependency-dirty');
  assert.ok(plan.nodes.every(node => node.dirty));
});

test('a no-change re-plan reports zero dirty nodes', async () => {
  const store = new MemoryStore();
  const nodes = graph('sha256:syn1');
  await seedReceipts(store, nodes);
  const plan = await planBuild(nodes, store, sha256Hex);
  assert.deepStrictEqual(plan.dirty, []);
});

test('a synonym-only change dirties exactly its declared descendants', async () => {
  const store = new MemoryStore();
  await seedReceipts(store, graph('sha256:syn1'));
  // Same graph, new synonyms catalog hash.
  const plan = await planBuild(graph('sha256:syn2'), store, sha256Hex);
  // synonyms changed -> synonyms, event-indexes, majors-trends dirty.
  // event-core and players do NOT depend on synonyms -> stay clean.
  assert.deepStrictEqual(plan.dirty.sort(), ['event-indexes', 'majors-trends', 'synonyms']);
  const players = plan.nodes.find(node => node.name === 'players');
  assert.strictEqual(players?.dirty, false);
});

test('a missing receipt (corrupt/absent output) invalidates a node', async () => {
  const store = new MemoryStore();
  const nodes = graph('sha256:syn1');
  await seedReceipts(store, nodes);
  // Drop the event-core receipt: it and its dependents become dirty.
  const plan1 = await planBuild(nodes, store, sha256Hex);
  const coreKey = plan1.nodes.find(node => node.name === 'event-core')!.nodeKey;
  // A store that pretends event-core's receipt vanished.
  const holed: ReceiptStore = { get: async (node, key) => (node === 'event-core' && key === coreKey ? null : store.get(node, key)) };
  const plan2 = await planBuild(nodes, holed, sha256Hex);
  assert.ok(plan2.dirty.includes('event-core'));
  assert.ok(plan2.dirty.includes('event-indexes'), 'dependents of the holed node rebuild too');
});

test('validateNodeReceipt collects structural errors', () => {
  assert.deepStrictEqual(validateNodeReceipt({ schemaVersion: 1, node: 'n', nodeKey: 'k', builder: 'b', inputs: {}, outputs: { a: { key: 'x', sha256: 'y', bytes: 3 } }, completedAt: 't' }), []);
  const errors = validateNodeReceipt({ schemaVersion: 2, node: '', builder: 'b', inputs: {}, outputs: { a: { key: 'x', sha256: 'y', bytes: -1 } }, completedAt: 't' });
  assert.ok(errors.some(e => e.includes('schemaVersion')));
  assert.ok(errors.some(e => e.includes('node:')));
  assert.ok(errors.some(e => e.includes('nodeKey')));
  assert.ok(errors.some(e => e.includes('bytes')));
});
