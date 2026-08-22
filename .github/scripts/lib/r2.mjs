/**
 * Shared R2 access for the Node producer scripts.
 *
 * One retrying S3 client, typed read results, and a Cloudflare-style binding
 * shim so every producer treats "missing", "corrupt", and "transport failure"
 * as distinct outcomes instead of collapsing them into "no data".
 *
 * Retries are layered. The SDK's own retry mode absorbs sub-second blips;
 * `withR2Retry` wraps each operation on top of it because R2's `InternalError`
 * episodes routinely outlast the SDK's budget — the daily producers have died
 * with `attempts: 8, totalRetryDelay: 6456`, i.e. eight tries crammed into 6.4
 * seconds and then a hard failure. The outer loop also covers the body read,
 * which the SDK cannot retry at all: the stream is consumed after `send()` has
 * already resolved, so a mid-stream drop escapes its retry middleware.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * True only for a verifiable "object does not exist" signal. Any other error
 * (timeouts, 5xx, auth) is a transport failure and must NOT be read as missing.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFound(error) {
    const meta = /** @type {{ name?: string; $metadata?: { httpStatusCode?: number } }} */ (error);
    return meta?.name === 'NoSuchKey' || meta?.$metadata?.httpStatusCode === 404;
}

/** R2/S3 error codes that describe a transient server-side or throttling fault. */
const RETRYABLE_ERROR_NAMES = new Set([
    'InternalError',
    'InternalServerError',
    'ServiceUnavailable',
    'SlowDown',
    'RequestTimeout',
    'RequestTimeTooSkewed',
    'ThrottlingException',
    'TimeoutError',
    'NetworkingError'
]);

/** Socket-level failures that arrive with no HTTP status attached. */
const RETRYABLE_SYSCALL_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH'
]);

/**
 * Worth another attempt? A verified 404 is terminal (that is an answer, not a
 * fault), and so is any other 4xx except 429 — retrying bad credentials or a
 * malformed key just burns the clock. Everything 5xx, throttled, or severed at
 * the socket gets another go.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isRetryable(error) {
    if (isNotFound(error)) return false;
    const meta = /** @type {{ name?: string; code?: string; $metadata?: { httpStatusCode?: number } }} */ (error);
    const status = meta?.$metadata?.httpStatusCode;
    if (typeof status === 'number') return status === 429 || status >= 500;
    if (meta?.name && RETRYABLE_ERROR_NAMES.has(meta.name)) return true;
    return Boolean(meta?.code && RETRYABLE_SYSCALL_CODES.has(meta.code));
}

/** Outer-retry defaults: four retries over roughly 15s of jittered backoff. */
const DEFAULT_RETRY = { attempts: 5, baseDelayMs: 1000, maxDelayMs: 15000 };

/**
 * Run an R2 operation, retrying transient faults with exponential backoff and
 * full jitter. Full jitter (a uniform draw from `[0, ceiling]` rather than the
 * ceiling itself) keeps the producers from resynchronising into a thundering
 * herd when a shared R2 outage clears.
 *
 * Safe for writes: every call site targets a fixed key, so `put` and `delete`
 * are idempotent and a replayed attempt cannot corrupt anything.
 *
 * @template T
 * @param {() => Promise<T>} operation
 * @param {{ attempts?: number, baseDelayMs?: number, maxDelayMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withR2Retry(operation, options = {}) {
    const { attempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY, ...options };
    for (let attempt = 1; ; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= attempts || !isRetryable(error)) throw error;
            const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
            await sleep(Math.floor(Math.random() * ceiling));
        }
    }
}

/**
 * Coerce the accepted Cloudflare-binding body types into something the S3 SDK
 * accepts. Mirrors the pass-through the inline bindings did (strings and binary
 * bodies untouched); plain objects are serialized as a convenience fallback.
 *
 * @param {string | ArrayBuffer | ArrayBufferView | unknown} data
 * @returns {string | Buffer}
 */
function toBody(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return JSON.stringify(data);
}

/**
 * Build an S3 client for the R2 S3-compatible endpoint.
 *
 * The SDK keeps a short retry budget on purpose: it is the fast inner layer for
 * momentary blips, while `withR2Retry` owns the long, jittered waits that a
 * sustained R2 fault needs. Standard mode rather than adaptive, because the
 * adaptive client-side rate limiter would throttle the healthy bulk reads these
 * producers run in tight loops.
 *
 * @param {{ accountId: string, accessKeyId: string, secretAccessKey: string }} creds
 * @returns {S3Client}
 */
export function createR2Client({ accountId, accessKeyId, secretAccessKey }) {
    return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 4,
        retryMode: 'standard'
    });
}

/**
 * Read and parse a JSON object, distinguishing every failure mode. Never throws.
 *
 * @template T
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @param {{ retry?: { attempts?: number, baseDelayMs?: number, maxDelayMs?: number } }} [options]
 * @returns {Promise<
 *   | { status: 'found', value: T }
 *   | { status: 'missing' }
 *   | { status: 'corrupt', error: unknown }
 *   | { status: 'transport', error: unknown }
 * >}
 */
export async function getJsonResult(client, bucket, key, options = {}) {
    let text;
    try {
        text = await withR2Retry(async () => {
            const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            return response.Body.transformToString();
        }, options.retry);
    } catch (error) {
        if (isNotFound(error)) return { status: 'missing' };
        return { status: 'transport', error };
    }
    try {
        return { status: 'found', value: JSON.parse(text) };
    } catch (error) {
        return { status: 'corrupt', error };
    }
}

/**
 * Write a JSON object. Transient transport failures are retried.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @param {unknown} value
 * @param {{ cacheControl?: string, contentType?: string, retry?: { attempts?: number, baseDelayMs?: number, maxDelayMs?: number } }} [options]
 * @returns {Promise<void>}
 */
export async function putJson(client, bucket, key, value, options = {}) {
    await withR2Retry(() =>
        client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: typeof value === 'string' ? value : JSON.stringify(value),
                ContentType: options.contentType ?? 'application/json',
                CacheControl: options.cacheControl
            })
        ),
        options.retry
    );
}

/**
 * Cloudflare-style `{ get, put, delete }` binding backed by the S3 client. Get
 * returns an R2ObjectBody-like `{ text, json }` (or null on a verified 404);
 * every other error throws. This consolidates the shim that run-trends,
 * run-player-aggregator, and build-rotation-snapshots each re-implemented.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {{ retry?: { attempts?: number, baseDelayMs?: number, maxDelayMs?: number } }} [options]
 */
export function createReportsBinding(client, bucket, options = {}) {
    const retry = options.retry;
    return {
        /**
         * @param {string} key
         * @returns {Promise<{ text(): Promise<string>, json(): Promise<unknown> } | null>}
         */
        async get(key) {
            // The body is drained inside the retry rather than handed back as a
            // lazy stream: every caller reads it immediately, and buffering here
            // is what lets a mid-stream drop be retried as a fresh GET.
            let text;
            try {
                text = await withR2Retry(async () => {
                    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
                    return response.Body.transformToString();
                }, retry);
            } catch (error) {
                if (isNotFound(error)) return null;
                throw error;
            }
            return {
                async text() {
                    return text;
                },
                async json() {
                    return JSON.parse(text);
                }
            };
        },
        /**
         * @param {string} key
         * @param {string | ArrayBuffer | ArrayBufferView} data
         * @param {{ httpMetadata?: { contentType?: string, cacheControl?: string } }} [opts]
         */
        async put(key, data, opts) {
            await withR2Retry(() =>
                client.send(
                    new PutObjectCommand({
                        Bucket: bucket,
                        Key: key,
                        Body: toBody(data),
                        ContentType: opts?.httpMetadata?.contentType ?? 'application/json',
                        CacheControl: opts?.httpMetadata?.cacheControl
                    })
                ),
                retry
            );
        },
        /**
         * @param {string} key
         */
        async delete(key) {
            await withR2Retry(() => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })), retry);
        }
    };
}
