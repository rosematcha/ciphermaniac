/**
 * Manual player identity corrections: a player holding two Limitless ids must
 * publish one career under the canonical id, with the pinned display name —
 * never two half-careers, and never the name the override exists to replace.
 *
 * The fixtures use the real shipped override (9397 / 16920) so the assertion
 * covers the entry actually in production, not a synthetic one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlayerAggregates } from '../../shared/onlineMeta/playerAggregator.js';
import { canonicalPlayerId, overriddenPlayerName } from '../../shared/onlineMeta/playerIdentity.js';

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

const CANONICAL_EVENT = '2024-12-13, Regional Canonical';
const ALIAS_EVENT = '2026-01-16, Regional Alias';

function participant(playerId: number, name: string) {
  return [
    {
      tpId: 3,
      playerId,
      name,
      country: 'CA',
      placement: 12,
      wins: 7,
      losses: 2,
      ties: 1,
      madePhase2: true,
      madeTopCut: false
    }
  ];
}

function makeStore(): Record<string, string> {
  return {
    'reports/tournaments.json': JSON.stringify([ALIAS_EVENT, CANONICAL_EVENT]),
    [`reports/${CANONICAL_EVENT}/players.json`]: JSON.stringify(participant(9397, 'Caitlin White')),
    [`reports/${CANONICAL_EVENT}/decks.json`]: JSON.stringify([]),
    [`reports/${CANONICAL_EVENT}/meta.json`]: JSON.stringify({ fetchedAt: '2024-12-14T00:00:00.000Z' }),
    // The later event — and so the name pickPrimaryName would otherwise choose.
    [`reports/${ALIAS_EVENT}/players.json`]: JSON.stringify(participant(16920, 'Cali White')),
    [`reports/${ALIAS_EVENT}/decks.json`]: JSON.stringify([
      {
        deckId: 'deck-1',
        playerId: 16920,
        player: 'Cali White',
        archetype: 'Dragapult',
        cards: [{ count: 4, name: 'Dreepy', set: 'ASC', number: '158', category: 'pokemon' }]
      }
    ]),
    [`reports/${ALIAS_EVENT}/meta.json`]: JSON.stringify({ fetchedAt: '2026-01-17T00:00:00.000Z' })
  };
}

test('an alias id folds into the canonical profile under the pinned name', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  const profile = store['players/9397/profile.json'];
  assert.ok(profile, 'the canonical id must own the profile');
  const parsed = JSON.parse(profile);
  assert.equal(parsed.name, 'Caitlin White');
  assert.equal(parsed.summary.eventCount, 2, 'both ids’ events belong to one career');
  assert.equal(store['players/16920/profile.json'], undefined, 'the alias id must not publish its own career');
});

test('the published profile carries no trace of the replaced name', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  assert.ok(!store['players/9397/profile.json'].includes('Cali White'));
});

test('a deck recorded under the alias id still attaches to the merged career', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  const decks = store['players/9397/decks.json'];
  assert.ok(decks, 'the slice-local deck join must use the id the event recorded');
  assert.equal(Object.keys(JSON.parse(decks).decks).length, 1);
});

test('ids without an override pass through untouched', () => {
  assert.equal(canonicalPlayerId('12786'), '12786');
  assert.equal(overriddenPlayerName('12786'), null);
});
