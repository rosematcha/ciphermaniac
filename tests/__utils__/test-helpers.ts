/**
 * Test helper utilities for the Ciphermaniac test suite.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import { generatedFileRegistry } from './mock-data-factory';

/**
 * Wait for an asynchronous condition to become true.
 * Polls at a small interval until timeout.
 * @param condition A function returning boolean or Promise<boolean>
 * @param timeout Maximum time in ms to wait (default 2000)
 */
export async function waitFor(condition: () => boolean | Promise<boolean>, timeout = 2000): Promise<void> {
  const start = Date.now();
  const interval = 30;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await Promise.resolve().then(() => condition());
    if (res) {
      return;
    }
    if (Date.now() - start >= timeout) {
      throw new Error(`waitFor: condition not met within ${timeout}ms`);
    }
    await sleep(interval);
  }
}

/**
 * Promise-based delay.
 * @param ms milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

type MockFetchResponse = {
  url?: string; // optional URL to match
  predicate?: (input: RequestInfo, init?: RequestInit) => boolean; // alternative matcher
  handler?: (
    input: RequestInfo,
    init?: RequestInit
  ) =>
    | Promise<{ status: number; body: any; headers?: Record<string, string> }>
    | { status: number; body: any; headers?: Record<string, string> }; // dynamic handler
  status?: number;
  headers?: Record<string, string>;
  body?: any; // will be JSON.stringified if object
};

let _originalFetch: typeof fetch | undefined;
let _currentMockResponses: MockFetchResponse[] | null = null;

/**
 * Mock global fetch with a deterministic set of responses.
 * Accepts either an array of responses (served in order) or a map keyed by URL.
 * @param responses Array of MockFetchResponse
 */
export function mockFetch(
  responses: MockFetchResponse | MockFetchResponse[] | Record<string, MockFetchResponse>
): void {
  if (typeof globalThis === 'undefined') {
    throw new Error('mockFetch: globalThis is not available in this environment');
  }

  if (!_originalFetch) {
    // Save original for restore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _originalFetch = (globalThis as any).fetch;
  }

  // Handle single MockFetchResponse object
  if (
    !Array.isArray(responses) &&
    (responses.predicate ||
      responses.handler ||
      responses.url ||
      responses.status !== undefined ||
      responses.body !== undefined)
  ) {
    _currentMockResponses = [responses as MockFetchResponse];
  } else if (!Array.isArray(responses)) {
    // convert map to list keyed by url
    _currentMockResponses = Object.keys(responses).map(k => ({
      ...(responses as Record<string, MockFetchResponse>)[k],
      url: k
    }));
  } else {
    _currentMockResponses = responses.slice();
  }

  // @ts-ignore replace global fetch
  (globalThis as any).fetch = async function (input: RequestInfo, init?: RequestInit) {
    const reqUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);

    if (!_currentMockResponses || _currentMockResponses.length === 0) {
      return new Response(null, { status: 404 });
    }

    // Try to find a matching response by predicate or url
    let idx = _currentMockResponses.findIndex(responseItem => {
      if (responseItem.predicate) {
        return responseItem.predicate(input, init);
      }
      if (responseItem.url) {
        return reqUrl === responseItem.url;
      }
      return false;
    });

    if (idx === -1) {
      idx = 0;
    } // fallback to first

    const resp = _currentMockResponses[idx];
    // If responses are ordered (no url/predicate), shift the first
    if (!resp.url && !resp.predicate) {
      _currentMockResponses.shift();
    }

    // Support dynamic handler for stateful responses (e.g. 429 then 200)
    if (resp.handler) {
      const handlerResult = await Promise.resolve(resp.handler(input, init));
      const handlerHeaders = new Headers(handlerResult.headers || {});
      if (
        !handlerHeaders.has('content-type') &&
        typeof handlerResult.body === 'string' &&
        handlerResult.body.startsWith('{')
      ) {
        handlerHeaders.set('content-type', 'application/json');
      }
      const handlerBody =
        handlerResult.body === undefined || handlerResult.body === null
          ? null
          : typeof handlerResult.body === 'string'
            ? handlerResult.body
            : JSON.stringify(handlerResult.body);
      return new Response(handlerBody, {
        status: handlerResult.status ?? 200,
        headers: handlerHeaders
      });
    }

    const headers = new Headers(resp.headers || {});
    const body =
      resp.body === undefined || resp.body === null
        ? null
        : typeof resp.body === 'string'
          ? resp.body
          : JSON.stringify(resp.body);

    return new Response(body, {
      status: resp.status ?? 200,
      headers
    });
  } as unknown as typeof fetch;
}

/**
 * Restore the original global fetch implementation.
 */
export function restoreFetch(): void {
  if (typeof globalThis === 'undefined') {
    return;
  }
  if (_originalFetch) {
    // @ts-ignore
    (globalThis as any).fetch = _originalFetch;
    _originalFetch = undefined;
  }
  _currentMockResponses = null;
}

/**
 * Remove generated test files that were registered by the mock data factory.
 * Ignores missing files and collects any other errors.
 */
export function cleanupTestData(): void {
  const errors: Error[] = [];
  for (const fp of Array.from(generatedFileRegistry)) {
    try {
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
      }
      generatedFileRegistry.delete(fp);
    } catch (err) {
      if (err instanceof Error) {
        errors.push(err);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`cleanupTestData: failed to remove ${errors.length} files. First error: ${errors[0].message}`);
  }
}

/**
 * Assert that a function throws (sync or async). Optionally check error type or message.
 * @param fn Function expected to throw
 * @param errorType Optional constructor of expected error (e.g. TypeError)
 */
export async function expectThrows(
  fn: () => unknown | Promise<unknown>,
  errorType?: new (...args: any[]) => Error
): Promise<void> {
  let threw = false;
  try {
    await Promise.resolve().then(() => fn());
  } catch (err) {
    threw = true;
    if (errorType && !(err instanceof errorType)) {
      assert.fail(`Expected error type ${(errorType as any).name} but got ${(err as Error).name}`);
    }
  }
  if (!threw) {
    assert.fail('Expected function to throw but it did not');
  }
}

/**
 * Deep clone an object for test isolation. Uses structuredClone when available.
 * @param obj Value to clone
 */
export function deepClone<T>(obj: T): T {
  // @ts-ignore
  if (typeof (globalThis as any).structuredClone === 'function') {
    // @ts-ignore
    return (globalThis as any).structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}

export default {
  waitFor,
  sleep,
  mockFetch,
  restoreFetch,
  cleanupTestData,
  expectThrows,
  deepClone
};
