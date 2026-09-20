import test from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';

import { deleteR2Keys, listR2Keys, listR2Objects } from '../../.github/scripts/lib/r2Inventory.mjs';

interface Sent {
  input: Record<string, unknown>;
}

/** A stub S3 client answering each `send` with the next canned response. */
function scriptedClient(responses: unknown[]): { client: S3Client; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    send: async (command: Sent) => {
      sent.push(command);
      return responses[sent.length - 1];
    }
  } as unknown as S3Client;
  return { client, sent };
}

test('listR2Keys follows every page with the cursor from the one before', async () => {
  const { client, sent } = scriptedClient([
    { Contents: [{ Key: 'a/1.json' }, { Key: 'a/2.json' }], IsTruncated: true, NextContinuationToken: 'page-2' },
    { Contents: [{ Key: 'a/3.json' }], IsTruncated: false }
  ]);
  assert.deepEqual(await listR2Keys(client, 'bucket', 'a/'), ['a/1.json', 'a/2.json', 'a/3.json']);
  assert.deepEqual(
    sent.map(command => command.input.ContinuationToken),
    [undefined, 'page-2']
  );
});

test('an empty prefix lists nothing', async () => {
  const { client } = scriptedClient([{ IsTruncated: false }]);
  assert.deepEqual(await listR2Keys(client, 'bucket', 'none/'), []);
});

test('a truncated page without a cursor throws instead of passing for a full listing', async () => {
  const { client } = scriptedClient([{ Contents: [{ Key: 'a/1.json' }], IsTruncated: true }]);
  await assert.rejects(listR2Keys(client, 'bucket', 'a/'), /truncated without a cursor/);
});

test('listR2Objects yields the listing metadata untouched', async () => {
  const object = { Key: 'a/1.json', ETag: '"abc"', Size: 12 };
  const { client } = scriptedClient([{ Contents: [object], IsTruncated: false }]);
  const seen = [];
  for await (const entry of listR2Objects(client, 'bucket', 'a/')) {
    seen.push(entry);
  }
  assert.deepEqual(seen, [object]);
});

test('deleteR2Keys batches by a thousand and sends nothing for no keys', async () => {
  const keys = Array.from({ length: 1001 }, (_, index) => `k/${index}`);
  const { client, sent } = scriptedClient([{}, {}]);
  assert.equal(await deleteR2Keys(client, 'bucket', keys), 1001);
  const sizes = sent.map(command => (command.input.Delete as { Objects: unknown[] }).Objects.length);
  assert.deepEqual(sizes, [1000, 1]);

  const idle = scriptedClient([]);
  assert.equal(await deleteR2Keys(idle.client, 'bucket', []), 0);
  assert.equal(idle.sent.length, 0);
});

test('deleteR2Keys throws when R2 rejects a key, rather than counting it deleted', async () => {
  const { client } = scriptedClient([{ Errors: [{ Key: 'k/1', Code: 'AccessDenied' }] }]);
  await assert.rejects(deleteR2Keys(client, 'bucket', ['k/1']), /rejected 1 deletion/);
});
