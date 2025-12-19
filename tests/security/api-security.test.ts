/**
 * tests/security/api-security.test.ts
 * Security-focused tests for the feedback API endpoint.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMaliciousInput } from '../__utils__/mock-data-factory.js';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

// Import the feedback handler under test
import * as FeedbackModule from '../../functions/api/feedback.ts';

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
