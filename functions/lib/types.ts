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

/** The slice of an R2 bucket binding the functions write with. */
export interface PublishBucket {
  head: (key: string) => Promise<PublishedObject | null>;
  /** Null when `onlyIf` did not hold, and nothing was written. */
  put: (
    key: string,
    value: string,
    options: {
      httpMetadata: Record<string, string>;
      customMetadata: Record<string, string>;
      onlyIf: { etagMatches: string } | Headers;
    }
  ) => Promise<PublishedObject | null>;
  delete: (key: string) => Promise<unknown>;
}

/** What R2 says of a proof it holds: how big it is, and the type it was stored as. */
export interface ProofObject {
  size: number;
  httpMetadata?: { contentType?: string };
}

/**
 * The slice of the private bucket an organizer Application's proof is kept in.
 * Nothing public reads it; only an admin's request streams a proof back.
 */
export interface ProofBucket {
  head: (key: string) => Promise<ProofObject | null>;
  get: (key: string) => Promise<(ProofObject & { body: ReadableStream<Uint8Array> }) | null>;
  put: (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
}
