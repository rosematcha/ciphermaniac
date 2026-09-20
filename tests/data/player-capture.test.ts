import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePlayers, planPlayerCapture } from '../../.github/scripts/lib/build/playerCapture';
import { protectPlayerReferences } from '../../.github/scripts/prune-releases';
import { assertProducerComplete } from '../../.github/scripts/lib/build/provenance';

const object = { sourceKey: 'players/1/profile.json', relativeKey: '1/profile.json', etag: 'one', size: 20 };
const prior = '/releases/v1/players/aaaaaaaaaaaa';
const previous = { '1/profile.json': { etag: 'one', size: 20, path: `${prior}/1/profile.json` } };

test('unchanged player bodies retain their immutable reference while changed bodies are copied', () => {
  const current = '/releases/v1/players/bbbbbbbbbbbb';
  const plan = planPlayerCapture([object, { ...object, relativeKey: '2/profile.json' }], previous, current, prior);
  assert.equal(plan.copies.length, 1);
  assert.equal(plan.inventory['1/profile.json'].path, previous['1/profile.json'].path);
  assert.equal(plan.inventory['2/profile.json'].path, `${current}/2/profile.json`);
  assert.equal(planPlayerCapture([{ ...object, etag: 'changed' }], previous, current, prior).copies.length, 1);
  assert.deepEqual(planPlayerCapture([], previous, current, prior).inventory, {});
  const transitive = {
    '1/profile.json': { ...previous['1/profile.json'], path: '/releases/v1/players/older/1/profile.json' }
  };
  assert.equal(planPlayerCapture([object], transitive, current, prior).copies.length, 1);
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
