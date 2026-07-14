/**
 * Publication-safety algorithm over an abstract object store.
 *
 * Encodes the plan's release ordering independent of any SDK so it is unit
 * testable: build candidate objects under IMMUTABLE keys, write each with
 * "create only" (`If-None-Match: *`), read back and verify length + hash, and
 * only then write the node receipt. A body-upload failure never produces a
 * receipt; a receipt-write failure leaves only harmless unreferenced objects.
 *
 * The R2/S3 wiring is a thin adapter that satisfies {@link ObjectStore}; tests
 * use an in-memory store.
 * @module shared/data/build/receiptStore
 */

import type { NodeReceipt, OutputRecord, ReceiptStore } from './graph';

/** Minimal object store the publication algorithm needs. */
export interface ObjectStore {
  /** Create an object only if the key does not exist (If-None-Match: *). Rejects on conflict. */
  putIfAbsent(key: string, body: string): Promise<void>;
  /** Read an object body, or null if absent. */
  get(key: string): Promise<string | null>;
  /** Overwrite an object (used for receipts and channel pointers). */
  put(key: string, body: string): Promise<void>;
}

/** A candidate output built in scratch space before publication. */
export interface CandidateOutput {
  /** Logical output name (receipt key). */
  name: string;
  /** Immutable destination key. */
  key: string;
  /** Serialized body. */
  body: string;
  /** Content hash of the body. */
  sha256: string;
}

export interface PublishResult {
  outputs: Record<string, OutputRecord>;
}

const utf8Bytes = (body: string): number => {
  // Byte length of a UTF-8 string without a Buffer dependency (env-neutral).
  let bytes = 0;
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
};

/**
 * Publish a node's candidate outputs immutably, verify them, then write the
 * receipt LAST. Returns the output records for the receipt.
 *
 * @param store - Object store
 * @param candidates - Built candidate outputs
 * @param hashOf - Content-hash function over a string body
 * @throws When any upload conflicts, or a read-back length/hash check fails —
 *   in which case NO receipt is written.
 */
export async function publishOutputs(
  store: ObjectStore,
  candidates: CandidateOutput[],
  hashOf: (body: string) => string
): Promise<PublishResult> {
  const outputs: Record<string, OutputRecord> = {};
  for (const candidate of candidates) {
    // Immutable create: an existing key with identical content is fine (idempotent
    // re-run); a conflict on differing content is a real error the store raises.
    const existing = await store.get(candidate.key);
    if (existing === null) {
      await store.putIfAbsent(candidate.key, candidate.body);
    } else if (existing !== candidate.body) {
      throw new Error(`immutable key ${candidate.key} already exists with different content`);
    }

    // Read back and verify length + hash before trusting the object.
    const readBack = await store.get(candidate.key);
    if (readBack === null) throw new Error(`read-back failed: ${candidate.key} is absent after write`);
    if (utf8Bytes(readBack) !== utf8Bytes(candidate.body)) throw new Error(`read-back length mismatch for ${candidate.key}`);
    if (hashOf(readBack) !== candidate.sha256) throw new Error(`read-back hash mismatch for ${candidate.key}`);

    outputs[candidate.name] = { key: candidate.key, sha256: candidate.sha256, bytes: utf8Bytes(candidate.body) };
  }
  return { outputs };
}

/**
 * Write a node receipt after its outputs are published and verified. This is the
 * last write; its presence means the node is complete.
 * @param store - Object store
 * @param receipt - The receipt to write
 * @param receiptKey - build/v1/nodes/{node}/{nodeKey}.json
 */
export async function writeReceipt(store: ObjectStore, receipt: NodeReceipt, receiptKey: string): Promise<void> {
  await store.put(receiptKey, JSON.stringify(receipt));
}

/** Adapt an {@link ObjectStore} to the graph's {@link ReceiptStore} for planning. */
export function receiptStoreFrom(store: ObjectStore, keyFor: (node: string, nodeKey: string) => string): ReceiptStore {
  return {
    async get(node: string, nodeKey: string): Promise<NodeReceipt | null> {
      const body = await store.get(keyFor(node, nodeKey));
      if (body === null) return null;
      return JSON.parse(body) as NodeReceipt;
    }
  };
}

/**
 * Like {@link receiptStoreFrom}, but a receipt is only honored when every output
 * it references still exists AND its content hash matches the recorded sha256.
 * A missing or corrupt referenced artifact invalidates the receipt (returns
 * null), so the node re-dirties instead of being wrongly skipped — the plan's
 * "missing or corrupt referenced artifacts invalidate a receipt" exit criterion.
 * @param store - Object store
 * @param keyFor - Receipt key layout
 * @param hashOf - Content-hash function over a serialized body (must match how
 *   {@link publishOutputs} computed the recorded `sha256`)
 * @returns A verifying receipt store
 */
export function verifyingReceiptStoreFrom(
  store: ObjectStore,
  keyFor: (node: string, nodeKey: string) => string,
  hashOf: (body: string) => string
): ReceiptStore {
  return {
    async get(node: string, nodeKey: string): Promise<NodeReceipt | null> {
      const body = await store.get(keyFor(node, nodeKey));
      if (body === null) return null;
      const receipt = JSON.parse(body) as NodeReceipt;
      for (const output of Object.values(receipt.outputs)) {
        const objectBody = await store.get(output.key);
        if (objectBody === null || hashOf(objectBody) !== output.sha256) {
          return null; // referenced artifact missing or corrupt → receipt invalid
        }
      }
      return receipt;
    }
  };
}
