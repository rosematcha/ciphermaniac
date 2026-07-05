/**
 * Minimal Cloudflare Workers runtime types used by Pages Functions.
 *
 * The full @cloudflare/workers-types package conflicts with the DOM lib
 * (duplicate Request/Response/etc.), so only the surface actually used in
 * functions/ is declared here.
 */

interface KVNamespacePutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  get(key: string, type: 'text'): Promise<string | null>;
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  get(key: string, type: 'stream'): Promise<ReadableStream | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: KVNamespacePutOptions
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  contentDisposition?: string;
}

interface R2PutOptionsShim {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

interface R2ObjectBody {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpMetadata?: R2HTTPMetadata;
  readonly body: ReadableStream | null;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
    options?: R2PutOptionsShim
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number; delimiter?: string }): Promise<{
    objects: Array<{ key: string; size: number; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes?: string[];
  }>;
}

/** Cloudflare exposes the always-present default cache on CacheStorage. */
interface CacheStorage {
  readonly default: Cache;
}
