/**
 * HTTP transport for the browser data layer.
 *
 * Split out of `src/lib/data.ts` so the fetch/dedupe/cache behavior — which
 * every page depends on and which nothing could test — has a seam. The
 * dependencies that made it untestable are now parameters: `fetch`, the clock,
 * the base URL, and release-path resolution.
 *
 * There is no DI framework here and there should not be one. {@link createDataClient}
 * is a factory over a small options bag; the module-level default instance is
 * wired to the real globals and is what the rest of the data layer uses.
 * @module src/lib/data/client
 */

import { isReleasePath, recoverFromMissingReleaseBody, resolveDataPath } from '../releaseClient';

export { R2_ORIGIN as R2_BASE } from '../constants';

import { R2_ORIGIN as R2_BASE } from '../constants';

/**
 * How long a resolved response stays in the dedupe cache.
 *
 * Long enough that a navigation burst shares one download of the large shared
 * payloads (master.json, cardUsage.json, the synonym database), short enough
 * that a tab left open across the daily data update picks up fresh reports
 * within minutes.
 */
export const FETCH_TTL_MS = 5 * 60 * 1000;

export interface DataClientOptions {
  /** Transport. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Clock for cache expiry, in ms. Defaults to `Date.now`. */
  now?: () => number;
  /** Origin for non-local reads. Defaults to {@link R2_BASE}. */
  baseUrl?: string;
  /** Resolved-response cache lifetime. Defaults to {@link FETCH_TTL_MS}. */
  ttlMs?: number;
  /**
   * Legacy path → path to actually fetch. Defaults to the embedded release
   * resolver, which is a no-op when no manifest is embedded.
   */
  resolvePath?: (path: string) => string;
  /**
   * True when a resolved path targets an immutable release body, where a 404
   * means corruption rather than an optional miss.
   */
  isReleaseBodyPath?: (resolvedPath: string) => boolean;
  /**
   * Handle a 404 on an immutable release body. Returns true when it started a
   * recovery navigation, in which case the request never resolves.
   */
  recoverFromMissingBody?: (resolvedPath: string) => boolean;
  /**
   * Serve this path from the local origin instead of `baseUrl`. Defaults to the
   * dev-only snapshot rule below.
   */
  useLocalOrigin?: (resolvedPath: string) => boolean;
}

/**
 * Snapshot data (frozen pre-rotation reports) lives at /reports/Snapshots/{date}/.
 * In dev, the build-rotation-snapshots script writes to `static/reports/Snapshots/`
 * so vite serves them at the root; in prod they're on R2 like everything else.
 * The choice is per call rather than per helper so non-snapshot reads keep their
 * fast path.
 */
function defaultUseLocalOrigin(path: string): boolean {
  return Boolean(import.meta.env?.DEV) && path.startsWith('/reports/Snapshots/');
}

export interface DataClient {
  /** Fetch JSON; rejects on any non-OK response. */
  fetchJson: <T>(path: string) => Promise<T>;
  /** Fetch JSON; resolves to null on 404 rather than rejecting. */
  fetchJsonOptional: <T>(path: string) => Promise<T | null>;
  /** Resolve a data path to the URL this client would fetch. */
  resolveUrl: (path: string) => string;
  /** Drop every cached entry. For tests and hard refreshes; not used in the app. */
  clearCache: () => void;
  /** Number of entries currently held. For tests. */
  readonly cacheSize: number;
}

/**
 * Build a data client.
 *
 * The cache is a dedupe map first and a short TTL cache second: `expires` is
 * Infinity while a request is in flight, so concurrent callers share one
 * download, then becomes `now + ttl` once resolved. A REJECTED entry is evicted
 * immediately, so a user-triggered retry gets a real fetch rather than a cached
 * failure. Expired entries are swept on insert so multi-megabyte payloads do
 * not accumulate for the life of the session.
 * @param options - Injectable dependencies; every one has a production default
 * @returns The client
 */
export function createDataClient(options: DataClientOptions = {}): DataClient {
  const {
    fetch: fetchImpl = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
    now = Date.now,
    baseUrl = R2_BASE,
    ttlMs = FETCH_TTL_MS,
    resolvePath = resolveDataPath,
    isReleaseBodyPath = isReleasePath,
    recoverFromMissingBody = recoverFromMissingReleaseBody,
    useLocalOrigin = defaultUseLocalOrigin
  } = options;

  const inflight = new Map<string, { promise: Promise<unknown>; expires: number }>();

  function cached(url: string): Promise<unknown> | null {
    const entry = inflight.get(url);
    if (!entry) {
      return null;
    }
    if (now() > entry.expires) {
      inflight.delete(url);
      return null;
    }
    return entry.promise;
  }

  function remember(url: string, promise: Promise<unknown>): void {
    const at = now();
    for (const [key, entry] of inflight) {
      if (at > entry.expires) {
        inflight.delete(key);
      }
    }
    const entry = { promise, expires: Infinity };
    inflight.set(url, entry);
    promise.then(
      () => {
        entry.expires = now() + ttlMs;
      },
      () => {
        // Only evict if this entry is still the current one — a retry may have
        // already replaced it.
        if (inflight.get(url) === entry) {
          inflight.delete(url);
        }
      }
    );
  }

  function resolveUrl(path: string): string {
    const resolvedPath = resolvePath(path);
    return useLocalOrigin(resolvedPath) ? resolvedPath : `${baseUrl}${resolvedPath}`;
  }

  async function fetchJsonCore<T>(path: string, optional: boolean): Promise<T | null> {
    // Release-aware resolution: a no-op when no manifest is embedded (production
    // default), else rewrites scope paths to their immutable release roots.
    const resolvedPath = resolvePath(path);
    const url = useLocalOrigin(resolvedPath) ? resolvedPath : `${baseUrl}${resolvedPath}`;
    const hit = cached(url);
    if (hit) {
      return hit as Promise<T | null>;
    }
    const promise = (async () => {
      const response = await fetchImpl(url, { mode: 'cors' });
      // A 404 on an IMMUTABLE release body is corruption, not an optional miss:
      // recover with one controlled reload (adopt a newer release) rather than
      // mixing a legacy generation into this document. recoverFromMissingBody
      // is a no-op unless a manifest is embedded and this is a release path.
      if (response.status === 404 && isReleaseBodyPath(resolvedPath) && recoverFromMissingBody(resolvedPath)) {
        return new Promise<T | null>(() => {}); // navigation underway; never resolves
      }
      if (optional && response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    })();
    remember(url, promise);
    return promise;
  }

  return {
    fetchJson: <T>(path: string) => fetchJsonCore<T>(path, false) as Promise<T>,
    fetchJsonOptional: <T>(path: string) => fetchJsonCore<T>(path, true),
    resolveUrl,
    clearCache: () => inflight.clear(),
    get cacheSize() {
      return inflight.size;
    }
  };
}

/** The application's client, wired to the real globals. */
export const dataClient = createDataClient();
