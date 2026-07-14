/// <reference types="node" />
/**
 * SHA-256 hashing over canonical JSON, for content-addressed stable IDs.
 *
 * This module imports `node:crypto` and therefore must NOT be imported by
 * browser code — only tests and producers use it. Keeping it separate lets
 * `contracts.ts` and `canonicalJson.ts` stay environment-neutral: the ID
 * constructors that need hashing take a hash function as a parameter, and the
 * caller supplies {@link sha256Hex} from here. The triple-slash reference above
 * pulls in `@types/node` regardless of each tsconfig's `types` allowlist.
 * @module shared/data/hash
 */

import { createHash } from 'node:crypto';

import { canonicalStringify, stripVolatile } from './canonicalJson';

/**
 * Hex SHA-256 of a UTF-8 string.
 * @param input - The string to hash
 * @returns 64-character lowercase hex digest
 */
export function sha256HexString(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Hex SHA-256 of a value's canonical serialization. Structurally equal values
 * hash identically regardless of key insertion order.
 * @param value - The value to hash
 * @returns 64-character lowercase hex digest
 */
export function sha256Hex(value: unknown): string {
  return sha256HexString(canonicalStringify(value));
}

/**
 * SEMANTIC content hash: like {@link sha256Hex} but with volatile timestamp
 * fields (fetchedAt/updatedAt/generatedAt/…) stripped first, so a re-fetch or
 * rebuild that only bumps a timestamp produces the SAME hash. Use this for
 * build-graph node input hashes so unchanged semantic inputs do no work.
 * @param value - The value to hash
 * @returns 64-character lowercase hex digest of the volatile-stripped value
 */
export function semanticHash(value: unknown): string {
  return sha256HexString(canonicalStringify(stripVolatile(value)));
}
