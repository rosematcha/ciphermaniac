import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadProductionRelease,
  productionEventKey,
  productionScopeKey,
  resolveLegacyEventKey
} from '../../.github/scripts/lib/build/productionRelease.ts';
import type { ReleaseManifest } from '../../shared/data/build/release.ts';

const manifest: ReleaseManifest = {
  contractVersion: 2,
  releaseId: 'release-abc',
  publishedAt: '2026-09-12T00:00:00Z',
  roots: {
    online: '/releases/v1/online/aaaaaaaaaaaa',
    trends: '/releases/v1/trends/aaaaaaaaaaaa',
    players: '/releases/v1/players/aaaaaaaaaaaa',
    prices: '/releases/v1/prices/aaaaaaaaaaaa',
    catalogs: '/releases/v1/catalogs/aaaaaaaaaaaa',
    snapshots: '/releases/v1/snapshots/aaaaaaaaaaaa',
    assets: '/releases/v1/assets/aaaaaaaaaaaa'
  },
  events: {
    Event: '/releases/v1/events/Event/bbbbbbbbbbbb',
    '2026-01-01, Event': '/releases/v1/events/2026-01-01, Event/cccccccccccc'
  },
  dependencies: {}
};

function reader(pointer: unknown = { releaseId: manifest.releaseId, manifest: '/releases/v1/manifests/live.json' }) {
  return {
    async read<T>(key: string): Promise<T | null> {
      if (key === 'current.json') {
        return pointer as T;
      }
      if (key === 'releases/v1/manifests/live.json') {
        return manifest as T;
      }
      return null;
    }
  };
}

test('loads and validates the production pointer and manifest', async () => {
  assert.deepEqual(await loadProductionRelease(reader()), manifest);
  assert.equal(productionEventKey(manifest, 'Event', 'decks.json'), 'releases/v1/events/Event/bbbbbbbbbbbb/decks.json');
  assert.equal(
    productionScopeKey(manifest, 'catalogs', 'tournaments.json'),
    'releases/v1/catalogs/aaaaaaaaaaaa/tournaments.json'
  );
  assert.equal(
    resolveLegacyEventKey(manifest, 'reports/2026-01-01, Event/decks.json'),
    'releases/v1/events/2026-01-01, Event/cccccccccccc/decks.json'
  );
});

test('fails closed for missing, malformed, mismatched, or unsafe production references', async () => {
  await assert.rejects(loadProductionRelease(reader(null)), /pointer/);
  await assert.rejects(loadProductionRelease(reader({ releaseId: '../bad' })), /pointer/);
  await assert.rejects(
    loadProductionRelease(reader({ releaseId: manifest.releaseId, manifest: '/reports/tournaments.json' })),
    /manifest key/
  );
  const mismatch = { ...manifest, releaseId: 'different' };
  const mismatchReader = {
    async read<T>(key: string): Promise<T | null> {
      return (
        key === 'current.json'
          ? { releaseId: manifest.releaseId, manifest: '/releases/v1/manifests/live.json' }
          : mismatch
      ) as T;
    }
  };
  await assert.rejects(loadProductionRelease(mismatchReader), /disagree/);
  assert.throws(() => productionEventKey(manifest, 'Missing', 'decks.json'), /absent/);
});
