import test from 'node:test';
import assert from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';

import { decimalBoundaries, listR2ObjectsInRanges } from '../../.github/scripts/lib/build/rangedListing';

interface ListInput {
  Prefix: string;
  StartAfter?: string;
  ContinuationToken?: string;
}

/** An R2 stand-in: byte-ordered keys, pages of `pageSize`, StartAfter honored unless told otherwise. */
function fakeBucket(keys: string[], pageSize: number, honorStartAfter = true): { client: S3Client; calls: number } {
  const sorted = [...keys].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const state = { calls: 0 };
  const client = {
    send: async ({ input }: { input: ListInput }) => {
      state.calls += 1;
      const inPrefix = sorted.filter(key => key.startsWith(input.Prefix));
      let start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
      if (!input.ContinuationToken && input.StartAfter && honorStartAfter) {
        const after = Buffer.from(input.StartAfter);
        start = inPrefix.findIndex(key => Buffer.compare(Buffer.from(key), after) > 0);
        start = start < 0 ? inPrefix.length : start;
      }
      const end = start + pageSize;
      return {
        Contents: inPrefix.slice(start, end).map(Key => ({ Key })),
        IsTruncated: end < inPrefix.length,
        NextContinuationToken: end < inPrefix.length ? String(end) : undefined
      };
    }
  } as unknown as S3Client;
  return {
    client,
    get calls() {
      return state.calls;
    }
  };
}

const KEYS = [
  'players/1/profile.json',
  'players/10/profile.json',
  'players/10/decks.json',
  'players/100/profile.json',
  'players/19/profile.json',
  'players/2/profile.json',
  'players/20/profile.json',
  'players/9/profile.json',
  'players/99/profile.json',
  'players/999/x.json',
  'players/_manifest.json',
  'players/index.json',
  'players/é/profile.json',
  'other/1.json'
];

function sortedPlayerKeys(): string[] {
  return KEYS.filter(key => key.startsWith('players/')).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

test('ranged listing returns exactly the full sorted listing, with or without StartAfter', async () => {
  for (const honor of [true, false]) {
    for (const pageSize of [1, 2, 1000]) {
      const { client } = fakeBucket(KEYS, pageSize, honor);
      const listed = await listR2ObjectsInRanges(
        { client, bucket: 'bucket', prefix: 'players/' },
        decimalBoundaries('players/'),
        4
      );
      assert.deepEqual(
        listed.map(object => object.Key),
        sortedPlayerKeys(),
        `pageSize ${pageSize}, StartAfter ${honor ? 'honored' : 'ignored'}`
      );
    }
  }
});

test('boundaries that are not strictly increasing are rejected before any request', async () => {
  const bucket = fakeBucket(KEYS, 10);
  await assert.rejects(
    listR2ObjectsInRanges({ client: bucket.client, bucket: 'bucket', prefix: 'players/' }, ['players/2', 'players/2']),
    /strictly increasing/
  );
  assert.equal(bucket.calls, 0);
});

test('a truncated page without a cursor throws', async () => {
  const client = {
    send: async () => ({ Contents: [{ Key: 'players/1/a.json' }], IsTruncated: true })
  } as unknown as S3Client;
  await assert.rejects(
    listR2ObjectsInRanges({ client, bucket: 'bucket', prefix: 'players/' }, []),
    /truncated without a cursor/
  );
});
