import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatFeedbackEmail,
  isEmailAddress,
  normalizePagePath,
  parseFeedback,
  type ParseResult
} from '../../shared/feedback';

const valid = (overrides: Record<string, unknown> = {}) => ({
  type: 'wrong',
  message: 'Dusknoir count is doubled',
  ...overrides
});

function value(result: ParseResult) {
  if (!result.ok) {
    throw new Error(`expected a valid submission, got "${result.error}"`);
  }
  return result.value;
}

const AT = new Date('2026-09-13T12:00:00Z');

test('parseFeedback accepts a complete report and trims its text', () => {
  const result = parseFeedback(
    valid({
      message: '  doubled  ',
      correction: ' 1 copy ',
      page: '/cards/PAL/185',
      reply: { method: 'email', handle: ' a@b.co ' },
      environment: { browser: 'Firefox 130', os: 'Linux' }
    })
  );
  assert.deepEqual(value(result), {
    type: 'wrong',
    message: 'doubled',
    correction: '1 copy',
    page: '/cards/PAL/185',
    reply: { method: 'email', handle: 'a@b.co' },
    environment: { browser: 'Firefox 130', os: 'Linux' }
  });
});

test('parseFeedback leaves out optional fields that are blank or absent', () => {
  assert.deepEqual(value(parseFeedback({ type: 'say', message: 'Thanks', correction: '   ', reply: null })), {
    type: 'say',
    message: 'Thanks'
  });
});

test('parseFeedback rejects a missing, unknown, or inherited type', () => {
  for (const type of [undefined, '', 'bug', 'toString', '__proto__', 7]) {
    assert.deepEqual(parseFeedback(valid({ type })), { ok: false, error: 'Missing required fields' }, String(type));
  }
});

test('parseFeedback rejects a body that is not an object', () => {
  for (const body of [null, 'wrong', [], 42]) {
    assert.equal(parseFeedback(body).ok, false, JSON.stringify(body));
  }
});

test('parseFeedback rejects empty and oversized text', () => {
  assert.deepEqual(parseFeedback(valid({ message: ' \n\t ' })), { ok: false, error: 'Missing required fields' });
  assert.deepEqual(parseFeedback(valid({ message: 42 })), { ok: false, error: 'Missing required fields' });
  assert.deepEqual(parseFeedback(valid({ message: 'a'.repeat(10_001) })), {
    ok: false,
    error: 'Feedback text too long'
  });
  assert.deepEqual(parseFeedback(valid({ correction: 'a'.repeat(1_001) })), {
    ok: false,
    error: 'Correction is too long'
  });
  assert.deepEqual(parseFeedback(valid({ page: 'a'.repeat(501) })), { ok: false, error: 'Page is too long' });
});

test('parseFeedback rejects reply details without a known method and a handle', () => {
  const replies = [
    { method: 'fax', handle: 'x' },
    { method: 'email', handle: '  ' },
    { method: 'discord', handle: 'a'.repeat(201) },
    { method: 'toString', handle: 'x' },
    'email',
    []
  ];
  for (const reply of replies) {
    assert.deepEqual(
      parseFeedback(valid({ reply })),
      { ok: false, error: 'Invalid reply details' },
      JSON.stringify(reply)
    );
  }
});

test('parseFeedback accepts every contact method', () => {
  for (const method of ['email', 'twitter', 'bluesky', 'discord']) {
    assert.deepEqual(value(parseFeedback(valid({ reply: { method, handle: 'reese' } }))).reply, {
      method,
      handle: 'reese'
    });
  }
});

test('parseFeedback keeps only known device fields, as trimmed, capped strings', () => {
  const environment = { browser: ' Chrome 130 ', cookies: 'secret', os: 42, language: 'x'.repeat(300) };
  assert.deepEqual(value(parseFeedback(valid({ environment }))).environment, {
    browser: 'Chrome 130',
    language: 'x'.repeat(200)
  });
  assert.equal(value(parseFeedback(valid({ environment: { cookies: 'a' } }))).environment, undefined);
  assert.equal(value(parseFeedback(valid({ environment: 'Chrome' }))).environment, undefined);
});

test('formatFeedbackEmail quotes the questions the form asked, in order', () => {
  const email = formatFeedbackEmail(
    {
      type: 'wrong',
      message: 'Doubled',
      correction: 'One',
      page: '/cards/PAL/185',
      reply: { method: 'discord', handle: 'reese' },
      environment: { mode: 'Dark', browser: 'Firefox 130' }
    },
    AT
  );
  assert.equal(email.subject, '[Ciphermaniac] Something’s wrong');
  assert.equal(
    email.text,
    [
      'Type: Something’s wrong',
      '',
      'What’s wrong?',
      'Doubled',
      '',
      'What should it be?',
      'One',
      '',
      'Page: /cards/PAL/185',
      'Reply by Discord: reese',
      '',
      'Browser: Firefox 130',
      'Site mode: Dark',
      '',
      'Submitted at: 2026-09-13T12:00:00.000Z'
    ].join('\n')
  );
});

test('formatFeedbackEmail says when no reply or device data was asked for', () => {
  const { subject, text } = formatFeedbackEmail({ type: 'say', message: 'Love it' }, AT);
  assert.equal(subject, '[Ciphermaniac] Something to say');
  assert.match(text, /What’s on your mind\?\nLove it/);
  assert.match(text, /\nNo reply wanted\n/);
  assert.match(text, /Browser, device, and OS not included/);
  assert.doesNotMatch(text, /What should it be\?|Page:/);
});

test('formatFeedbackEmail strips scripts and control characters but keeps ordinary symbols', () => {
  const { text } = formatFeedbackEmail(
    {
      type: 'say',
      message: 'Hi <script>alert(1)</script> R&D x < 5 and <script src=x> done\u0007',
      reply: { method: 'email', handle: 'a@b.co\nBcc: c@d.co' }
    },
    AT
  );
  assert.ok(!/<\/?script/i.test(text));
  assert.ok(text.includes('R&D x < 5'));
  assert.ok(!text.includes(String.fromCharCode(7)), 'control characters are stripped');
  assert.equal(text.match(/\[script removed\]/g)?.length, 2);
  // A single-line field cannot smuggle a new header line.
  assert.ok(text.includes('Reply by Email: a@b.co Bcc: c@d.co'));
});

test('isEmailAddress accepts plain addresses and rejects anything header-shaped', () => {
  assert.equal(isEmailAddress('reese@ciphermaniac.com'), true);
  assert.equal(isEmailAddress('first.last+tag@sub.example.co'), true);
  for (const bad of ['not-an-email', 'a@b', 'a b@c.co', 'a@b.co\nBcc: x@y.z', '"a"@b.co', `${'a'.repeat(200)}@b.co`]) {
    assert.equal(isEmailAddress(bad), false, bad);
  }
});

test('normalizePagePath keeps same-site paths and drops everything else', () => {
  assert.equal(normalizePagePath('/cards/PAL/185?format=x'), '/cards/PAL/185?format=x');
  assert.equal(normalizePagePath(' /cards '), '/cards');
  for (const bad of [
    undefined,
    '',
    'cards',
    '//evil.example',
    'https://evil.example',
    '/a b',
    '/a\\b',
    `/${'a'.repeat(500)}`
  ]) {
    assert.equal(normalizePagePath(bad), '', String(bad));
  }
});
