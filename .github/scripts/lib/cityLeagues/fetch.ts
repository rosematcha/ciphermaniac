/**
 * The one way the City League source talks to other sites: a request at a
 * time, a gap between requests, a User-Agent that says who we are, and a
 * widening backoff on failure. Limitless and pokemonproxies.com are both
 * volunteer projects; we are guests on both.
 */

export const CITY_LEAGUES_USER_AGENT = 'ciphermaniac-city-leagues/1.0 (+https://ciphermaniac.com)';

interface PoliteFetchOptions {
  /** Least time between the start of one request and the next. Default 1500 ms. */
  minGapMs?: number;
  /** Attempts per URL. Default 4. */
  attempts?: number;
  /** First retry delay, doubled each retry. Default 2000 ms. */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PoliteFetcher {
  fetchText(url: string): Promise<string>;
  fetchBytes(url: string): Promise<Uint8Array>;
}

/** A 404 is an answer, not a blip: it is never retried. */
export class NotFoundError extends Error {
  constructor(url: string) {
    super(`Not found: ${url}`);
    this.name = 'NotFoundError';
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * A fetcher that serialises every request it makes and spaces them out.
 * @param options - Gap, retry and test seams
 * @returns Text and byte fetchers sharing one queue
 */
export function createPoliteFetcher(options: PoliteFetchOptions = {}): PoliteFetcher {
  const minGapMs = options.minGapMs ?? 1500;
  const attempts = options.attempts ?? 4;
  const backoffMs = options.backoffMs ?? 2000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  let lastStart = Number.NEGATIVE_INFINITY;
  let queue: Promise<unknown> = Promise.resolve();

  async function once(url: string): Promise<Response> {
    const wait = lastStart + minGapMs - now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastStart = now();
    const response = await fetchImpl(url, { headers: { 'User-Agent': CITY_LEAGUES_USER_AGENT } });
    if (response.status === 404) {
      throw new NotFoundError(url);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response;
  }

  async function withRetries(url: string): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
      try {
        return await once(url);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw error;
        }
        lastError = error;
      }
    }
    throw new Error(`Gave up on ${url} after ${attempts} attempts: ${String(lastError)}`);
  }

  // Chained so concurrent callers still go one at a time.
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    fetchText: url => enqueue(async () => (await withRetries(url)).text()),
    fetchBytes: url => enqueue(async () => new Uint8Array(await (await withRetries(url)).arrayBuffer()))
  };
}
