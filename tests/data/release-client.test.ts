/**
 * tests/data/release-client.test.ts
 * Release-aware path resolution: pass-through in production (no manifest).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isReleaseAware, resolveDataPath } from '../../src/lib/releaseClient.ts';

test('production default (no embedded manifest) resolves paths unchanged', () => {
  // The committed generated module exports null, so this is the production state.
  assert.strictEqual(isReleaseAware, false);
  for (const path of [
    '/reports/Online - Last 14 Days/master.json',
    '/reports/Trends - Last 30 Days/trends.json',
    '/reports/2026-01-16, Regional Championship Toronto/decks.json',
    '/players/1272/profile.json',
    '/reports/tournaments.json',
    '/reports/prices.json'
  ]) {
    assert.strictEqual(resolveDataPath(path), path, `path must be unchanged: ${path}`);
  }
});

test('with an embedded manifest, scope paths resolve to immutable release roots', async () => {
  const { createReleaseResolver } = await import('../../shared/releaseManifest.ts');
  const { resolvePathWith } = await import('../../src/lib/releaseClient.ts');
  const resolver = createReleaseResolver({
    contractVersion: 1,
    releaseId: '20260713T000000Z-abc',
    publishedAt: '2026-07-13T00:00:00Z',
    roots: {
      online: '/releases/v1/online/aaa',
      trends: '/releases/v1/trends/bbb',
      players: '/releases/v1/players/ccc',
      prices: '/releases/v1/prices/ddd',
      catalogs: '/releases/v1/catalogs/eee',
      snapshots: '/releases/v1/snapshots/fff'
    },
    events: { '2026-01-16, Regional X': '/releases/v1/events/2026-01-16, Regional X/999' },
    dependencies: {}
  });
  assert.strictEqual(resolvePathWith(resolver, '/reports/Online - Last 14 Days/master.json'), '/releases/v1/online/aaa/master.json');
  assert.strictEqual(resolvePathWith(resolver, '/reports/Trends - Last 30 Days/trends.json'), '/releases/v1/trends/bbb/trends.json');
  assert.strictEqual(resolvePathWith(resolver, '/players/1272/profile.json'), '/releases/v1/players/ccc/1272/profile.json');
  assert.strictEqual(resolvePathWith(resolver, '/reports/tournaments.json'), '/releases/v1/catalogs/eee/tournaments.json');
  assert.strictEqual(resolvePathWith(resolver, '/reports/prices.json'), '/releases/v1/prices/ddd/prices.json');
  assert.strictEqual(resolvePathWith(resolver, '/reports/majors-trends.json'), '/releases/v1/trends/bbb/majors-trends.json');
  // Event-folder paths resolve when the event is in the embedded map.
  assert.strictEqual(resolvePathWith(resolver, '/reports/2026-01-16, Regional X/master.json'), '/releases/v1/events/2026-01-16, Regional X/999/master.json');
  // An event NOT in the map passes through.
  assert.strictEqual(resolvePathWith(resolver, '/reports/2026-02-01, Other/master.json'), '/reports/2026-02-01, Other/master.json');
});
