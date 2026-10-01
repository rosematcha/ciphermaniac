/**
 * The private proofs bucket for the API suites: R2's get, put and delete
 * over a map, with what each key holds there to look at.
 */

import type { ProofBucket } from '../../functions/lib/types.ts';

export interface StoredProof {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export function memoryProofs(): ProofBucket & { objects: Map<string, StoredProof> } {
  const objects = new Map<string, StoredProof>();
  return {
    objects,
    get: async key => {
      const stored = objects.get(key);
      return stored
        ? { body: new Blob([stored.bytes]).stream(), httpMetadata: { contentType: stored.contentType } }
        : null;
    },
    put: async (key, value, options) => {
      // A copy, as R2 keeps its own: the caller's buffer may change after.
      objects.set(key, { bytes: new Uint8Array(value), contentType: options.httpMetadata.contentType });
      return {};
    },
    delete: async key => {
      objects.delete(key);
    }
  };
}

/**
 * `bucket`, with every delete held back until `release` is called: R2
 * taking its time over the cleanup after an answer, while the account goes
 * on uploading and applying.
 */
export function stalledDeletes(bucket: ProofBucket): { bucket: ProofBucket; release: () => void } {
  let release = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    bucket: {
      ...bucket,
      delete: async key => {
        await released;
        return bucket.delete(key);
      }
    },
    release
  };
}
