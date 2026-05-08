/**
 * Generic TTL cache with deduplication of in-flight requests.
 */

export interface CacheOptions {
  /** Time-to-live in milliseconds */
  ttl: number;
  /** Maximum number of entries before pruning (0 = unlimited) */
  maxEntries?: number;
  /** Cleanup threshold — prune only when size exceeds this (defaults to maxEntries) */
  cleanupThreshold?: number;
}

interface Entry<T> {
  data?: T;
  promise?: Promise<T>;
  expiresAt: number;
}

export class TtlCache<T = unknown> {
  private readonly map = new Map<string, Entry<T>>();
  private readonly ttl: number;
  private readonly maxEntries: number;
  private readonly cleanupThreshold: number;

  constructor(options: CacheOptions) {
    this.ttl = options.ttl;
    this.maxEntries = options.maxEntries || 0;
    this.cleanupThreshold = options.cleanupThreshold || this.maxEntries;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }
    if (!entry.promise && entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /** Get resolved data if present and not expired. */
  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.data;
  }

  /** Get the pending promise if one is in-flight. */
  getPromise(key: string): Promise<T> | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    if (!entry.promise && entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.promise;
  }

  /** Store resolved data. */
  set(key: string, data: T, ttl?: number): void {
    this.map.set(key, { data, expiresAt: Date.now() + (ttl ?? this.ttl) });
    this.prune();
  }

  /** Store an in-flight promise (prevents duplicate fetches). */
  setPending(key: string, promise: Promise<T>, ttl?: number): void {
    this.map.set(key, { promise, expiresAt: Date.now() + (ttl ?? this.ttl) });
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private prune(): void {
    if (!this.maxEntries || this.map.size <= this.cleanupThreshold) {
      return;
    }

    const now = Date.now();
    for (const [key, entry] of Array.from(this.map.entries())) {
      if (!entry.promise && entry.expiresAt <= now) {
        this.map.delete(key);
      }
    }

    if (this.map.size <= this.maxEntries) {
      return;
    }

    // Evict oldest non-pending entries
    const reclaimable = Array.from(this.map.entries())
      .filter(([, entry]) => !entry.promise)
      .sort((a, b) => (a[1].expiresAt || 0) - (b[1].expiresAt || 0));

    for (const [key] of reclaimable) {
      if (this.map.size <= this.maxEntries) {
        break;
      }
      this.map.delete(key);
    }
  }
}

/**
 * Wraps an async fetcher with TTL caching and in-flight deduplication.
 * Concurrent calls with the same key share the same promise.
 */
export function withCachedFetch<T>(
  cache: TtlCache<T>,
  fetcher: (key: string) => Promise<T>
): (key: string) => Promise<T> {
  return async (key: string): Promise<T> => {
    // Check resolved cache
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Deduplicate in-flight requests
    const pending = cache.getPromise(key);
    if (pending) {
      return pending;
    }

    const promise = fetcher(key).then(
      data => {
        cache.set(key, data);
        return data;
      },
      error => {
        cache.delete(key);
        throw error;
      }
    );

    cache.setPending(key, promise);
    return promise;
  };
}
