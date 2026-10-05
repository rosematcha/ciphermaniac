/**
 * Swiss standings against how TOM ranks: tiebreakers as TOM computes them,
 * checked on small fields built by hand.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { swissStandings, tallySwiss, winRate } from '../../shared/tournament/standings.ts';
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

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Independently replay a cutoff to check each frozen rate against its original definition. */
function expectedRates(field: Pod, players: Player[], at: number, historical: boolean) {
  const tallies = tallySwiss(field, at);
  const rates = new Map(
    [...tallies].map(([id, tally]) => {
      const drop = players.find(p => p.id === id)?.droppedAfter ?? null;
      return [id, winRate(tally, drop !== null && (!historical || drop <= at))];
    })
  );
  const owp = new Map(
    [...tallies].map(([id, tally]) => [id, mean(tally.opponents.map(opponent => rates.get(opponent) ?? 0))])
  );
  return new Map(
    [...tallies].map(([id, tally]) => [
      id,
      { owp: owp.get(id) ?? 0, oowp: mean(tally.opponents.map(opponent => owp.get(opponent) ?? 0)) }
    ])
  );
}

test('distinct drop snapshots preserve both rates, future drop caps, and round cutoffs', () => {
  const players = PLAYERS.map(p => ({ ...p, droppedAfter: p.id === 'B' ? 2 : p.droppedAfter }));
  const elimination = { ...round(4, [['F', 'B']]), kind: 'elimination' as const };
  // Input need not be chronological; snapshot replay must not mutate it.
  const field = pod(FIELD.playerIds, [FIELD.rounds[2], elimination, FIELD.rounds[0], FIELD.rounds[1]] as Round[]);
  const original = structuredClone(field);
  for (const through of [0, 1, 2, 3, Infinity]) {
    const current = expectedRates(field, players, through, false);
    for (const row of swissStandings(field, players, { throughRound: through })) {
      const drop = players.find(p => p.id === row.playerId)?.droppedAfter ?? null;
      const expected = drop !== null && drop < through ? expectedRates(field, players, drop, true) : current;
      const rates = expected.get(row.playerId)!;
      assert.ok(Math.abs(row.owp - rates.owp) < 1e-12);
      assert.ok(Math.abs(row.oowp - rates.oowp) < 1e-12);
      assert.deepEqual(row.record, tallySwiss(field, through).get(row.playerId)?.record);
    }
  }
  assert.deepEqual(field, original);
});

test('opponent averages weight rematches and ignore byes and pending matches', () => {
  const field = pod(['A', 'B', 'C'], [round(1, [['A', 'B']], 'C'), round(2, [['A', 'B']], 'C')]);
  const third = round(3, [['C', 'A']], 'B');
  const pending = { ...round(4, [['B', 'C']]), status: 'started' as const };
  pending.matches[0]!.outcome = 'pending';
  field.rounds.push(third, pending);
  const players = field.playerIds.map(id => player(id));
  const a = swissStandings(field, players).find(row => row.playerId === 'A');
  assert.equal(a?.owp, (0.25 + 0.25 + 1) / 3);
  const expected = expectedRates(field, players, Infinity, false);
  for (const row of swissStandings(field, players)) {
    assert.deepEqual({ owp: row.owp, oowp: row.oowp }, expected.get(row.playerId));
  }
});

test('head-to-head applies only to a pair of level ranked players', () => {
  const field = pod(
    ['A', 'B', 'C', 'D'],
    [
      round(1, [
        ['A', 'B'],
        ['C', 'D']
      ]),
      round(2, [
        ['D', 'A'],
        ['B', 'C']
      ])
    ]
  );
  const players = ['B', 'A', 'C', 'D'].map(id => player(id));
  assert.deepEqual(
    swissStandings(field, players).map(row => row.playerId),
    ['B', 'A', 'C', 'D']
  );
  const filtered = swissStandings(field, players, { only: new Set(['A', 'B']) });
  assert.deepEqual(
    filtered.map(row => row.playerId),
    ['A', 'B']
  );
  assert.ok(filtered.every(row => row.owp === 0.5 && row.oowp === 0.5));
});

test('matches are tallied once even with many distinct drop rounds', () => {
  const ids = Array.from({ length: 40 }, (_, i) => String(i));
  const rounds = Array.from({ length: 20 }, (_, i) => round(i + 1, [[ids[i]!, ids[i + 20]!]]));
  const field = pod(ids, rounds);
  const players = ids.map((id, i) => player(id, (i % 20) + 1));
  const counter = { reads: 0 };
  for (const r of rounds) {
    for (const match of r.matches) {
      const { outcome } = match;
      Object.defineProperty(match, 'outcome', {
        get() {
          counter.reads += 1;
          return outcome;
        }
      });
    }
  }
  tallySwiss(field);
  const onePass = counter.reads;
  counter.reads = 0;
  const standings = swissStandings(field, players);
  assert.equal(standings.length, ids.length);
  assert.equal(counter.reads, onePass);
});

test('players sharing a drop round keep their own rates when divisions or disqualifications filter rows', () => {
  const players = PLAYERS.map(p => ({
    ...p,
    droppedAfter: ['A', 'B', 'D'].includes(p.id) ? 1 : null,
    disqualified: p.id === 'D' ? (true as const) : undefined
  }));
  const expected = expectedRates(FIELD, players, 1, true);
  for (const withDisqualified of [false, true]) {
    const rows = swissStandings(FIELD, players, { only: new Set(['A', 'B', 'D']), withDisqualified });
    assert.equal(rows.length, withDisqualified ? 3 : 2);
    for (const row of rows) {
      assert.deepEqual({ owp: row.owp, oowp: row.oowp }, expected.get(row.playerId));
    }
  }
});

test('a match participant absent from the pod roster can freeze before their first match', () => {
  const field = pod(['A'], [round(2, [['A', 'B']])]);
  const rows = swissStandings(field, [player('A'), player('B', 1)]);
  const b = rows.find(row => row.playerId === 'B');
  assert.deepEqual(b?.record, { wins: 0, losses: 1, ties: 0 });
  assert.equal(b?.owp, 0);
  assert.equal(b?.oowp, 0);
});
