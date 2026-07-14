/**
 * tests/data/release-manifest.test.ts
 * Immutable release manifest: composition, validation, path resolution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeRelease,
  isScopeArtifactServed,
  type ReleaseComposition,
  resolveEventPath,
  resolveScopePath,
  validateReleaseManifest
} from '../../shared/data/build/release.ts';

function composition(): ReleaseComposition {
  return {
    releaseId: '20260713T000000Z-abc1234',
    publishedAt: '2026-07-13T00:00:00Z',
    roots: {
      online: '/releases/v1/online/aaa111',
      trends: '/releases/v1/trends/bbb222',
      players: '/releases/v1/players/ccc333',
      prices: '/releases/v1/prices/ddd444',
      catalogs: '/releases/v1/catalogs/eee555',
      snapshots: '/releases/v1/snapshots/fff666'
    },
    served: {
      online: ['master.json', 'archetypes/index.json'],
      trends: ['trends.json'],
      players: ['index.json', 'index-slim.json'],
      prices: ['prices.json', 'prices-history.json'],
      catalogs: ['tournaments.json'],
      snapshots: ['index.json']
    },
    events: { 'labs:0042': '/releases/v1/events/labs:0042/999zzz' },
    dependencies: { 'prices.online': 'aaa111' }
  };
}

test('composeRelease produces a valid manifest', () => {
  const manifest = composeRelease(composition());
  assert.deepStrictEqual(validateReleaseManifest(manifest), []);
});

test('resolveScopePath joins the scope root and strips leading slashes', () => {
  const manifest = composeRelease(composition());
  assert.strictEqual(resolveScopePath(manifest, 'online', 'master.json'), '/releases/v1/online/aaa111/master.json');
  assert.strictEqual(
    resolveScopePath(manifest, 'online', '/archetypes/index.json'),
    '/releases/v1/online/aaa111/archetypes/index.json'
  );
});

test('resolveEventPath returns null for an unlinked event', () => {
  const manifest = composeRelease(composition());
  assert.strictEqual(
    resolveEventPath(manifest, 'labs:0042', 'cardUsage.json'),
    '/releases/v1/events/labs:0042/999zzz/cardUsage.json'
  );
  assert.strictEqual(resolveEventPath(manifest, 'labs:9999', 'cardUsage.json'), null);
});

test('composeRelease rejects a mutable (non-immutable) root', () => {
  const bad = composition();
  bad.roots.online = 'reports/Online - Last 14 Days';
  assert.throws(() => composeRelease(bad), /invalid manifest/);
});

test('validateReleaseManifest flags missing scopes and bad paths', () => {
  const errors = validateReleaseManifest({
    contractVersion: 1,
    releaseId: 'r',
    publishedAt: 't',
    roots: { online: '/releases/v1/online/x/' }, // trailing slash + missing scopes
    events: {},
    dependencies: {}
  });
  assert.ok(errors.some(e => e.includes('roots.online')));
  assert.ok(errors.some(e => e.includes('roots.trends: missing')));
});

test('served allowlist: only published keys are served, others are not', () => {
  const manifest = composeRelease(composition());
  assert.strictEqual(isScopeArtifactServed(manifest, 'online', 'master.json'), true);
  assert.strictEqual(isScopeArtifactServed(manifest, 'online', '/master.json'), true); // leading slash tolerated
  assert.strictEqual(isScopeArtifactServed(manifest, 'players', 'index-slim.json'), true);
  assert.strictEqual(isScopeArtifactServed(manifest, 'players', '1272/profile.json'), false); // per-player body unpublished
  assert.strictEqual(isScopeArtifactServed(manifest, 'online', 'conversion.json'), false); // never captured
});

test('validateReleaseManifest requires a served object with per-scope key arrays', () => {
  const noServed = composition() as Partial<ReleaseComposition>;
  delete noServed.served;
  const errors = validateReleaseManifest({ contractVersion: 1, ...noServed });
  assert.ok(errors.some(e => e.includes('served: expected object')));

  const badServed = composeRelease(composition()) as unknown as Record<string, unknown>;
  badServed.served = { ...(badServed.served as object), players: 'not-an-array' };
  assert.ok(validateReleaseManifest(badServed).some(e => e.includes('served.players')));
});

test('a release only replaces changed scope roots (unchanged reuse prior root)', () => {
  const prior = composeRelease(composition());
  // New build: only online changed; every other scope reuses the prior root.
  const next = composeRelease({
    ...composition(),
    releaseId: '20260714T000000Z-def5678',
    roots: { ...prior.roots, online: '/releases/v1/online/new999' }
  });
  assert.strictEqual(next.roots.trends, prior.roots.trends);
  assert.notStrictEqual(next.roots.online, prior.roots.online);
});
