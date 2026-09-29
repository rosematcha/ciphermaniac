/**
 * tests/data/release-resolver.test.ts
 * Release-aware resolver, the generated module renderer, and the release composer
 * that feeds it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { coerceManifest, createReleaseResolver } from '../../shared/releaseManifest.ts';
import { renderModule } from '../../.github/scripts/generate-release-module.ts';
import { buildReleaseArtifacts } from '../../.github/scripts/publish-release.ts';
import type { ReleaseScope } from '../../shared/data/build/release.ts';

function manifest(): unknown {
  return {
    contractVersion: 2,
    releaseId: '20260713T000000Z-abc',
    publishedAt: '2026-07-13T00:00:00Z',
    roots: {
      online: '/releases/v1/online/aaa',
      trends: '/releases/v1/trends/bbb',
      players: '/releases/v1/players/ccc',
      prices: '/releases/v1/prices/ddd',
      catalogs: '/releases/v1/catalogs/eee',
      snapshots: '/releases/v1/snapshots/fff',
      assets: '/releases/v1/assets/ggg'
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

test('a corrupt embedded manifest fails instead of mixing release and mutable data', () => {
  assert.throws(
    () => createReleaseResolver({ contractVersion: 2, releaseId: 'x', roots: { online: 'reports/mutable' } }),
    /Invalid embedded release manifest/
  );
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

test('renderModule emits null by default, and the composer embeds the manifest it composed', () => {
  assert.match(renderModule(null), /EMBEDDED_RELEASE: ReleaseManifest \| null = null;/);
  const { roots, events } = manifest() as { roots: Record<ReleaseScope, string>; events: Record<string, string> };
  const composed = buildReleaseArtifacts({
    roots,
    events,
    releaseId: '20260713T120000Z-abc1234',
    publishedAt: '2026-07-13T12:00:00Z'
  });
  assert.strictEqual(composed.manifest.roots.online, '/releases/v1/online/aaa');
  assert.match(composed.module, /EMBEDDED_RELEASE: ReleaseManifest \| null =/);
  assert.match(composed.module, /"releaseId": "20260713T120000Z-abc1234"/);
});
