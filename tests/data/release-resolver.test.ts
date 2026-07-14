/**
 * tests/data/release-resolver.test.ts
 * Release-aware resolver with legacy fallback + the generated module renderer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { coerceManifest, createReleaseResolver } from '../../shared/releaseManifest.ts';
import { renderModule } from '../../.github/scripts/generate-release-module.ts';

function manifest(): unknown {
  return {
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
      online: ['master.json'],
      trends: ['trends.json'],
      players: ['index.json', 'index-slim.json'],
      prices: ['prices.json', 'prices-history.json'],
      catalogs: ['tournaments.json'],
      snapshots: ['index.json']
    },
    events: { 'labs:0042': '/releases/v1/events/labs:0042/999' },
    dependencies: {}
  };
}

test('no embedded manifest falls back to legacy paths (no-op for production)', () => {
  const resolver = createReleaseResolver(null);
  assert.strictEqual(resolver.isReleaseAware, false);
  assert.strictEqual(resolver.releaseId, null);
  assert.strictEqual(resolver.scopePath('online', 'master.json'), 'reports/Online - Last 14 Days/master.json');
  assert.strictEqual(resolver.eventPath('labs:0042', 'cardUsage.json'), null);
});

test('an embedded manifest resolves immutable release roots', () => {
  const resolver = createReleaseResolver(manifest());
  assert.strictEqual(resolver.isReleaseAware, true);
  assert.strictEqual(resolver.scopePath('online', 'master.json'), '/releases/v1/online/aaa/master.json');
  assert.strictEqual(
    resolver.eventPath('labs:0042', 'cardUsage.json'),
    '/releases/v1/events/labs:0042/999/cardUsage.json'
  );
});

test('servesScopePath is true only for published keys; false in legacy mode', () => {
  const resolver = createReleaseResolver(manifest());
  assert.strictEqual(resolver.servesScopePath('online', 'master.json'), true);
  assert.strictEqual(resolver.servesScopePath('players', 'index-slim.json'), true);
  assert.strictEqual(resolver.servesScopePath('players', '1272/profile.json'), false);
  assert.strictEqual(resolver.servesScopePath('online', 'conversion.json'), false);
  assert.strictEqual(createReleaseResolver(null).servesScopePath('online', 'master.json'), false);
});

test('a corrupt embedded manifest degrades to legacy rather than throwing', () => {
  const resolver = createReleaseResolver({ contractVersion: 1, releaseId: 'x', roots: { online: 'reports/mutable' } });
  assert.strictEqual(resolver.isReleaseAware, false);
  assert.strictEqual(resolver.scopePath('trends', 'trends.json'), 'reports/Trends - Last 30 Days/trends.json');
});

test('coerceManifest accepts a valid manifest and rejects junk', () => {
  assert.ok(coerceManifest(manifest()));
  assert.strictEqual(coerceManifest({ nope: true }), null);
  assert.strictEqual(coerceManifest(null), null);
});

test('the resolver is frozen (roots cannot be mutated mid-session)', () => {
  const resolver = createReleaseResolver(manifest());
  assert.throws(() => {
    (resolver as { isReleaseAware: boolean }).isReleaseAware = false;
  }, TypeError);
});

test('renderModule emits null by default and a typed manifest when given one', () => {
  assert.match(renderModule(null), /EMBEDDED_RELEASE: ReleaseManifest \| null = null;/);
  assert.match(renderModule(manifest()), /"releaseId": "20260713T000000Z-abc"/);
});
