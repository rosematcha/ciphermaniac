/**
 * Conditional channel-pointer updates with replan-on-conflict.
 *
 * The channel pointers (build/v1/channels/{shadow,production}.json) are the one
 * mutable control-plane object per channel. Updates use an optimistic
 * conditional write (create-if-absent, else if-ETag-matches); a lost race reads
 * the new pointer, lets the caller recompute the next value, and retries. This
 * reuses the tournaments.json lost-update pattern but for release promotion.
 *
 * Environment-neutral: the R2 If-Match/If-None-Match wiring is a thin adapter
 * satisfying {@link ConditionalPointerStore}.
 * @module shared/data/build/channel
 */

/** A pointer as stored, with its concurrency token. */
export interface PointerState<T> {
  value: T;
  etag: string;
}

/** Conditional pointer store (R2 or in-memory). */
export interface ConditionalPointerStore<T> {
  /** Read the pointer + its ETag, or null when it does not exist yet. */
  read(key: string): Promise<PointerState<T> | null>;
  /** Create the pointer only if absent. Rejects with a conflict on a race. */
  createIfAbsent(key: string, value: T): Promise<void>;
  /** Overwrite only if the current ETag matches. Rejects with a conflict on a race. */
  writeIfMatch(key: string, value: T, etag: string): Promise<void>;
}

/** Thrown by a store when a conditional write loses its race. */
export class PointerConflictError extends Error {
  constructor(key: string) {
    super(`pointer conflict on ${key}`);
    this.name = 'PointerConflictError';
  }
}

function isConflict(error: unknown): boolean {
  return error instanceof PointerConflictError || (error as { name?: string })?.name === 'PointerConflictError' || (error as { code?: string })?.code === 'PointerConflict';
}

/**
 * Update a channel pointer, recomputing the next value from the latest state on
 * each attempt so a conflict re-reads and retries instead of clobbering.
 * @param store - Conditional pointer store
 * @param key - Pointer key
 * @param next - Given the current value (or null when absent), produce the next
 *   value, or null to leave the pointer unchanged
 * @param options - Retry bound
 * @param options.maxAttempts - Max attempts before giving up (default 5)
 * @returns The value written, or the unchanged value when `next` returned null
 * @throws When the conflict persists past `maxAttempts`
 */
export async function updatePointer<T>(
  store: ConditionalPointerStore<T>,
  key: string,
  next: (current: T | null) => T | null,
  options: { maxAttempts?: number } = {}
): Promise<T | null> {
  const maxAttempts = options.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const current = await store.read(key);
    const proposed = next(current?.value ?? null);
    if (proposed === null) return current?.value ?? null;
    try {
      if (current === null) await store.createIfAbsent(key, proposed);
      else await store.writeIfMatch(key, proposed, current.etag);
      return proposed;
    } catch (error) {
      if (isConflict(error) && attempt < maxAttempts) continue; // re-read + retry
      throw error;
    }
  }
  throw new PointerConflictError(key);
}
