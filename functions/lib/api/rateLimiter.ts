/**
 * Simple in-memory (per-isolate) rate limiter for Cloudflare Pages functions.
 *
 * Each endpoint creates its own store via `createRateLimiter`, so limits are
 * tracked independently per route. The store is a `Map<IP, {count, windowStart}>`
 * with deterministic cleanup every Nth request plus a hard size cap to avoid OOM.
 * This is best-effort (state is per-isolate and not shared across regions), which
 * is acceptable for the low-stakes endpoints that use it.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
}

export interface RateLimiter {
  /** Record a request from `ip` and report whether it is within the limit. */
  check(ip: string): RateLimitResult;
  /** Clear all tracked state. Exposed primarily for tests. */
  reset(): void;
}

export interface RateLimiterOptions {
  /** Sliding window length in milliseconds (default 1 hour). */
  windowMs?: number;
  /** Max allowed requests per IP per window (default 5). */
  maxRequests?: number;
  /** Hard cap on distinct IPs tracked before the store is cleared (default 10k). */
  maxStoreSize?: number;
  /** Run expiry cleanup every Nth request (default 100). */
  cleanupInterval?: number;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const windowMs = options.windowMs ?? 60 * 60 * 1000;
  const maxRequests = options.maxRequests ?? 5;
  const maxStoreSize = options.maxStoreSize ?? 10_000;
  const cleanupInterval = options.cleanupInterval ?? 100;

  const store = new Map<string, { count: number; windowStart: number }>();
  let requestCount = 0;

  function cleanup(): void {
    const now = Date.now();
    for (const [ip, data] of store.entries()) {
      if (now - data.windowStart > windowMs) {
        store.delete(ip);
      }
    }
  }

  function check(ip: string): RateLimitResult {
    const now = Date.now();

    // Deterministic cleanup every N requests + hard cap to prevent OOM.
    requestCount++;
    if (requestCount % cleanupInterval === 0) {
      cleanup();
    }
    if (store.size > maxStoreSize) {
      store.clear();
    }

    const existing = store.get(ip);
    if (!existing || now - existing.windowStart > windowMs) {
      store.set(ip, { count: 1, windowStart: now });
      return { allowed: true };
    }
    if (existing.count >= maxRequests) {
      const retryAfter = Math.ceil((existing.windowStart + windowMs - now) / 1000);
      return { allowed: false, retryAfter };
    }
    existing.count++;
    return { allowed: true };
  }

  return {
    check,
    reset: (): void => store.clear()
  };
}
