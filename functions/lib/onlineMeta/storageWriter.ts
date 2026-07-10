import { runWithConcurrency } from './tournamentFetcher';

const DEFAULT_R2_CONCURRENCY = 6;

/**
 * Default browser/edge cache for live report JSON (P3.1, owner-approved):
 * data regenerates roughly daily, so a 6-hour client cache means repeat
 * visitors load instantly while staying same-day fresh.
 *
 * NOTE: dated snapshot bodies under `reports/Snapshots/YYYY-MM-DD/` are NOT
 * immutable — the rotation-snapshot build reruns the same date after data
 * corrections. Marking them `immutable, max-age=1y` (as this code previously
 * did) meant a corrected snapshot body could be served stale by browsers/CDN
 * for up to a year (P-15). All keys now use the same 6-hour live policy.
 */
const LIVE_JSON_CACHE_CONTROL = 'public, max-age=21600';

interface R2PutOptions {
  httpMetadata?: { contentType?: string; cacheControl?: string };
}

interface R2Object {
  text(): Promise<string>;
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, data: string | ArrayBuffer | ArrayBufferView, opts?: R2PutOptions): Promise<unknown>;
  delete?(key: string): Promise<unknown>;
}

interface EnvWithReports {
  REPORTS?: R2Bucket;
}

/**
 * Fetch a JSON object from R2. Returns `null` if the key doesn't exist or the
 * stored payload isn't valid JSON. Used to read forward-rolling history files
 * (e.g. `online-history.json`) so we can append today's snapshot rather than
 * overwriting the whole series.
 */
export async function getJson<T = unknown>(env: unknown, key: string): Promise<T | null> {
  const bucket = (env as EnvWithReports)?.REPORTS;
  if (!bucket?.get) {
    throw new Error('REPORTS bucket not configured');
  }
  const obj = await bucket.get(key);
  if (!obj) {
    return null;
  }
  try {
    const text = await obj.text();
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn(`[storageWriter] Failed to parse JSON at ${key}, returning null`, err);
    return null;
  }
}

/**
 * Discriminated JSON load result. Unlike {@link getJson}, this distinguishes:
 *   - `missing`: the key does not exist (a valid, expected state)
 *   - `error`:   a transport/permission failure OR corrupt (unparseable) body
 *   - `ok`:      a successfully parsed payload
 *
 * Callers that publish destructive indexes (snapshot index, player aggregates)
 * must NOT conflate `error` with `missing` — a corrupt live master read as
 * "empty" silently produces a wrong index (Theme E, P-05, P-16).
 */
export type JsonLoadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'error'; error: unknown };

export async function getJsonResult<T = unknown>(env: unknown, key: string): Promise<JsonLoadResult<T>> {
  const bucket = (env as EnvWithReports)?.REPORTS;
  if (!bucket?.get) {
    throw new Error('REPORTS bucket not configured');
  }
  let obj: R2Object | null;
  try {
    obj = await bucket.get(key);
  } catch (error) {
    // Transport/permission failure is NOT the same as a missing object.
    return { status: 'error', error };
  }
  if (!obj) {
    return { status: 'missing' };
  }
  let text: string;
  try {
    text = await obj.text();
  } catch (error) {
    return { status: 'error', error };
  }
  try {
    return { status: 'ok', value: JSON.parse(text) as T };
  } catch (error) {
    return { status: 'error', error };
  }
}

/**
 * Delete an object. No-op-safe against already-absent keys (R2 delete is
 * idempotent). Throws if the binding does not expose `delete`.
 */
async function deleteObject(env: unknown, key: string): Promise<void> {
  const bucket = (env as EnvWithReports)?.REPORTS;
  if (!bucket?.delete) {
    throw new Error('REPORTS bucket delete not configured');
  }
  await bucket.delete(key);
}

export async function batchDelete(
  env: unknown,
  keys: string[],
  concurrency: number = DEFAULT_R2_CONCURRENCY
): Promise<void> {
  const normalized = (Array.isArray(keys) ? keys : []).filter(Boolean);
  if (!normalized.length) {
    return;
  }
  const limit = Math.max(1, Number(concurrency) || DEFAULT_R2_CONCURRENCY);
  await runWithConcurrency(normalized, limit, async key => deleteObject(env, key));
}

export interface PutJsonOptions {
  /** Pretty-print with 2-space indent. Defaults to false (compact). */
  pretty?: boolean;
  /** Override the default cache-control. */
  cacheControl?: string;
}

export async function putJson(env: unknown, key: string, data: unknown, options: PutJsonOptions = {}): Promise<void> {
  const bucket = (env as EnvWithReports)?.REPORTS;
  if (!bucket?.put) {
    throw new Error('REPORTS bucket not configured');
  }
  const payload = options.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  // Every key uses the 6-hour live policy. Dated snapshot bodies are rerunnable
  // (corrections re-publish under the same date), so they must not be immutable
  // (P-15).
  await bucket.put(key, payload, {
    httpMetadata: {
      contentType: 'application/json',
      cacheControl: options.cacheControl ?? LIVE_JSON_CACHE_CONTROL
    }
  });
}

export interface BatchPutEntry {
  key: string;
  data: unknown;
}

export async function batchPutJson(
  env: unknown,
  entries: BatchPutEntry[],
  concurrency: number = DEFAULT_R2_CONCURRENCY,
  options: PutJsonOptions = {}
): Promise<void> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const normalized = entries.filter(entry => entry && entry.key && entry.data !== undefined);
  if (!normalized.length) {
    return;
  }

  const limit = Math.max(1, Number(concurrency) || DEFAULT_R2_CONCURRENCY);
  await runWithConcurrency(normalized, limit, async entry => putJson(env, entry.key, entry.data, options));
}
