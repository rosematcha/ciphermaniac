/**
 * Swiss standings against how TOM ranks: tiebreakers as TOM computes them,
 * checked on small fields built by hand.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { swissStandings } from '../../shared/tournament/standings.ts';
import type { Match, Player, Pod, Round } from '../../shared/tournament/types.ts';

const player = (id: string, droppedAfter: number | null = null): Player => ({
  id,
  firstName: id,
  lastName: 'Player',
  birthDate: '',
  droppedAfter,
  created: '',
  modified: ''
});

/** A finished Swiss round from [winner, loser] pairs and an optional bye. */
function round(number: number, wins: [string, string][], bye?: string): Round {
  const matches: Match[] = wins.map(([p1, p2], i) => ({ table: i + 1, p1, p2, outcome: 'p1', timestamp: '' }));
  return {
    number,
    kind: 'swiss',
    status: 'finished',
    timeLeft: 0,
    pairTime: '',
    startTime: '',
    matches: bye ? [...matches, { table: 0, p1: bye, p2: null, outcome: 'bye', timestamp: '' }] : matches
  };
}

const pod = (playerIds: string[], rounds: Round[]): Pod => ({
  category: 'masters',
  playerIds,
  rounds,
  cut: 0,
  playoff3rd4th: false,
  startingTable: 1
});

// D loses to A in round 1 and drops; A, 1-0 then, loses both rounds after.
const FIELD = pod(
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  [
    round(
      1,
      [
        ['A', 'D'],
        ['B', 'E'],
        ['C', 'F']
      ],
      'G'
    ),
    round(2, [
      ['B', 'A'],
      ['C', 'G'],
      ['E', 'F']
    ]),
    round(3, [
      ['B', 'C'],
      ['E', 'A'],
      ['G', 'F']
    ])
  ]
);
const PLAYERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => player(id, id === 'D' ? 1 : null));

test('a dropped player keeps the tiebreakers they had when they dropped', () => {
  const d = swissStandings(FIELD, PLAYERS).find(row => row.playerId === 'D');
  // A was 1-0 when D dropped; A finished 1-2, which would put D's OWP at 33%.
  assert.equal(d?.owp, 1);
});

test('a dropped player ranks on those kept tiebreakers, as TOM does', () => {
  const order = swissStandings(FIELD, PLAYERS).map(row => row.playerId);
  // Both have no points: F's OWP is 61%, D's kept one 100%.
  assert.ok(order.indexOf('D') < order.indexOf('F'));
});

test('standings through a round before the drop rank the player as they stood', () => {
  const early = swissStandings(FIELD, PLAYERS, { throughRound: 1 }).find(row => row.playerId === 'D');
  assert.equal(early?.owp, 1);
});

test('players level on everything who never met rank in the order they registered, as TOM ranks them', () => {
  // A and B each beat one of C and D; all four are 1-1 or 1-0 with the same tiebreakers.
  const level = pod(
    ['B', 'A', 'D', 'C'],
    [
      round(1, [
        ['A', 'C'],
        ['B', 'D']
      ])
    ]
  );
  const players = ['A', 'B', 'C', 'D'].map(id => player(id));
  assert.deepEqual(
    swissStandings(level, players).map(row => row.playerId),
    ['A', 'B', 'C', 'D']
  );
});
