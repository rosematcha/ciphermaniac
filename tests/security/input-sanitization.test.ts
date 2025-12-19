/**
 * tests/security/input-sanitization.test.ts
 * Tests for input validation and sanitization utilities.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeArchetypeName, sanitizeForFilename, sanitizeForPath } from '../../functions/lib/reportBuilder.js';

import { validators } from '../../src/utils/errorHandler.ts';

import { generateMaliciousInput } from '../__utils__/mock-data-factory.js';
import { expectThrows } from '../__utils__/test-helpers.js';

/**
 * sanitizeForPath should remove characters that would allow path traversal or invalid filesystem names
 */
test('sanitizeForPath prevents path traversal and strips invalid characters (unix & windows)', () => {
  const inputs = [
    '/etc/passwd',
    '../secrets/hidden',
    '..\\windows\\system32',
    'C:\\Windows\\System32\\cmd.exe',
    'normal-name',
    'spa ce/name',
    'bad|name<>:"*?'
  ];

  for (const input of inputs) {
    const out = sanitizeForPath(input);
    // Should never contain path separators
    assert.equal(out.includes('/'), false, `sanitized should not contain '/' for input ${input}`);
    assert.equal(out.includes('\\'), false, `sanitized should not contain '\\' for input ${input}`);
    // Should remove characters that are illegal in filenames
    assert.equal(/[<>:"/\\|?*]/.test(out), false, `sanitized should not contain invalid chars for ${input}`);
  }
});

/**
 * sanitizeForFilename should replace spaces with underscores and remove invalid chars
 */
test('sanitizeForFilename normalizes filenames and prevents filename injection', () => {
  const raw = 'my file: name?.json';
  const filename = sanitizeForFilename(raw);
  assert.equal(filename.includes(' '), false, 'Filename should not contain spaces');
  assert.equal(
    filename.includes(':') || filename.includes('?'),
    false,
    'Filename should not contain invalid punctuation'
  );
  assert.ok(filename.length > 0, 'Filename must not be empty after sanitization');
});

/**
 * normalizeArchetypeName should collapse underscores and whitespace, and lowercase
 */
test('normalizeArchetypeName handles special characters and unicode', () => {
  const cases: Array<[string, string]> = [
    ['Pika_Power', 'pika power'],
    ['   Lots   of   Spaces   ', 'lots of spaces'],
    ['', 'unknown'],
    ['Ünicode—Name', 'ünicode—name']
  ];

  for (const [input, expected] of cases) {
    const out = normalizeArchetypeName(input);
    assert.equal(out, expected);
  }
});

/**
 * validators.cardIdentifier should accept sane values and reject malicious or oversized ones
 */
test('validators.cardIdentifier enforces length and rejects null/empty inputs', async () => {
  // Valid identifier
  const identifier = validators.cardIdentifier('  XY-123  ');
  assert.equal(identifier, 'XY-123');

  // Empty string
  await expectThrows(() => validators.cardIdentifier('   '));

  // Non-string
  await expectThrows(() => validators.cardIdentifier(null as unknown as string));

  // Too long (>200)
  const long = 'A'.repeat(201);
  await expectThrows(() => validators.cardIdentifier(long));
});

/**
 * Test NULL bytes, very long inputs, and unicode handling for sanitizers
 */
test('sanitizers handle null bytes, extremely long input, and unicode', () => {
  const nullBytePayload = generateMaliciousInput('path-traversal').payload as string; // contains null byte
  const sanitized = sanitizeForPath(nullBytePayload);
  assert.equal(sanitized.includes('\0'), false, 'Sanitize should remove null bytes');

  const longInput = `${'A'.repeat(5000)}/../etc/passwd`;
  const out = sanitizeForPath(longInput);
  assert.ok(out.length < longInput.length, 'Sanitized output should be smaller or equal to input');
  assert.equal(out.includes('..'), false, 'Sanitized should not contain ".." sequences');

  const windowsStyle = 'C:\\\\some\\path\\..\\evil';
  const windowsOut = sanitizeForPath(windowsStyle);
  assert.equal(windowsOut.includes('\\'), false);
});
