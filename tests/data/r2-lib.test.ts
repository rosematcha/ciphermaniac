import test from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';

import {
  createReportsBinding,
  getJsonResult,
  putJsonIfChanged,
  readJson,
  withR2Retry
} from '../../.github/scripts/lib/r2.mjs';

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

/** Wrap a handler so each call is counted. */
function counted(handler: () => Promise<unknown>): { client: S3Client; calls: () => number } {
  let calls = 0;
  return {
    client: stubClient(() => {
      calls += 1;
      return handler();
    }),
    calls: () => calls
  };
}

test('getJsonResult classifies every outcome, never throws, and only retries transport', async () => {
  const cases: Array<[string, () => Promise<unknown>, string, number | null]> = [
    ['found', found('{"a":1,"b":[2,3]}'), 'found', 1],
    ['NoSuchKey', rejects({ name: 'NoSuchKey' }), 'missing', 1],
    ['404 status', rejects({ $metadata: { httpStatusCode: 404 } }), 'missing', 1],
    // A parse error is not transient.
    ['not JSON', found('this is not json{'), 'corrupt', 1],
    // Never conflated with missing.
    ['500', rejects(awsError({ name: 'InternalError', status: 500 })), 'transport', null],
    ['network failure with no HTTP status', rejects(new Error('ECONNRESET')), 'transport', null],
    ['a bare string, not even an Error', rejects('a bare string'), 'transport', null]
  ];
  for (const [label, handler, status, expectedCalls] of cases) {
    const { client, calls } = counted(handler);
    const result = await getJsonResult(client, BUCKET, KEY, { retry: FAST_RETRY });
    assert.equal(result.status, status, label);
    if (expectedCalls !== null) {
      assert.equal(calls(), expectedCalls, label);
    }
  }

  const found1 = await getJsonResult<{ a: number }>(stubClient(found('{"a":1}')), BUCKET, KEY);
  assert.deepEqual(found1.status === 'found' && found1.value, { a: 1 });
  const err = awsError({ name: 'InternalError', status: 500 });
  const transport = await getJsonResult(stubClient(rejects(err)), BUCKET, KEY, { retry: FAST_RETRY });
  assert.equal(transport.status === 'transport' && transport.error, err);
});

test('getJsonResult retries a failed send and a body read that drops mid-stream', async () => {
  const failures: Array<[string, (calls: number) => Promise<unknown>]> = [
    [
      'send',
      async calls => {
        if (calls < 2) {
          throw awsError({ name: 'InternalError', status: 500 });
        }
        return { Body: { transformToString: async () => '{"a":1}' } };
      }
    ],
    [
      'body read',
      async calls => ({
        Body: {
          transformToString: async () => {
            if (calls < 2) {
              throw awsError({ code: 'ECONNRESET' });
            }
            return '{"a":1}';
          }
        }
      })
    ]
  ];
  for (const [label, attempt] of failures) {
    let calls = 0;
    const client = stubClient(() => {
      calls += 1;
      return attempt(calls);
    });
    const result = await getJsonResult<{ a: number }>(client, BUCKET, KEY, { retry: FAST_RETRY });
    assert.deepEqual(result.status === 'found' && result.value, { a: 1 }, label);
    assert.equal(calls, 2, label);
  }
});

test('createReportsBinding.get returns null only for a verified miss and rethrows a transport failure', async () => {
  for (const miss of [{ $metadata: { httpStatusCode: 404 } }, { name: 'NoSuchKey' }]) {
    assert.equal(await createReportsBinding(stubClient(rejects(miss)), BUCKET).get(KEY), null, JSON.stringify(miss));
  }
  const binding = createReportsBinding(stubClient(rejects({ $metadata: { httpStatusCode: 503 } })), BUCKET, {
    retry: FAST_RETRY
  });
  await assert.rejects(() => binding.get(KEY));
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
  const { client, calls } = counted(found('{"ok":true}'));
  const obj = await createReportsBinding(client, BUCKET).get(KEY);
  assert.ok(obj);
  assert.equal(await obj.text(), '{"ok":true}');
  assert.deepEqual(await obj.json(), { ok: true });
  assert.equal(calls(), 1);
});

test('withR2Retry retries server, throttling, and socket failures, but not a miss or bad credentials', async () => {
  const cases: Array<[string, Error, boolean]> = [
    ['500', awsError({ name: 'InternalError', status: 500 }), true],
    // A 429 is a 4xx that is still worth retrying.
    ['429', awsError({ name: 'SlowDown', status: 429 }), true],
    ['socket failure with no HTTP status', awsError({ code: 'ECONNRESET' }), true],
    // Missing is an answer, not a fault.
    ['404', awsError({ name: 'NoSuchKey' }), false],
    // Bad credentials will not fix themselves.
    ['403', awsError({ name: 'AccessDenied', status: 403 }), false]
  ];
  for (const [label, error, retried] of cases) {
    let calls = 0;
    const attempt = withR2Retry(async () => {
      calls += 1;
      if (calls < 2) {
        throw error;
      }
      return 'ok';
    }, FAST_RETRY);
    if (retried) {
      assert.equal(await attempt, 'ok', label);
    } else {
      await assert.rejects(attempt, label);
    }
    assert.equal(calls, retried ? 2 : 1, label);
  }
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

test('putJsonIfChanged skips matching content and writes changed content once', async () => {
  const commands: unknown[] = [];
  const client = {
    async send(command: unknown) {
      commands.push(command);
      return commands.length === 1 ? { Metadata: { sha256: 'wrong' } } : {};
    }
  } as unknown as S3Client;
  assert.equal(await putJsonIfChanged(client, BUCKET, KEY, { value: { ok: true } }), true);
  assert.equal(commands.length, 2);

  const digest = (commands[1] as { input: { Metadata: { sha256: string } } }).input.Metadata.sha256;
  const unchanged = stubClient(async () => ({ Metadata: { sha256: digest } }));
  assert.equal(await putJsonIfChanged(unchanged, BUCKET, KEY, { value: { ok: true } }), false);
});

test('putJsonIfChanged does not turn a HEAD transport failure into a rewrite', async () => {
  const client = stubClient(rejects(awsError({ name: 'AccessDenied', status: 403 })));
  await assert.rejects(() => putJsonIfChanged(client, BUCKET, KEY, { value: { ok: true } }));
});

test('readJson returns the parsed value, and null only for a verified 404', async () => {
  assert.deepEqual(await readJson(stubClient(found('{"a":1}')), BUCKET, KEY), { a: 1 });
  assert.equal(await readJson(stubClient(rejects(awsError({ name: 'NoSuchKey' }))), BUCKET, KEY), null);
});

test('readJson throws on a transport failure or a corrupt body, keeping the cause', async () => {
  const fault = awsError({ name: 'InternalError', status: 500 });
  await assert.rejects(
    readJson(stubClient(rejects(fault)), BUCKET, KEY, { retry: { attempts: 2, ...FAST_RETRY } }),
    error => {
      assert.match((error as Error).message, /reports\/thing\.json \(transport\)/);
      assert.equal((error as Error).cause, fault);
      return true;
    }
  );
  await assert.rejects(readJson(stubClient(found('{not json')), BUCKET, KEY), /\(corrupt\)/);
});

test('runR2Batch bounds concurrency and processes every item exactly once', async () => {
  const { runR2Batch } = await import('../../.github/scripts/lib/r2.mjs');
  let active = 0;
  let peak = 0;
  const seen: number[] = [];
  await runR2Batch(
    Array.from({ length: 23 }, (_, index) => index),
    async item => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => {
        setImmediate(resolve);
      });
      seen.push(item);
      active--;
    },
    3
  );
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(
    seen.sort((left, right) => left - right),
    Array.from({ length: 23 }, (_, index) => index)
  );
});

test('runR2Batch stops scheduling after a fault and drains active work before rejecting', async () => {
  const { runR2Batch } = await import('../../.github/scripts/lib/r2.mjs');
  const { deferred } = await import('../__utils__/deferred');
  const gate = deferred<void>();
  const started: number[] = [];
  let settled = false;
  let finished = false;
  const fault = new Error('upload failed');
  const batch = runR2Batch(
    [0, 1, 2, 3],
    async item => {
      started.push(item);
      if (item === 0) {
        throw fault;
      }
      await gate.promise;
      finished = true;
    },
    2
  );
  const rejection = assert.rejects(batch, error => {
    settled = true;
    assert.equal(finished, true);
    return error === fault;
  });
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
  assert.deepEqual(started, [0, 1]);
  assert.equal(settled, false);
  gate.resolve();
  await rejection;
});

test('runR2Batch handles empty batches and rejects invalid concurrency before starting work', async () => {
  const { runR2Batch } = await import('../../.github/scripts/lib/r2.mjs');
  let calls = 0;
  const operation = async () => {
    calls++;
  };
  await runR2Batch([], operation);
  for (const concurrency of [0, -1, 1.5, Number.NaN, Infinity]) {
    await assert.rejects(runR2Batch([1], operation, concurrency), RangeError);
  }
  assert.equal(calls, 0);
});
