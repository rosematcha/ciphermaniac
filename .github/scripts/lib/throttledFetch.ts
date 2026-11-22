/**
 * Fetching from a volunteer host a few requests at a time: a 429 or 503 is a request to slow down,
 * not a missing page, so it is waited out (as long as Retry-After asks, or a doubling backoff) and
 * retried. Pages still refused after that are counted, so a run can fail rather than quietly use
 * less data.
 * @module .github/scripts/lib/throttledFetch
 */

const THROTTLE_STATUSES = new Set([429, 503]);

interface ThrottleOptions {
  /** Waits per request before giving up on it. */
  retries?: number;
  /** Requests that may end throttled before {@link ThrottledFetch.assertWithinLimit} throws. */
  limit?: number;
  wait?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
}

export interface ThrottledFetch {
  /** The response, after waiting out throttling; the last throttled one when that runs out. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Whether more requests than the limit ended throttled; the run cannot publish once it has. */
  exhausted(): boolean;
  /** Throws when more requests than the limit ended throttled. */
  assertWithinLimit(): void;
}

function waitMs(response: Response, attempt: number): number {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : 2000 * 2 ** attempt;
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

export function createThrottledFetch(options: ThrottleOptions = {}): ThrottledFetch {
  const { retries = 4, limit = 20, wait = sleep, fetch: send = fetch } = options;
  let refused = 0;
  return {
    async fetch(url, init) {
      for (let attempt = 0; ; attempt++) {
        const response = await send(url, init);
        if (!THROTTLE_STATUSES.has(response.status)) {
          return response;
        }
        if (attempt === retries) {
          refused++;
          return response;
        }
        await wait(waitMs(response, attempt));
      }
    },
    exhausted() {
      return refused > limit;
    },
    assertWithinLimit() {
      if (refused > limit) {
        throw new Error(`${refused} requests stayed throttled past every retry; try the run again later`);
      }
    }
  };
}

/**
 * Run `work` over `items` a few at a time, admitting no more once `stop` says so; the work in
 * flight still finishes.
 */
export async function prefetchAll<T>(
  items: readonly T[],
  work: (item: T) => Promise<unknown>,
  options: { concurrency: number; stop: () => boolean }
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !options.stop()) {
      await work(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, worker));
}
