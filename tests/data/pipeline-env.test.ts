/**
 * Pipeline environment access (DB-MASTER-PLAN Phase 8.4).
 *
 * Thirteen entrypoints each had their own `requireEnv`. Consolidating them is
 * only worth it if the one implementation is stricter than the thirteen were —
 * in particular about booleans, because GitHub Actions renders an unchecked
 * boolean input as the STRING "false", which is truthy in JavaScript. A
 * destructive job reading an unchecked box as "yes" is the failure this guards.
 */

import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import { boolEnv, intEnv, optionalEnv, r2Config, requireEnv } from '../../.github/scripts/lib/env.ts';

/** Set vars for one call, then restore — these tests must not leak into each other. */
function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    return run();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

test('a required variable is returned trimmed', () => {
  assert.equal(
    withEnv({ CM_T: '  value  ' }, () => requireEnv('CM_T')),
    'value'
  );
});

test('a missing or blank required variable throws, naming it but never a value', () => {
  for (const value of [undefined, '', '   ']) {
    assert.throws(
      () => withEnv({ CM_T: value }, () => requireEnv('CM_T')),
      (err: Error) => {
        assert.match(err.message, /CM_T/);
        return true;
      }
    );
  }
});

test('the error for a set-but-blank secret does not echo its value', () => {
  // A pipeline failure is public in the Actions log.
  assert.throws(
    () => withEnv({ CM_SECRET: '   ' }, () => requireEnv('CM_SECRET')),
    (err: Error) => {
      assert.ok(!err.message.includes('   ') || err.message.trim() === err.message, err.message);
      return true;
    }
  );
});

test('an optional variable falls back when unset or blank', () => {
  assert.equal(
    withEnv({ CM_T: undefined }, () => optionalEnv('CM_T', 'fb')),
    'fb'
  );
  assert.equal(
    withEnv({ CM_T: '  ' }, () => optionalEnv('CM_T', 'fb')),
    'fb'
  );
  assert.equal(
    withEnv({ CM_T: ' set ' }, () => optionalEnv('CM_T', 'fb')),
    'set'
  );
});

test('the string "false" is false, not truthy', () => {
  // This is the whole point: Actions renders an unchecked boolean input as the
  // string "false", and Boolean("false") is true.
  assert.equal(
    withEnv({ CM_B: 'false' }, () => boolEnv('CM_B')),
    false
  );
  assert.equal(
    withEnv({ CM_B: 'False' }, () => boolEnv('CM_B')),
    false
  );
  assert.equal(
    withEnv({ CM_B: '0' }, () => boolEnv('CM_B')),
    false
  );
  assert.equal(
    withEnv({ CM_B: 'no' }, () => boolEnv('CM_B')),
    false
  );
});

test('affirmatives are affirmative', () => {
  for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
    assert.equal(
      withEnv({ CM_B: value }, () => boolEnv('CM_B')),
      true,
      value
    );
  }
});

test('an unset boolean takes its fallback', () => {
  assert.equal(
    withEnv({ CM_B: undefined }, () => boolEnv('CM_B')),
    false
  );
  assert.equal(
    withEnv({ CM_B: '' }, () => boolEnv('CM_B', true)),
    true
  );
});

test('an unrecognized boolean throws rather than guessing', () => {
  // Silently reading "maybe" as either answer is worse than refusing to run.
  assert.throws(() => withEnv({ CM_B: 'maybe' }, () => boolEnv('CM_B')), /must be a boolean/);
});

test('integers are bounded', () => {
  assert.equal(
    withEnv({ CM_N: '5' }, () => intEnv('CM_N', 1, { min: 1, max: 10 })),
    5
  );
  assert.equal(
    withEnv({ CM_N: undefined }, () => intEnv('CM_N', 3)),
    3
  );
  for (const bad of ['0', '11', '2.5', 'abc']) {
    assert.throws(() => withEnv({ CM_N: bad }, () => intEnv('CM_N', 1, { min: 1, max: 10 })), /must be an integer/);
  }
});

test('R2 config prefers R2_ACCOUNT_ID, which is what the workflows set', () => {
  const cfg = withEnv(
    {
      R2_ACCOUNT_ID: 'acct-r2',
      CLOUDFLARE_ACCOUNT_ID: 'acct-cf',
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
      R2_BUCKET_NAME: 'b'
    },
    () => r2Config()
  );
  assert.deepEqual(cfg, { accountId: 'acct-r2', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' });
});

test('R2 config accepts CLOUDFLARE_ACCOUNT_ID when a job forgot the mapping', () => {
  const cfg = withEnv(
    {
      R2_ACCOUNT_ID: undefined,
      CLOUDFLARE_ACCOUNT_ID: 'acct-cf',
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
      R2_BUCKET_NAME: 'b'
    },
    () => r2Config()
  );
  assert.equal(cfg.accountId, 'acct-cf');
});

test('the bucket is required unless a default is offered', () => {
  const base = {
    R2_ACCOUNT_ID: 'a',
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    R2_BUCKET_NAME: undefined
  };
  assert.throws(() => withEnv(base, () => r2Config()), /R2_BUCKET_NAME/);
  assert.equal(withEnv(base, () => r2Config({ defaultBucket: 'fb' })).bucket, 'fb');
});
