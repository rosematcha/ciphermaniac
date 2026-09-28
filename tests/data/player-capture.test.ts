import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePlayers, currentPlayerObjects, planPlayerCapture } from '../../.github/scripts/lib/build/playerCapture';
import { protectPlayerReferences } from '../../.github/scripts/prune-releases';
import { assertProducerComplete } from '../../.github/scripts/lib/build/provenance';

const object = { sourceKey: 'players/1/profile.json', relativeKey: '1/profile.json', etag: 'one', size: 20 };
const prior = '/releases/v1/players/aaaaaaaaaaaa';
const previous = { '1/profile.json': { etag: 'one', size: 20, path: `${prior}/1/profile.json` } };

test('unchanged player bodies retain their immutable reference while changed bodies are copied', () => {
  const current = '/releases/v1/players/bbbbbbbbbbbb';
  const plan = planPlayerCapture([object, { ...object, relativeKey: '2/profile.json' }], previous, current, prior);
  assert.equal(plan.copies.length, 1);
  assert.deepEqual(plan.copyReasons, { other: 0, new: 1, invalidRoot: 0, changed: 0 });
  assert.equal(plan.inventory['1/profile.json'].path, previous['1/profile.json'].path);
  assert.equal(plan.inventory['2/profile.json'].path, `${current}/2/profile.json`);
  assert.equal(planPlayerCapture([{ ...object, etag: 'changed' }], previous, current, prior).copies.length, 1);
  assert.deepEqual(planPlayerCapture([], previous, current, prior).inventory, {});
  const transitive = {
    '1/profile.json': { ...previous['1/profile.json'], path: '/releases/v1/players/cccccccccccc/1/profile.json' }
  };
  const reused = planPlayerCapture([object], transitive, current, prior);
  assert.equal(reused.copies.length, 0);
  assert.equal(reused.reusedFromOlderRoot, 1);
  assert.equal(reused.inventory['1/profile.json'].path, transitive['1/profile.json'].path);
  assert.deepEqual(planPlayerCapture([object], transitive, current, prior).copyReasons, {
    other: 0,
    new: 0,
    invalidRoot: 0,
    changed: 0
  });
  const invalid = { '1/profile.json': { ...previous['1/profile.json'], path: '/reports/1/profile.json' } };
  assert.equal(planPlayerCapture([object], invalid, current, prior).copies.length, 1);
});

test('capture excludes stale player files and requires every current profile', () => {
  const files = [
    object,
    { ...object, relativeKey: '1/decks.json' },
    { ...object, relativeKey: '2/profile.json' },
    { ...object, relativeKey: 'index.json' },
    { ...object, relativeKey: 'index-slim.json' },
    { ...object, relativeKey: 'old/matches.json' }
  ];
  const selected = currentPlayerObjects(files, { '1': [] });
  assert.deepEqual(
    selected.map(file => file.relativeKey),
    ['1/profile.json', '1/decks.json', 'index.json', 'index-slim.json']
  );
  assert.throws(() => currentPlayerObjects(files, { '1': [], '3': [] }), /incomplete/);
});

test('capture records older reused roots for retention', async () => {
  const older = '/releases/v1/players/cccccccccccc';
  const writes = new Map<string, unknown>();
  const result = await capturePlayers({
    objects: [object],
    previous: { '1/profile.json': { ...previous['1/profile.json'], path: `${older}/1/profile.json` } },
    previousRoot: prior,
    write: true,
    store: {
      read: async () => null,
      write: async (key, value) => {
        writes.set(key, value);
      },
      copy: async () => {
        throw new Error('Unchanged player was copied');
      }
    }
  });
  assert.equal(result.copied, 0);
  assert.deepEqual(writes.get(`${result.root.slice(1)}/_references.json`), [older]);
});

test('capture commits routes and references only after all copies succeed; identical retries write nothing', async () => {
  const bodies = new Map<string, unknown>();
  const store = {
    read: async <T>(key: string) => (bodies.get(key) as T) ?? null,
    write: async (key: string, body: unknown) => {
      bodies.set(key, body);
    },
    copy: async () => {}
  };
  const result = await capturePlayers({ objects: [object], previous, previousRoot: prior, store, write: true });
  assert.equal(result.reused, 1);
  assert.equal(result.copied, 0);
  assert.deepEqual(bodies.get(`${result.root.slice(1)}/_references.json`), [prior]);
  assert.equal(bodies.size, 259);
  assert.equal(
    (await capturePlayers({ objects: [object], previous, previousRoot: prior, store, write: true })).copied,
    0
  );
  const failed = {
    ...store,
    copy: async () => {
      throw new Error('transport');
    }
  };
  await assert.rejects(
    capturePlayers({
      objects: [{ ...object, etag: 'new' }],
      previous,
      previousRoot: prior,
      store: failed,
      write: true
    }),
    /transport/
  );
  assert.equal(bodies.size, 259);
  await capturePlayers({
    objects: [{ ...object, etag: 'new' }],
    previous,
    previousRoot: prior,
    store: failed,
    write: false
  });
});

test('retention protects transitive player references, handles cycles, and fails closed on bad references', async () => {
  const current = 'releases/v1/players/bbbbbbbbbbbb/';
  const keep = new Set([current]);
  await protectPlayerReferences(
    { readOptional: async key => (key.startsWith(current) ? [prior] : [`/${current.slice(0, -1)}`]) },
    keep
  );
  assert.ok(keep.has(`${prior.slice(1)}/`));
  await assert.rejects(
    protectPlayerReferences({ readOptional: async () => ['/reports/players'] }, new Set([current])),
    /Invalid/
  );
  await assert.rejects(protectPlayerReferences({ readOptional: async () => ({}) }, new Set([current])), /Invalid/);
  await protectPlayerReferences({ readOptional: async () => null }, new Set([current]));
});

test('publication requires completed producer inputs, not just pre-existing output files', () => {
  for (const state of [
    null,
    { status: 'building' as const, inputs: 'a', revision: 'v1' },
    { status: 'complete' as const, inputs: 'old', revision: 'v1' }
  ]) {
    assert.throws(() => assertProducerComplete(state, 'a', 'players'), /completed generation/);
  }
  assertProducerComplete({ status: 'complete', inputs: 'a', revision: 'v1' }, 'a', 'players');
});
