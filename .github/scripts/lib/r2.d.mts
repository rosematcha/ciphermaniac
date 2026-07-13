import type { S3Client } from '@aws-sdk/client-s3';

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Discriminated read result: a transport blip is never conflated with a 404. */
export type JsonReadResult<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'corrupt'; error: unknown }
  | { status: 'transport'; error: unknown };

export interface PutJsonOptions {
  cacheControl?: string;
  contentType?: string;
}

/** Cloudflare R2 `R2ObjectBody`-shaped read result. */
export interface R2ObjectBody {
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface R2PutOptions {
  httpMetadata?: { contentType?: string; cacheControl?: string };
}

/** Cloudflare R2 binding-shaped shim over the S3 client. */
export interface ReportsBinding {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, data: string | ArrayBuffer | ArrayBufferView, opts?: R2PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

export declare function createR2Client(creds: R2Credentials): S3Client;

export declare function getJsonResult<T = unknown>(
  client: S3Client,
  bucket: string,
  key: string
): Promise<JsonReadResult<T>>;

export declare function putJson(
  client: S3Client,
  bucket: string,
  key: string,
  value: unknown,
  options?: PutJsonOptions
): Promise<void>;

export declare function createReportsBinding(client: S3Client, bucket: string): ReportsBinding;
