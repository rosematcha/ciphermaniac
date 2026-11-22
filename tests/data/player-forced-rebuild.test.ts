/**
 * A forced rebuild ignores the stored manifest for reuse, but it still has to delete the files of
 * players who dropped out, and the index order must not depend on the order players were seen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlayerAggregates } from '../../shared/onlineMeta/playerAggregator.js';

const EVENT = '2026-01-10, Regional Shared';

function makeEnv(store: Record<string, string>) {
  return {
    REPORTS: {
      async get(key: string) {
        return key in store ? { text: async () => store[key] } : null;
      },
      async put(key: string, data: string) {
        Object.assign(store, { [key]: data });
      },
      async delete(key: string) {
        Reflect.deleteProperty(store, key);
      }
    }
  };
}

function participant(playerId: number, name: string) {
  return {
    tpId: playerId,
    playerId,
    name,
    country: 'US',
    placement: playerId,
    wins: 4,
    losses: 2,
    ties: 0,
    madePhase2: false,
    madeTopCut: false
  };
}

function makeStore(players: ReturnType<typeof participant>[]): Record<string, string> {
  return {
    'reports/tournaments.json': JSON.stringify([EVENT]),
    [`reports/${EVENT}/players.json`]: JSON.stringify(players),
    [`reports/${EVENT}/decks.json`]: JSON.stringify([]),
    [`reports/${EVENT}/meta.json`]: JSON.stringify({ fetchedAt: '2026-01-11T00:00:00.000Z' })
  };
}

test('a forced rebuild deletes the files of players who dropped out', async () => {
  const store = makeStore([participant(1, 'Ash Ketchum'), participant(2, 'Tim Franklin')]);
  const env = makeEnv(store);
  await buildPlayerAggregates(env);
  assert.ok(store['players/2/profile.json']);

  store[`reports/${EVENT}/players.json`] = JSON.stringify([participant(1, 'Ash Ketchum')]);
  await buildPlayerAggregates(env, { forceFullRebuild: true });
  assert.equal(store['players/2/profile.json'], undefined);
  assert.ok(store['players/1/profile.json']);
});

test('players tied on date and event count are indexed by id, whatever order they were seen in', async () => {
  const players = [participant(3, 'Third'), participant(1, 'First'), participant(2, 'Second')];
  const later = '2026-02-10, Regional Later';
  // The index lists players with two or more events.
  const store: Record<string, string> = {
    ...makeStore(players),
    'reports/tournaments.json': JSON.stringify([EVENT, later]),
    [`reports/${later}/players.json`]: JSON.stringify(players),
    [`reports/${later}/decks.json`]: JSON.stringify([]),
    [`reports/${later}/meta.json`]: JSON.stringify({ fetchedAt: '2026-02-11T00:00:00.000Z' })
  };
  await buildPlayerAggregates(makeEnv(store));
  const index = JSON.parse(store['players/index.json']) as { playerId: string }[];
  assert.deepEqual(
    index.map(entry => entry.playerId),
    ['1', '2', '3']
  );
});

test('a forced rebuild that could not read an event keeps that event players files', async () => {
  const later = '2026-02-10, Regional Later';
  const store: Record<string, string> = {
    ...makeStore([participant(1, 'Ash Ketchum')]),
    'reports/tournaments.json': JSON.stringify([EVENT, later]),
    [`reports/${later}/players.json`]: JSON.stringify([participant(2, 'Tim Franklin')]),
    [`reports/${later}/decks.json`]: JSON.stringify([]),
    [`reports/${later}/meta.json`]: JSON.stringify({ fetchedAt: '2026-02-11T00:00:00.000Z' })
  };
  const env = makeEnv(store);
  await buildPlayerAggregates(env);
  assert.ok(store['players/2/profile.json']);

  Reflect.deleteProperty(store, `reports/${later}/players.json`);
  const rebuild = await buildPlayerAggregates(env, { forceFullRebuild: true });
  assert.equal(rebuild.tournamentsSkipped, 1);
  assert.ok(store['players/2/profile.json'], 'a skipped event is not a player dropping out');
});

test('a run that needs every event writes nothing when one cannot be read', async () => {
  const later = '2026-02-10, Regional Later';
  const store: Record<string, string> = {
    ...makeStore([participant(1, 'Ash Ketchum')]),
    'reports/tournaments.json': JSON.stringify([EVENT, later]),
    [`reports/${later}/players.json`]: JSON.stringify([participant(1, 'Ash Ketchum'), participant(2, 'Tim Franklin')]),
    [`reports/${later}/decks.json`]: JSON.stringify([]),
    [`reports/${later}/meta.json`]: JSON.stringify({ fetchedAt: '2026-02-11T00:00:00.000Z' })
  };
  const env = makeEnv(store);
  await buildPlayerAggregates(env);
  Reflect.deleteProperty(store, `reports/${later}/players.json`);
  const before = { ...store };
  for (const forceFullRebuild of [true, false]) {
    await assert.rejects(
      buildPlayerAggregates(env, { forceFullRebuild, requireEveryEvent: true, fingerprintOf: key => key }),
      /could not be read/
    );
    assert.deepEqual(store, before);
  }
});

test('a failed player write starts no further writes and leaves the manifest unpublished', async () => {
  const players = Array.from({ length: 50 }, (_, index) => participant(index + 1, `Player ${index + 1}`));
  const store = makeStore(players);
  const started: string[] = [];
  const env = makeEnv(store);
  const write = env.REPORTS.put;
  env.REPORTS.put = async (key: string, data: string) => {
    started.push(key);
    if (key === 'players/1/profile.json') {
      throw new Error('PUT refused');
    }
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    return write(key, data);
  };
  await assert.rejects(buildPlayerAggregates(env, { r2Concurrency: 8 }), /PUT refused/);
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise(resolve => {
      setImmediate(resolve);
    });
  }
  assert.ok(started.length <= 8, `${started.length} writes started`);
  assert.equal(store['players/_manifest.json'], undefined);
});

test('an unreadable event protects only its own players, so others who drop out are still deleted', async () => {
  const empty = '2026-03-10, Regional Empty';
  const store: Record<string, string> = {
    ...makeStore([participant(1, 'Ash Ketchum'), participant(2, 'Tim Franklin')]),
    'reports/tournaments.json': JSON.stringify([EVENT, empty]),
    [`reports/${empty}/players.json`]: JSON.stringify([]),
    [`reports/${empty}/decks.json`]: JSON.stringify([]),
    [`reports/${empty}/meta.json`]: JSON.stringify({ fetchedAt: '2026-03-11T00:00:00.000Z' })
  };
  const env = makeEnv(store);
  await buildPlayerAggregates(env);
  assert.ok(store['players/2/profile.json']);
  store[`reports/${EVENT}/players.json`] = JSON.stringify([participant(1, 'Ash Ketchum')]);
  await buildPlayerAggregates(env);
  assert.equal(store['players/2/profile.json'], undefined);
});
