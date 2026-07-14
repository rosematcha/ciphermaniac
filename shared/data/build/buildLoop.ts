/**
 * Build-loop engine: plan, build dirty nodes, publish, write receipts, replan.
 *
 * Generic orchestration over the {@link BuildNode} graph and an
 * {@link ObjectStore}. Each node supplies a builder that returns its candidate
 * outputs; the loop publishes them immutably, writes the receipt last, and
 * replans until no dirty nodes remain (so nodes discovered mid-build are still
 * caught). Retries and network policy live in the store adapter; this engine is
 * pure control flow, unit-testable with in-memory stores.
 * @module shared/data/build/buildLoop
 */

import { type BuildNode, type BuildPlan, planBuild, type PlannedNode } from './graph';
import { type CandidateOutput, type ObjectStore, publishOutputs, verifyingReceiptStoreFrom, writeReceipt } from './receiptStore';

/** Builds one node's candidate outputs from its resolved dependency keys. */
export type NodeBuilder = (node: PlannedNode) => Promise<CandidateOutput[]> | CandidateOutput[];

export interface BuildLoopOptions {
  /** Node name -> builder. A dirty node without a builder is an error. */
  builders: Record<string, NodeBuilder>;
  /** Receipt key layout (default build/v1/nodes/{node}/{nodeKey}.json). */
  receiptKeyFor?: (node: string, nodeKey: string) => string;
  /** Builder version string per node, stamped on receipts. */
  builderVersionFor?: (node: string) => string;
  /** Logical build time for receipts (pass in; never generated inside). */
  completedAt: string;
  /** Plan only: report dirty nodes, write nothing. */
  planOnly?: boolean;
  /** Safety cap on replan rounds. */
  maxRounds?: number;
}

export interface BuildLoopResult {
  built: string[];
  rounds: number;
  finalPlan: BuildPlan;
}

const defaultReceiptKey = (node: string, nodeKey: string): string => `build/v1/nodes/${node}/${nodeKey}.json`;

/**
 * Run the build loop to convergence.
 * @param nodes - The declarative graph
 * @param store - Object store for outputs + receipts
 * @param hashValue - Content-hash function for node keys
 * @param hashBody - Content-hash function over a serialized body (for verify)
 * @param options - Builders and run options
 * @returns Which nodes were built, how many rounds, and the final (clean) plan
 */
export async function runBuildLoop(
  nodes: BuildNode[],
  store: ObjectStore,
  hashValue: (value: unknown) => string,
  hashBody: (body: string) => string,
  options: BuildLoopOptions
): Promise<BuildLoopResult> {
  const receiptKeyFor = options.receiptKeyFor ?? defaultReceiptKey;
  const builderVersionFor = options.builderVersionFor ?? (() => 'v1');
  // Verify a cached receipt's outputs still exist + hash-match on every replan,
  // so a deleted/corrupt artifact re-dirties its node instead of being skipped.
  const receiptStore = verifyingReceiptStoreFrom(store, receiptKeyFor, hashBody);
  const maxRounds = options.maxRounds ?? 50;
  const built: string[] = [];

  let rounds = 0;
  let plan = await planBuild(nodes, receiptStore, hashValue);
  if (options.planOnly) return { built, rounds, finalPlan: plan };

  while (plan.dirty.length > 0) {
    rounds += 1;
    if (rounds > maxRounds) throw new Error(`build loop did not converge after ${maxRounds} rounds; still dirty: ${plan.dirty.join(', ')}`);

    // Build dirty nodes in dependency (topological) order so a node's inputs
    // are published before it builds.
    const dirtyInOrder = plan.nodes.filter(node => node.dirty);
    for (const planned of dirtyInOrder) {
      const builder = options.builders[planned.name];
      if (!builder) throw new Error(`no builder registered for dirty node "${planned.name}"`);
      const candidates = await builder(planned);
      const { outputs } = await publishOutputs(store, candidates, hashBody);
      await writeReceipt(
        store,
        {
          schemaVersion: 1,
          node: planned.name,
          nodeKey: planned.nodeKey,
          builder: builderVersionFor(planned.name),
          inputs: planned.dependencyKeys,
          outputs,
          completedAt: options.completedAt
        },
        receiptKeyFor(planned.name, planned.nodeKey)
      );
      built.push(planned.name);
    }

    // Replan: everything just built now has a receipt, so it goes clean. This
    // also picks up any node whose inputs were only resolvable after this round.
    plan = await planBuild(nodes, receiptStore, hashValue);
  }

  return { built, rounds, finalPlan: plan };
}
