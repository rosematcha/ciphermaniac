/** Reading what D1 hands back, in the two shapes the functions keep needing. */

/** The first row of one statement's result in a batch, or null when it found none. */
export function firstRow<T>(result: { results?: unknown[] } | undefined): T | null {
  return (result?.results?.[0] ?? null) as T | null;
}

/** How many rows a write changed. */
export function rowsChanged(result: unknown): number {
  return (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
}
