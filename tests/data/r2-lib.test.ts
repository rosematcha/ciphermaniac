import test from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';

import { getJsonResult, createReportsBinding } from '../../.github/scripts/lib/r2.mjs';

/**
 * Build a stub S3 client whose `send` runs `handler`. No network is touched —
 * `handler` decides the outcome for every command the code under test issues.
 */
function stubClient(handler: () => Promise<unknown>): S3Client {
  return { send: () => handler() } as unknown as S3Client;
}

/** A found object: `Body.transformToString()` yields `text`. */
function found(text: string): () => Promise<unknown> {
  return async () => ({ Body: { transformToString: async () => text } });
}

/** A rejected send with the given AWS-shaped error. */
function rejects(error: unknown): () => Promise<unknown> {
  return async () => {
    throw error;
  };
}

const BUCKET = 'test-bucket';
const KEY = 'reports/thing.json';

test('getJsonResult → found returns the parsed value', async () => {
  const client = stubClient(found('{"a":1,"b":[2,3]}'));
  const result = await getJsonResult<{ a: number; b: number[] }>(client, BUCKET, KEY);
  assert.equal(result.status, 'found');
  if (result.status === 'found') {
    assert.deepEqual(result.value, { a: 1, b: [2, 3] });
  }
});

test('getJsonResult → missing on NoSuchKey', async () => {
  const client = stubClient(rejects({ name: 'NoSuchKey' }));
  const result = await getJsonResult(client, BUCKET, KEY);
  assert.equal(result.status, 'missing');
});

test('getJsonResult → missing on a 404 $metadata status', async () => {
  const client = stubClient(rejects({ $metadata: { httpStatusCode: 404 } }));
  const result = await getJsonResult(client, BUCKET, KEY);
  assert.equal(result.status, 'missing');
});

test('getJsonResult → corrupt when the body is not JSON', async () => {
  const client = stubClient(found('this is not json{'));
  const result = await getJsonResult(client, BUCKET, KEY);
  assert.equal(result.status, 'corrupt');
  if (result.status === 'corrupt') {
    assert.ok(result.error instanceof Error);
  }
});

test('getJsonResult → transport on a 500 (never conflated with missing)', async () => {
  const err = { name: 'InternalError', $metadata: { httpStatusCode: 500 } };
  const client = stubClient(rejects(err));
  const result = await getJsonResult(client, BUCKET, KEY);
  assert.equal(result.status, 'transport');
  if (result.status === 'transport') {
    assert.equal(result.error, err);
  }
});

test('getJsonResult → transport on a network failure with no HTTP status', async () => {
  const client = stubClient(rejects(new Error('ECONNRESET')));
  const result = await getJsonResult(client, BUCKET, KEY);
  assert.equal(result.status, 'transport');
});

test('getJsonResult never throws', async () => {
  const client = stubClient(rejects('a bare string, not even an Error'));
  await assert.doesNotReject(() => getJsonResult(client, BUCKET, KEY));
});

test('createReportsBinding.get → null on a verified 404', async () => {
  const client = stubClient(rejects({ $metadata: { httpStatusCode: 404 } }));
  const binding = createReportsBinding(client, BUCKET);
  assert.equal(await binding.get(KEY), null);
});

test('createReportsBinding.get → null on NoSuchKey', async () => {
  const client = stubClient(rejects({ name: 'NoSuchKey' }));
  const binding = createReportsBinding(client, BUCKET);
  assert.equal(await binding.get(KEY), null);
});

test('createReportsBinding.get → object exposing text()/json() when found', async () => {
  const client = stubClient(found('{"ok":true}'));
  const binding = createReportsBinding(client, BUCKET);
  const obj = await binding.get(KEY);
  assert.ok(obj);
  assert.equal(await obj.text(), '{"ok":true}');
});

test('createReportsBinding.get → rethrows a transport failure (not treated as 404)', async () => {
  const client = stubClient(rejects({ $metadata: { httpStatusCode: 503 } }));
  const binding = createReportsBinding(client, BUCKET);
  await assert.rejects(() => binding.get(KEY));
});
