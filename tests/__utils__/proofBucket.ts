/**
 * The private proofs bucket for the API suites: R2's head, get, put and
 * delete over a map, with what each key holds there to look at.
 */

import type { ProofBucket } from '../../functions/lib/types.ts';

export interface StoredProof {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export function memoryProofs(): ProofBucket & { objects: Map<string, StoredProof> } {
  const objects = new Map<string, StoredProof>();
  const described = (stored: StoredProof) => ({
    size: stored.bytes.byteLength,
    httpMetadata: { contentType: stored.contentType }
  });
  return {
    objects,
    head: async key => {
      const stored = objects.get(key);
      return stored ? described(stored) : null;
    },
    get: async key => {
      const stored = objects.get(key);
      return stored ? { ...described(stored), body: new Blob([stored.bytes]).stream() } : null;
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
