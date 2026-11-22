/**
 * tests/data/build-loop-event-capture.test.ts
 * Which event folders the release build captures into immutable roots.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import type { S3Client } from '@aws-sdk/client-s3';
import {
  assertNoEventRegression,
  captureScope,
  dropStaleRouteTable,
  validateEventSources
} from '../../.github/scripts/build-loop.ts';
import { routeTableSource } from '../../.github/scripts/lib/synonymObjects.ts';
import { loadEventSources } from '../../.github/scripts/lib/build/productionRelease.ts';

test('release builds read immutable production events with pending overrides', async () => {
  const event = '2026-01-01, Event';
  const roots = {
    online: '/releases/v1/online/aaaaaaaaaaaa',
    trends: '/releases/v1/trends/aaaaaaaaaaaa',
    players: '/releases/v1/players/aaaaaaaaaaaa',
    prices: '/releases/v1/prices/aaaaaaaaaaaa',
    catalogs: '/releases/v1/catalogs/aaaaaaaaaaaa',
    snapshots: '/releases/v1/snapshots/aaaaaaaaaaaa',
    assets: '/releases/v1/assets/aaaaaaaaaaaa'
  };
  const manifest = {
    contractVersion: 2,
    releaseId: 'active',
    publishedAt: '2026-09-12T00:00:00Z',
    roots,
    events: { [event]: `/releases/v1/events/${event}/bbbbbbbbbbbb` },
    dependencies: {}
  };
  const bodies = {
    'current.json': { releaseId: 'active', manifest: '/releases/v1/manifests/active.json' },
    'releases/v1/manifests/active.json': manifest,
    'pending-events.json': { events: { [event]: `/releases/v1/events/${event}/cccccccccccc` } }
  };
  const load = async <T>(key: string): Promise<T | null> => (bodies[key as keyof typeof bodies] as T) ?? null;
  const result = await loadEventSources({ read: load });
  assert.equal(result.sources[event], `/releases/v1/events/${event}/cccccccccccc`);
});

test('release promotion requires a complete immutable event generation', async () => {
  const folder = '2026-01-01, Event';
  const root = `releases/v1/events/${folder}/aaaaaaaaaaaa`;
  const complete = {
    [`${root}/_complete.json`]: { generation: 'aaaaaaaaaaaa', objectCount: 3 },
    [`${root}/decks.json`]: [],
    [`${root}/meta.json`]: { name: 'Event' },
    [`${root}/master.json`]: { items: [] }
  };
  const read = async <T>(key: string): Promise<T | null> => (complete[key as keyof typeof complete] as T) ?? null;
  assert.deepEqual(await validateEventSources({ [folder]: `/${root}` }, read), { [folder]: `/${root}` });
  delete (complete as Partial<typeof complete>)[`${root}/master.json`];
  await assert.rejects(validateEventSources({ [folder]: `/${root}` }, read), /incomplete/);
});

test('the captured event set cannot silently omit an event served by production', async () => {
  const load = async <T>(key: string): Promise<T | null> =>
    (({
      'current.json': { releaseId: 'active', manifest: '/releases/v1/manifests/active.json' },
      'releases/v1/manifests/active.json': { events: { '2026-01-01, Event': '/releases/v1/events/aaa' } }
    })[key] as T | undefined) ?? null;
  await assertNoEventRegression(['2026-01-01, Event'], load);
  await assert.rejects(assertNoEventRegression([], load), /event regression/);
});

test('the old cleanup flag is rejected before any credentials or writes are used', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '.github/scripts/build-loop.ts', '--write', '--gc'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--gc is unsafe/);
});

test('a generation production already serves is checked by its marker alone', async () => {
  const folder = '2026-01-01, Event';
  const root = `/releases/v1/events/${folder}/aaaaaaaaaaaa`;
  const read = async <T>(key: string): Promise<T | null> => {
    if (key !== `${root.slice(1)}/_complete.json`) {
      throw new Error(`unexpected read of ${key}`);
    }
    return { generation: 'aaaaaaaaaaaa', objectCount: 3 } as T;
  };
  assert.deepEqual(await validateEventSources({ [folder]: root }, read, { [folder]: root }), { [folder]: root });
  const missingMarker = async <T>(): Promise<T | null> => null;
  await assert.rejects(validateEventSources({ [folder]: root }, missingMarker, { [folder]: root }), /incomplete/);
});

test('a route table solved from another synonym map is left out of the release', async () => {
  const synonyms = { 'Iono::PAL::269': 'Iono::PAL::185' };
  const captures = () => [
    {
      scope: 'assets' as const,
      objects: ['card-routes.json', 'card-synonyms.json'].map(relativeKey => ({
        sourceKey: `assets/${relativeKey}`,
        relativeKey,
        etag: 'e',
        size: 1
      }))
    }
  ];
  for (const [source, kept] of [
    [routeTableSource(synonyms), true],
    [routeTableSource({}), false],
    [undefined, false]
  ] as const) {
    const bodies: Record<string, unknown> = {
      'assets/card-routes.json': { source, routes: {} },
      'assets/card-synonyms.json': { synonyms }
    };
    const scopes = captures();
    await dropStaleRouteTable(scopes, async <T>(key: string) => (bodies[key] as T) ?? null);
    assert.equal(
      scopes[0].objects.some(object => object.relativeKey === 'card-routes.json'),
      kept
    );
  }
});

test('a scope copy that fails for good starts no further copies and writes no marker', async () => {
  const sent: string[] = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: { Key: string } }) => {
      const kind = command.constructor.name;
      sent.push(`${kind} ${command.input.Key}`);
      if (kind === 'GetObjectCommand') {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      }
      if (kind === 'CopyObjectCommand' && command.input.Key.endsWith('/0.json')) {
        throw Object.assign(new Error('precondition'), { $metadata: { httpStatusCode: 412 } });
      }
      await new Promise(resolve => {
        setImmediate(resolve);
      });
      return {};
    }
  } as unknown as S3Client;
  const objects = Array.from({ length: 200 }, (_, index) => ({
    sourceKey: `reports/x/${index}.json`,
    relativeKey: `${index}.json`,
    etag: `"${index}"`,
    size: 1
  }));
  await assert.rejects(
    captureScope({ client, bucket: 'b', scope: 'online', objects, write: true, written: [], gen: () => 'g' }),
    /precondition/
  );
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise(resolve => {
      setImmediate(resolve);
    });
  }
  const copies = sent.filter(line => line.startsWith('CopyObjectCommand'));
  assert.ok(copies.length <= 48, `${copies.length} copies started`);
  assert.ok(!sent.some(line => line.includes('_complete.json') && line.startsWith('PutObjectCommand')));
});
