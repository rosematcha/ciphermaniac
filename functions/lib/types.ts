/**
 * The slice of Cloudflare's D1 binding these functions use, typed here so the
 * functions and their tests share one shape without pulling in the Workers
 * type package.
 */

export interface D1Statement {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
}

export interface D1Like {
  prepare: (sql: string) => D1Statement;
  /**
   * Runs the statements in order, in one transaction and one round trip. Each
   * result carries the rows a statement read and how many rows it changed.
   */
  batch: (statements: D1Statement[]) => Promise<{ results?: unknown[]; meta?: { changes?: number } }[]>;
}
