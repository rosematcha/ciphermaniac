/**
 * Content-hash build graph: node keys, receipts, and dirty-node planning.
 *
 * The build is a graph of nodes (event indexes, online meta, trends, players,
 * prices, catalogs, …). Each node's KEY is a content hash of its contract
 * version, builder version, normalized configuration, its sorted semantic
 * dependency hashes, and an optional logical window/date — never the repository
 * commit, so an unrelated frontend change does not rebuild data. A node is
 * clean when a verified receipt already exists for its current key; otherwise it
 * is dirty and must rebuild.
 *
 * This module is environment-neutral (pure logic). R2/filesystem receipt stores
 * are thin adapters that satisfy {@link ReceiptStore}.
 * @module shared/data/build/graph
 */

export const BUILD_SCHEMA_VERSION = 1;

/** A single build output object: its key, content hash, and byte length. */
export interface OutputRecord {
  key: string;
  sha256: string;
  bytes: number;
}

/** An immutable receipt written only after every output is validated + read back. */
export interface NodeReceipt {
  schemaVersion: number;
  /** Stable node name, e.g. "event-indexes:event-0054". */
  node: string;
  /** Content hash identifying exactly this build. */
  nodeKey: string;
  /** Builder implementation version (bump to force a rebuild of this node). */
  builder: string;
  /** Semantic input name -> content hash. */
  inputs: Record<string, string>;
  /** Logical output name -> where it landed. */
  outputs: Record<string, OutputRecord>;
  /** ISO completion time (informational; excluded from the node key). */
  completedAt: string;
}

/** The inputs to a node key. Volatile values (timestamps) are excluded. */
export interface NodeKeySpec {
  /** Node contract version. */
  contractVersion: number;
  /** Builder implementation version. */
  builderVersion: string;
  /** Normalized, order-insensitive configuration for this node. */
  config?: unknown;
  /** Semantic dependency name -> content hash (order-insensitive). */
  dependencyHashes: Record<string, string>;
  /** Logical window or date when the node is time-scoped (else omit). */
  logicalWindow?: string | null;
}

/**
 * Compute a node key from its semantic inputs. Dependency hashes are sorted so
 * key order cannot change the result; the config is canonicalized by the hash
 * function. The returned value is `sha256:<hex>`.
 * @param spec - The node's semantic inputs
 * @param hashValue - Canonical content-hash function (e.g. sha256Hex)
 * @returns The node key
 */
export function computeNodeKey(spec: NodeKeySpec, hashValue: (value: unknown) => string): string {
  const sortedDeps = Object.keys(spec.dependencyHashes)
    .sort()
    .map(name => [name, spec.dependencyHashes[name]] as const);
  return `sha256:${hashValue({
    contractVersion: spec.contractVersion,
    builderVersion: spec.builderVersion,
    config: spec.config ?? null,
    dependencies: sortedDeps,
    logicalWindow: spec.logicalWindow ?? null
  })}`;
}

/** A node in the declarative build graph. */
export interface BuildNode {
  /** Stable node name. */
  name: string;
  /** Names of nodes this node depends on (edges). */
  dependsOn: string[];
  /** Everything needed to compute this node's key EXCEPT dependency hashes. */
  keySpec: Omit<NodeKeySpec, 'dependencyHashes'>;
  /**
   * Content hashes of this node's non-node semantic inputs (source captures,
   * catalogs) keyed by name. Node dependencies contribute their nodeKey.
   */
  sourceHashes?: Record<string, string>;
}

/** Read side of a receipt store (R2 or filesystem). */
export interface ReceiptStore {
  /** The receipt for `node` at exactly `nodeKey`, or null if none exists. */
  get(node: string, nodeKey: string): Promise<NodeReceipt | null>;
}

/** Why a node is dirty. */
export type DirtyReason = 'no-receipt' | 'dependency-dirty';

export interface PlannedNode {
  name: string;
  nodeKey: string;
  dirty: boolean;
  reason: DirtyReason | null;
  dependencyKeys: Record<string, string>;
}

/** Result of planning: every node with its resolved key and dirty status. */
export interface BuildPlan {
  nodes: PlannedNode[];
  dirty: string[];
  order: string[];
}

/** Topologically order nodes; throws on a cycle or an unknown dependency. */
export function topoSort(nodes: BuildNode[]): string[] {
  const byName = new Map(nodes.map(node => [node.name, node]));
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const visit = (name: string, stack: string[]): void => {
    const status = state.get(name);
    if (status === 'done') return;
    if (status === 'visiting') throw new Error(`build graph cycle: ${[...stack, name].join(' -> ')}`);
    const node = byName.get(name);
    if (!node) throw new Error(`unknown build node "${name}" referenced by ${stack[stack.length - 1] ?? '(root)'}`);
    state.set(name, 'visiting');
    for (const dep of node.dependsOn) visit(dep, [...stack, name]);
    state.set(name, 'done');
    order.push(name);
  };
  for (const node of nodes) visit(node.name, []);
  return order;
}

/**
 * Plan the build: resolve each node's key from its dependencies (in topological
 * order), then mark a node dirty when it has no verified receipt at that key OR
 * any dependency is dirty. A node key depends on its dependencies' resolved
 * keys, so a changed input propagates to exactly its declared descendants.
 * @param nodes - The declarative graph
 * @param store - Receipt store
 * @param hashValue - Content-hash function
 * @returns The plan (resolved keys, dirty set, topological order)
 */
export async function planBuild(
  nodes: BuildNode[],
  store: ReceiptStore,
  hashValue: (value: unknown) => string
): Promise<BuildPlan> {
  const order = topoSort(nodes);
  const byName = new Map(nodes.map(node => [node.name, node]));
  const keyByName = new Map<string, string>();
  const dirtyByName = new Map<string, boolean>();
  const planned: PlannedNode[] = [];

  for (const name of order) {
    const node = byName.get(name)!;
    const dependencyKeys: Record<string, string> = { ...(node.sourceHashes ?? {}) };
    let anyDepDirty = false;
    for (const dep of node.dependsOn) {
      dependencyKeys[dep] = keyByName.get(dep)!;
      if (dirtyByName.get(dep)) anyDepDirty = true;
    }
    const nodeKey = computeNodeKey({ ...node.keySpec, dependencyHashes: dependencyKeys }, hashValue);
    keyByName.set(name, nodeKey);

    let dirty = false;
    let reason: DirtyReason | null = null;
    if (anyDepDirty) {
      dirty = true;
      reason = 'dependency-dirty';
    } else {
      const receipt = await store.get(name, nodeKey);
      if (!receipt) {
        dirty = true;
        reason = 'no-receipt';
      }
    }
    dirtyByName.set(name, dirty);
    planned.push({ name, nodeKey, dirty, reason, dependencyKeys });
  }

  return { nodes: planned, dirty: planned.filter(node => node.dirty).map(node => node.name), order };
}

/** Collect all errors preventing `value` from being a valid {@link NodeReceipt}. */
export function validateNodeReceipt(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return ['receipt: expected object'];
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.schemaVersion !== BUILD_SCHEMA_VERSION) errors.push(`schemaVersion: expected ${BUILD_SCHEMA_VERSION}`);
  for (const field of ['node', 'nodeKey', 'builder', 'completedAt'] as const) {
    if (typeof receipt[field] !== 'string' || (receipt[field] as string).length === 0) {
      errors.push(`${field}: expected non-empty string`);
    }
  }
  if (typeof receipt.inputs !== 'object' || receipt.inputs === null) errors.push('inputs: expected object');
  if (typeof receipt.outputs !== 'object' || receipt.outputs === null) {
    errors.push('outputs: expected object');
  } else {
    for (const [name, output] of Object.entries(receipt.outputs as Record<string, unknown>)) {
      if (typeof output !== 'object' || output === null) {
        errors.push(`outputs.${name}: expected object`);
        continue;
      }
      const record = output as Record<string, unknown>;
      if (typeof record.key !== 'string' || record.key.length === 0) errors.push(`outputs.${name}.key: expected non-empty string`);
      if (typeof record.sha256 !== 'string' || record.sha256.length === 0) errors.push(`outputs.${name}.sha256: expected non-empty string`);
      if (!Number.isInteger(record.bytes) || (record.bytes as number) < 0) errors.push(`outputs.${name}.bytes: expected a non-negative integer`);
    }
  }
  return errors;
}
