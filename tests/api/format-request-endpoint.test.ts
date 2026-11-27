import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _resetRateLimitStore, onRequestPost } from '../../functions/api/format-request.js';
import type { D1Like, D1Statement } from '../../functions/lib/types.js';

/** A D1 stand-in that records every bound write. */
function recordingDb(): { db: D1Like; writes: unknown[][] } {
  const writes: unknown[][] = [];
  const statement = (values: unknown[] = []): D1Statement => ({
    bind: (...next: unknown[]) => statement(next),
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => {
      writes.push(values);
      return {};
    }
  });
  return { db: { prepare: () => statement(), batch: async () => [] }, writes };
}

function post(body: unknown): Request {
  return new Request('https://ciphermaniac.test/api/format-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
    body: JSON.stringify(body)
  });
}

beforeEach(() => _resetRateLimitStore());

test('a typed format is counted under its folded name and nothing about the sender', async () => {
  const { db, writes } = recordingDb();
  const response = await onRequestPost({ request: post({ name: '  Gym   Neo ' }), env: { LIVE_DB: db } });
  assert.equal(response.status, 204);
  assert.equal(writes.length, 1);
  const [key, name, seen] = writes[0]!;
  assert.equal(key, 'gym neo');
  assert.equal(name, 'Gym Neo');
  assert.equal(typeof seen, 'number');
  assert.equal(writes[0]!.length, 3);
});

test('anything that is not a short name is answered the same and written nowhere', async () => {
  const { db, writes } = recordingDb();
  for (const body of [{}, { name: '' }, { name: 'x'.repeat(25) }, { name: 'a\u0007b' }, { name: 42 }]) {
    const response = await onRequestPost({ request: post(body), env: { LIVE_DB: db } });
    assert.equal(response.status, 204);
  }
  assert.equal(writes.length, 0);
});
