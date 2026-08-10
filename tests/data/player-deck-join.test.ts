/**
 * Deck-ownership guard: the participant/deck name comparison must be
 * diacritic-insensitive. Upstream deck rows and participant rows don't always
 * agree on accents ("José" vs "Jose"), and an exact comparison silently
 * dropped those players' legitimate decklists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlayerAggregates } from '../../shared/onlineMeta/playerAggregator.js';

function makeEnv(store: Record<string, string>) {
  const bucket = store; // local alias so put/delete don't reassign the param
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

function makeStore(participantName: string, deckPlayerName: string): Record<string, string> {
  const KEY = '2026-04-01, Regional Accents';
  return {
    'reports/tournaments.json': JSON.stringify([KEY]),
    [`reports/${KEY}/players.json`]: JSON.stringify([
      {
        tpId: 7,
        playerId: 42,
        name: participantName,
        country: 'ES',
        placement: 2,
        wins: 8,
        losses: 2,
        ties: 0,
        madePhase2: true,
        madeTopCut: true
      }
    ]),
    [`reports/${KEY}/decks.json`]: JSON.stringify([
      {
        deckId: 'deck-1',
        playerId: 42,
        player: deckPlayerName,
        archetype: 'Dragapult',
        cards: [{ count: 4, name: 'Dreepy', set: 'ASC', number: '158', category: 'pokemon' }]
      }
    ]),
    [`reports/${KEY}/meta.json`]: JSON.stringify({ fetchedAt: '2026-04-02T00:00:00.000Z' })
  };
}

test('a deck joins its player when names differ only by diacritics', async () => {
  const store = makeStore('José Ordaz', 'Jose Ordaz');
  await buildPlayerAggregates(makeEnv(store));

  const decks = store['players/42/decks.json'];
  assert.ok(decks, 'decks.json must be written despite the accent mismatch');
  const parsed = JSON.parse(decks);
  assert.equal(Object.keys(parsed.decks).length, 1);
});

test('a deck with a genuinely different owner name is still rejected', async () => {
  const store = makeStore('José Ordaz', 'Someone Else');
  await buildPlayerAggregates(makeEnv(store));

  assert.equal(store['players/42/decks.json'], undefined, 'mismatched deck must not be attributed');
});
