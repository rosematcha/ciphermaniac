/**
 * Careers built from immutable event artifacts.
 *
 * Immutable events key every participant, deck and match row by an
 * event-scoped id (`labs:0001:12`) and carry the Limitless career id as
 * `playerRef`. Grouping on the event-scoped id splits one player into a
 * separate "career" per event, so the aggregator must group on `playerRef`
 * while still joining decks and rounds through the event-scoped id.
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

const FIRST = '2026-01-10, Regional First';
const SECOND = '2026-02-14, Regional Second';

function participant(eventCode: string, entry: number, playerRef: number, name: string, placement: number) {
  return {
    playerId: `labs:${eventCode}:${entry}`,
    playerRef,
    name,
    country: 'US',
    placement,
    wins: 5,
    losses: 2,
    ties: 0,
    points: 15,
    madePhase2: true,
    madeTopCut: false,
    dropped: placement > 1,
    dropRound: placement > 1 ? 7 : null,
    decklistPublished: true
  };
}

function deck(eventCode: string, entry: number, name: string, archetype: string) {
  return {
    id: `sha256:${eventCode}${entry}`,
    deckId: `sha256:${eventCode}${entry}`,
    player: name,
    playerId: `labs:${eventCode}:${entry}`,
    archetype,
    cards: [{ count: 4, name: 'Dreepy', set: 'TWM', number: '128', category: 'pokemon' }]
  };
}

function round(eventCode: string, entry: number, name: string, opponentEntry: number, opponentName: string) {
  return {
    id: `labs:${eventCode}:${entry}:r1`,
    playerId: `labs:${eventCode}:${entry}`,
    playerName: name,
    opponentId: `labs:${eventCode}:${opponentEntry}`,
    opponentName,
    round: 1,
    phase: 1,
    outcome: 'win'
  };
}

// Ash is entry 3 at the first event and entry 9 at the second; his career id is 1205.
function makeStore(): Record<string, string> {
  return {
    'reports/tournaments.json': JSON.stringify([SECOND, FIRST]),
    [`reports/${FIRST}/players.json`]: JSON.stringify([
      participant('0001', 3, 1205, 'Ash Ketchum', 1),
      participant('0001', 4, 3405, 'Misty Waterflower', 2)
    ]),
    [`reports/${FIRST}/decks.json`]: JSON.stringify([
      deck('0001', 3, 'Ash Ketchum', 'Dragapult'),
      deck('0001', 4, 'Misty Waterflower', 'Gardevoir')
    ]),
    [`reports/${FIRST}/playerMatches.json`]: JSON.stringify([round('0001', 3, 'Ash Ketchum', 4, 'Misty Waterflower')]),
    [`reports/${FIRST}/meta.json`]: JSON.stringify({ name: 'Regional First', labsCode: '0001' }),
    [`reports/${SECOND}/players.json`]: JSON.stringify([participant('0002', 9, 1205, 'Ash Ketchum', 2)]),
    [`reports/${SECOND}/decks.json`]: JSON.stringify([deck('0002', 9, 'Ash Ketchum', 'Charizard')]),
    [`reports/${SECOND}/meta.json`]: JSON.stringify({ name: 'Regional Second', labsCode: '0002' })
  };
}

function readJson<T>(store: Record<string, string>, key: string): T {
  const body = store[key];
  assert.ok(body, `${key} must be written`);
  return JSON.parse(body) as T;
}

test('one career per playerRef, not one per event-scoped participant id', async () => {
  const store = makeStore();
  const result = await buildPlayerAggregates(makeEnv(store));

  assert.equal(result.profileCount, 2);
  assert.equal(
    Object.keys(store).some(key => key.startsWith('players/labs:')),
    false,
    'no profile may be keyed by an event-scoped id'
  );
  const ash = readJson<PlayerProfile>(store, 'players/1205/profile.json');
  assert.equal(ash.summary.eventCount, 2);
  assert.equal(ash.summary.bestPlacement, 1);
});

test('decks, drop rounds and rounds still join through the event-scoped id', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  const ash = readJson<PlayerProfile>(store, 'players/1205/profile.json');
  const bySlice = new Map(ash.tournaments.map(entry => [entry.tournamentId, entry]));
  assert.equal(bySlice.get(FIRST)?.archetype, 'dragapult');
  assert.equal(bySlice.get(FIRST)?.deckId, 'sha256:00013');
  assert.equal(bySlice.get(SECOND)?.archetype, 'charizard');
  assert.equal(bySlice.get(SECOND)?.dropRound, 7);

  const decks = readJson<{ decks: Record<string, unknown[]> }>(store, 'players/1205/decks.json');
  assert.deepEqual(Object.keys(decks.decks).sort(), [FIRST, SECOND]);

  const [only] = ash.rounds![FIRST];
  assert.equal(only.opponentId, '3405', 'the opponent links to their career id');
  assert.equal(only.opponentPlacement, 2);
});
