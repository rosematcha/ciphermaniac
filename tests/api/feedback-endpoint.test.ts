import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _resetRateLimitStore, onRequestOptions, onRequestPost } from '../../functions/api/feedback.js';

interface SentEmail {
  url: string;
  body: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
let sent: SentEmail[] = [];

/** Stand in for Resend, answering every call with `status` and recording what was sent. */
function resendAnswers(status = 200, body: unknown = { id: 'msg_1' }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

beforeEach(() => {
  _resetRateLimitStore();
  sent = [];
  resendAnswers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ENV = { FEEDBACK_RECIPIENT: 'owner@site.test', RESEND_API_KEY: 'test-key' };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://ciphermaniac.test/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function submit(body: unknown, env: Record<string, string> = ENV) {
  const response = await onRequestPost({ request: post(body), env });
  return { status: response.status, json: JSON.parse(await response.text()) };
}

test('OPTIONS preflight allows POST from any origin', () => {
  const response = onRequestOptions();
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
});

test('a full data report is mailed with every answer and the device data', async () => {
  const result = await submit({
    type: 'wrong',
    message: 'Dusknoir count is doubled',
    correction: 'One copy',
    page: '/archetypes/Dragapult',
    reply: { method: 'email', handle: 'player@example.com' },
    environment: { browser: 'Firefox 130', os: 'Linux' }
  });
  assert.deepEqual(result, { status: 200, json: { success: true } });
  assert.equal(sent.length, 1);
  const [email] = sent;
  assert.equal(email?.url, 'https://api.resend.com/emails');
  assert.equal(email?.body.to, 'owner@site.test');
  assert.equal(email?.body.subject, '[Ciphermaniac] Something’s wrong');
  const text = String(email?.body.text);
  for (const line of [
    'What’s wrong?\nDusknoir count is doubled',
    'What should it be?\nOne copy',
    'Page: /archetypes/Dragapult',
    'Reply by Email: player@example.com',
    'Browser: Firefox 130',
    'OS: Linux'
  ]) {
    assert.ok(text.includes(line), `missing "${line}"`);
  }
});

test('an email reply address becomes reply_to, so answering is one click', async () => {
  await submit({ type: 'say', message: 'Hi', reply: { method: 'email', handle: 'player@example.com' } });
  assert.equal(sent[0]?.body.reply_to, 'player@example.com');
});

test('no reply_to for a social handle or an address that is not one', async () => {
  await submit({ type: 'say', message: 'Hi', reply: { method: 'bluesky', handle: '@player.bsky.social' } });
  await submit({ type: 'say', message: 'Hi', reply: { method: 'email', handle: 'player at example' } });
  await submit({ type: 'say', message: 'Hi' });
  assert.equal(sent.length, 3);
  for (const email of sent) {
    assert.equal('reply_to' in email.body, false);
  }
  assert.ok(String(sent[0]?.body.text).includes('Reply by Bluesky: @player.bsky.social'));
  assert.ok(String(sent[2]?.body.text).includes('No reply wanted'));
});

test('something to say is mailed under its own subject', async () => {
  const result = await submit({ type: 'say', message: 'Love the trends page' });
  assert.equal(result.status, 200);
  assert.equal(sent[0]?.body.subject, '[Ciphermaniac] Something to say');
});

test('the default recipient is used when none is configured', async () => {
  await submit({ type: 'say', message: 'Hi' }, { RESEND_API_KEY: 'test-key' });
  assert.equal(sent[0]?.body.to, 'reese@ciphermaniac.com');
});

test('invalid submissions are rejected with 400 and send nothing', async () => {
  const bodies = [
    {},
    { type: 'wrong' },
    { type: 'wrong', message: '   \n\t ' },
    { type: 'bug', message: 'Old type' },
    // The retired shape must not slip through.
    { feedbackType: 'bug', feedbackText: 'Old payload' },
    { type: 'say', message: 'Hi', reply: { method: 'fax', handle: 'x' } },
    { type: 'wrong', message: 'Hi', correction: 'a'.repeat(1_001) }
  ];
  for (const body of bodies) {
    // More bodies than the hourly limit allows; each is judged on its own.
    _resetRateLimitStore();
    const result = await submit(body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.ok(result.json.error);
  }
  assert.equal(sent.length, 0);
});

test('an overlong message is rejected with its own error', async () => {
  const result = await submit({ type: 'say', message: 'a'.repeat(10_001) });
  assert.deepEqual(result.json.error, 'Feedback text too long');
  assert.equal(result.status, 400);
});

test('malformed JSON is a 400', async () => {
  const result = await submit('{not json');
  assert.equal(result.status, 400);
  assert.equal(sent.length, 0);
});

test('a body over the size cap is a 413, whether declared or actual', async () => {
  const big = JSON.stringify({ type: 'say', message: 'a'.repeat(70_000) });
  const declared = await onRequestPost({ request: post('{}', { 'content-length': '70000' }), env: ENV });
  const actual = await onRequestPost({ request: post(big), env: ENV });
  assert.equal(declared.status, 413);
  assert.equal(actual.status, 413);
  assert.equal(sent.length, 0);
});

test('the size cap holds for a chunked body with no declared length', async () => {
  const chunk = new TextEncoder().encode('a'.repeat(16 * 1024));
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(chunk);
      // An endless body: only the cap can end it.
    }
  });
  const request = new Request('https://ciphermaniac.test/api/feedback', {
    method: 'POST',
    body: stream,
    duplex: 'half'
  } as RequestInit);
  const response = await onRequestPost({ request, env: ENV });
  assert.equal(response.status, 413);
  assert.ok(pulled < 10, `read ${pulled} chunks before stopping`);
  assert.equal(sent.length, 0);
});

test('the size cap counts bytes, not characters', async () => {
  // 30,000 three-byte characters: under the cap as characters, over it as bytes.
  const result = await submit({ type: 'say', message: '€'.repeat(30_000) });
  assert.equal(result.status, 413);
});

test('a filled honeypot looks like success but sends nothing', async () => {
  const result = await submit({ type: 'say', message: 'Buy now', hp: 'http://spam.example' });
  assert.deepEqual(result, { status: 200, json: { success: true } });
  assert.equal(sent.length, 0);
});

test('a Resend failure is a generic 500', async () => {
  resendAnswers(500, 'internal resend error');
  const result = await submit({ type: 'say', message: 'Crash on load' });
  assert.equal(result.status, 500);
  assert.equal(result.json.error, 'Internal server error');
});

test('a missing API key is a generic 500 that does not name the key', async () => {
  const result = await submit({ type: 'say', message: 'Hi' }, {});
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result.json).includes('RESEND_API_KEY'), false);
  assert.equal(sent.length, 0);
});
