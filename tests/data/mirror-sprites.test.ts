import test from 'node:test';
import assert from 'node:assert/strict';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { mirrorSprites } from '../../.github/scripts/lib/mirrorSprites';

const PREFIX = 'pokemon-sprites/gen9/';
const key = (slug: string) => `${PREFIX}${slug}.png`;

function bucketStub(pages: string[][]) {
  const sent: Array<ListObjectsV2Command | PutObjectCommand | DeleteObjectsCommand> = [];
  let page = 0;
  const client = {
    async send(command: ListObjectsV2Command | PutObjectCommand | DeleteObjectsCommand) {
      sent.push(command);
      if (command instanceof ListObjectsV2Command) {
        const entries = pages[page++];
        return {
          Contents: entries.map(Key => ({ Key })),
          IsTruncated: page < pages.length,
          NextContinuationToken: page < pages.length ? String(page) : undefined
        };
      }
      return {};
    }
  } as unknown as S3Client;
  return { client, sent };
}

function source(fetches: string[], status = 200): typeof fetch {
  return async url => {
    fetches.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]), { status });
  };
}

const sourceUrl = (slug: string) => `https://sprites.example/${slug}.png`;

test('sprite mirror reuses all listing pages to skip existing assets and prune without HEAD or a second scan', async () => {
  const { client, sent } = bucketStub([[key('a')], [key('b'), key('old')]]);
  const fetches: string[] = [];
  const stats = await mirrorSprites(client, {
    bucket: 'bucket',
    slugs: ['a', 'b', 'c', 'c'],
    sourceUrl,
    fetchSource: source(fetches)
  });
  assert.deepEqual(stats, { uploaded: 1, skipped: 2, missing: 0, removed: 1 });
  assert.deepEqual(fetches, [sourceUrl('c')]);
  assert.deepEqual(
    sent.map(command => command.constructor.name),
    ['ListObjectsV2Command', 'ListObjectsV2Command', 'PutObjectCommand', 'DeleteObjectsCommand']
  );
  const upload = sent[2] as PutObjectCommand;
  assert.equal(upload.input.Key, key('c'));
  assert.equal(upload.input.ContentType, 'image/png');
  assert.equal(upload.input.CacheControl, 'public, max-age=31536000, immutable');
  assert.deepEqual((sent[3] as DeleteObjectsCommand).input.Delete?.Objects, [{ Key: key('old') }]);
});

test('forced mirroring uploads existing sprites', async () => {
  const { client, sent } = bucketStub([[key('a')]]);
  const stats = await mirrorSprites(client, {
    bucket: 'bucket',
    slugs: ['a'],
    sourceUrl,
    force: true,
    fetchSource: source([])
  });
  assert.equal(stats.uploaded, 1);
  assert.ok(sent[1] instanceof PutObjectCommand);
});

test('a missing source is skipped while transport and HTTP failures prevent pruning', async () => {
  const absent = bucketStub([[key('old')]]);
  const stats = await mirrorSprites(absent.client, {
    bucket: 'bucket',
    slugs: ['a'],
    sourceUrl,
    fetchSource: source([], 404)
  });
  assert.equal(stats.missing, 1);
  for (const status of [403, 429, 500]) {
    const { client, sent } = bucketStub([[key('old')]]);
    await assert.rejects(
      mirrorSprites(client, {
        bucket: 'bucket',
        slugs: ['a'],
        sourceUrl,
        fetchSource: source([], status)
      }),
      new RegExp(`HTTP ${status}`)
    );
    assert.equal(sent.length, 1);
  }
  const { client, sent } = bucketStub([[key('old')]]);
  await assert.rejects(
    mirrorSprites(client, {
      bucket: 'bucket',
      slugs: ['a'],
      sourceUrl,
      fetchSource: async () => {
        throw new Error('connection reset');
      }
    }),
    /connection reset/
  );
  assert.equal(sent.length, 1);
});

test('sprite mirror uploads concurrently with a limit of eight', async () => {
  const { client } = bucketStub([[]]);
  let active = 0;
  let peak = 0;
  const stats = await mirrorSprites(client, {
    bucket: 'bucket',
    slugs: Array.from({ length: 20 }, (_, index) => String(index)),
    sourceUrl,
    fetchSource: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => {
        setImmediate(resolve);
      });
      active--;
      return new Response(new Uint8Array([1]));
    }
  });
  assert.equal(stats.uploaded, 20);
  assert.equal(peak, 8);
});
