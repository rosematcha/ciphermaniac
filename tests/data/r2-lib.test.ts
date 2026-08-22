import test from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';

import { createReportsBinding, getJsonResult, withR2Retry } from '../../.github/scripts/lib/r2.mjs';

/** Backoff small enough that exhausting every attempt stays sub-millisecond. */
const FAST_RETRY = { baseDelayMs: 0, maxDelayMs: 0 };

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

/**
 * An AWS-shaped failure: a real Error carrying the `name`, `$metadata.httpStatusCode`,
 * and `code` fields the SDK attaches, which is what the retry classifier reads.
 */
function awsError({ name, status, code }: { name?: string; status?: number; code?: string }): Error {
  const error = new Error(name ?? code ?? 'r2 failure');
  if (name !== undefined) {
    error.name = name;
  }
  if (status !== undefined) {
    Object.assign(error, { $metadata: { httpStatusCode: status } });
  }
  if (code !== undefined) {
    Object.assign(error, { code });
  }
  return error;
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
  const err = awsError({ name: 'InternalError', status: 500 });
  const client = stubClient(rejects(err));
  const result = await getJsonResult(client, BUCKET, KEY, { retry: FAST_RETRY });
  assert.equal(result.status, 'transport');
  if (result.status === 'transport') {
    assert.equal(result.error, err);
  }
});

test('getJsonResult → transport on a network failure with no HTTP status', async () => {
  const client = stubClient(rejects(new Error('ECONNRESET')));
  const result = await getJsonResult(client, BUCKET, KEY, { retry: FAST_RETRY });
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
  const binding = createReportsBinding(client, BUCKET, { retry: FAST_RETRY });
  await assert.rejects(() => binding.get(KEY));
});

test('withR2Retry retries a 500 and returns the eventual success', async () => {
  let calls = 0;
  const value = await withR2Retry(async () => {
    calls += 1;
    if (calls < 3) {
      throw awsError({ name: 'InternalError', status: 500 });
    }
    return 'ok';
  }, FAST_RETRY);
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('withR2Retry gives up after the attempt budget and rethrows the last error', async () => {
  const err = awsError({ name: 'InternalError', status: 500 });
  let calls = 0;
  await assert.rejects(
    () =>
      withR2Retry(
        async () => {
          calls += 1;
          throw err;
        },
        { ...FAST_RETRY, attempts: 4 }
      ),
    (thrown: unknown) => thrown === err
  );
  assert.equal(calls, 4);
});

test('withR2Retry does not retry a 404 — missing is an answer, not a fault', async () => {
  let calls = 0;
  await assert.rejects(() =>
    withR2Retry(async () => {
      calls += 1;
      throw awsError({ name: 'NoSuchKey' });
    }, FAST_RETRY)
  );
  assert.equal(calls, 1);
});

test('withR2Retry does not retry a 403 — bad credentials will not fix themselves', async () => {
  let calls = 0;
  await assert.rejects(() =>
    withR2Retry(async () => {
      calls += 1;
      throw awsError({ name: 'AccessDenied', status: 403 });
    }, FAST_RETRY)
  );
  assert.equal(calls, 1);
});

test('withR2Retry retries a 429 even though it is a 4xx', async () => {
  let calls = 0;
  await withR2Retry(async () => {
    calls += 1;
    if (calls < 2) {
      throw awsError({ name: 'SlowDown', status: 429 });
    }
  }, FAST_RETRY);
  assert.equal(calls, 2);
});

test('withR2Retry retries a socket failure that carries no HTTP status', async () => {
  let calls = 0;
  await withR2Retry(async () => {
    calls += 1;
    if (calls < 2) {
      throw awsError({ code: 'ECONNRESET' });
    }
  }, FAST_RETRY);
  assert.equal(calls, 2);
});

test('getJsonResult retries a 500 and returns the value on a later attempt', async () => {
  let calls = 0;
  const client = stubClient(async () => {
    calls += 1;
    if (calls < 2) {
      throw awsError({ name: 'InternalError', status: 500 });
    }
    return { Body: { transformToString: async () => '{"a":1}' } };
  });
  const result = await getJsonResult<{ a: number }>(client, BUCKET, KEY, { retry: FAST_RETRY });
  assert.equal(result.status, 'found');
  assert.equal(calls, 2);
});

test('getJsonResult retries a body read that drops mid-stream', async () => {
  let calls = 0;
  const client = stubClient(async () => {
    calls += 1;
    return {
      Body: {
        transformToString: async () => {
          if (calls < 2) {
            throw awsError({ code: 'ECONNRESET' });
          }
          return '{"a":1}';
        }
      }
    };
  });
  const result = await getJsonResult<{ a: number }>(client, BUCKET, KEY, { retry: FAST_RETRY });
  assert.equal(result.status, 'found');
  if (result.status === 'found') {
    assert.deepEqual(result.value, { a: 1 });
  }
  assert.equal(calls, 2);
});

test('getJsonResult still reports corrupt without retrying — a parse error is not transient', async () => {
  let calls = 0;
  const client = stubClient(async () => {
    calls += 1;
    return { Body: { transformToString: async () => 'not json{' } };
  });
  const result = await getJsonResult(client, BUCKET, KEY);
  assert.equal(result.status, 'corrupt');
  assert.equal(calls, 1);
});

test('createReportsBinding.get retries a 500 before succeeding', async () => {
  let calls = 0;
  const client = stubClient(async () => {
    calls += 1;
    if (calls < 2) {
      throw awsError({ name: 'InternalError', status: 500 });
    }
    return { Body: { transformToString: async () => '{"ok":true}' } };
  });
  const obj = await createReportsBinding(client, BUCKET, { retry: FAST_RETRY }).get(KEY);
  assert.ok(obj);
  assert.deepEqual(await obj.json(), { ok: true });
  assert.equal(calls, 2);
});

test('createReportsBinding.get buffers the body so repeated reads do not refetch', async () => {
  let calls = 0;
  const client = stubClient(async () => {
    calls += 1;
    return { Body: { transformToString: async () => '{"ok":true}' } };
  });
  const obj = await createReportsBinding(client, BUCKET).get(KEY);
  assert.ok(obj);
  assert.equal(await obj.text(), '{"ok":true}');
  assert.deepEqual(await obj.json(), { ok: true });
  assert.equal(calls, 1);
});
