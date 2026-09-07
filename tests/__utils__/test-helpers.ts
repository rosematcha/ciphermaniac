/**
 * Test helper utilities for the Ciphermaniac test suite.
 */

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
    (globalThis as any).fetch = _originalFetch;
    _originalFetch = undefined;
  }
  _currentMockResponses = null;
}

/**
 * Deep clone an object for test isolation. Uses structuredClone when available.
 * @param obj Value to clone
 */
export function deepClone<T>(obj: T): T {
  if (typeof (globalThis as any).structuredClone === 'function') {
    return (globalThis as any).structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}
