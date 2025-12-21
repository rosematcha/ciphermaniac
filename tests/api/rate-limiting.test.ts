/**
 * tests/api/rate-limiting.test.ts
 * Tests for rate limiting functionality in the feedback endpoint
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';
import { _resetRateLimitStore, onRequestPost } from '../../functions/api/feedback.js';

// Reset rate limit store before each test to prevent cross-test interference
beforeEach(() => {
  _resetRateLimitStore();
  restoreFetch();
});

/**
 * Helper to build a Cloudflare-style Request for the feedback function
 */
function makeJsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://ciphermaniac.test/api/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

/**
 * Helper for valid feedback payload
 */
function validFeedbackPayload() {
  return {
    feedbackType: 'feature',
    feedbackText: 'Test feedback',
    followUp: 'no'
  };
}

// ============================================================================
// Rate limiting - Basic behavior
// ============================================================================

test('Rate limiting: allows first request from new IP', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const request = makeJsonRequest(validFeedbackPayload(), {
    'CF-Connecting-IP': '192.168.1.100'
  });

  const response = await onRequestPost({ request, env });
  assert.strictEqual(response.status, 200, 'First request should succeed');
});

test('Rate limiting: allows requests up to the limit (5 requests)', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const testIp = '10.0.0.50';

  // Make 5 requests (at limit)
  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload(), {
      'CF-Connecting-IP': testIp
    });
    const response = await onRequestPost({ request, env });
    assert.strictEqual(response.status, 200, `Request ${i + 1} should succeed`);
  }
});

test('Rate limiting: blocks 6th request from same IP with 429 status', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const testIp = '10.0.0.51';

  // Make 5 successful requests
  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload(), {
      'CF-Connecting-IP': testIp
    });
    await onRequestPost({ request, env });
  }

  // 6th request should be blocked
  const request = makeJsonRequest(validFeedbackPayload(), {
    'CF-Connecting-IP': testIp
  });
  const response = await onRequestPost({ request, env });

  assert.strictEqual(response.status, 429, 'Request over limit should return 429');

  const body = JSON.parse(await response.text());
  assert.ok(body.error, 'Should have error message');
  assert.ok(
    body.error.toLowerCase().includes('too many') || body.error.toLowerCase().includes('rate'),
    'Error should mention rate limiting'
  );
});

test('Rate limiting: includes Retry-After header when rate limited', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const testIp = '10.0.0.52';

  // Exhaust rate limit
  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload(), {
      'CF-Connecting-IP': testIp
    });
    await onRequestPost({ request, env });
  }

  // 6th request
  const request = makeJsonRequest(validFeedbackPayload(), {
    'CF-Connecting-IP': testIp
  });
  const response = await onRequestPost({ request, env });

  const retryAfter = response.headers.get('Retry-After');
  assert.ok(retryAfter, 'Should include Retry-After header');
  const retrySeconds = parseInt(retryAfter, 10);
  assert.ok(retrySeconds > 0, 'Retry-After should be positive');
  assert.ok(retrySeconds <= 3600, 'Retry-After should not exceed 1 hour');
});

// ============================================================================
// Rate limiting - IP isolation
// ============================================================================

test('Rate limiting: different IPs have independent limits', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const ip1 = '192.168.1.1';
  const ip2 = '192.168.1.2';

  // Exhaust limit for IP1
  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload(), {
      'CF-Connecting-IP': ip1
    });
    await onRequestPost({ request, env });
  }

  // IP1 is now blocked
  const blockedRequest = makeJsonRequest(validFeedbackPayload(), {
    'CF-Connecting-IP': ip1
  });
  const blockedResponse = await onRequestPost({ request: blockedRequest, env });
  assert.strictEqual(blockedResponse.status, 429, 'IP1 should be blocked');

  // IP2 should still be allowed
  const allowedRequest = makeJsonRequest(validFeedbackPayload(), {
    'CF-Connecting-IP': ip2
  });
  const allowedResponse = await onRequestPost({ request: allowedRequest, env });
  assert.strictEqual(allowedResponse.status, 200, 'IP2 should still be allowed');
});

// ============================================================================
// Rate limiting - Fallback IP headers
// ============================================================================

test('Rate limiting: uses X-Forwarded-For when CF-Connecting-IP is missing', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const testIp = '203.0.113.50';

  // Exhaust limit using X-Forwarded-For
  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload(), {
      'X-Forwarded-For': testIp
    });
    await onRequestPost({ request, env });
  }

  // 6th request should be blocked
  const request = makeJsonRequest(validFeedbackPayload(), {
    'X-Forwarded-For': testIp
  });
  const response = await onRequestPost({ request, env });
  assert.strictEqual(response.status, 429, 'Should be rate limited via X-Forwarded-For');
});

test('Rate limiting: falls back to "unknown" when no IP headers present', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;

  // Make requests without IP headers - all will share "unknown" bucket
  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload());
    await onRequestPost({ request, env });
  }

  // 6th request should be blocked
  const request = makeJsonRequest(validFeedbackPayload());
  const response = await onRequestPost({ request, env });
  assert.strictEqual(response.status, 429, 'Should be rate limited when no IP provided');
});

// ============================================================================
// Rate limiting - Reset behavior
// ============================================================================

test('Rate limiting: _resetRateLimitStore clears all limits', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const testIp = '10.0.0.99';

  // Exhaust limit
  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload(), {
      'CF-Connecting-IP': testIp
    });
    await onRequestPost({ request, env });
  }

  // Verify blocked
  const blockedRequest = makeJsonRequest(validFeedbackPayload(), {
    'CF-Connecting-IP': testIp
  });
  const blockedResponse = await onRequestPost({ request: blockedRequest, env });
  assert.strictEqual(blockedResponse.status, 429);

  // Reset the store
  _resetRateLimitStore();

  // Should be allowed again
  const allowedRequest = makeJsonRequest(validFeedbackPayload(), {
    'CF-Connecting-IP': testIp
  });
  const allowedResponse = await onRequestPost({ request: allowedRequest, env });
  assert.strictEqual(allowedResponse.status, 200, 'Should be allowed after reset');
});

// ============================================================================
// Rate limiting - Error handling
// ============================================================================

test('Rate limiting: applies before processing invalid requests', async () => {
  // No mock fetch needed - we won't reach the email sending step
  const env = { RESEND_API_KEY: 'sk_test' } as any;
  const testIp = '10.0.0.77';

  // Exhaust limit with valid requests
  mockFetch({
    predicate: () => true,
    status: 200,
    body: { id: 'ok' }
  });

  for (let i = 0; i < 5; i++) {
    const request = makeJsonRequest(validFeedbackPayload(), {
      'CF-Connecting-IP': testIp
    });
    await onRequestPost({ request, env });
  }

  restoreFetch();

  // Invalid request should still get 429 (rate limit checked first)
  const invalidRequest = makeJsonRequest(
    { invalid: 'payload' }, // Missing required fields
    { 'CF-Connecting-IP': testIp }
  );
  const response = await onRequestPost({ request: invalidRequest, env });

  // Rate limiting is checked before payload validation
  assert.strictEqual(response.status, 429, 'Rate limit should be checked before validation');
});
