import assert from 'node:assert/strict';
import test from 'node:test';

import { ONLINE_META_NAME, scopeSlug } from '../../shared/data/tournamentKeys.ts';
import { resolveInitialScope } from '../../src/lib/scopeUrl.ts';

const EVENT = '2026-05-08, Regional Championship Los Angeles';
const STORED = '2026-06-20, North America International Championship';
const KEYS = [ONLINE_META_NAME, EVENT, STORED];

test('a URL scope takes precedence over persisted scope', () => {
  assert.deepEqual(resolveInitialScope(scopeSlug(EVENT), STORED, KEYS), {
    key: EVENT,
    removeInvalidParam: false
  });
});

test('persisted scope takes precedence over the default', () => {
  assert.equal(resolveInitialScope(undefined, STORED, KEYS).key, STORED);
});

test('the online scope is the default without URL or stored state', () => {
  assert.equal(resolveInitialScope(undefined, null, KEYS).key, ONLINE_META_NAME);
});

test('an unresolvable URL scope falls back and is marked for removal', () => {
  assert.deepEqual(resolveInitialScope('not-published', STORED, KEYS), {
    key: STORED,
    removeInvalidParam: true
  });
});

test('an unresolvable URL and stale storage fall back to online', () => {
  assert.deepEqual(resolveInitialScope('not-published', 'missing event', KEYS), {
    key: ONLINE_META_NAME,
    removeInvalidParam: true
  });
});
