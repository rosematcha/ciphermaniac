import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubmission, type FeedbackFormState, sendFeedback, validateForm } from '../../src/lib/feedbackForm';

const state = (overrides: Partial<FeedbackFormState> = {}): FeedbackFormState => ({
  type: 'wrong',
  message: 'Dusknoir count is doubled',
  correction: '',
  page: '/cards/PAL/185',
  wantsReply: false,
  method: 'email',
  handle: '',
  environment: null,
  ...overrides
});

test('validateForm requires a message', () => {
  assert.deepEqual(validateForm(state()), {});
  assert.deepEqual(validateForm(state({ message: '  \n ' })), { message: 'Required' });
});

test('validateForm only asks for a handle once a reply is wanted', () => {
  assert.deepEqual(validateForm(state({ handle: '' })), {});
  assert.deepEqual(validateForm(state({ wantsReply: true, handle: ' ' })), { handle: 'Required' });
  assert.deepEqual(validateForm(state({ wantsReply: true, handle: 'reese' })), {
    handle: 'Needs to be an email address'
  });
  assert.deepEqual(validateForm(state({ wantsReply: true, handle: ' reese@ciphermaniac.com ' })), {});
  assert.deepEqual(validateForm(state({ wantsReply: true, method: 'discord', handle: 'reese' })), {});
});

test('buildSubmission sends what a data report asked for, trimmed', () => {
  const body = buildSubmission(
    state({ message: ' Doubled ', correction: ' One ', wantsReply: true, method: 'bluesky', handle: ' @reese ' }),
    ''
  );
  assert.deepEqual(body, {
    type: 'wrong',
    message: 'Doubled',
    correction: 'One',
    page: '/cards/PAL/185',
    reply: { method: 'bluesky', handle: '@reese' },
    hp: ''
  });
});

test('buildSubmission leaves out blank optional fields', () => {
  assert.deepEqual(buildSubmission(state({ page: '  ' }), ''), {
    type: 'wrong',
    message: 'Dusknoir count is doubled',
    hp: ''
  });
});

test('buildSubmission drops data-report fields from something to say', () => {
  const body = buildSubmission(state({ type: 'say', message: 'Thanks', correction: 'stale', page: '/cards' }), 'bot');
  assert.deepEqual(body, { type: 'say', message: 'Thanks', hp: 'bot' });
});

test('buildSubmission includes device data only when it was opted in', () => {
  const environment = { browser: 'Firefox 130', os: 'Linux' };
  assert.deepEqual(buildSubmission(state({ environment }), '').environment, environment);
  assert.equal('environment' in buildSubmission(state(), ''), false);
});

function fakeFetch(respond: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

test('sendFeedback posts JSON to the endpoint and reports success', async () => {
  const { impl, calls } = fakeFetch(async () => new Response('{"success":true}', { status: 200 }));
  assert.equal(await sendFeedback({ type: 'say', message: 'Hi' }, impl), 'sent');
  assert.equal(calls[0]?.url, '/api/feedback');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { type: 'say', message: 'Hi' });
});

test('sendFeedback tells a rate limit apart from other failures', async () => {
  assert.equal(await sendFeedback({}, fakeFetch(async () => new Response('', { status: 429 })).impl), 'limited');
  assert.equal(await sendFeedback({}, fakeFetch(async () => new Response('', { status: 500 })).impl), 'failed');
  assert.equal(await sendFeedback({}, fakeFetch(() => Promise.reject(new TypeError('offline'))).impl), 'failed');
});
