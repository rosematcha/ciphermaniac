/**
 * Shared R2 access for the Node producer scripts.
 *
 * One retrying S3 client, typed read results, and a Cloudflare-style binding
 * shim so every producer treats "missing", "corrupt", and "transport failure"
 * as distinct outcomes instead of collapsing them into "no data".
 *
 * The client uses the AWS SDK v3 adaptive retry mode, which already implements
 * exponential backoff with full jitter for network failures, 429, and 5xx —
 * that satisfies the "retries with backoff and jitter" requirement without any
 * hand-rolled sleeps.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
 * Build an S3 client for the R2 S3-compatible endpoint with adaptive retries.
 *
 * @param {{ accountId: string, accessKeyId: string, secretAccessKey: string }} creds
 * @returns {S3Client}
 */
export function createR2Client({ accountId, accessKeyId, secretAccessKey }) {
    return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 8,
        retryMode: 'adaptive'
    });
}

/**
 * Read and parse a JSON object, distinguishing every failure mode. Never throws.
 *
 * @template T
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<
 *   | { status: 'found', value: T }
 *   | { status: 'missing' }
 *   | { status: 'corrupt', error: unknown }
 *   | { status: 'transport', error: unknown }
 * >}
 */
export async function getJsonResult(client, bucket, key) {
    let text;
    try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        text = await response.Body.transformToString();
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
 * Write a JSON object. SDK retries cover transient transport failures.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @param {unknown} value
 * @param {{ cacheControl?: string, contentType?: string }} [options]
 * @returns {Promise<void>}
 */
export async function putJson(client, bucket, key, value, options = {}) {
    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: typeof value === 'string' ? value : JSON.stringify(value),
            ContentType: options.contentType ?? 'application/json',
            CacheControl: options.cacheControl
        })
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
 */
export function createReportsBinding(client, bucket) {
    return {
        /**
         * @param {string} key
         * @returns {Promise<{ text(): Promise<string>, json(): Promise<unknown> } | null>}
         */
        async get(key) {
            let response;
            try {
                response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            } catch (error) {
                if (isNotFound(error)) return null;
                throw error;
            }
            const body = response.Body;
            return {
                async text() {
                    return body.transformToString();
                },
                async json() {
                    return JSON.parse(await body.transformToString());
                }
            };
        },
        /**
         * @param {string} key
         * @param {string | ArrayBuffer | ArrayBufferView} data
         * @param {{ httpMetadata?: { contentType?: string, cacheControl?: string } }} [opts]
         */
        async put(key, data, opts) {
            await client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: toBody(data),
                    ContentType: opts?.httpMetadata?.contentType ?? 'application/json',
                    CacheControl: opts?.httpMetadata?.cacheControl
                })
            );
        },
        /**
         * @param {string} key
         */
        async delete(key) {
            await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        }
    };
}
