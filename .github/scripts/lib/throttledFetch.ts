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

/** One request's outcome: its successful response, or none, and whether the host refused it. */
export interface GetResult {
  response: Response | null;
  throttled: boolean;
}

export interface ThrottledFetch {
  /** The response, after waiting out throttling; the last throttled one when that runs out. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /**
   * This request's own outcome, after waiting out throttling and retrying other failures up to
   * `retries` times: the response when it succeeded, and whether it ended throttled. A throttled
   * answer is not retried here, and nothing is sent once the run is exhausted.
   */
  get(url: string, init?: RequestInit, retries?: number): Promise<GetResult>;
  /**
   * Whether the run should stop asking: more requests than the limit ended throttled, or the host
   * asked for a longer wait than the run holds a worker for.
   */
  exhausted(): boolean;
  /** Throws when more requests than the limit ended throttled. */
  assertWithinLimit(): void;
}

/** The longest wait worth holding a worker for; a host asking for longer is refusing for now. */
const MAX_WAIT_MS = 60_000;

/** How long the host asked to wait (Retry-After as seconds or an HTTP date), else a doubling backoff. */
function waitMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')?.trim();
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const until = header ? Date.parse(header) : Number.NaN;
  return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 2000 * 2 ** attempt;
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

export function createThrottledFetch(options: ThrottleOptions = {}): ThrottledFetch {
  const { retries = 4, limit = 20, wait = sleep, fetch: send = fetch } = options;
  let refused = 0;
  let closed = false;
  const throttled: ThrottledFetch = {
    async get(url, init, attempts = 3) {
      for (let attempt = 1; attempt <= attempts && !throttled.exhausted(); attempt++) {
        const response = await throttled.fetch(url, init).catch(() => null);
        if (response?.ok) {
          return { response, throttled: false };
        }
        // An unread body keeps Node's connection from going back to the pool.
        void response?.body?.cancel().catch(() => undefined);
        if (response && THROTTLE_STATUSES.has(response.status)) {
          return { response: null, throttled: true };
        }
        if (attempt < attempts) {
          await wait(500 * 2 ** (attempt - 1));
        }
      }
      return { response: null, throttled: false };
    },
    async fetch(url, init) {
      for (let attempt = 0; ; attempt++) {
        const response = await send(url, init);
        if (!THROTTLE_STATUSES.has(response.status)) {
          return response;
        }
        const delay = waitMs(response, attempt);
        // Retrying before the host's stated time would only spend requests it has said it refuses.
        if (attempt === retries || delay > MAX_WAIT_MS) {
          refused++;
          closed ||= delay > MAX_WAIT_MS;
          return response;
        }
        void response.body?.cancel().catch(() => undefined);
        await wait(delay);
        // Another worker may have been told to stop, or the budget spent, while this one slept.
        if (throttled.exhausted()) {
          return response;
        }
      }
    },
    exhausted() {
      return closed || refused > limit;
    },
    assertWithinLimit() {
      if (closed) {
        throw new Error('The host asked for a longer wait than the run holds for; try the run again later');
      }
      if (refused > limit) {
        throw new Error(`${refused} requests stayed throttled past every retry; try the run again later`);
      }
    }
  };
  return throttled;
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
  let failed = false;
  // The first failure stops new work, and the call rejects once the work in flight has settled.
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length && !options.stop()) {
      try {
        await work(items[next++]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(options.concurrency, items.length) }, worker));
  const rejection = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (rejection) {
    throw rejection.reason;
  }
}
