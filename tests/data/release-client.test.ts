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
    served: {
      online: ['master.json', 'decks.json', 'meta.json', 'cardUsage.json', 'archetypes/index.json'],
      trends: ['trends.json', 'meta.json', 'majors-trends.json'],
      players: ['index.json', 'index-slim.json'],
      prices: ['prices.json', 'prices-history.json'],
      catalogs: ['tournaments.json'],
      snapshots: ['index.json']
    },
    events: { '2026-01-16, Regional X': '/releases/v1/events/2026-01-16, Regional X/999' },
    dependencies: {}
  });
  // Served keys rewrite to their immutable roots.
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Online - Last 14 Days/master.json'),
    '/releases/v1/online/aaa/master.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Trends - Last 30 Days/trends.json'),
    '/releases/v1/trends/bbb/trends.json'
  );
  assert.strictEqual(resolvePathWith(resolver, '/players/index-slim.json'), '/releases/v1/players/ccc/index-slim.json');
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/tournaments.json'),
    '/releases/v1/catalogs/eee/tournaments.json'
  );
  assert.strictEqual(resolvePathWith(resolver, '/reports/prices.json'), '/releases/v1/prices/ddd/prices.json');
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/majors-trends.json'),
    '/releases/v1/trends/bbb/majors-trends.json'
  );
  // UNPUBLISHED keys pass through to legacy: per-player bodies, and online files
  // the release never captured (conversion doesn't exist for the online window).
  assert.strictEqual(resolvePathWith(resolver, '/players/1272/profile.json'), '/players/1272/profile.json');
  assert.strictEqual(resolvePathWith(resolver, '/players/1272/decks.json'), '/players/1272/decks.json');
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Online - Last 14 Days/conversion.json'),
    '/reports/Online - Last 14 Days/conversion.json'
  );
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/Snapshots/2025-05-01/master.json'),
    '/reports/Snapshots/2025-05-01/master.json'
  );
  // Event-folder paths resolve when the event is in the embedded map.
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/2026-01-16, Regional X/master.json'),
    '/releases/v1/events/2026-01-16, Regional X/999/master.json'
  );
  // An event NOT in the map passes through.
  assert.strictEqual(
    resolvePathWith(resolver, '/reports/2026-02-01, Other/master.json'),
    '/reports/2026-02-01, Other/master.json'
  );
});

test('missing-release-body recovery: reload once for a release path, never for legacy or twice', async () => {
  const { planMissingBodyRecovery, isReleasePath } = await import('../../src/lib/releaseClient.ts');
  // Release-aware + immutable release path + not yet reloaded -> one reload.
  assert.strictEqual(planMissingBodyRecovery('/releases/v1/online/aaa/master.json', true, false), 'reload');
  // Already reloaded once -> passthrough (no loop; must not combine roots).
  assert.strictEqual(planMissingBodyRecovery('/releases/v1/online/aaa/master.json', true, true), 'passthrough');
  // A legacy path 404 is a normal miss, never a recovery reload.
  assert.strictEqual(planMissingBodyRecovery('/reports/Online - Last 14 Days/master.json', true, false), 'passthrough');
  // Not release-aware (production default) -> never reloads.
  assert.strictEqual(planMissingBodyRecovery('/releases/v1/online/aaa/master.json', false, false), 'passthrough');
  assert.strictEqual(isReleasePath('/releases/v1/x/y.json'), true);
  assert.strictEqual(isReleasePath('/reports/x/y.json'), false);
});
