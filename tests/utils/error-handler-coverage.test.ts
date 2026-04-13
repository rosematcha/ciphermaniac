import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assert as appAssert,
  AppError,
  ErrorBoundary,
  ErrorTypes,
  safeAsync,
  safeFetch,
  safeSync,
  validateType,
  validators,
  withRetry
} from '../../src/utils/errorHandler.ts';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

// ---------------------------------------------------------------------------
// AppError – edge cases
// ---------------------------------------------------------------------------

test('AppError uses custom user message when provided', () => {
  const err = new AppError(ErrorTypes.NETWORK, 'internal', 'Custom message');
  assert.equal(err.userMessage, 'Custom message');
  assert.ok(err.timestamp > 0);
});

test('AppError.getDefaultUserMessage falls back for unknown type', () => {
  const msg = AppError.getDefaultUserMessage('UnknownType' as any);
  assert.equal(msg, 'Something went wrong. Please try again.');
});

test('AppError stores context', () => {
  const err = new AppError(ErrorTypes.TIMEOUT, 'timeout', null, { timeout: 5000 });
  assert.deepEqual(err.context, { timeout: 5000 });
});

// ---------------------------------------------------------------------------
// validators – additional coverage
// ---------------------------------------------------------------------------

test('validators.cardIdentifier rejects null', () => {
  assert.throws(() => validators.cardIdentifier(null), AppError);
});

test('validators.cardIdentifier rejects whitespace-only', () => {
  assert.throws(() => validators.cardIdentifier('   '), AppError);
});

test('validators.cardIdentifier rejects too-long string', () => {
  assert.throws(() => validators.cardIdentifier('a'.repeat(201)), AppError);
});

test('validators.cardIdentifier trims valid input', () => {
  assert.equal(validators.cardIdentifier('  Pikachu  '), 'Pikachu');
});

test('validators.tournament rejects non-string', () => {
  assert.throws(() => validators.tournament(null), AppError);
});

test('validators.tournament trims valid input', () => {
  assert.equal(validators.tournament('  Worlds  '), 'Worlds');
});

test('validators.array rejects non-array', () => {
  assert.throws(() => validators.array('not-array'), AppError);
});

test('validators.array rejects short array', () => {
  assert.throws(() => validators.array([1], 2), AppError);
});

test('validators.array returns valid array', () => {
  const result = validators.array([1, 2, 3], 2);
  assert.deepEqual(result, [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// assert helper
// ---------------------------------------------------------------------------

test('appAssert passes for truthy values', () => {
  appAssert(true);
  appAssert(1);
  appAssert('non-empty');
});

test('appAssert throws AppError for falsy values', () => {
  assert.throws(
    () => appAssert(false, 'custom message'),
    (err: unknown) => {
      return err instanceof AppError && err.message === 'custom message';
    }
  );
});

test('appAssert uses default message', () => {
  assert.throws(
    () => appAssert(0),
    (err: unknown) => {
      return err instanceof AppError && err.message === 'Assertion failed';
    }
  );
});

// ---------------------------------------------------------------------------
// validateType
// ---------------------------------------------------------------------------

test('validateType passes for matching type', () => {
  validateType('hello', 'string', 'name');
  validateType(42, 'number', 'count');
  validateType(true, 'boolean', 'flag');
});

test('validateType throws for mismatched type', () => {
  assert.throws(() => validateType(42, 'string', 'name'), AppError);
});

test('validateType handles array type', () => {
  validateType([1, 2], 'array', 'items');
});

test('validateType throws for non-array when array expected', () => {
  assert.throws(
    () => validateType('not-array', 'array', 'items'),
    (err: unknown) => {
      return err instanceof AppError && err.message.includes('items must be array');
    }
  );
});

// ---------------------------------------------------------------------------
// safeSync – argument parsing variants
// ---------------------------------------------------------------------------

test('safeSync returns result on success (no extra args)', () => {
  const result = safeSync(() => 42);
  assert.equal(result, 42);
});

test('safeSync returns null on error (no extra args)', () => {
  const result = safeSync(() => {
    throw new Error('boom');
  });
  assert.equal(result, null);
});

test('safeSync with 2 args – default value (non-string)', () => {
  const result = safeSync(() => {
    throw new Error('boom');
  }, 99);
  assert.equal(result, 99);
});

test('safeSync with 2 args – error message (string)', () => {
  const result = safeSync(() => {
    throw new Error('boom');
  }, 'custom error');
  assert.equal(result, null);
});

test('safeSync with 3 args – defaultValue first, errorMessage second', () => {
  const result = safeSync(
    () => {
      throw new Error('boom');
    },
    77,
    'error msg'
  );
  assert.equal(result, 77);
});

// ---------------------------------------------------------------------------
// safeAsync – argument parsing variants
// ---------------------------------------------------------------------------

test('safeAsync returns result on success (no extra args)', async () => {
  const result = await safeAsync(async () => 42);
  assert.equal(result, 42);
});

test('safeAsync returns null on error (no extra args)', async () => {
  const result = await safeAsync(async () => {
    throw new Error('boom');
  });
  assert.equal(result, null);
});

test('safeAsync with 2 args – default value (non-string)', async () => {
  const result = await safeAsync(async () => {
    throw new Error('boom');
  }, 99);
  assert.equal(result, 99);
});

test('safeAsync with 2 args – error message (string)', async () => {
  const result = await safeAsync(async () => {
    throw new Error('boom');
  }, 'custom error');
  assert.equal(result, null);
});

test('safeAsync with 3 args – defaultValue first, errorMessage second', async () => {
  const result = await safeAsync(
    async () => {
      throw new Error('boom');
    },
    77,
    'error msg'
  );
  assert.equal(result, 77);
});

// ---------------------------------------------------------------------------
// withRetry – shouldRetry callback
// ---------------------------------------------------------------------------

test('withRetry stops early when shouldRetry returns false', async () => {
  let attempts = 0;
  await assert.rejects(async () => {
    await withRetry(
      async () => {
        attempts++;
        throw new Error('permanent');
      },
      { maxAttempts: 5, delayMs: 1, shouldRetry: () => false }
    );
  });
  assert.equal(attempts, 1);
});

test('withRetry calls onAttemptFail callback', async () => {
  const failures: number[] = [];
  await assert.rejects(async () => {
    await withRetry(
      async () => {
        throw new Error('fail');
      },
      { maxAttempts: 2, delayMs: 1, onAttemptFail: (_err, attempt) => failures.push(attempt) }
    );
  });
  assert.deepEqual(failures, [1, 2]);
});

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

test('ErrorBoundary.showLoading sets container HTML', () => {
  const container = { innerHTML: '', querySelector: () => null } as unknown as HTMLElement;
  const boundary = new ErrorBoundary(container);
  boundary.showLoading('Loading data...');
  assert.ok(container.innerHTML.includes('Loading data...'));
});

test('ErrorBoundary.showLoading does nothing with null container', () => {
  const boundary = new ErrorBoundary(null);
  boundary.showLoading('Loading...');
  // no error thrown
});

test('ErrorBoundary.showError renders error message', () => {
  const container = { innerHTML: '', querySelector: () => null } as unknown as HTMLElement;
  const boundary = new ErrorBoundary(container, { showRetryButton: false, showErrorDetails: false });
  boundary.showError(new AppError(ErrorTypes.NETWORK, 'net fail'));
  assert.ok(container.innerHTML.includes('error-state'));
  assert.ok(container.innerHTML.includes('Connection problem'));
});

test('ErrorBoundary.showError renders retry button and details when enabled', () => {
  const mockBtn = { addEventListener: () => {} };
  const container = {
    innerHTML: '',
    querySelector: (sel: string) => (sel === '.error-retry-btn' ? mockBtn : null)
  } as unknown as HTMLElement;
  const boundary = new ErrorBoundary(container, { showRetryButton: true, showErrorDetails: true });
  boundary.showError(new Error('some error'));
  assert.ok(container.innerHTML.includes('error-retry-btn'));
  assert.ok(container.innerHTML.includes('error-details'));
});

test('ErrorBoundary.showError does nothing with null container', () => {
  const boundary = new ErrorBoundary(null);
  boundary.showError(new Error('fail'));
  // no error thrown
});

test('ErrorBoundary.clearError removes error and loading states', () => {
  let removed = 0;
  const container = {
    innerHTML: '',
    querySelector: (sel: string) => {
      if (sel === '.error-state' || sel === '.loading-state') {
        return {
          remove: () => {
            removed++;
          }
        };
      }
      return null;
    }
  } as unknown as HTMLElement;
  const boundary = new ErrorBoundary(container);
  boundary.clearError();
  assert.equal(removed, 2);
});

test('ErrorBoundary.clearError does nothing with null container', () => {
  const boundary = new ErrorBoundary(null);
  boundary.clearError();
});

test('ErrorBoundary.sleep resolves after delay', async () => {
  const boundary = new ErrorBoundary(null);
  const start = Date.now();
  await boundary.sleep(10);
  assert.ok(Date.now() - start >= 5);
});

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

test('safeFetch returns response on success', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { ok: true }
  });

  const response = await safeFetch('https://example.com/api', { timeout: 5000, retries: 0 });
  assert.equal(response.status, 200);
  restoreFetch();
});

test('safeFetch throws AppError for non-ok response (404)', async () => {
  mockFetch({
    predicate: () => true,
    status: 404,
    headers: { 'content-type': 'text/plain' },
    body: 'Not Found'
  });

  await assert.rejects(
    async () => safeFetch('https://example.com/missing', { timeout: 5000, retries: 0 }),
    (err: unknown) => err instanceof AppError && err.context?.status === 404
  );
  restoreFetch();
});

test('safeFetch throws AppError for 500 server error', async () => {
  mockFetch({
    predicate: () => true,
    status: 500,
    headers: { 'content-type': 'text/plain' },
    body: 'Internal Server Error'
  });

  await assert.rejects(
    async () => safeFetch('https://example.com/error', { timeout: 5000, retries: 0 }),
    (err: unknown) => err instanceof AppError && err.userMessage.includes('Server')
  );
  restoreFetch();
});

test('cleanup error-handler-coverage', () => {
  restoreFetch();
});
