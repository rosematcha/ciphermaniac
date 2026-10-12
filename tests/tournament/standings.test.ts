/**
 * Swiss standings against how TOM ranks: tiebreakers as TOM computes them,
 * checked on small fields built by hand.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { placeFinals, swissStandings, tallySwiss, winRate } from '../../shared/tournament/standings.ts';
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

const rounding = { maximumSignificantDigits: 4, useGrouping: false, roundingMode: 'halfEven' };
const percent = new Intl.NumberFormat('en-US', rounding);
const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : Number(
        (
          Number(percent.format((values.reduce((sum, value) => sum + value, 0) / values.length) * 100)) / 100
        ).toPrecision(4)
      );

/** TOM caps a dropped player only when they played fewer rounds than the pod plans: here, the Swiss rounds paired. */
const planned = (field: Pod) => field.rounds.filter(r => r.kind === 'swiss').length;

/** Independent direct evaluation of SPEC 3.7; absent players use their latest recorded round. */
function expectedRates(field: Pod, players: Player[], through: number) {
  const available = { ...field, rounds: field.rounds.filter(r => r.number <= through) };
  const at = Number.isFinite(through)
    ? through
    : Math.max(0, ...available.rounds.filter(r => r.kind === 'swiss').map(r => r.number));
  const roundsFor = (id: string) =>
    available.rounds.filter(r => r.matches.some(m => m.p1 === id || m.p2 === id)).map(r => r.number);
  const selected = (id: string, evaluation: number) =>
    roundsFor(id).includes(evaluation) ? evaluation : Math.max(0, ...roundsFor(id));
  const tally = (id: string, evaluation: number) => tallySwiss(available, selected(id, evaluation)).get(id)!;
  const own = (id: string, evaluation: number) =>
    winRate(
      tally(id, evaluation),
      players.find(p => p.id === id)?.droppedAfter !== null && roundsFor(id).length < planned(field)
    );
  const opponentRate = (id: string, evaluation: number): number => {
    const chosen = selected(id, evaluation);
    return mean(tally(id, chosen).opponents.map(opponent => own(opponent, chosen)));
  };
  return new Map(
    [...tallySwiss(available)].map(([id]) => {
      const chosen = selected(id, at);
      return [
        id,
        {
          owp: opponentRate(id, chosen),
          oowp: mean(tally(id, chosen).opponents.map(opponent => opponentRate(opponent, chosen)))
        }
      ];
    })
  );
}

test('latest recorded rounds preserve both rates, total match caps, and evaluation cutoffs', () => {
  const players = PLAYERS.map(p => ({ ...p, droppedAfter: p.id === 'B' ? 2 : p.droppedAfter }));
  const elimination = { ...round(4, [['F', 'B']]), kind: 'elimination' as const };
  // Input need not be chronological; snapshot replay must not mutate it.
  const field = pod(FIELD.playerIds, [FIELD.rounds[2], elimination, FIELD.rounds[0], FIELD.rounds[1]] as Round[]);
  const original = structuredClone(field);
  for (const through of [0, 1, 2, 3, Infinity]) {
    const expected = expectedRates(field, players, through);
    for (const row of swissStandings(field, players, { throughRound: through })) {
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
  const expected = expectedRates(field, players, Infinity);
  for (const row of swissStandings(field, players)) {
    assert.deepEqual({ owp: row.owp, oowp: row.oowp }, expected.get(row.playerId));
  }
});

test('head-to-head applies pairwise before roster order, including larger tie groups', () => {
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
    ['A', 'B', 'C', 'D']
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

test('division and disqualification filters preserve each player’s latest recorded percentages', () => {
  const players = PLAYERS.map(p => ({
    ...p,
    droppedAfter: ['A', 'B', 'D'].includes(p.id) ? 1 : null,
    disqualified: p.id === 'D' ? (true as const) : undefined
  }));
  const expected = expectedRates(FIELD, players, Infinity);
  for (const withDisqualified of [false, true]) {
    const rows = swissStandings(FIELD, players, { only: new Set(['A', 'B', 'D']), withDisqualified });
    assert.equal(rows.length, withDisqualified ? 3 : 2);
    for (const row of rows) {
      assert.deepEqual({ owp: row.owp, oowp: row.oowp }, expected.get(row.playerId));
    }
  }
});

test('a disqualified or unranked opponent keeps the tiebreakers they had when they left', () => {
  // A's OOWP averages D's OWP from round one, when A was 1-0, not A's final 1-2.
  const oowp = (rows: ReturnType<typeof swissStandings>) => rows.find(row => row.playerId === 'A')?.oowp;
  const dropped = oowp(swissStandings(FIELD, PLAYERS));
  const disqualified = PLAYERS.map(p => (p.id === 'D' ? { ...p, disqualified: true as const } : p));
  assert.equal(oowp(swissStandings(FIELD, disqualified)), dropped);
  assert.equal(oowp(swissStandings(FIELD, PLAYERS, { only: new Set(['A']) })), dropped);
  assert.ok(!swissStandings(FIELD, disqualified).some(row => row.playerId === 'D'));
});

test('an opponent absent from the pod roster uses their latest recorded match', () => {
  const field = pod(['A'], [round(2, [['A', 'B']])]);
  const rows = swissStandings(field, [player('A'), player('B', 1)]);
  const b = rows.find(row => row.playerId === 'B');
  assert.deepEqual(b?.record, { wins: 0, losses: 1, ties: 0 });
  assert.equal(b?.owp, 1);
  assert.equal(b?.oowp, 0.25);
});

test('deleted TOM matches count opponents without giving either player a record or points', () => {
  const field = pod(['A', 'B'], [round(1, [['A', 'B']])]);
  field.rounds[0]!.matches[0]!.outcome = 'deleted';
  for (const row of swissStandings(
    field,
    ['A', 'B'].map(id => player(id))
  )) {
    assert.deepEqual(row.record, { wins: 0, losses: 0, ties: 0 });
    assert.equal(row.points, 0);
    assert.equal(row.owp, 0.25);
    assert.equal(row.oowp, 0.25);
  }
});

test('a dropped player is capped at 75% only when they played fewer rounds than the pod plans, as TOM caps', () => {
  // A wins every round and drops after the third; B met A, D and C.
  const field = pod(
    ['A', 'B', 'C', 'D'],
    [
      round(1, [
        ['A', 'B'],
        ['C', 'D']
      ]),
      round(2, [
        ['A', 'C'],
        ['B', 'D']
      ]),
      round(3, [
        ['A', 'D'],
        ['B', 'C']
      ])
    ]
  );
  const players = [player('A', 3), player('B'), player('C'), player('D')];
  const owpOfB = (regularRounds?: number) =>
    swissStandings(field, players, regularRounds === undefined ? {} : { regularRounds }).find(r => r.playerId === 'B')
      ?.owp;
  assert.equal(owpOfB(3), 0.5278, 'A played every planned round: a full 100% opponent');
  assert.equal(owpOfB(), 0.5278, 'without a plan, the rounds paired are the plan');
  assert.equal(owpOfB(4), 0.4444, 'A left a round early: capped at 75%');
});

test('late entrants use tiebreaker zero until a document reload gives them roster order', () => {
  const players = [
    { ...player('starter'), tiebreaker: 1 },
    { ...player('late'), tiebreaker: 0 }
  ];
  const field = pod(['starter', 'late'], []);
  assert.deepEqual(
    swissStandings(field, players).map(row => row.playerId),
    ['late', 'starter']
  );
  assert.deepEqual(
    swissStandings(
      field,
      players.map(({ tiebreaker: _tie, ...rest }) => rest)
    ).map(row => row.playerId),
    ['starter', 'late']
  );
});

test('tied cut losers compare opponents before their own preference, independently of the champion', () => {
  const ids = ['A', 'B', 'C', 'D'];
  const players = ids.map(id => player(id));
  const drawn = round(1, [
    ['A', 'B'],
    ['C', 'D']
  ]);
  drawn.matches = drawn.matches.map(match => ({ ...match, outcome: 'tie' }));
  const semis = {
    ...round(2, [
      ['A', 'D'],
      ['B', 'C']
    ]),
    kind: 'elimination' as const
  };
  for (const champion of ['A', 'B']) {
    const final = { ...round(3, [[champion, champion === 'A' ? 'B' : 'A']]), kind: 'elimination' as const };
    const field = { ...pod(ids, [drawn, semis, final]), cut: 4 };
    const swiss = swissStandings(field, players);
    assert.deepEqual(
      placeFinals(field, swiss)
        .slice(2)
        .map(row => row.playerId),
      ['D', 'C']
    );
  }
});

test('shared entrant preferences compare earlier opponents, then fall back to the players themselves', () => {
  const ids = ['A', 'B', 'C', 'D'];
  const players = ids.map((id, i) => ({ ...player(id), tiebreaker: i < 2 ? 0 : i + 1 }));
  const drawn = round(1, [
    ['A', 'B'],
    ['C', 'D']
  ]);
  drawn.matches = drawn.matches.map(match => ({ ...match, outcome: 'tie' }));
  const semis = {
    ...round(2, [
      ['A', 'D'],
      ['B', 'C']
    ]),
    kind: 'elimination' as const
  };
  const field = { ...pod(ids, [drawn, semis]), cut: 4 };
  const order = (swissPod: Pod) =>
    placeFinals(swissPod, swissStandings(swissPod, players), {
      players,
      swissPod,
      regularRounds: 1
    })
      .slice(2)
      .map(row => row.playerId);
  assert.deepEqual(order(field), ['D', 'C'], 'the Swiss opponents separate tied semifinal opponents');
  assert.deepEqual(
    order({ ...field, rounds: [{ ...drawn, matches: [] }, semis] }),
    ['C', 'D'],
    'no opponent separates them'
  );
});

test('cut opponents align by personal match count and an opponent precedes a one-seat match', () => {
  const ids = ['A', 'B', 'D', 'C'];
  const players = ids.map(id => player(id));
  const early = { ...round(1, [['A', 'C']]), kind: 'elimination' as const };
  const later = { ...round(2, [['B', 'D']]), kind: 'elimination' as const };
  const field = { ...pod(ids, [early, later]), cut: 4, cutOf: 'masters' as const };
  const swiss = swissStandings(field, players);
  assert.deepEqual(
    placeFinals(field, swiss)
      .slice(2)
      .map(row => row.playerId),
    ['C', 'D']
  );
  const oneSeat: Match = { p1: 'C', p2: null, table: 0, outcome: 'loss', timestamp: '' };
  assert.deepEqual(
    placeFinals({ ...field, rounds: [{ ...early, matches: [oneSeat] }, later] }, swiss)
      .filter(row => ['C', 'D'].includes(row.playerId))
      .map(row => row.playerId),
    ['D', 'C']
  );
});

test('the third-place setting promotes the champion’s latest opponents across whole tied groups without a playoff', () => {
  const ids = ['A', 'E', 'D', 'G', 'C', 'B', 'F', 'H'];
  const rounds = [
    round(1, [
      ['H', 'B'],
      ['C', 'A'],
      ['F', 'D'],
      ['E', 'G']
    ]),
    round(2, [
      ['H', 'C'],
      ['F', 'E']
    ]),
    round(3, [['H', 'F']])
  ].map(r => ({ ...r, kind: 'elimination' as const }));
  const field = pod(ids, rounds);
  const players = ids.map(id => player(id, id === 'C' ? 2 : null));
  const swiss = swissStandings(field, players);
  const order = (playoff3rd4th: boolean) => placeFinals({ ...field, playoff3rd4th }, swiss).map(row => row.playerId);
  assert.deepEqual(order(false), ['H', 'F', 'E', 'C', 'A', 'D', 'G', 'B']);
  assert.deepEqual(order(true), ['H', 'F', 'C', 'E', 'B', 'A', 'D', 'G']);
  assert.deepEqual(
    placeFinals({ ...field, cutOf: 'mixed', cut: 8, playoff3rd4th: true }, swiss).map(row => row.playerId),
    ['H', 'F', 'E', 'C', 'G', 'A', 'D', 'B'],
    'a cut after Swiss retains the setting threshold and orders the tied opening losers by their opponents'
  );
});
