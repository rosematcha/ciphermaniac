/** The username rules: what a username may be, which ones are the same, and the name an account is called by. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  displayName,
  handleKey,
  handleProblem,
  isHandle,
  normalizeHandle,
  randomHandle
} from '../../shared/accounts/handle.ts';

test('a username is stored trimmed and lowercased', () => {
  assert.equal(normalizeHandle('  RoseMatcha '), 'rosematcha');
});

test('usernames that differ only in separators share a key', () => {
  assert.equal(handleKey('rose.matcha'), 'rosematcha');
  assert.equal(handleKey('ro-se_ma.tcha'), 'rosematcha');
});

test('a username is 2 to 32 letters, digits and separators, with letters or digits at the ends and between separators', () => {
  for (const good of ['ab', 'r2', '42', 'rose.matcha', 'rose-matcha', 'rose_matcha', 'a.b-c_d', 'a'.repeat(32)]) {
    assert.equal(handleProblem(good), null, good);
  }
  const bad: [string, string][] = [
    ['a', 'Use 2 to 32 characters'],
    ['a'.repeat(33), 'Use 2 to 32 characters'],
    ['Rose', 'Use letters, numbers, periods, dashes and underscores'],
    ['rose matcha', 'Use letters, numbers, periods, dashes and underscores'],
    // A Cyrillic е, which looks like the Latin one.
    ['rosе', 'Use letters, numbers, periods, dashes and underscores'],
    ['rose/matcha', 'Use letters, numbers, periods, dashes and underscores'],
    ['.rose', 'Start and end with a letter or number'],
    ['rose_', 'Start and end with a letter or number'],
    ['..', 'Start and end with a letter or number'],
    ['rose.-matcha', 'Put a letter or number between separators'],
    ['admin', 'That username is reserved'],
    ['cipher-maniac', 'That username is reserved']
  ];
  for (const [handle, problem] of bad) {
    assert.equal(handleProblem(handle), problem, handle);
  }
  assert.equal(isHandle('admin', { reserved: false }), true, 'only the reserved list is skipped');
  assert.equal(isHandle('.admin', { reserved: false }), false);
});

test('a random username is a valid one', () => {
  for (let i = 0; i < 50; i += 1) {
    const handle = randomHandle();
    assert.match(handle, /^player-[a-z0-9]{8}$/);
    assert.ok(isHandle(handle));
  }
});

test('an account is called by its real name, or its username without one', () => {
  assert.equal(displayName({ firstName: 'Reese', lastName: 'Lundquist', handle: 'rosematcha' }), 'Reese Lundquist');
  assert.equal(displayName({ firstName: 'Reese', lastName: null, handle: 'rosematcha' }), 'Reese');
  assert.equal(displayName({ firstName: null, lastName: null, handle: 'rosematcha' }), 'rosematcha');
  assert.equal(displayName({ firstName: '', lastName: '', handle: 'rosematcha' }), 'rosematcha');
});
