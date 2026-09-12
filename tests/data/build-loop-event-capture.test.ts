/**
 * tests/data/build-loop-event-capture.test.ts
 * Which event folders the release build captures into immutable roots.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  assertNoEventRegression,
  buildEvent,
  eventNeedsPublication,
  planEventCapture
} from '../../.github/scripts/build-loop.ts';

const populated = { decks: [{ playerId: '1' }], players: [{ tpId: 1 }], meta: { name: 'Event' } };

const reasonFor = (bodies: Parameters<typeof planEventCapture>[0]): string => {
  const plan = planEventCapture(bodies);
  assert.equal(plan.capture, false, 'expected the folder to be skipped');
  return plan.capture ? '' : plan.reason;
};

test('a populated event folder is captured, carrying its bodies through', () => {
  const plan = planEventCapture(populated);
  assert.equal(plan.capture, true);
  assert.deepEqual(plan.capture ? plan.decks : null, populated.decks);
});

test('an event whose decklists are not published yet is skipped', () => {
  // Labs publishes standings first; capturing here would freeze deckTotal:0
  // into an immutable release body that serves 200 and never falls back.
  assert.equal(reasonFor({ ...populated, decks: [] }), '0 decks (decklists not published yet)');
});

test('a folder missing any required body is skipped, naming what is absent', () => {
  assert.equal(reasonFor({ ...populated, decks: null }), 'missing decks.json');
  assert.equal(reasonFor({ ...populated, players: null }), 'missing players.json');
  assert.equal(reasonFor({ ...populated, meta: null }), 'missing meta.json');
  assert.equal(reasonFor({ decks: null, players: null, meta: null }), 'missing decks.json, players.json, meta.json');
});

test('completed event generations are reused and inconsistent markers stop publication', () => {
  assert.equal(eventNeedsPublication(null, 'abc', 3), true);
  assert.equal(eventNeedsPublication({ generation: 'abc', objectCount: 3 }, 'abc', 3), false);
  assert.throws(() => eventNeedsPublication({ generation: 'other', objectCount: 3 }, 'abc', 3));
  assert.throws(() => eventNeedsPublication({ generation: 'abc', objectCount: 2 }, 'abc', 3));
});

test('publishing an unchanged event a second time writes no objects', async () => {
  const folder = '2026-01-01, Event';
  const bodies = new Map<string, unknown>([
    [`reports/${folder}/decks.json`, [{ playerId: '1', archetype: 'Test', cards: [] }]],
    [`reports/${folder}/players.json`, [{ tpId: 1, name: 'Test', wins: 1, losses: 0, ties: 0 }]],
    [`reports/${folder}/meta.json`, { name: 'Event', date: '2026-01-01', players: 1 }]
  ]);
  const written: string[] = [];
  const context = {
    load: async <T>(key: string): Promise<T | null> => (bodies.get(key) as T | undefined) ?? null,
    publish: async (key: string, body: unknown) => {
      written.push(key);
      bodies.set(key, body);
    },
    gen: () => 'aaaaaaaaaaaa',
    synonyms: null
  };
  const root = await buildEvent(folder, context);
  assert.ok(written.length > 1);
  written.length = 0;
  assert.equal(await buildEvent(folder, context), root);
  assert.deepEqual(written, []);
  bodies.delete(`reports/${folder}/decks.json`);
  assert.equal(await buildEvent(folder, context), null);
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
