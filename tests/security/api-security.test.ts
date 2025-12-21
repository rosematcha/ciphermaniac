/**
 * tests/security/api-security.test.ts
 * Security-focused tests for API endpoints including feedback, cron auth, and thumbnails.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateMaliciousInput } from '../__utils__/mock-data-factory.js';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

// Import the feedback handler under test
import * as FeedbackModule from '../../functions/api/feedback.ts';

// Import cron handler for authentication tests
import * as CronModule from '../../functions/_cron/online-meta.ts';

// Import thumbnail handler for path validation tests
import * as ThumbnailModule from '../../functions/thumbnails/[[path]].ts';

// Reset rate limit store before each test to prevent cross-test interference
beforeEach(() => {
  FeedbackModule._resetRateLimitStore();
  restoreFetch();
});

/**
 * Helper to build a Cloudflare-style Request for the function
 */
function makeJsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://ciphermaniac.test/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

// ============================================================================
// Feedback API Security Tests
// ============================================================================

/**
 * Test: Ensure preflight OPTIONS returns expected CORS headers.
 */
test('Feedback API: OPTIONS preflight returns CORS headers', async () => {
  const resp = FeedbackModule.onRequestOptions();
  assert.equal(resp.status, 200);
  const allowOrigin = resp.headers.get('Access-Control-Allow-Origin');
  assert.equal(allowOrigin, '*');
  const allowMethods = resp.headers.get('Access-Control-Allow-Methods');
  assert.ok(allowMethods && allowMethods.includes('POST'));
});

/**
 * Test: malformed JSON and invalid content types should be rejected
 */
test('Feedback API: rejects malformed JSON and invalid Content-Type', async () => {
  const badJsonReq = new Request('https://ciphermaniac.test/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Intentionally malformed JSON
    body: '{invalidJson: true,'
  });

  const badResp = await FeedbackModule.onRequestPost({ request: badJsonReq, env: {} as any });
  assert.equal(badResp.status, 400);
  const badBody = JSON.parse(await badResp.text());
  assert.ok(badBody.error);

  const plainReq = new Request('https://ciphermaniac.test/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'feedback'
  });
  const plainResp = await FeedbackModule.onRequestPost({ request: plainReq, env: {} as any });
  assert.equal(plainResp.status, 400);
});

/**
 * Test XSS and script tag sanitization by observing the content sent to the email provider.
 * The feedback handler builds a plaintext email and forwards it via Resend API. We mock
 * the outbound fetch to capture the `body` sent. The secure expectation is that
 * user-supplied HTML/script content is neutralized before being forwarded.
 */
test('Feedback API: neutralizes XSS and script tags in outgoing email payload', async () => {
  const malicious = generateMaliciousInput('xss').payload as string;
  let capturedBodyText: string | null = null;

  mockFetch([
    {
      predicate: (_input, init) => {
        // capture the body that would be POSTed to the external mail API
        try {
          if (init && typeof (init as any).body === 'string') {
            capturedBodyText = (init as any).body as string;
          }
        } catch {
          // ignore
        }
        return true;
      },
      status: 200,
      body: { id: 'mocked-email' }
    }
  ]);

  const payload = {
    feedbackType: 'feature',
    feedbackText: `User says: ${malicious}`,
    followUp: 'no'
  };

  const req = makeJsonRequest(payload);
  const env = { RESEND_API_KEY: 'sk_test_mock' } as any;

  const resp = await FeedbackModule.onRequestPost({ request: req, env });
  assert.equal(resp.status, 200, 'Expected successful response when mail provider accepts request');

  // We expect the outgoing email payload (JSON string) to NOT contain raw script tags or angle brackets
  assert.ok(capturedBodyText !== null, 'Outbound email body should have been captured by mockFetch');
  if (capturedBodyText) {
    const lower = capturedBodyText.toLowerCase();
    // The secure expectation (test assertion) is that script tags are neutralized
    assert.equal(lower.includes('<script>'), false, 'Outbound email should not contain literal <script> tags');
    assert.equal(lower.includes('</script>'), false, 'Outbound email should not contain literal </script> tags');
    // Also expect that common XSS sequences are either encoded or stripped
    assert.equal(lower.includes("alert('xss')"), false, 'Outbound email should not contain direct JS payloads');
  }

  restoreFetch();
});

/**
 * Email header injection should be prevented: contactInfo must not inject additional headers
 */
test('Feedback API: prevents email header injection via contactInfo', async () => {
  let capturedBodyText: string | null = null;
  mockFetch([
    {
      predicate: (_input, init) => {
        capturedBodyText = (init as any)?.body as string;
        return true;
      },
      status: 200,
      body: { id: 'ok' }
    }
  ]);

  const contact = 'attacker@example.com\nBcc: victim@example.com';
  const payload = {
    feedbackType: 'bug',
    feedbackText: 'Something broke',
    followUp: 'yes',
    contactMethod: 'email',
    contactInfo: contact,
    platform: 'desktop'
  };

  const req = makeJsonRequest(payload);
  const env = { RESEND_API_KEY: 'sk_safe' } as any;

  const resp = await FeedbackModule.onRequestPost({ request: req, env });
  assert.equal(resp.status, 200);
  // Secure expectation: no raw header injection patterns inside the email text payload
  assert.ok(capturedBodyText !== null);
  if (capturedBodyText) {
    const decoded = capturedBodyText;
    assert.equal(decoded.includes('\nBcc:'), false, 'Outbound email must not contain injected Bcc header');
    assert.equal(decoded.includes('\r\nBcc:'), false, 'Outbound email must not contain CRLF-injected Bcc header');
  }

  restoreFetch();
});

/**
 * Test that API does not echo secrets such as API keys when a downstream service returns an error message
 */
test('Feedback API: does not expose API keys from downstream errors', async () => {
  // Simulate downstream provider returning an error body that contains sensitive token material
  const leakedKey = 'Bearer sk_live_SUPER_SECRET_KEY_12345';
  mockFetch([
    {
      predicate: (input, _init) => typeof input === 'string' && input.includes('api.resend.com'),
      status: 401,
      body: leakedKey
    }
  ]);

  const payload = {
    feedbackType: 'feature',
    feedbackText: 'Test secret leakage',
    followUp: 'no'
  };

  const req = makeJsonRequest(payload);
  const env = { RESEND_API_KEY: 'sk_set_but_downstream_leaks' } as any;

  const resp = await FeedbackModule.onRequestPost({ request: req, env });
  // The function is expected to catch and return 500 on downstream failure
  assert.equal(resp.status, 500);
  const text = await resp.text();
  // Secure expectation: response body should NOT contain leaked key material
  assert.equal(text.includes('SUPER_SECRET_KEY_12345'), false, 'Error response must not echo downstream secrets');

  restoreFetch();
});

/**
 * Unicode handling and size tests: ensure unicode payloads are preserved and very large bodies handled safely
 */
test('Feedback API: handles unicode characters and enforces size limits', async () => {
  let captured: string | null = null;
  mockFetch([
    {
      predicate: (_i, init) => {
        captured = (init as any)?.body as string;
        return true;
      },
      status: 200,
      body: { id: 'ok' }
    }
  ]);

  const unicode = '反馈: 👍🏽 — 漢字 — emoji — 😊';
  const payload = {
    feedbackType: 'feature',
    feedbackText: unicode,
    followUp: 'no'
  };

  const req = makeJsonRequest(payload);
  const env = { RESEND_API_KEY: 'sk_unicode' } as any;

  const resp = await FeedbackModule.onRequestPost({ request: req, env });
  assert.equal(resp.status, 200);
  assert.ok(captured && captured.includes(unicode), 'Unicode content should be preserved in outgoing email text');

  // Test extremely large body (>1MB). The secure expectation is that the API rejects overly large submissions.
  const largeString = 'A'.repeat(1024 * 1024 + 100); // ~1MB + 100 bytes
  const largeReq = new Request('https://ciphermaniac.test/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackType: 'feature', feedbackText: largeString })
  });

  const largeResp = await FeedbackModule.onRequestPost({ request: largeReq, env });
  // Secure expectation: the server should reject the large payload (413 or 400). We assert it here so failures will flag.
  assert.ok([413, 400].includes(largeResp.status), `Large payload should be rejected; got ${largeResp.status}`);

  restoreFetch();
});

// ============================================================================
// Cron Authentication Tests (X-Cron-Secret header validation)
// ============================================================================

/**
 * Test: Cron endpoint rejects requests without X-Cron-Secret header
 */
test('Cron API: rejects request without X-Cron-Secret header', async () => {
  const request = new Request('https://ciphermaniac.test/_cron/online-meta', {
    method: 'GET'
  });

  const env = { CRON_SECRET: 'secret-key-123' } as any;

  const response = await CronModule.onRequestGet({ request, env });
  assert.strictEqual(response.status, 401, 'Should reject missing auth header');

  const body = JSON.parse(await response.text());
  assert.ok(body.error, 'Should have error message');
  assert.ok(body.error.toLowerCase().includes('unauthorized'), 'Error should indicate unauthorized');
});

/**
 * Test: Cron endpoint rejects requests with incorrect X-Cron-Secret
 */
test('Cron API: rejects request with incorrect X-Cron-Secret', async () => {
  const request = new Request('https://ciphermaniac.test/_cron/online-meta', {
    method: 'GET',
    headers: {
      'X-Cron-Secret': 'wrong-secret'
    }
  });

  const env = { CRON_SECRET: 'correct-secret-456' } as any;

  const response = await CronModule.onRequestGet({ request, env });
  assert.strictEqual(response.status, 401, 'Should reject incorrect secret');
});

/**
 * Test: Cron endpoint rejects requests when CRON_SECRET is not configured (fail secure)
 */
test('Cron API: rejects request when CRON_SECRET env var not configured', async () => {
  const request = new Request('https://ciphermaniac.test/_cron/online-meta', {
    method: 'GET',
    headers: {
      'X-Cron-Secret': 'any-secret'
    }
  });

  // No CRON_SECRET in env - should fail secure
  const env = {} as any;

  const response = await CronModule.onRequestGet({ request, env });
  assert.strictEqual(response.status, 401, 'Should deny when secret not configured');

  const body = JSON.parse(await response.text());
  assert.ok(body.error.includes('not configured'), 'Should indicate secret not configured');
});

/**
 * Test: Cron endpoint rejects empty X-Cron-Secret header
 */
test('Cron API: rejects empty X-Cron-Secret header', async () => {
  const request = new Request('https://ciphermaniac.test/_cron/online-meta', {
    method: 'GET',
    headers: {
      'X-Cron-Secret': ''
    }
  });

  const env = { CRON_SECRET: 'valid-secret' } as any;

  const response = await CronModule.onRequestGet({ request, env });
  assert.strictEqual(response.status, 401, 'Should reject empty secret');
});

// ============================================================================
// Thumbnail Path Validation Tests
// ============================================================================

/**
 * Helper to create a thumbnail request
 */
function makeThumbnailRequest(path: string): Request {
  return new Request(`https://ciphermaniac.test${path}`, {
    method: 'GET'
  });
}

/**
 * Test: Thumbnail endpoint validates path format
 */
test('Thumbnail API: rejects invalid path format', async () => {
  // Missing parts
  const request = makeThumbnailRequest('/thumbnails/sm/TEF');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject path with missing number');
  const text = await response.text();
  assert.ok(text.includes('Invalid path format'), 'Error should mention path format');
});

/**
 * Test: Thumbnail endpoint validates size parameter
 */
test('Thumbnail API: rejects invalid size parameter', async () => {
  const request = makeThumbnailRequest('/thumbnails/large/TEF/123');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject invalid size');
  const text = await response.text();
  assert.ok(text.includes('Invalid size'), 'Error should mention invalid size');
});

/**
 * Test: Thumbnail endpoint validates set code format
 */
test('Thumbnail API: rejects invalid set code format', async () => {
  // Set code with special characters (potential path traversal)
  const request = makeThumbnailRequest('/thumbnails/sm/../TEF/123');
  const response = await ThumbnailModule.onRequest({ request });
  // The path parsing will result in different path parts
  assert.ok([400, 404].includes(response.status), 'Should reject malformed set code');
});

test('Thumbnail API: rejects set code with invalid characters', async () => {
  // Set code too long
  const request = makeThumbnailRequest('/thumbnails/sm/TOOLONGSETCODE/123');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject set code > 8 chars');

  // Set code too short
  const request2 = makeThumbnailRequest('/thumbnails/sm/X/123');
  const response2 = await ThumbnailModule.onRequest({ request: request2 });
  assert.strictEqual(response2.status, 400, 'Should reject set code < 2 chars');
});

/**
 * Test: Thumbnail endpoint validates card number format
 */
test('Thumbnail API: rejects invalid card number format', async () => {
  // Non-numeric card number with invalid chars
  const request = makeThumbnailRequest('/thumbnails/sm/TEF/abc!@#');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject invalid card number');
});

/**
 * Test: Thumbnail endpoint handles path traversal attempts
 */
test('Thumbnail API: prevents path traversal attacks', async () => {
  // Attempt to traverse outside allowed paths
  const traversalPaths = [
    '/thumbnails/sm/../../etc/passwd',
    '/thumbnails/sm/TEF/../../../secret/123',
    '/thumbnails/sm/TEF/..%2F..%2Fetc/passwd'
  ];

  for (const path of traversalPaths) {
    const request = makeThumbnailRequest(path);
    const response = await ThumbnailModule.onRequest({ request });
    // Should either reject or result in 404 - never serve external files
    assert.ok([400, 404].includes(response.status), `Path traversal attempt should be blocked: ${path}`);
  }
});

/**
 * Test: Thumbnail OPTIONS returns proper CORS headers
 */
test('Thumbnail API: OPTIONS preflight returns CORS headers', async () => {
  const response = await ThumbnailModule.onRequestOptions();
  assert.strictEqual(response.status, 204);
  assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(response.headers.get('Access-Control-Allow-Methods')?.includes('GET'));
});

/**
 * Test: Thumbnail endpoint accepts valid paths
 */
test('Thumbnail API: accepts valid sm/xs sizes', async () => {
  // Mock fetch to simulate CDN response
  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      return urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com');
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  // Test 'sm' size
  const smRequest = makeThumbnailRequest('/thumbnails/sm/TEF/123');
  const smResponse = await ThumbnailModule.onRequest({ request: smRequest });
  assert.strictEqual(smResponse.status, 200, 'Should accept sm size');

  restoreFetch();

  // Mock again for xs
  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      return urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com');
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  // Test 'xs' size
  const xsRequest = makeThumbnailRequest('/thumbnails/xs/PAL/45');
  const xsResponse = await ThumbnailModule.onRequest({ request: xsRequest });
  assert.strictEqual(xsResponse.status, 200, 'Should accept xs size');

  restoreFetch();
});

/**
 * Test: Thumbnail endpoint normalizes card numbers correctly
 */
test('Thumbnail API: handles card number normalization', async () => {
  mockFetch({
    predicate: (url, _init) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      // Verify the normalized URL format
      return urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com');
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  // Card number with leading zeros
  const request = makeThumbnailRequest('/thumbnails/sm/TEF/007');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 200, 'Should handle leading zeros');

  restoreFetch();
});

/**
 * Test: Thumbnail endpoint handles card numbers with letter suffixes
 */
test('Thumbnail API: accepts card numbers with letter suffix', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  // Card number with letter suffix (e.g., 123a, 45GG)
  const request = makeThumbnailRequest('/thumbnails/sm/TEF/123a');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 200, 'Should accept card number with suffix');

  restoreFetch();
});
