/**
 * tests/data/publish-release.test.ts
 * Release composer: valid manifest + embed module, rejects mutable roots.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReleaseArtifacts } from '../../.github/scripts/publish-release.ts';
import type { ReleaseScope } from '../../shared/data/build/release.ts';

function roots(): Record<ReleaseScope, string> {
  return {
    online: '/releases/v1/online/a',
    trends: '/releases/v1/trends/b',
    players: '/releases/v1/players/c',
    prices: '/releases/v1/prices/d',
    catalogs: '/releases/v1/catalogs/e',
    snapshots: '/releases/v1/snapshots/f'
  };
}

test('composes a valid manifest and a matching embed module', () => {
  const { manifest, module } = buildReleaseArtifacts({
    roots: roots(),
    releaseId: '20260713T120000Z-abc1234',
    publishedAt: '2026-07-13T12:00:00Z',
    events: { 'labs:0042': '/releases/v1/events/labs:0042/g' }
  });
  assert.strictEqual(manifest.releaseId, '20260713T120000Z-abc1234');
  assert.strictEqual(manifest.roots.online, '/releases/v1/online/a');
  assert.match(module, /"releaseId": "20260713T120000Z-abc1234"/);
  assert.match(module, /EMBEDDED_RELEASE: ReleaseManifest \| null =/);
});

test('refuses to compose a release pointing at a mutable root', () => {
  const bad = roots();
  bad.online = 'reports/Online - Last 14 Days';
  assert.throws(
    () => buildReleaseArtifacts({ roots: bad, releaseId: 'r', publishedAt: 't' }),
    /invalid manifest/
  );
});
