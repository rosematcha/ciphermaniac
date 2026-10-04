/**
 * What a spectator narrows the pairings to (the tables still playing, the
 * players they follow, one archetype), the decks a round offers, the players
 * a device follows, and the table a stream overlay shows.
 */

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';

import type { Match, Pod, Round, Tournament } from '../../shared/tournament/types.ts';
import { DEFAULT_SETTINGS } from '../../shared/tournament/view.ts';
import {
  NO_FILTER,
  readFollowing,
  roundDecks,
  spectatorMatches,
  stillPlaying,
  streamDecks,
  streamTable,
  toggleFollowing
} from '../../src/lib/tournament/spectate.ts';

const match = (table: number, p1: string, p2: string | null, outcome: Match['outcome'] = 'pending'): Match => ({
  table,
  p1,
  p2,
  outcome,
  timestamp: ''
});

const MATCHES = [match(1, 'a', 'b'), match(2, 'c', 'd', 'p1'), match(3, 'e', 'f'), match(0, 'g', null, 'bye')];
const round: Round = {
  number: 2,
  kind: 'swiss',
  status: 'started',
  timeLeft: 0,
  pairTime: '',
  startTime: '',
  matches: MATCHES
};
const pod: Pod = {
  category: 'masters',
  playerIds: [],
  rounds: [round],
  cut: 0,
  playoff3rd4th: false,
  startingTable: 1
};
const DECKS = { a: 'Gardevoir ex', c: 'Gardevoir ex', d: 'Dragapult ex', f: 'Raging Bolt ex' };
const context = { pod, round, pending: [], decks: DECKS, following: new Set(['d', 'g']) };
const tables = (matches: readonly Match[]) => matches.map(m => m.table);

test('every table shows until the spectator narrows them', () => {
  assert.deepEqual(tables(spectatorMatches(MATCHES, NO_FILTER, context)), [1, 2, 3, 0]);
});

test('playing leaves the tables with no result, a result entered on the site counting as one', () => {
  assert.deepEqual(tables(spectatorMatches(MATCHES, { showing: 'playing', deck: null }, context)), [1, 3]);
  const pending = [{ pod: 'masters' as const, round: 2, table: 3, p1: 'e', p2: 'f', outcome: 'p2' as const, at: 0 }];
  assert.equal(stillPlaying(MATCHES[2] as Match, { pod, round, pending }), false);
  assert.equal(stillPlaying(MATCHES[3] as Match, { pod, round, pending }), false, 'a bye is not played');
});

test('following leaves the followed players’ tables, a bye among them', () => {
  assert.deepEqual(tables(spectatorMatches(MATCHES, { showing: 'following', deck: null }, context)), [2, 0]);
});

test('a deck leaves the tables where either player is on it, and combines with the other filters', () => {
  assert.deepEqual(tables(spectatorMatches(MATCHES, { showing: 'all', deck: 'Gardevoir ex' }, context)), [1, 2]);
  assert.deepEqual(tables(spectatorMatches(MATCHES, { showing: 'playing', deck: 'Gardevoir ex' }, context)), [1]);
});

test('a round offers its decks most played first, then by name', () => {
  assert.deepEqual(roundDecks(MATCHES, DECKS), ['Gardevoir ex', 'Dragapult ex', 'Raging Bolt ex']);
  assert.deepEqual(roundDecks(MATCHES, {}), []);
});

describe('following', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value)
      }
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  test('a device follows players per event, and a second press stops following', () => {
    assert.deepEqual([...toggleFollowing('ABC', 'k1')], ['k1']);
    assert.deepEqual([...toggleFollowing('ABC', 'k2')], ['k1', 'k2']);
    assert.deepEqual([...readFollowing('XYZ')], [], 'another event follows nobody');
    assert.deepEqual([...toggleFollowing('ABC', 'k1')], ['k2']);
    assert.deepEqual([...readFollowing('ABC')], ['k2']);
  });

  test('what the device kept is read with care', () => {
    store.set('cm-tournament-follow:ABC', '{not json');
    assert.deepEqual([...readFollowing('ABC')], []);
    store.set('cm-tournament-follow:ABC', JSON.stringify(['k1', 7, null]));
    assert.deepEqual([...readFollowing('ABC')], ['k1']);
  });
});

test('a stream shows the table in the current round of the pod asked for, or of the first that plays it', () => {
  const juniors: Pod = { ...pod, category: 'junior', rounds: [{ ...round, matches: [match(5, 'j1', 'j2')] }] };
  const tournament = { pods: [pod, juniors] } as unknown as Tournament;
  assert.equal(streamTable(tournament, 3)?.match.p1, 'e');
  assert.equal(streamTable(tournament, 5)?.pod.category, 'junior');
  assert.equal(streamTable(tournament, 1, 'junior'), null, 'not in that pod');
  assert.equal(streamTable(tournament, 9), null);
});

test('once a combined pod’s divisions cut, a stream shows the cut at that table, not the Swiss round before it', () => {
  const swiss: Pod = { ...pod, category: 'senior-masters' };
  const cut = (category: 'senior' | 'masters', p1: string): Pod => ({
    ...pod,
    category,
    cutOf: 'senior-masters',
    rounds: [{ ...round, number: 3, kind: 'elimination', matches: [match(1, p1, `${p1}-2`)] }]
  });
  const tournament = { pods: [swiss, cut('senior', 's1'), cut('masters', 'm1')] } as unknown as Tournament;
  assert.equal(streamTable(tournament, 1)?.match.p1, 's1', 'the Swiss pod’s own table 1 is over');
  assert.equal(streamTable(tournament, 1, 'masters')?.match.p1, 'm1');
  assert.equal(streamTable(tournament, 1, 'senior-masters')?.match.p1, 's1', 'the pod asked for leads to its cuts');
  assert.equal(streamTable(tournament, 3), null, 'a table only the retired Swiss round had');
});

test('a stream shows decks only once the event shows them to everyone, whoever’s copy it reads', () => {
  const decks = { a: 'Gardevoir ex' };
  const settings = (patch: Partial<typeof DEFAULT_SETTINGS>) => ({ ...DEFAULT_SETTINGS, ...patch });
  assert.deepEqual(streamDecks({ decks, settings: settings({ deckVisibility: 'always' }) }), decks);
  assert.deepEqual(streamDecks({ decks, settings: settings({ deckVisibility: 'after', finished: false }) }), {});
  assert.deepEqual(streamDecks({ decks, settings: settings({ deckVisibility: 'after', finished: true }) }), decks);
  assert.deepEqual(streamDecks({ decks, settings: settings({ deckVisibility: 'off' }) }), {});
});
