/**
 * tests/data/build-loop-event-capture.test.ts
 * Which event folders the release build captures into immutable roots.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { assertNoEventRegression, validateEventSources } from '../../.github/scripts/build-loop.ts';
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
