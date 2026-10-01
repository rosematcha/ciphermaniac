/** Map an input list while keeping at most `limit` asynchronous jobs in flight. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const concurrency = Math.max(1, Math.min(items.length, Math.floor(limit) || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return results;
}

/**
 * A gate that lets at most `limit` jobs run at once, for jobs that turn up
 * one by one rather than as a list: the rest wait their turn, first come
 * first served.
 */
export function createLimiter(limit: number): <T>(job: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async job => {
    if (running >= limit) {
      await new Promise<void>(resolve => {
        waiting.push(resolve);
      });
    }
    running += 1;
    try {
      return await job();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}
