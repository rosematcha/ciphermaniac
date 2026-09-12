import assert from 'node:assert/strict';
import test from 'node:test';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createRetentionStore, pruneReleases } from '../../.github/scripts/prune-releases';
import {
  expiredGenerations,
  type Generation,
  generationPrefix,
  protectedGenerations,
  recordGeneration,
  retentionManifest,
  type StoredObject
} from '../../.github/scripts/lib/build/retention';

const NOW = Date.parse('2026-09-12T00:00:00Z');
const OLD = NOW - 30 * 86_400_000;
const ACTIVE = 'releases/v1/online/aaaaaaaaaaaa/';
const PREVIOUS = 'releases/v1/online/bbbbbbbbbbbb/';
const EXPIRED = 'releases/v1/online/cccccccccccc/';
const RECENT = 'releases/v1/online/dddddddddddd/';
const PENDING = 'releases/v1/events/2026-01-01, Event/eeeeeeeeeeee/';
const manifest = (releaseId: string, root: string, at = OLD) => ({
  releaseId,
  publishedAt: new Date(at).toISOString(),
  roots: { online: `/${root.slice(0, -1)}` },
  events: {}
});

function fixture() {
  const bodies = new Map<string, unknown>([
    ['current.json', { releaseId: 'active', manifest: '/releases/v1/manifests/active.json' }],
    ['releases/v1/manifests/active.json', manifest('active', ACTIVE, NOW)],
    ['build/v1/releases/previous.json', manifest('previous', PREVIOUS, NOW - 86_400_000)],
    ['build/v1/releases/expired.json', manifest('expired', EXPIRED)]
  ]);
  const objects: StoredObject[] = [...bodies.keys()].map(key => ({ key, size: 10, modified: OLD }));
  for (const prefix of [ACTIVE, PREVIOUS, EXPIRED, RECENT]) {
    objects.push({ key: `${prefix}master.json`, size: 100, modified: prefix === RECENT ? NOW : OLD });
  }
  objects.push({ key: `${PENDING}master.json`, size: 100, modified: OLD });
  objects.push({ key: 'reports/raw.json', size: 1000, modified: OLD });
  objects.push({ key: 'reports/event/tournament.db', size: 500, modified: OLD });
  objects.push({ key: 'reports/2026-01-01, Event/master.json', size: 250, modified: OLD });
  objects.push({ key: 'reports/tournaments.json', size: 50, modified: OLD });
  const removed: string[] = [];
  const store = {
    async *list(prefix: string) {
      yield* objects.filter(object => object.key.startsWith(prefix));
    },
    async read(key: string) {
      return bodies.get(key);
    },
    async readOptional(key: string) {
      return bodies.get(key) ?? null;
    },
    async remove(keys: string[]) {
      removed.push(...keys);
    }
  };
  return { bodies, objects, removed, store };
}

test('retention recognizes exact generation boundaries and never producer data', () => {
  assert.equal(generationPrefix(`${ACTIVE}master.json`), ACTIVE);
  assert.equal(
    generationPrefix('releases/v1/events/2026-01-01, São Paulo/aaaaaaaaaaaa/master.json'),
    'releases/v1/events/2026-01-01, São Paulo/aaaaaaaaaaaa/'
  );
  for (const key of ['reports/raw.json', 'releases/v1/manifests/active.json', 'releases/v1/online/not-a-hash/file']) {
    assert.equal(generationPrefix(key), null);
  }
  const groups = new Map<string, Generation>();
  recordGeneration(groups, { key: 'reports/raw.json', size: 1, modified: OLD });
  recordGeneration(groups, { key: `${ACTIVE}a`, size: 10, modified: OLD });
  recordGeneration(groups, { key: `${ACTIVE}b`, size: 20, modified: NOW });
  assert.deepEqual(groups.get(ACTIVE), { prefix: ACTIVE, bytes: 30, objects: 2, newest: NOW });
  assert.throws(() => recordGeneration(groups, { key: `${ACTIVE}c`, size: -1, modified: OLD }));
  assert.throws(() => recordGeneration(groups, { key: `${ACTIVE}c`, size: 1, modified: NaN }));
});

test('invalid manifests and missing active references fail closed', () => {
  assert.deepEqual(retentionManifest(manifest('active', ACTIVE)), manifest('active', ACTIVE));
  for (const value of [
    null,
    {},
    { ...manifest('x', ACTIVE), roots: {} },
    { ...manifest('x', ACTIVE), events: [] },
    { ...manifest('x', ACTIVE), roots: { online: '/reports' } }
  ]) {
    assert.throws(() => retentionManifest(value));
  }
  assert.throws(() => protectedGenerations([], new Set(), NOW));
  assert.throws(() => protectedGenerations([], new Set(['missing']), NOW));
  assert.throws(() => expiredGenerations([], new Set(), NOW));
});

test('old active releases and the last two releases survive even after a long publishing outage', () => {
  const keep = protectedGenerations(
    [
      manifest('active', ACTIVE, OLD - 1000),
      manifest('previous', PREVIOUS, OLD),
      manifest('expired', EXPIRED, OLD - 2000)
    ],
    new Set(['active']),
    NOW
  );
  assert.deepEqual([...keep].sort(), [ACTIVE, PREVIOUS].sort());
});

test('dry run reports garbage without touching any objects', async () => {
  const f = fixture();
  const plan = await pruneReleases(f.store, NOW);
  assert.equal(plan.totalBytes, 500);
  assert.equal(plan.reclaimBytes, 1000);
  assert.deepEqual(
    plan.generations.map(group => group.prefix),
    [EXPIRED, PENDING]
  );
  assert.deepEqual(f.removed, []);
});

test('cleanup deletes old unreferenced generations and tournament databases while retaining source JSON', async () => {
  const f = fixture();
  await pruneReleases(f.store, NOW, true);
  assert.deepEqual(f.removed, [
    `${EXPIRED}master.json`,
    `${PENDING}master.json`,
    'reports/event/tournament.db',
    'reports/2026-01-01, Event/master.json',
    'reports/tournaments.json'
  ]);
});

test('shadow channels are obsolete and do not protect release roots', async () => {
  const f = fixture();
  f.bodies.set('channels/shadow.json', { releaseId: 'expired', manifest: '/build/v1/releases/expired.json' });
  f.objects.push({ key: 'channels/shadow.json', size: 10, modified: OLD });
  const plan = await pruneReleases(f.store, NOW, true);
  assert.equal(plan.reclaimBytes, 1010);
  assert.deepEqual(f.removed, [
    `${EXPIRED}master.json`,
    `${PENDING}master.json`,
    'channels/shadow.json',
    'reports/event/tournament.db',
    'reports/2026-01-01, Event/master.json',
    'reports/tournaments.json'
  ]);
});

test('pending production events remain protected until promotion', async () => {
  const f = fixture();
  f.bodies.set('pending-events.json', {
    events: { '2026-01-01, Event': `/${PENDING.slice(0, -1)}` }
  });
  const plan = await pruneReleases(f.store, NOW, true);
  assert.equal(plan.reclaimBytes, 900);
  assert.deepEqual(f.removed, [
    `${EXPIRED}master.json`,
    'reports/event/tournament.db',
    'reports/2026-01-01, Event/master.json',
    'reports/tournaments.json'
  ]);
});

test('a malformed or missing channel manifest blocks all deletion', async () => {
  for (const pointer of [
    null,
    { releaseId: '../bad' },
    { releaseId: 'active', manifest: '/reports/raw.json' },
    { releaseId: 'different', manifest: '/releases/v1/manifests/active.json' }
  ]) {
    const f = fixture();
    f.bodies.set('current.json', pointer);
    await assert.rejects(pruneReleases(f.store, NOW, true));
    assert.deepEqual(f.removed, []);
  }
});

test('a promotion during inventory cancels deletion', async () => {
  const f = fixture();
  const { list } = f.store;
  f.store.list = async function* (prefix) {
    yield* list(prefix);
    if (prefix === 'releases/v1/') {
      f.bodies.set('current.json', { releaseId: 'expired', manifest: '/build/v1/releases/expired.json' });
    }
  };
  await assert.rejects(pruneReleases(f.store, NOW, true), /became active/);
  assert.deepEqual(f.removed, []);
});

test('an object written after planning blocks deletion of its generation', async () => {
  const f = fixture();
  const { list } = f.store;
  f.store.list = async function* (prefix) {
    for await (const object of list(prefix)) {
      yield prefix === EXPIRED ? { ...object, modified: NOW } : object;
    }
  };
  await assert.rejects(pruneReleases(f.store, NOW, true), /changed during cleanup/);
  assert.deepEqual(f.removed, []);
});

test('R2 storage adapter paginates and refuses truncated listings, missing reads, and partial deletes', async t => {
  const client = new S3Client({ region: 'auto', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  const responses: unknown[] = [];
  t.mock.method(client, 'send', async (command: unknown) => {
    assert.ok(
      command instanceof ListObjectsV2Command ||
        command instanceof GetObjectCommand ||
        command instanceof DeleteObjectsCommand
    );
    return responses.shift();
  });
  const store = createRetentionStore(client, 'test');
  responses.push(
    {
      Contents: [{ Key: 'one', Size: 1, LastModified: new Date(OLD) }],
      IsTruncated: true,
      NextContinuationToken: 'next'
    },
    { Contents: [{ Key: 'two', Size: 2, LastModified: new Date(NOW) }] }
  );
  const objects = [];
  for await (const object of store.list('')) {
    objects.push(object);
  }
  assert.equal(objects.length, 2);
  responses.push({ IsTruncated: true });
  await assert.rejects(async () => {
    for await (const object of store.list('')) {
      void object;
    }
  }, /continuation/);
  responses.push({ Contents: [{}] });
  await assert.rejects(async () => {
    for await (const object of store.list('')) {
      void object;
    }
  }, /metadata/);
  responses.push({ Body: { transformToString: async () => '{"ok":true}' } });
  assert.deepEqual(await store.read('one'), { ok: true });
  responses.push({});
  await assert.rejects(store.read('missing'));
  responses.push({});
  await store.remove(['one']);
  responses.push({ Errors: [{ Key: 'one', Code: 'Denied' }] });
  await assert.rejects(store.remove(['one']), /rejected/);
});
