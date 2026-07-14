/**
 * R2-backed ObjectStore for the build loop.
 *
 * Implements the create-only immutable write (`If-None-Match: *`), plain read,
 * and overwrite that shared/data/build/receiptStore.ts's publication algorithm
 * needs. Immutable release bodies get a one-year cache policy; receipts and
 * channel pointers are mutable control-plane objects.
 * @module .github/scripts/lib/build/r2ObjectStore
 */

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CONTROL_CACHE_CONTROL = 'no-cache';

/** Codes R2/S3 return when a conditional create loses the race. */
const CONFLICT_CODES = new Set(['PreconditionFailed', 'At least one of the pre-conditions you specified did not hold']);

function isConflict(error) {
  const code = error?.Code || error?.name || error?.$metadata?.httpStatusCode;
  return CONFLICT_CODES.has(code) || code === 412;
}

function isMissing(error) {
  const code = error?.Code || error?.name;
  return code === 'NoSuchKey' || code === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

/**
 * Build an ObjectStore over an R2 bucket.
 * @param {import('@aws-sdk/client-s3').S3Client} client - R2 S3 client
 * @param {string} bucket - Bucket name
 * @returns {{ putIfAbsent(key: string, body: string): Promise<void>, get(key: string): Promise<string|null>, put(key: string, body: string): Promise<void> }}
 */
export function createR2ObjectStore(client, bucket) {
  return {
    async putIfAbsent(key, body) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'application/json',
            CacheControl: IMMUTABLE_CACHE_CONTROL,
            IfNoneMatch: '*'
          })
        );
      } catch (error) {
        if (isConflict(error)) {
          const conflict = new Error(`immutable key already exists: ${key}`);
          conflict.code = 'ImmutableConflict';
          throw conflict;
        }
        throw error;
      }
    },

    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await response.Body.transformToString('utf-8');
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async put(key, body) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          CacheControl: CONTROL_CACHE_CONTROL
        })
      );
    },

    /** Read a control-plane pointer with its ETag, or null when absent. */
    async read(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await response.Body.transformToString('utf-8');
        return { value: JSON.parse(body), etag: response.ETag };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    /** Create the pointer only if absent (If-None-Match: *). */
    async createIfAbsent(key, value) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket, Key: key, Body: JSON.stringify(value),
            ContentType: 'application/json', CacheControl: CONTROL_CACHE_CONTROL, IfNoneMatch: '*'
          })
        );
      } catch (error) {
        if (isConflict(error)) throw pointerConflict(key);
        throw error;
      }
    },

    /** Overwrite the pointer only if its ETag still matches (If-Match). */
    async writeIfMatch(key, value, etag) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket, Key: key, Body: JSON.stringify(value),
            ContentType: 'application/json', CacheControl: CONTROL_CACHE_CONTROL, IfMatch: etag
          })
        );
      } catch (error) {
        if (isConflict(error)) throw pointerConflict(key);
        throw error;
      }
    }
  };
}

function pointerConflict(key) {
  const error = new Error(`pointer conflict on ${key}`);
  error.name = 'PointerConflictError';
  error.code = 'PointerConflict';
  return error;
}
