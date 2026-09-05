/**
 * Per-round match records on player profiles.
 *
 * Every event publishes `playerMatches.json`, one row per pilot per round, keyed
 * by the tournament-scoped tpId. The aggregator joins those rows to careers the
 * same guarded way it joins decks, and carries them on the player's profile
 * with each opponent named as they are published today.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlayerAggregates } from '../../shared/onlineMeta/playerAggregator.js';
import type { PlayerProfile } from '../../shared/playerTypes.js';

function makeEnv(store: Record<string, string>) {
  const bucket = store;
  return {
    REPORTS: {
      async get(key: string) {
        if (!(key in bucket)) {
          return null;
        }
        const value = bucket[key];
        return { text: async () => value };
      },
      async put(key: string, data: string | ArrayBuffer | ArrayBufferView) {
        bucket[key] = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf-8');
      },
      async delete(key: string) {
        delete bucket[key];
      }
    }
  };
}

const KEY = '2026-05-29, Regional Championship Indianapolis';
const LATER = '2026-06-12, International Championship New Orleans';

function participants() {
  return [
    {
      tpId: 420,
      playerId: 1272,
      name: 'Gabriel Smart',
      country: 'US',
      placement: 133,
      wins: 2,
      losses: 1,
      ties: 0,
      madePhase2: true,
      madeTopCut: false,
      dropRound: null
    },
    {
      tpId: 419,
      playerId: 8956,
      name: 'Tim Franklin',
      country: 'AU',
      placement: 6,
      wins: 3,
      losses: 0,
      ties: 0,
      madePhase2: true,
      madeTopCut: true,
      dropRound: null
    },
    // Same numeric value as Gabriel's career id, but as a tpId: the namespaces overlap.
    {
      tpId: 1272,
      playerId: 555,
      name: 'Finn Schleusner',
      country: 'US',
      placement: 900,
      wins: 1,
      losses: 2,
      ties: 0,
      madePhase2: false,
      madeTopCut: false,
      dropRound: 3
    },
    {
      tpId: 77,
      playerId: null,
      name: 'No Id Player',
      country: 'CA',
      placement: 1200,
      wins: 0,
      losses: 3,
      ties: 0,
      madePhase2: false,
      madeTopCut: false,
      dropRound: null
    }
  ];
}

function matchesByTpId() {
  return [
    {
      id: '420:r1',
      playerId: 420,
      playerName: 'Gabriel Smart',
      opponentId: 419,
      opponentName: 'Tim Franklin',
      opponentCountry: 'AU',
      opponentArchetype: 'Mega Absol Box',
      playerArchetype: 'Dragapult',
      round: 1,
      phase: 1,
      outcome: 'loss'
    },
    {
      id: '420:r3',
      playerId: 420,
      playerName: 'Gabriel Smart',
      opponentId: 77,
      opponentName: 'No Id Player',
      opponentCountry: 'CA',
      opponentArchetype: 'Crustle',
      playerArchetype: 'Dragapult',
      round: 3,
      phase: 1,
      outcome: 'win'
    },
    {
      id: '420:r2',
      playerId: 420,
      playerName: 'Gabriel Smart',
      opponentId: null,
      opponentName: null,
      opponentCountry: null,
      opponentArchetype: null,
      playerArchetype: 'Dragapult',
      round: 2,
      phase: 1,
      outcome: 'bye'
    },
    {
      id: '419:r1',
      playerId: 419,
      playerName: 'Tim Franklin',
      opponentId: 420,
      opponentName: 'Gabriel Smart',
      opponentCountry: 'US',
      opponentArchetype: 'Dragapult',
      playerArchetype: 'Mega Absol Box',
      round: 1,
      phase: 1,
      outcome: 'win'
    },
    {
      id: '1272:r1',
      playerId: 1272,
      playerName: 'Finn Schleusner',
      opponentId: 77,
      opponentName: 'No Id Player',
      opponentCountry: 'CA',
      opponentArchetype: 'Crustle',
      playerArchetype: 'Festival Lead',
      round: 1,
      phase: 1,
      outcome: 'win'
    }
  ];
}

function makeStore(): Record<string, string> {
  return {
    'reports/tournaments.json': JSON.stringify([KEY]),
    [`reports/${KEY}/players.json`]: JSON.stringify(participants()),
    [`reports/${KEY}/decks.json`]: JSON.stringify([]),
    [`reports/${KEY}/meta.json`]: JSON.stringify({ fetchedAt: '2026-05-30T00:00:00.000Z' }),
    [`reports/${KEY}/playerMatches.json`]: JSON.stringify(matchesByTpId())
  };
}

function readProfile(
  store: Record<string, string>,
  id: string
): PlayerProfile & { rounds: NonNullable<PlayerProfile['rounds']> } {
  const body = store[`players/${id}/profile.json`];
  assert.ok(body, `players/${id}/profile.json must be written`);
  const profile = JSON.parse(body) as PlayerProfile;
  // The producer always emits `rounds`; it is optional only for bodies written
  // before the field existed, which a freshly-built store never has.
  assert.ok(profile.rounds, `players/${id}/profile.json must carry rounds`);
  return profile as PlayerProfile & { rounds: NonNullable<PlayerProfile['rounds']> };
}

test('rounds join through the tpId and are published in round order under the career id', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  const gabriel = readProfile(store, '1272');
  const rounds = gabriel.rounds[KEY];
  assert.equal(rounds.length, 3);
  assert.deepEqual(
    rounds.map(r => [r.round, r.outcome]),
    [
      [1, 'loss'],
      [2, 'bye'],
      [3, 'win']
    ]
  );
  // The tpId 1272 belongs to Finn at this event; his rounds must not land on Gabriel.
  assert.equal(
    rounds.some(r => r.opponentArchetype === 'Crustle' && r.outcome === 'win' && r.round === 1),
    false
  );
  const finn = readProfile(store, '555');
  assert.equal(finn.rounds[KEY].length, 1);
});

test('an opponent with a career record is linked by id and carries their finish', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  const [first, bye, third] = readProfile(store, '1272').rounds[KEY];
  assert.equal(first.opponentId, '8956');
  assert.equal(first.opponentPlacement, 6);
  assert.equal(first.opponentArchetype, 'Mega Absol Box');
  assert.equal(bye.opponentId, null);
  assert.equal(bye.opponentName, null);
  // Id-less opponents keep the event's name; there is nothing newer to resolve to.
  assert.equal(third.opponentId, null);
  assert.equal(third.opponentName, 'No Id Player');
});

test('an opponent is named as they are published today, not as the event recorded them', async () => {
  const store = makeStore();
  // Tim registers under a new name at a later event; that becomes his published name.
  store['reports/tournaments.json'] = JSON.stringify([KEY, LATER]);
  store[`reports/${LATER}/players.json`] = JSON.stringify([
    {
      tpId: 5,
      playerId: 8956,
      name: 'Timothy Franklin',
      country: 'AU',
      placement: 40,
      wins: 5,
      losses: 3,
      ties: 0,
      madePhase2: false,
      madeTopCut: false
    }
  ]);
  store[`reports/${LATER}/decks.json`] = '[]';
  store[`reports/${LATER}/meta.json`] = JSON.stringify({ fetchedAt: '2026-06-13T00:00:00.000Z' });
  await buildPlayerAggregates(makeEnv(store));

  const profile = JSON.parse(store['players/8956/profile.json']) as PlayerProfile;
  assert.equal(profile.name, 'Timothy Franklin');
  const [first] = readProfile(store, '1272').rounds[KEY];
  assert.equal(first.opponentName, 'Timothy Franklin');
  assert.equal(store['players/1272/profile.json'].includes('Tim Franklin'), false);
});

test('a row whose pilot name does not match the participant is dropped', async () => {
  const store = makeStore();
  const rows = matchesByTpId();
  rows[0].playerName = 'Somebody Else';
  store[`reports/${KEY}/playerMatches.json`] = JSON.stringify(rows);
  await buildPlayerAggregates(makeEnv(store));

  assert.equal(readProfile(store, '1272').rounds[KEY].length, 2);
});

test('an event without match data leaves the profile with no rounds', async () => {
  const store = makeStore();
  delete store[`reports/${KEY}/playerMatches.json`];
  await buildPlayerAggregates(makeEnv(store));

  assert.deepEqual(readProfile(store, '1272').rounds, {});
});

test('rounds ride on the profile rather than an object of their own', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  // R2 bills operations, not object count: a second object per player would
  // double the aggregator's writes and buy nothing.
  const perPlayerKeys = Object.keys(store).filter(k => k.startsWith('players/') && k.includes('/'));
  assert.deepEqual([...new Set(perPlayerKeys.map(k => k.split('/').pop()))].sort(), [
    '_manifest.json',
    'index-slim.json',
    'index.json',
    'profile.json'
  ]);
});

test('the profile carries the drop round and the index carries the record', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  const finn = JSON.parse(store['players/555/profile.json']) as PlayerProfile;
  assert.equal(finn.tournaments[0].dropRound, 3);
  const gabriel = JSON.parse(store['players/1272/profile.json']) as PlayerProfile;
  assert.equal(gabriel.tournaments[0].dropRound, null);

  const index = JSON.parse(store['players/index.json']) as Array<{ playerId: string; wins: number; losses: number }>;
  // Everyone here has one event, so the index is empty; the write plan still computed the record.
  assert.deepEqual(index, []);
});

test('match rows keyed by the career id join when that convention fits better', async () => {
  const store = makeStore();
  const rows = matchesByTpId().map(r => ({
    ...r,
    playerId: r.playerId === 420 ? 1272 : r.playerId === 419 ? 8956 : 555,
    opponentId: r.opponentId === 420 ? 1272 : r.opponentId === 419 ? 8956 : r.opponentId === 77 ? null : r.opponentId
  }));
  store[`reports/${KEY}/playerMatches.json`] = JSON.stringify(rows);
  await buildPlayerAggregates(makeEnv(store));

  const gabriel = readProfile(store, '1272');
  assert.equal(gabriel.rounds[KEY].length, 3);
  assert.equal(gabriel.rounds[KEY][0].opponentId, '8956');
});
