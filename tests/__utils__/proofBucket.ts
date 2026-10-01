/**
 * The private proofs bucket for the API suites: R2's head, get, put and
 * delete over a map, with what each key holds there to look at.
 */

import type { ProofBucket } from '../../functions/lib/types.ts';

export interface StoredProof {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  etag: string;
}

export function memoryProofs(): ProofBucket & { objects: Map<string, StoredProof> } {
  const objects = new Map<string, StoredProof>();
  let uploads = 0;
  const described = (stored: StoredProof) => ({
    etag: stored.etag,
    size: stored.bytes.byteLength,
    httpMetadata: { contentType: stored.contentType }
  });
  return {
    objects,
    head: async key => {
      const stored = objects.get(key);
      return stored ? described(stored) : null;
    },
    get: async (key, options) => {
      const stored = objects.get(key);
      if (!stored) {
        return null;
      }
      // As R2 does: an object that fails `onlyIf` comes back described, without its body.
      const holds = !options || options.onlyIf.etagMatches === stored.etag;
      return holds ? { ...described(stored), body: new Blob([stored.bytes]).stream() } : described(stored);
    },
    put: async (key, value, options) => {
      // A copy, as R2 keeps its own: the caller's buffer may change after.
      uploads += 1;
      objects.set(key, {
        bytes: new Uint8Array(value),
        contentType: options.httpMetadata.contentType,
        etag: `etag-${uploads}`
      });
      return {};
    },
    delete: async key => {
      objects.delete(key);
    }
  };
}
