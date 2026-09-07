import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from '../../functions/lib/api/rateLimiter.ts';

let now = 0;

beforeEach(() => {
  now = 0;
  mock.method(Date, 'now', () => now);
});

afterEach(() => {
  mock.restoreAll();
});

test('createRateLimiter allows the configured number of requests and reports retry time', () => {
  const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 2 });

  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: false, retryAfter: 10 });

  now = 5_001;
  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: false, retryAfter: 5 });
});

test('an expired window starts fresh without affecting another address', () => {
  const limiter = createRateLimiter({ windowMs: 1_000, maxRequests: 1 });

  assert.deepEqual(limiter.check('198.51.100.2'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.2'), { allowed: false, retryAfter: 1 });
  now = 1_001;
  assert.deepEqual(limiter.check('198.51.100.2'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.3'), { allowed: true });
});

test('the store cap clears old addresses before adding another one', () => {
  const limiter = createRateLimiter({ maxRequests: 1, maxStoreSize: 1 });

  assert.deepEqual(limiter.check('198.51.100.4'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.5'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.6'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.4'), { allowed: true });
});

test('reset clears a live window', () => {
  const limiter = createRateLimiter({ maxRequests: 1 });

  assert.deepEqual(limiter.check('198.51.100.7'), { allowed: true });
  assert.equal(limiter.check('198.51.100.7').allowed, false);
  limiter.reset();
  assert.deepEqual(limiter.check('198.51.100.7'), { allowed: true });
});
