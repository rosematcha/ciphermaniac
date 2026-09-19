/** Stored follows: anything that is not a list of keys is no follows, and a toggle adds or removes one key. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStoredFollows, toggled } from '../../src/lib/liveFollows.ts';

test('only a list of strings parses as follows', () => {
  assert.deepEqual(parseStoredFollows('["ada lovelace|GB","x|US"]'), ['ada lovelace|GB', 'x|US']);
  assert.deepEqual(parseStoredFollows('["ok|US",3,null]'), ['ok|US']);
  for (const raw of [null, '', 'not json', '{"a":1}']) {
    assert.deepEqual(parseStoredFollows(raw), []);
  }
});

test('a toggle follows, then unfollows, without touching the set it was given', () => {
  const none = new Set<string>();
  const one = toggled(none, 'ada lovelace|GB');
  assert.deepEqual([...one], ['ada lovelace|GB']);
  assert.deepEqual([...toggled(one, 'ada lovelace|GB')], []);
  assert.equal(none.size, 0);
});
