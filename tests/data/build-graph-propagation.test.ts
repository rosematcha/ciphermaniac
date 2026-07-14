/**
 * tests/data/build-graph-propagation.test.ts
 * Required verification matrix (DB-MASTER-PLAN Phase 3): the declarative build
 * graph propagates a changed input to exactly its declared descendants.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { type BuildNode, type NodeReceipt, planBuild, type ReceiptStore } from '../../shared/data/build/graph.ts';
import { sha256Hex } from '../../shared/data/hash.ts';

const graphPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'build-graph.json');
const GRAPH = (JSON.parse(readFileSync(graphPath, 'utf8')) as { nodes: BuildNode[] }).nodes;

/** Deep-clone the graph and override a named source hash (a changed input). */
function withSource(overrides: Record<string, string>): BuildNode[] {
  return GRAPH.map(node => ({
    ...node,
    sourceHashes: node.sourceHashes
      ? Object.fromEntries(Object.entries(node.sourceHashes).map(([k, v]) => [k, overrides[k] ?? v]))
      : node.sourceHashes
  }));
}

/** A store that has receipts for every node at its key in the BASE graph. */
class SeededStore implements ReceiptStore {
  private readonly keys = new Set<string>();
  async seed(nodes: BuildNode[]): Promise<void> {
    const plan = await planBuild(nodes, { get: async () => null }, sha256Hex);
    for (const node of plan.nodes) this.keys.add(`${node.name}@${node.nodeKey}`);
  }
  async get(node: string, nodeKey: string): Promise<NodeReceipt | null> {
    return this.keys.has(`${node}@${nodeKey}`)
      ? { schemaVersion: 1, node, nodeKey, builder: 'x', inputs: {}, outputs: {}, completedAt: '1970-01-01T00:00:00Z' }
      : null;
  }
}

async function dirtyAfter(changed: BuildNode[]): Promise<string[]> {
  const store = new SeededStore();
  await store.seed(GRAPH); // receipts exist for the clean base
  const plan = await planBuild(changed, store, sha256Hex);
  return plan.dirty.sort();
}

test('a no-change replan schedules zero builders', async () => {
  assert.deepStrictEqual(await dirtyAfter(GRAPH), []);
});

test('a synonym-only change dirties all and only its declared descendants', async () => {
  const dirty = await dirtyAfter(withSource({ cardObservations: 'SRC:cardObservations-v2' }));
  // Every node whose transitive deps include `synonyms` (and card-types, which
  // shares the cardObservations source) — but NOT event source captures.
  assert.deepStrictEqual(dirty, [
    'card-types',
    'event-core:0054',
    'event-core:0055',
    'event-indexes:0054',
    'event-indexes:0055',
    'majors-trends',
    'online-meta',
    'online-trends',
    'players:0054',
    'players:0055',
    'price-history',
    'prices',
    'snapshots',
    'synonyms',
    'tournament-catalog'
  ]);
  // Sanity: synonyms + prices + majors + event-indexes are all in (canonical-card dependents).
  for (const n of ['synonyms', 'prices', 'majors-trends', 'event-indexes:0054']) assert.ok(dirty.includes(n));
});

test('a corrected event dirties its release, catalog, majors, and attending players — not unrelated events', async () => {
  // Change only event 0054's normalized source capture.
  const changed = GRAPH.map(node =>
    node.name === 'event-core:0054' && node.sourceHashes
      ? { ...node, sourceHashes: { ...node.sourceHashes, normalizedEvent: 'SRC:event-0054-corrected' } }
      : node
  );
  const result = await dirtyAfter(changed);
  // Dirty: event 0054's core + indexes, the catalog (depends on all cores),
  // majors, snapshots, and 0054's attending players.
  assert.ok(result.includes('event-core:0054'));
  assert.ok(result.includes('event-indexes:0054'));
  assert.ok(result.includes('tournament-catalog'));
  assert.ok(result.includes('majors-trends'));
  assert.ok(result.includes('players:0054'));
  // NOT unrelated event 0055's core/indexes, NOT its attending players
  // (Phase 5: correcting one event does not reconstruct unrelated players), and
  // NOT the online chain.
  assert.ok(!result.includes('event-core:0055'), 'unrelated event core must stay clean');
  assert.ok(!result.includes('event-indexes:0055'), 'unrelated event indexes must stay clean');
  assert.ok(!result.includes('players:0055'), 'unrelated attendees must not rebuild (Phase 5 content-hash fingerprints)');
  assert.ok(!result.includes('online-meta'), 'online meta must stay clean');
  assert.ok(!result.includes('prices'), 'prices must stay clean');
});
