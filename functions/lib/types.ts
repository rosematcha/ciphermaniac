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

/** What R2 says of an object it holds: enough to write over exactly that object. */
export interface PublishedObject {
  etag: string;
  customMetadata?: Record<string, string>;
}

/** The slice of an R2 bucket binding the functions write with, and read the locator's files from. */
export interface PublishBucket {
  head: (key: string) => Promise<PublishedObject | null>;
  /** Null when `onlyIf` did not hold, and nothing was written. */
  put: (
    key: string,
    value: string,
    options: {
      httpMetadata: Record<string, string>;
      customMetadata: Record<string, string>;
      onlyIf?: { etagMatches: string } | Headers;
    }
  ) => Promise<PublishedObject | null>;
  delete: (key: string) => Promise<unknown>;
  /** An object's text; null when there is none. Optional so test doubles that only publish need not have it. */
  get?: (key: string) => Promise<{ text: () => Promise<string> } | null>;
}

/**
 * The private bucket Store Applications' proof files were kept in, when they
 * carried one. Nothing reads it; the files left in it are being deleted.
 */
export interface ProofBucket {
  delete: (key: string) => Promise<unknown>;
}
