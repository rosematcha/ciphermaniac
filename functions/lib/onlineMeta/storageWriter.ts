import { runWithConcurrency } from './tournamentFetcher';

const DEFAULT_R2_CONCURRENCY = 6;

interface R2PutOptions {
  httpMetadata?: { contentType?: string; cacheControl?: string };
}

interface R2Object {
  text(): Promise<string>;
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, data: string | ArrayBuffer | ArrayBufferView, opts?: R2PutOptions): Promise<unknown>;
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
  await bucket.put(key, payload, {
    httpMetadata: {
      contentType: 'application/json',
      ...(options.cacheControl ? { cacheControl: options.cacheControl } : {})
    }
  });
}

export async function putBinary(
  env: unknown,
  key: string,
  data: Uint8Array | ArrayBuffer,
  contentType = 'application/octet-stream'
): Promise<void> {
  const bucket = (env as EnvWithReports)?.REPORTS;
  if (!bucket?.put) {
    throw new Error('REPORTS bucket not configured');
  }
  await bucket.put(key, data, {
    httpMetadata: { contentType }
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
