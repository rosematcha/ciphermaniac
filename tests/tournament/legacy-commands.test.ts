/**
 * Commands on a document the lifecycle engine has not imported: one stored
 * before it, without settings, and the TOM clock commands applied to TOM-run
 * events. Rounds are paired through the engine, then its settings are taken
 * off, as such a document stands.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand as applyLifecycle } from '../../shared/tournament/commands.ts';
import { applyCommand, canUndrop, type Command, type CommandContext } from '../../shared/tournament/legacyCommands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import type { Pod, Round, Tournament } from '../../shared/tournament/types.ts';

function context(now = 1_000_000, localTime = '09/28/2026 10:00:00'): CommandContext {
  return { now, localTime, season: 2027, random: seededRandom(3) };
}

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  let current = tournament;
  for (const command of commands) {
    const result = applyCommand(current, command, context());
    assert.ok(result.ok, `${command.type}: ${result.ok ? '' : result.error}`);
    current = result.tournament;
  }
  return current;
}

function refusal(tournament: Tournament, command: Command, ctx = context()): string {
  const result = applyCommand(tournament, command, ctx);
  assert.equal(result.ok, false);
  return result.ok ? '' : result.error;
}

const pod = (t: Tournament): Pod => t.pods[0] as Pod;
const latest = (t: Tournament): Round => pod(t).rounds.at(-1) as Round;

/** The document without what the lifecycle engine adds, as one stored before it. */
function unimported({ settings: _settings, ...rest }: Tournament): Tournament {
  return rest;
}

function registered(count: number): Tournament {
  const adds: Command[] = Array.from({ length: count }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: 'Player', lastName: String(i + 1), id: String(100 + i), birthDate: '01/01/1990' }
  }));
  return run(emptyTournament({ name: 'Legacy Cup' }), ...adds);
}

function paired(t: Tournament): Tournament {
  const result = applyLifecycle(t, { type: 'pairRound', pod: pod(t).category }, context());
  assert.ok(result.ok, result.ok ? '' : result.error);
  return unimported(result.tournament);
}

function report(t: Tournament, outcome: 'p1' | 'p2' = 'p1'): Tournament {
  const round = latest(t);
  return run(
    t,
    ...round.matches
      .filter(m => m.outcome === 'pending' && m.p2 !== null)
      .map((m): Command => ({
        type: 'reportResult',
        pod: pod(t).category,
        round: round.number,
        table: m.table,
        p1: m.p1,
        p2: m.p2,
        outcome
      }))
  );
}

const firstMatch = (t: Tournament) => latest(t).matches.find(m => m.p2 !== null)!;

test('legacy pairRound refuses: rounds pair through the lifecycle engine', () => {
  const t = registered(4);
  assert.equal(refusal(t, { type: 'pairRound', pod: pod(t).category }), 'Rounds are paired by the lifecycle engine');
});

test('a late entrant takes a loss for every Swiss round already paired', () => {
  const t = paired(registered(8));
  const next = run(t, {
    type: 'addPlayer',
    player: { firstName: 'Late', lastName: 'Comer', id: '999', birthDate: '01/01/1990' }
  });
  const player = next.players.find(p => p.id === '999')!;
  assert.equal(player.late, true);
  assert.equal(player.starter, false);
  assert.deepEqual(player.lateData, {
    round: 1,
    timestamp: '09/28/2026 10:00:00',
    forcedLoss: true,
    usedForcedLoss: true
  });
  assert.ok(pod(next).playerIds.includes('999'));
  assert.ok(latest(next).matches.some(m => m.p1 === '999' && m.p2 === null && m.outcome === 'loss'));
});

test('a late entrant of a division nobody played joins the pod it would combine into', () => {
  const t = paired(registered(8));
  const next = run(t, {
    type: 'addPlayer',
    player: { firstName: 'Young', lastName: 'Player', id: '998', birthDate: '01/01/2018' }
  });
  assert.equal(next.pods.length, 1);
  assert.notEqual(pod(next).category, pod(t).category);
  assert.ok(pod(next).playerIds.includes('998'));
});

test('a late entrant with no pod to join opens their own', () => {
  const t = paired(registered(8));
  const lone = { ...t, pods: [] };
  const next = run(lone, {
    type: 'addPlayer',
    player: { firstName: 'Lone', lastName: 'Player', id: '997', birthDate: '01/01/1990' }
  });
  assert.deepEqual(
    next.pods.map(p => p.playerIds),
    [['997']]
  );
});

test('no one joins once their division’s top cut is under way', () => {
  const t = report(paired(registered(8)));
  const cut = run(t, { type: 'startTopCut', pod: pod(t).category, size: 4 });
  assert.equal(
    refusal(cut, {
      type: 'addPlayer',
      player: { firstName: 'Too', lastName: 'Late', id: '996', birthDate: '01/01/1990' }
    }),
    'Their division’s Swiss rounds are over; the top cuts are under way'
  );
});

test('editing an unknown player, or removing a paired one, is refused', () => {
  const t = paired(registered(4));
  assert.equal(
    refusal(t, { type: 'editPlayer', id: 'nobody', firstName: 'A', lastName: 'B', birthDate: '' }),
    'No such player'
  );
  assert.equal(refusal(t, { type: 'removePlayer', id: '100' }), 'This player has been paired; drop them instead');
});

test('removing an unpaired player takes them out of their pod’s flights', () => {
  const t = registered(4);
  const flighted = {
    ...t,
    pods: t.pods.map(p => ({ ...p, flights: [{ number: 1, playerIds: [...p.playerIds] }] }))
  } as Tournament;
  const next = run(flighted, { type: 'removePlayer', id: '100' });
  assert.ok(!next.players.some(p => p.id === '100'));
  assert.ok(!pod(next).flights!.some(f => f.playerIds.includes('100')));
});

test('a drop forfeits the open match, and taking it back reopens it', () => {
  const t = paired(registered(4));
  const match = firstMatch(t);
  const dropped = run(t, { type: 'dropPlayer', id: match.p1 });
  const forfeited = latest(dropped).matches.find(m => m.table === match.table)!;
  assert.equal(forfeited.outcome, 'p2');
  assert.equal(dropped.players.find(p => p.id === match.p1)!.droppedAfter, 1);
  assert.ok(
    canUndrop(
      dropped,
      dropped.players.find(p => p.id === match.p1)!
    )
  );

  const back = run(dropped, { type: 'undropPlayer', id: match.p1 });
  assert.equal(latest(back).matches.find(m => m.table === match.table)!.outcome, 'pending');
  assert.equal(back.players.find(p => p.id === match.p1)!.droppedAfter, null);
});

test('a disqualified player with no open match keeps the round as it is', () => {
  const t = report(paired(registered(4)));
  const match = firstMatch(t);
  const next = run(t, { type: 'disqualifyPlayer', id: match.p2! });
  assert.equal(next.players.find(p => p.id === match.p2)!.disqualified, true);
  assert.deepEqual(latest(next).matches, latest(t).matches);
  const back = run(next, { type: 'undropPlayer', id: match.p2! });
  assert.equal(back.players.find(p => p.id === match.p2)!.disqualified, undefined);
});

test('a drop cannot be taken back once the next round is paired', () => {
  const t = paired(registered(4));
  const dropped = run(t, { type: 'dropPlayer', id: '100' });
  const later = {
    ...dropped,
    pods: [{ ...pod(dropped), rounds: [...pod(dropped).rounds, { ...latest(dropped), number: 2 }] }]
  };
  assert.equal(
    refusal(later, { type: 'undropPlayer', id: '100' }),
    'They dropped before round 2 was paired, so they can’t come back now'
  );
});

test('a re-pair keeps reported matches when asked, and a deleted round is gone', () => {
  const t = paired(registered(8));
  const match = firstMatch(t);
  const one = run(t, {
    type: 'reportResult',
    pod: pod(t).category,
    round: 1,
    table: match.table,
    p1: match.p1,
    p2: match.p2,
    outcome: 'p1'
  });
  const kept = run(one, { type: 'repairRound', pod: pod(t).category, keepReported: true });
  assert.ok(latest(kept).matches.some(m => m.p1 === match.p1 && m.p2 === match.p2 && m.outcome === 'p1'));
  assert.equal(latest(kept).status, 'paired');
  const fresh = run(one, { type: 'repairRound', pod: pod(t).category, keepReported: false });
  assert.ok(latest(fresh).matches.every(m => m.outcome === 'pending'));

  assert.equal(
    refusal(one, { type: 'deleteRound', pod: pod(t).category }),
    'Clear this round’s results before deleting it'
  );
  assert.deepEqual(pod(run(fresh, { type: 'deleteRound', pod: pod(t).category })).rounds, []);
});

test('re-pairing and deleting need a Swiss round', () => {
  const t = registered(4);
  const { category } = pod(t);
  assert.equal(refusal(t, { type: 'repairRound', pod: category, keepReported: true }), 'There is no round to re-pair');
  assert.equal(refusal(t, { type: 'deleteRound', pod: category }), 'There is no round to delete');
  assert.equal(refusal(t, { type: 'repairRound', pod: 'junior', keepReported: true }), 'There is no round to change');

  const cut = run(report(paired(registered(8))), { type: 'startTopCut', pod: category, size: 4 });
  assert.equal(
    refusal(cut, { type: 'repairRound', pod: category, keepReported: true }),
    'Only a Swiss round can be re-paired'
  );
  const undone = run(cut, { type: 'deleteRound', pod: category });
  assert.ok(undone.players.every(p => p.seed === undefined && p.order === undefined));
});

test('a report must name a current match with a result it can take', () => {
  const t = paired(registered(8));
  const match = firstMatch(t);
  const base = {
    type: 'reportResult',
    pod: pod(t).category,
    round: 1,
    table: match.table,
    p1: match.p1,
    p2: match.p2
  } as const;
  assert.equal(refusal(t, { ...base, table: 99, outcome: 'p1' }), 'That match has changed; reload and try again');
  assert.equal(refusal(t, { ...base, outcome: 'bogus' as never }), 'Not a result');
  const done = report(t);
  assert.equal(latest(done).status, 'finished');
  const reopened = run(done, { ...base, outcome: 'pending' });
  assert.equal(latest(reopened).status, 'started');

  const withBye = {
    ...t,
    pods: [
      {
        ...pod(t),
        rounds: [
          {
            ...latest(t),
            matches: [
              ...latest(t).matches,
              { table: 9, p1: '900', p2: null, outcome: 'pending' as const, timestamp: '' }
            ]
          }
        ]
      }
    ]
  };
  assert.equal(
    refusal(withBye, { ...base, table: 9, p1: '900', p2: null, outcome: 'p1' }),
    'A bye has no result to report'
  );
});

test('a top cut match needs a winner, and is settled once the next round pairs', () => {
  const t = report(paired(registered(8)));
  const { category } = pod(t);
  const cut = run(t, { type: 'startTopCut', pod: category, size: 4 });
  const match = firstMatch(cut);
  const base = {
    type: 'reportResult',
    pod: category,
    round: 2,
    table: match.table,
    p1: match.p1,
    p2: match.p2
  } as const;
  assert.equal(refusal(cut, { ...base, outcome: 'tie' }), 'A top cut match needs a winner');
  const next = { ...cut, pods: [{ ...pod(cut), rounds: [...pod(cut).rounds, { ...latest(cut), number: 3 }] }] };
  assert.equal(refusal(next, { ...base, outcome: 'p1' }), 'The next top cut round is already paired');
});

test('swapping seats two players in each other’s unreported matches', () => {
  const t = paired(registered(8));
  const [a, b] = latest(t).matches;
  const { category } = pod(t);
  const swapped = run(t, { type: 'swapPlayers', pod: category, a: a!.p1, b: b!.p1 });
  assert.equal(latest(swapped).matches[0]!.p1, b!.p1);
  assert.equal(latest(swapped).matches[1]!.p1, a!.p1);
  assert.equal(
    refusal(t, { type: 'swapPlayers', pod: category, a: a!.p1, b: a!.p1 }),
    'Pick two different players in the current round'
  );
  assert.equal(
    refusal(report(t), { type: 'swapPlayers', pod: category, a: a!.p1, b: b!.p1 }),
    'Both players must be in unreported matches or the bye'
  );
  assert.equal(refusal(t, { type: 'swapPlayers', pod: 'junior', a: a!.p1, b: b!.p1 }), 'There is no round to change');
});

test('the round clock starts, stops and adjusts', () => {
  const t = paired(registered(4));
  const { category } = pod(t);
  const started = applyCommand(t, { type: 'startClock', pod: category }, context(1_000_000));
  assert.ok(started.ok);
  assert.equal(latest(started.tournament).status, 'started');
  assert.equal(latest(started.tournament).clockStartedAt, 1_000_000);
  const again = applyCommand(started.tournament, { type: 'startClock', pod: category }, context(2_000_000));
  assert.ok(again.ok);
  assert.equal(latest(again.tournament).clockStartedAt, 1_000_000);

  const stopped = applyCommand(started.tournament, { type: 'stopClock', pod: category }, context(1_060_000));
  assert.ok(stopped.ok);
  assert.equal(latest(stopped.tournament).timeLeft, latest(t).timeLeft - 60);
  assert.equal(latest(stopped.tournament).clockStartedAt, null);

  const adjusted = run(stopped.tournament, { type: 'adjustClock', pod: category, seconds: 120 });
  assert.equal(latest(adjusted).timeLeft, latest(t).timeLeft + 60);
  assert.equal(refusal(t, { type: 'adjustClock', pod: category, seconds: 7200 }), 'Adjust by up to an hour at a time');
  assert.equal(refusal(registered(4), { type: 'stopClock', pod: category }), 'There is no round to time');
});

test('a top cut is refused until it can start', () => {
  const t = paired(registered(8));
  const { category } = pod(t);
  const cut = (size: number) => ({ type: 'startTopCut', pod: category, size }) as const;
  assert.equal(refusal(t, cut(4)), 'Finish the Swiss rounds first');
  const done = report(t);
  assert.equal(refusal(done, cut(3)), 'A top cut is 2, 4, 8, 16 or 32 players');
  assert.equal(refusal(done, cut(16)), 'Not enough players for that cut');
  assert.equal(
    refusal(done, cut(4), { ...context(), sanctioned: true }),
    'A sanctioned event plays at least 3 Swiss rounds before its top cut'
  );
  assert.equal(refusal(run(done, cut(4)), cut(4)), 'The top cut has started');
});

test('a top cut seeds and brackets the Swiss leaders, with a playoff for third from four', () => {
  const t = report(paired(registered(8)));
  const next = run(t, { type: 'startTopCut', pod: pod(t).category, size: 4, playoff3rd4th: true });
  const seeded = next.players.filter(p => p.seed !== undefined);
  assert.deepEqual(seeded.map(p => p.seed).sort(), [1, 2, 3, 4]);
  assert.equal(pod(next).playoff3rd4th, true);
  assert.equal(latest(next).kind, 'elimination');
  assert.equal(latest(next).matches.length, 2);
});
