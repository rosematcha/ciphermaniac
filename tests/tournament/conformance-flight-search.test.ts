import assert from 'node:assert/strict';
import test from 'node:test';

import { swissRound } from '../../shared/tournament/lifecyclePairing.ts';
import type { Match, Round } from '../../shared/tournament/types.ts';
import { context, generatedEvent, operated } from './conformance-generated.ts';

const match = (p1: string, p2: string | null, table: number, outcome: Match['outcome']): Match => ({
  p1,
  p2,
  table,
  outcome,
  timestamp: '10/01/2026 12:00:00'
});

test("V23-3: an unrecorded repair releases another flight's last match when its pool cannot pair", () => {
  const ctx = context(23);
  const t = operated(generatedEvent(6, ctx), { type: 'start' }, ctx);
  const pod = t.pods[0]!;
  const base = pod.rounds[0]!;
  const prior: Round = {
    ...base,
    stage: 5,
    matches: [
      match('1', '2', 1, 'tie'),
      match('3', null, 0, 'bye'),
      match('4', '5', 2, 'tie'),
      match('6', null, 0, 'bye')
    ]
  };
  const round: Round = {
    ...base,
    number: 2,
    stage: 2,
    matches: [match('3', null, 0, 'assigned-bye'), match('6', null, 0, 'assigned-bye'), match('4', '5', 3, 'pending')]
  };
  const field = {
    ...pod,
    flights: [
      { number: 1, playerIds: ['1', '2', '3'] },
      { number: 2, playerIds: ['4', '5', '6'] }
    ],
    rounds: [prior, round]
  };
  const repaired = swissRound({ ...t, pods: [field] }, field, ctx, true);
  const { matches } = repaired.rounds.at(-1)!;
  const pairs = matches.filter(m => m.p2 !== null);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.flatMap(m => [m.p1, m.p2]).sort(), ['1', '2', '4', '5']);
  assert.ok(pairs.every(m => ['1', '2'].includes(m.p1) !== ['1', '2'].includes(m.p2!)));
  assert.deepEqual(pairs.map(m => m.table).sort(), [1, 2]);
  assert.deepEqual(
    matches
      .filter(m => m.p2 === null)
      .map(m => m.p1)
      .sort(),
    ['3', '6']
  );
});

test('V23-3: a sole waiting flight leaves another flight’s existing random bye in place', () => {
  const ctx = context(24);
  const t = operated(generatedEvent(6, ctx), { type: 'start' }, ctx);
  const pod = t.pods[0]!;
  const base = pod.rounds[0]!;
  const prior: Round = {
    ...base,
    stage: 5,
    matches: [
      match('1', '2', 1, 'tie'),
      match('3', null, 0, 'loss'),
      match('4', '5', 2, 'tie'),
      match('6', null, 0, 'loss')
    ]
  };
  const round: Round = {
    ...base,
    number: 2,
    stage: 2,
    matches: [
      match('3', null, 0, 'bye'),
      match('1', '2', 1, 'pending'),
      match('6', null, 0, 'bye'),
      match('4', '5', 2, 'pending')
    ]
  };
  const field = {
    ...pod,
    flights: [
      { number: 1, playerIds: ['1', '2', '3'] },
      { number: 2, playerIds: ['4', '5', '6'] }
    ],
    rounds: [prior, round]
  };
  const pairings = [
    { p1: '6', p2: null },
    { p1: '3', p2: null },
    { p1: '1', p2: '2' },
    { p1: '4', p2: '5' }
  ];
  const repaired = swissRound(
    { ...t, pods: [field] },
    field,
    {
      ...ctx,
      recorded: { retainedTables: [1, 2], pairings: { [pod.category]: pairings } }
    },
    true
  );
  const { matches } = repaired.rounds.at(-1)!;
  assert.deepEqual(
    matches.map(m => ({ p1: m.p1, p2: m.p2 })),
    pairings
  );
  assert.deepEqual(
    matches.map(m => m.table),
    [0, 0, 1, 2]
  );
  assert.strictEqual(matches[0], round.matches[2]);
});
