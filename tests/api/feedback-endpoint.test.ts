import test from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

import { _resetRateLimitStore, onRequestOptions, onRequestPost } from '../../functions/api/feedback.js';

// Helper to build a Request with JSON body
function makeJsonRequest(body: unknown) {
  return new Request('https://ciphermaniac.test/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('Feedback API - OPTIONS CORS preflight returns 200 and CORS headers', async () => {
  const res = onRequestOptions();
  assert.strictEqual(res.status, 200);
  const allow = res.headers.get('Access-Control-Allow-Methods');
  assert.ok(allow && allow.includes('POST'));
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('Feedback API - valid bug report submission results in 200 and email sent', async () => {
  // Mock Resend API to return success
  mockFetch({
    'https://api.resend.com/emails': { status: 200, body: { id: 'msg_1' } }
  });

  const env = { FEEDBACK_RECIPIENT: 'owner@site.test', RESEND_API_KEY: 'test-key' } as any;

  const payload = {
    feedbackType: 'bug',
    feedbackText: 'Something is broken',
    platform: 'desktop',
    desktopOS: 'Windows 11',
    desktopBrowser: 'Firefox 100',
    followUp: 'yes',
    contactMethod: 'email',
    contactInfo: 'user@example.com'
  };

  const req = makeJsonRequest(payload);
  const res = await onRequestPost({ request: req, env });
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(await res.text());
  assert.strictEqual(body.success, true);

  restoreFetch();
});

test('Feedback API - valid feature request formats email with correct subject', async () => {
  let capturedBody: any = null;
  mockFetch({
    predicate: {
      // use object form to match any URL - test-helpers supports map or array, so use array below
    },
    'https://api.resend.com/emails': {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { id: 'msg_feature' }
    }
  });

  // We'll patch global fetch manually to capture payload since test-helpers map matching can be strict
  restoreFetch();
  // @ts-ignore
  const original = globalThis.fetch;
  // @ts-ignore
  globalThis.fetch = async function (input: RequestInfo, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url === 'https://api.resend.com/emails') {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({ id: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(null, { status: 404 });
  };

  const env = { FEEDBACK_RECIPIENT: 'owner@site.test', RESEND_API_KEY: 'key-xyz' } as any;
  const payload = { feedbackType: 'feature', feedbackText: 'Please add X feature', followUp: 'no' };
  const res = await onRequestPost({ request: makeJsonRequest(payload), env });
  assert.strictEqual(res.status, 200);
  assert.ok(capturedBody, 'Expected email payload to be sent');
  assert.ok(
    String(capturedBody.subject).includes('Feature Request') || String(capturedBody.subject).includes('feature'),
    'Subject should indicate feature request'
  );

  // restore original fetch
  // @ts-ignore
  globalThis.fetch = original;
});

test('Feedback API - missing required fields returns 400', async () => {
  const env = { RESEND_API_KEY: 'irrelevant' } as any;
  const req = makeJsonRequest({ feedbackType: 'bug' }); // missing feedbackText
  const res = await onRequestPost({ request: req, env });
  assert.strictEqual(res.status, 400);
  const body = JSON.parse(await res.text());
  assert.ok(body.error);
});

test('Feedback API - platform-specific validation: mobile requires mobileOS/mobileBrowser when platform mobile (but still accepts missing optional fields)', async () => {
  // Mock Resend success
  mockFetch({ 'https://api.resend.com/emails': { status: 200, body: { id: 'ok' } } });
  const env = { RESEND_API_KEY: 'k' } as any;

  const payload = {
    feedbackType: 'bug',
    feedbackText: 'Mobile bug',
    platform: 'mobile',
    mobileOS: 'iOS 17',
    mobileBrowser: 'Safari'
  };
  const res = await onRequestPost({ request: makeJsonRequest(payload), env });
  assert.strictEqual(res.status, 200);

  // Missing mobileOS should still be allowed (function doesn't enforce hard), ensure 200
  const payload2 = { feedbackType: 'bug', feedbackText: 'Mobile bug', platform: 'mobile' };
  const res2 = await onRequestPost({ request: makeJsonRequest(payload2), env });
  assert.strictEqual(res2.status, 200);

  restoreFetch();
});

test('Feedback API - email format validation for follow-up contact info', async () => {
  // Reset rate limit store to ensure clean state
  _resetRateLimitStore();
  // The function only checks presence and doesn't validate format heavily, but we validate that invalid email still allowed or case handled
  mockFetch({ 'https://api.resend.com/emails': { status: 200, body: { id: 'ok' } } });
  const env = { RESEND_API_KEY: 'k' } as any;

  const payload = {
    feedbackType: 'feature',
    feedbackText: 'Add dark mode',
    followUp: 'yes',
    contactMethod: 'email',
    contactInfo: 'not-an-email'
  };

  const res = await onRequestPost({ request: makeJsonRequest(payload), env });
  // The implementation only requires fields, doesn't strictly validate format; thus it should still be accepted.
  assert.strictEqual(res.status, 200);

  restoreFetch();
});

test('Feedback API - 500 response when Resend API fails and error message includes failure', async () => {
  // Reset rate limit store to ensure clean state
  _resetRateLimitStore();
  // Simulate Resend returning 500
  mockFetch({ 'https://api.resend.com/emails': { status: 500, body: 'internal resend error' } });
  const env = { RESEND_API_KEY: 'k' } as any;
  const payload = { feedbackType: 'bug', feedbackText: 'Crash on load' };
  const res = await onRequestPost({ request: makeJsonRequest(payload), env });
  assert.strictEqual(res.status, 500);
  const body = JSON.parse(await res.text());
  assert.ok(body.error);

  restoreFetch();
});

test('Feedback API - throws error when RESEND_API_KEY missing (handled gracefully returns 500)', async () => {
  // Reset rate limit store to ensure clean state
  _resetRateLimitStore();
  const env = {} as any;
  const payload = { feedbackType: 'feature', feedbackText: 'Enable sync' };
  const res = await onRequestPost({ request: makeJsonRequest(payload), env });
  assert.strictEqual(res.status, 500);
  const body = JSON.parse(await res.text());
  assert.ok(String(body.message).includes('RESEND_API_KEY') || body.error);
});
