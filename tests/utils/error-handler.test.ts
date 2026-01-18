import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError, ErrorTypes, safeAsync, safeSync, validators, withRetry } from '../../src/utils/errorHandler.ts';

test('AppError uses default user messages', () => {
  const err = new AppError(ErrorTypes.NETWORK, 'Network failed');
  assert.equal(err.type, ErrorTypes.NETWORK);
  assert.equal(err.userMessage, AppError.getDefaultUserMessage(ErrorTypes.NETWORK));
});

test('validators.cardIdentifier throws on invalid input', () => {
  assert.throws(
    () => validators.cardIdentifier(''),
    (error: unknown) => error instanceof AppError && error.type === ErrorTypes.VALIDATION
  );
});

test('withRetry returns after a successful retry', async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('fail');
      }
      return 'ok';
    },
    { maxAttempts: 3, delayMs: 1 }
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('safeSync returns default value on error', () => {
  const value = safeSync(
    () => {
      throw new Error('boom');
    },
    'sync failed',
    5
  );
  assert.equal(value, 5);
});

test('safeAsync returns default value on error', async () => {
  const value = await safeAsync(
    async () => {
      throw new Error('boom');
    },
    'async failed',
    7
  );
  assert.equal(value, 7);
});
