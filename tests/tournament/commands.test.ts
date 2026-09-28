/**
 * Running a Swiss event by commands: players join, rounds pair and report, a
 * late arrival is folded into a round already paired, drops leave the field,
 * and a top cut seeds from the standings.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command, type CommandContext, secondsLeft } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import type { Pod, Round, Tournament } from '../../shared/tournament/types.ts';

function context(seed = 1, now = 1_000_000): CommandContext {
  return { now, localTime: '09/28/2026 10:00:00', season: 2027, random: seededRandom(seed) };
}

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  let current = tournament;
  for (const command of commands) {
    const result = applyCommand(current, command, context(current.players.length + 7));
    assert.ok(result.ok, `${command.type}: ${result.ok ? '' : result.error}`);
    current = result.tournament;
  }
  return current;
}

function attempt(tournament: Tournament, command: Command): string {
  const result = applyCommand(tournament, command, context());
  assert.equal(result.ok, false);
  return result.ok ? '' : result.error;
}

const pod = (t: Tournament): Pod => t.pods[0] as Pod;
const round = (t: Tournament, n = pod(t).rounds.length): Round => pod(t).rounds[n - 1] as Round;

function withPlayers(count: number): Tournament {
  const adds: Command[] = Array.from({ length: count }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: 'Player', lastName: String(i + 1), id: String(100 + i), birthDate: '01/01/1990' }
  }));
  return run(emptyTournament({ name: 'Test Cup' }, true), ...adds);
}

/** Reports every open match in the current round as a win for player one. */
function reportAll(t: Tournament): Tournament {
  const r = round(t);
  const reports: Command[] = r.matches
    .filter(m => m.outcome === 'pending')
    .map(m => ({
      type: 'reportResult',
      pod: 'mixed',
      round: r.number,
      table: m.table,
      p1: m.p1,
      p2: m.p2,
      outcome: 'p1'
    }));
  return run(t, ...reports);
}

test('pairs a first round with a bye for the odd player out', () => {
  const t = run(withPlayers(5), { type: 'pairRound', pod: 'mixed' });
  const { matches } = round(t);
  assert.equal(matches.length, 3);
  assert.deepEqual(
    matches.map(m => m.table),
    [1, 2, 0]
  );
  assert.equal(matches[2]?.outcome, 'bye');
});

test('will not pair the next round while results are missing', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'mixed' });
  assert.match(attempt(t, { type: 'pairRound', pod: 'mixed' }), /Report every match/);
});

test('a late player gets a loss for each round they missed', () => {
  let t = reportAll(run(withPlayers(4), { type: 'pairRound', pod: 'mixed' }));
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Comer', id: '999' } });
  const missed = round(t).matches.find(m => m.p1 === '999');
  assert.deepEqual(missed && { p2: missed.p2, outcome: missed.outcome }, { p2: null, outcome: 'loss' });
  const late = swissStandings(pod(t), t.players).find(row => row.playerId === '999');
  assert.deepEqual(late?.record, { wins: 0, losses: 1, ties: 0 });
});

test('re-pairing a round keeps reported matches and seats a late arrival', () => {
  let t = run(withPlayers(6), { type: 'pairRound', pod: 'mixed' });
  const first = round(t).matches[0];
  assert.ok(first);
  t = run(t, {
    type: 'reportResult',
    pod: 'mixed',
    round: 1,
    table: first.table,
    p1: first.p1,
    p2: first.p2,
    outcome: 'p2'
  });
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Comer', id: '999' } });
  t = run(t, { type: 'repairRound', pod: 'mixed', keepReported: true });
  const { matches } = round(t);
  assert.deepEqual(
    matches.find(m => m.table === first.table),
    { ...first, outcome: 'p2', timestamp: '09/28/2026 10:00:00' }
  );
  const seated = matches.flatMap(m => [m.p1, m.p2]).filter(Boolean);
  assert.equal(seated.length, 7);
  assert.ok(seated.includes('999'));
  assert.ok(!matches.some(m => m.outcome === 'loss'), 'the missed-round loss is replaced by a real seat');
  assert.equal(matches.filter(m => m.outcome === 'bye').length, 1);
});

test('later rounds avoid rematches and dropped players are not paired', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'mixed' }));
  t = run(t, { type: 'dropPlayer', id: '100' }, { type: 'pairRound', pod: 'mixed' });
  const second = round(t);
  assert.ok(!second.matches.some(m => m.p1 === '100' || m.p2 === '100'));
  const firstPairs = new Set(round(t, 1).matches.map(m => [m.p1, m.p2].sort().join('v')));
  for (const match of second.matches) {
    assert.ok(!firstPairs.has([match.p1, match.p2].sort().join('v')));
  }
  assert.equal(t.players.find(p => p.id === '100')?.droppedAfter, 1);
});

test('swaps two players between tables in the current round', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'mixed' });
  const [a, b] = round(t).matches;
  assert.ok(a && b && a.p2);
  const swapped = run(t, { type: 'swapPlayers', pod: 'mixed', a: a.p2, b: b.p1 });
  assert.equal(round(swapped).matches[0]?.p2, b.p1);
  assert.equal(round(swapped).matches[1]?.p1, a.p2);
});

test('a player who has played cannot be removed, only dropped', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'mixed' });
  assert.match(attempt(t, { type: 'removePlayer', id: '100' }), /drop them instead/);
  const before = run(withPlayers(3), { type: 'removePlayer', id: '101' });
  assert.equal(before.players.length, 2);
});

test('deletes an unreported round, not a reported one', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'mixed' });
  assert.equal(pod(run(t, { type: 'deleteRound', pod: 'mixed' })).rounds.length, 0);
  assert.match(attempt(reportAll(t), { type: 'deleteRound', pod: 'mixed' }), /Clear this round/);
});

test('a top cut seeds from standings and plays down to a winner', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'mixed' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'mixed' }));
  assert.match(attempt(t, { type: 'startTopCut', pod: 'mixed', size: 4 }), /Pick the division/);
  t = run(t, { type: 'startTopCut', pod: 'mixed', size: 4, division: 'masters' });
  const seeds = swissStandings(pod(t), t.players)
    .slice(0, 4)
    .map(row => row.playerId);
  assert.deepEqual(
    round(t).matches.map(m => [m.p1, m.p2]),
    [
      [seeds[0], seeds[3]],
      [seeds[1], seeds[2]]
    ]
  );
  const semi = round(t).matches[0];
  assert.ok(semi);
  assert.match(
    attempt(t, {
      type: 'reportResult',
      pod: 'mixed',
      round: 3,
      table: semi.table,
      p1: semi.p1,
      p2: semi.p2,
      outcome: 'tie'
    }),
    /needs a winner/
  );
  t = reportAll(t);
  t = run(t, { type: 'pairRound', pod: 'mixed' });
  assert.equal(round(t).matches.length, 1);
  assert.match(
    attempt(t, {
      type: 'reportResult',
      pod: 'mixed',
      round: 3,
      table: semi.table,
      p1: semi.p1,
      p2: semi.p2,
      outcome: 'p2'
    }),
    /already paired/
  );
  t = reportAll(t);
  assert.match(attempt(t, { type: 'pairRound', pod: 'mixed' }), /top cut is finished/);
});

test('separate divisions pair apart', () => {
  const t = run(
    emptyTournament({ name: 'Split' }, false),
    { type: 'addPlayer', player: { firstName: 'A', lastName: 'Kid', birthDate: '01/01/2016' } },
    { type: 'addPlayer', player: { firstName: 'B', lastName: 'Kid', birthDate: '01/01/2017' } },
    { type: 'addPlayer', player: { firstName: 'C', lastName: 'Adult', birthDate: '01/01/1990' } },
    { type: 'addPlayer', player: { firstName: 'D', lastName: 'Adult', birthDate: '01/01/1991' } }
  );
  assert.deepEqual(
    t.pods.map(p => [p.category, p.playerIds.length]),
    [
      ['junior', 2],
      ['masters', 2]
    ]
  );
});

test('the clock runs, stops and takes extra time', () => {
  let t = run(withPlayers(2), { type: 'pairRound', pod: 'mixed' });
  const started = applyCommand(t, { type: 'startClock', pod: 'mixed' }, context(1, 0));
  assert.ok(started.ok);
  t = started.tournament;
  assert.equal(secondsLeft(round(t), 60_000), 50 * 60 - 60);
  const stopped = applyCommand(t, { type: 'stopClock', pod: 'mixed' }, context(1, 120_000));
  assert.ok(stopped.ok);
  t = run(stopped.tournament, { type: 'adjustClock', pod: 'mixed', seconds: 180 });
  assert.equal(secondsLeft(round(t), 999_999), 50 * 60 - 120 + 180);
});

test('a combined pod cuts one division at a time, seeded from that division', () => {
  let t = run(
    emptyTournament({ name: 'Mixed' }, true),
    ...['2016', '2016', '2016', '2016', '1990', '1990'].map(
      (year, i) =>
        ({
          type: 'addPlayer',
          player: { firstName: 'P', lastName: `${i}`, id: `${300 + i}`, birthDate: `02/27/${year}` }
        }) as Command
    )
  );
  t = reportAll(run(t, { type: 'pairRound', pod: 'mixed' }));
  t = run(t, { type: 'startTopCut', pod: 'mixed', size: 4, division: 'junior' });
  const seeded = round(t).matches.flatMap(m => [m.p1, m.p2]);
  assert.deepEqual(new Set(seeded), new Set(['300', '301', '302', '303']));
});

test('a report for a match that has since changed is refused', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'mixed' });
  const [first] = round(t).matches;
  assert.ok(first);
  assert.match(
    attempt(t, {
      type: 'reportResult',
      pod: 'mixed',
      round: 1,
      table: first.table,
      p1: first.p1,
      p2: 'someone-else',
      outcome: 'p1'
    }),
    /has changed/
  );
  const cleared = run(
    t,
    { type: 'reportResult', pod: 'mixed', round: 1, table: first.table, p1: first.p1, p2: first.p2, outcome: 'p1' },
    { type: 'reportResult', pod: 'mixed', round: 1, table: first.table, p1: first.p1, p2: first.p2, outcome: 'pending' }
  );
  assert.equal(round(cleared).matches[0]?.timestamp, round(cleared).pairTime, 'an open match carries its pairing time');
});

test('a drop can be taken back until the next round is paired, not after', () => {
  let t = run(withPlayers(4), { type: 'pairRound', pod: 'mixed' }, { type: 'dropPlayer', id: '100' });
  t = run(t, { type: 'undropPlayer', id: '100' }, { type: 'dropPlayer', id: '100' });
  t = run(reportAll(t), { type: 'pairRound', pod: 'mixed' });
  assert.match(attempt(t, { type: 'undropPlayer', id: '100' }), /before round 2 was paired/);
});

test('static seating keeps a player at their table every round, re-pairs included', () => {
  let t = run(withPlayers(8), { type: 'setFixedTable', id: '105', table: 3 });
  t = run(t, { type: 'pairRound', pod: 'mixed' });
  const at = (id: string) => round(t).matches.find(m => m.p1 === id || m.p2 === id)?.table;
  assert.equal(at('105'), 3);
  assert.deepEqual(
    round(t).matches.map(m => m.table),
    [1, 2, 3, 4],
    'the others fill the tables left, in order'
  );
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'One', id: '990' } });
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Two', id: '991' } });
  t = run(t, { type: 'repairRound', pod: 'mixed', keepReported: true });
  assert.equal(at('105'), 3);
  t = run(reportAll(t), { type: 'pairRound', pod: 'mixed' });
  assert.equal(at('105'), 3);
});

test('two players cannot share a fixed table, and one can be cleared', () => {
  const t = run(withPlayers(2), { type: 'setFixedTable', id: '100', table: 5 });
  assert.match(attempt(t, { type: 'setFixedTable', id: '101', table: 5 }), /already fixed for Player 1/);
  assert.match(attempt(t, { type: 'setFixedTable', id: '101', table: 0 }), /whole number/);
  const cleared = run(t, { type: 'setFixedTable', id: '100', table: null });
  assert.equal(cleared.players[0]?.fixedTable, undefined);
});
