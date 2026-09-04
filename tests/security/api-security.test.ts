import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateMaliciousInput } from '../__utils__/mock-data-factory.js';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

import * as FeedbackModule from '../../functions/api/feedback.ts';
import * as ThumbnailModule from '../../functions/thumbnails/[[path]].ts';
import * as SpriteModule from '../../functions/sprites/[[path]].ts';

beforeEach(() => {
  FeedbackModule._resetRateLimitStore();
  restoreFetch();
});

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

test('Feedback API: OPTIONS preflight returns CORS headers', async () => {
  const resp = FeedbackModule.onRequestOptions();
  assert.equal(resp.status, 200);
  const allowOrigin = resp.headers.get('Access-Control-Allow-Origin');
  assert.equal(allowOrigin, '*');
  const allowMethods = resp.headers.get('Access-Control-Allow-Methods');
  assert.ok(allowMethods && allowMethods.includes('POST'));
});

test('Feedback API: rejects malformed JSON and invalid Content-Type', async () => {
  const badJsonReq = new Request('https://ciphermaniac.test/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

test('Feedback API: neutralizes XSS and script tags in outgoing email payload', async () => {
  const malicious = generateMaliciousInput('xss').payload as string;
  let capturedBodyText = null as string | null;

  mockFetch([
    {
      predicate: (_input, init) => {
        if (typeof init?.body === 'string') {
          capturedBodyText = init.body;
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

  assert.ok(capturedBodyText !== null, 'Outbound email body should have been captured by mockFetch');
  if (capturedBodyText) {
    const lower = capturedBodyText.toLowerCase();
    assert.equal(lower.includes('<script>'), false, 'Outbound email should not contain literal <script> tags');
    assert.equal(lower.includes('</script>'), false, 'Outbound email should not contain literal </script> tags');
    assert.equal(lower.includes("alert('xss')"), false, 'Outbound email should not contain direct JS payloads');
  }

  restoreFetch();
});

test('Feedback API: prevents email header injection via contactInfo', async () => {
  let capturedBodyText = null as string | null;
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
  assert.ok(capturedBodyText !== null);
  if (capturedBodyText) {
    assert.equal(capturedBodyText.includes('\nBcc:'), false, 'Outbound email must not contain injected Bcc header');
    assert.equal(
      capturedBodyText.includes('\r\nBcc:'),
      false,
      'Outbound email must not contain CRLF-injected Bcc header'
    );
  }

  restoreFetch();
});

test('Feedback API: does not expose API keys from downstream errors', async () => {
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
  assert.equal(resp.status, 500);
  const text = await resp.text();
  assert.equal(text.includes('SUPER_SECRET_KEY_12345'), false, 'Error response must not echo downstream secrets');

  restoreFetch();
});

test('Feedback API: handles unicode characters and enforces size limits', async () => {
  let captured = null as string | null;
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

  const largeString = 'A'.repeat(1024 * 1024 + 100);
  const largeReq = new Request('https://ciphermaniac.test/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedbackType: 'feature', feedbackText: largeString })
  });

  const largeResp = await FeedbackModule.onRequestPost({ request: largeReq, env });
  assert.ok([413, 400].includes(largeResp.status), `Large payload should be rejected; got ${largeResp.status}`);

  restoreFetch();
});

function makeThumbnailRequest(path: string): Request {
  return new Request(`https://ciphermaniac.test${path}`, {
    method: 'GET'
  });
}

test('Thumbnail API: rejects invalid path format', async () => {
  const request = makeThumbnailRequest('/thumbnails/sm/TEF');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject path with missing number');
  const text = await response.text();
  assert.ok(text.includes('Invalid path format'), 'Error should mention path format');
});

test('Thumbnail API: rejects invalid size parameter', async () => {
  const request = makeThumbnailRequest('/thumbnails/large/TEF/123');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject invalid size');
  const text = await response.text();
  assert.ok(text.includes('Invalid size'), 'Error should mention invalid size');
});

test('Thumbnail API: rejects invalid set code format', async () => {
  const request = makeThumbnailRequest('/thumbnails/sm/../TEF/123');
  const response = await ThumbnailModule.onRequest({ request });
  assert.ok([400, 404].includes(response.status), 'Should reject malformed set code');
});

test('Thumbnail API: rejects set code with invalid characters', async () => {
  const request = makeThumbnailRequest('/thumbnails/sm/TOOLONGSETCODE/123');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject set code > 8 chars');

  const request2 = makeThumbnailRequest('/thumbnails/sm/X/123');
  const response2 = await ThumbnailModule.onRequest({ request: request2 });
  assert.strictEqual(response2.status, 400, 'Should reject set code < 2 chars');
});

test('Thumbnail API: rejects invalid card number format', async () => {
  const request = makeThumbnailRequest('/thumbnails/sm/TEF/abc!@#');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 400, 'Should reject invalid card number');
});

test('Thumbnail API: prevents path traversal attacks', async () => {
  const traversalPaths = [
    '/thumbnails/sm/../../etc/passwd',
    '/thumbnails/sm/TEF/../../../secret/123',
    '/thumbnails/sm/TEF/..%2F..%2Fetc/passwd'
  ];

  for (const path of traversalPaths) {
    const request = makeThumbnailRequest(path);
    const response = await ThumbnailModule.onRequest({ request });
    assert.ok([400, 404].includes(response.status), `Path traversal attempt should be blocked: ${path}`);
  }
});

test('Thumbnail API: OPTIONS preflight returns CORS headers', async () => {
  const response = await ThumbnailModule.onRequestOptions();
  assert.strictEqual(response.status, 204);
  assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(response.headers.get('Access-Control-Allow-Methods')?.includes('GET'));
});

test('Sprite API: rejects invalid slugs', async () => {
  const response = await SpriteModule.onRequest({ request: makeThumbnailRequest('/sprites/../mew.png') });
  assert.strictEqual(response.status, 400);
});

test('Sprite API: falls back and returns an immutable, CORS-open image', async () => {
  mockFetch([
    { status: 404 },
    {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream', 'Set-Cookie': 'blocked=1', Vary: 'Origin' },
      body: 'fake-image-data'
    }
  ]);

  const response = await SpriteModule.onRequest({ request: makeThumbnailRequest('/sprites/mew.png') });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers.get('Content-Type'), 'image/png');
  assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.strictEqual(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.strictEqual(response.headers.get('Set-Cookie'), null);
  assert.strictEqual(response.headers.get('Vary'), null);
});

test('Thumbnail API: accepts valid sm/xs sizes', async () => {
  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      return urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com');
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const smRequest = makeThumbnailRequest('/thumbnails/sm/TEF/123');
  const smResponse = await ThumbnailModule.onRequest({ request: smRequest });
  assert.strictEqual(smResponse.status, 200, 'Should accept sm size');

  restoreFetch();

  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      return urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com');
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const xsRequest = makeThumbnailRequest('/thumbnails/xs/PAL/45');
  const xsResponse = await ThumbnailModule.onRequest({ request: xsRequest });
  assert.strictEqual(xsResponse.status, 200, 'Should accept xs size');

  restoreFetch();
});

test('Thumbnail API: accepts trainer gallery card numbers', async () => {
  const requested: string[] = [];
  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com')) {
        requested.push(urlStr);
        return true;
      }
      return false;
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const response = await ThumbnailModule.onRequest({ request: makeThumbnailRequest('/thumbnails/lg/LOR/TG24') });
  assert.strictEqual(response.status, 200, 'Should accept TG-prefixed numbers');
  assert.ok(
    requested[0].endsWith('/LOR/LOR_TG24_R_EN_LG.png'),
    `Should build the gallery filename, got ${requested[0]}`
  );

  restoreFetch();

  const padded: string[] = [];
  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com')) {
        padded.push(urlStr);
        return true;
      }
      return false;
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });
  const ggResponse = await ThumbnailModule.onRequest({ request: makeThumbnailRequest('/thumbnails/sm/CRZ/GG5') });
  assert.strictEqual(ggResponse.status, 200, 'Should accept GG-prefixed numbers');
  assert.ok(padded[0].endsWith('/CRZ/CRZ_GG05_R_EN_SM.png'), `Should pad gallery digits to two, got ${padded[0]}`);

  restoreFetch();
});

test('Thumbnail API: lowercases variant suffixes', async () => {
  const requested: string[] = [];
  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com')) {
        requested.push(urlStr);
        return true;
      }
      return false;
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const response = await ThumbnailModule.onRequest({ request: makeThumbnailRequest('/thumbnails/sm/SLG/068A') });
  assert.strictEqual(response.status, 200, 'Should accept suffixed numbers');
  assert.ok(
    requested[0].endsWith('/SLG/SLG_068a_R_EN_SM.png'),
    `Suffix should be lowercased for the CDN, got ${requested[0]}`
  );

  restoreFetch();
});

test('Thumbnail API: handles card number normalization', async () => {
  mockFetch({
    predicate: (url, _init) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      return urlStr.includes('limitlesstcg.nyc3.cdn.digitaloceanspaces.com');
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const request = makeThumbnailRequest('/thumbnails/sm/TEF/007');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 200, 'Should handle leading zeros');

  restoreFetch();
});

test('Thumbnail API: accepts card numbers with letter suffix', async () => {
  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const request = makeThumbnailRequest('/thumbnails/sm/TEF/123a');
  const response = await ThumbnailModule.onRequest({ request });
  assert.strictEqual(response.status, 200, 'Should accept card number with suffix');

  restoreFetch();
});

test('Thumbnail API: proxies pokemontcg.io scans with CORS open', async () => {
  const requested: string[] = [];
  mockFetch({
    predicate: url => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('images.pokemontcg.io')) {
        requested.push(urlStr);
        return true;
      }
      return false;
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const response = await ThumbnailModule.onRequest({
    request: makeThumbnailRequest('/thumbnails/ptcgio/base1/94_hires')
  });
  assert.strictEqual(response.status, 200, 'Should serve a vintage scan');
  assert.strictEqual(requested[0], 'https://images.pokemontcg.io/base1/94_hires.png');
  assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');

  restoreFetch();
});

test('Thumbnail API: the pokemontcg.io leg only forwards names it recognises', async () => {
  const attempted: string[] = [];
  mockFetch({
    predicate: url => {
      attempted.push(typeof url === 'string' ? url : (url as Request).url);
      return true;
    },
    status: 200,
    headers: { 'Content-Type': 'image/png' },
    body: 'fake-image-data'
  });

  const rejected = [
    '/thumbnails/ptcgio/base1/..%2F..%2Fetc%2Fpasswd',
    '/thumbnails/ptcgio/base1/94.png%3Fx',
    '/thumbnails/ptcgio/BASE1%20/94',
    '/thumbnails/ptcgio/b/94',
    '/thumbnails/ptcgio/base1/hires'
  ];
  for (const path of rejected) {
    const response = await ThumbnailModule.onRequest({ request: makeThumbnailRequest(path) });
    assert.ok([400, 404].includes(response.status), `Should refuse ${path}, got ${response.status}`);
  }
  assert.deepStrictEqual(attempted, [], 'A refused name must not be fetched');

  restoreFetch();
});
