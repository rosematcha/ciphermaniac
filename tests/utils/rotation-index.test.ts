import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRotationIndex } from '../../src/lib/data/snapshots';

test('rotation index retries failures and deduplicates successful requests', async t => {
  let attempts = 0;
  const index = { generatedAt: '2026-01-01', rotations: [], cards: {}, cardsBySetNumber: {}, archetypes: {} };
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    if (attempts === 1) {
      throw new Error('offline');
    }
    return new Response(JSON.stringify(index), { status: 200 });
  });
  assert.equal(await fetchRotationIndex(), null);
  const first = fetchRotationIndex();
  assert.equal(fetchRotationIndex(), first);
  assert.deepEqual(await first, index);
  assert.equal(fetchRotationIndex(), first);
  assert.equal(attempts, 2);
});
