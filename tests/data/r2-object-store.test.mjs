import assert from 'node:assert/strict';
import test from 'node:test';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createR2ObjectStore } from '../../.github/scripts/lib/build/r2ObjectStore.mjs';

test('all R2 mutable pointer publication paths prevent HTTP storage', async () => {
  const uploads = [];
  const store = createR2ObjectStore({ send: async command => uploads.push(command) }, 'reports');
  await store.put('current.json', '{"releaseId":"one"}');
  await store.createIfAbsent('channels/shadow.json', { releaseId: 'one' });
  await store.writeIfMatch('current.json', { releaseId: 'two' }, 'etag-one');
  assert.equal(uploads.length, 3);
  for (const command of uploads) {
    assert.ok(command instanceof PutObjectCommand);
    assert.equal(command.input.Bucket, 'reports');
    assert.equal(command.input.ContentType, 'application/json');
    assert.equal(command.input.CacheControl, 'no-store, no-cache, must-revalidate');
  }
  assert.equal(uploads[1].input.IfNoneMatch, '*');
  assert.equal(uploads[2].input.IfMatch, 'etag-one');
});

test('immutable R2 release uploads retain year-long caching and create-only writes', async () => {
  const uploads = [];
  const store = createR2ObjectStore({ send: async command => uploads.push(command) }, 'reports');
  for (const key of ['releases/v1/online/aaaaaaaaaaaa/master.json', 'releases/v1/manifests/release-one.json']) {
    await store.putIfAbsent(key, '{}');
  }
  for (const command of uploads) {
    assert.ok(command instanceof PutObjectCommand);
    assert.equal(command.input.CacheControl, 'public, max-age=31536000, immutable');
    assert.equal(command.input.IfNoneMatch, '*');
  }
});
