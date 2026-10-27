/**
 * Non-Standard format reports as a card-discovery source: the formats index,
 * the optional `formats` release root, and their per-format deck corpora.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { formatRoots, releaseFormatRoots, releaseFormatsRoot } from '../../.github/scripts/lib/build/formatReports.ts';
import { loadFormatDecks } from '../../.github/scripts/lib/build/onlineDecks.ts';
import type { ReleaseManifest } from '../../shared/data/build/release.ts';

function reader(values: Record<string, unknown>) {
  return { read: async <T>(key: string) => (values[key] as T | undefined) ?? null };
}

const INDEX = {
  generatedAt: '2026-10-27T00:00:00Z',
  formats: [
    { id: 'rs-pk', label: 'RS-PK', window: 'Last 60 days', events: 15, decks: 180 },
    { id: 'expanded', label: 'Expanded', window: 'PBL era', events: 20, decks: 167 }
  ]
};

const ROOTS = {
  online: '/releases/v1/online/aaaaaaaaaaaa',
  trends: '/releases/v1/trends/aaaaaaaaaaaa',
  players: '/releases/v1/players/aaaaaaaaaaaa',
  prices: '/releases/v1/prices/aaaaaaaaaaaa',
  catalogs: '/releases/v1/catalogs/aaaaaaaaaaaa',
  snapshots: '/releases/v1/snapshots/aaaaaaaaaaaa',
  assets: '/releases/v1/assets/aaaaaaaaaaaa'
};

function manifest(extraRoots: Record<string, string> = {}): ReleaseManifest {
  return {
    contractVersion: 2,
    releaseId: 'release-abc',
    publishedAt: '2026-10-27T00:00:00Z',
    roots: { ...ROOTS, ...extraRoots },
    events: {},
    dependencies: {}
  };
}

test('no formats index means no format folders', async () => {
  assert.deepEqual(await formatRoots(reader({})), []);
});

test('every indexed format is a folder under the formats root', async () => {
  assert.deepEqual(await formatRoots(reader({ 'reports/Formats/index.json': INDEX })), [
    'reports/Formats/rs-pk',
    'reports/Formats/expanded'
  ]);
  assert.deepEqual(await formatRoots(reader({ 'gen/index.json': { formats: [{ id: 'efg' }] } }), 'gen'), ['gen/efg']);
});

test('a malformed index or an unsafe id fails closed rather than dropping formats', async () => {
  await assert.rejects(formatRoots(reader({ 'reports/Formats/index.json': {} })), /Invalid formats index/);
  for (const id of ['../escape', '/abs', 'a//b', '', 7]) {
    await assert.rejects(
      formatRoots(reader({ 'reports/Formats/index.json': { formats: [{ id }] } })),
      /Invalid formats index entry/,
      String(id)
    );
  }
});

test('a release without a formats root has no formats, without reading anything', async () => {
  assert.equal(releaseFormatsRoot(manifest()), null);
  const reads: string[] = [];
  const spy = {
    read: async <T>(key: string): Promise<T | null> => {
      reads.push(key);
      return null;
    }
  };
  assert.deepEqual(await releaseFormatRoots(spy, manifest()), []);
  assert.deepEqual(reads, []);
});

test('a release formats root resolves its index to bucket keys', async () => {
  const release = manifest({ formats: '/releases/v1/formats/dddddddddddd' });
  assert.equal(releaseFormatsRoot(release), 'releases/v1/formats/dddddddddddd');
  const values = { 'releases/v1/formats/dddddddddddd/index.json': INDEX };
  assert.deepEqual(await releaseFormatRoots(reader(values), release), [
    'releases/v1/formats/dddddddddddd/rs-pk',
    'releases/v1/formats/dddddddddddd/expanded'
  ]);
  // The scope exists but nothing is published in it yet.
  assert.deepEqual(await releaseFormatRoots(reader({}), release), []);
});

test('format deck corpora read like the online one and concatenate', async () => {
  const values = {
    'f/rs-pk/decks/index.json': ['archetypes/A/decks.json', 'decks/other.json'],
    'f/rs-pk/archetypes/A/decks.json': [{ id: 'a' }],
    'f/rs-pk/decks/other.json': [{ id: 'other' }],
    'f/expanded/decks/index.json': ['decks/other.json'],
    'f/expanded/decks/other.json': [{ id: 'x' }]
  };
  assert.deepEqual(await loadFormatDecks(reader(values), ['f/rs-pk', 'f/expanded']), [
    { id: 'a' },
    { id: 'other' },
    { id: 'x' }
  ]);
  assert.deepEqual(await loadFormatDecks(reader(values), []), []);
  await assert.rejects(
    loadFormatDecks(reader({ 'f/rs-pk/decks/index.json': ['decks/other.json'] }), ['f/rs-pk']),
    /Missing/
  );
});
