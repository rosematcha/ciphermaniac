/**
 * Deterministic JSON serialization for hashing and snapshots.
 *
 * Object keys are emitted in sorted order; array order is preserved (arrays are
 * meaningful sequences, objects are unordered maps). `undefined` object
 * properties are dropped and `undefined`/non-finite numbers inside arrays
 * collapse to `null`, mirroring `JSON.stringify` so a canonical string is always
 * parseable JSON.
 *
 * IMPORTANT: this module is environment-neutral — it must work in the browser,
 * Node.js, and Cloudflare Workers. Do not import `node:crypto` or any other
 * environment-specific dependency here (hashing lives in `shared/data/hash.ts`).
 * @module shared/data/canonicalJson
 */

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (type === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => serialize(entry)).join(',')}]`;
  }
  if (type === 'object') {
    // Honor toJSON (Date and friends) like JSON.stringify does — otherwise a
    // Date would serialize as '{}' and hash-collide with every other Date.
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === 'function') {
      return serialize(withToJson.toJSON());
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort();
    const body = keys.map(key => `${JSON.stringify(key)}:${serialize(record[key])}`).join(',');
    return `{${body}}`;
  }
  // Functions, symbols, bigint: not representable — treat as absent.
  return 'null';
}

/**
 * Serialize a value to canonical JSON: sorted object keys, preserved array
 * order. Two structurally equal values always produce byte-identical output
 * regardless of the order their keys were inserted.
 * @param value - The value to serialize
 * @returns Canonical JSON string
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value);
}

/**
 * Volatile timestamp fields excluded from SEMANTIC hashing (DB-MASTER-PLAN
 * Phase 3: "exclude volatile timestamps from semantic hashes"). A re-fetch or
 * rebuild that only bumps these must not change a node key, or every run would
 * rebuild everything and defeat incremental builds.
 */
export const VOLATILE_KEYS: readonly string[] = ['fetchedAt', 'updatedAt', 'generatedAt', 'publishedAt', 'completedAt'];

/**
 * Deep-copy `value`, dropping any object property whose key is in `keys`
 * (default {@link VOLATILE_KEYS}). Array order is preserved.
 * @param value - The value to strip
 * @param keys - Keys to remove (default volatile timestamps)
 * @returns A structural copy without the stripped keys
 */
export function stripVolatile(value: unknown, keys: readonly string[] = VOLATILE_KEYS): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => stripVolatile(entry, keys));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys.includes(k)) {
        continue;
      }
      out[k] = stripVolatile(v, keys);
    }
    return out;
  }
  return value;
}
