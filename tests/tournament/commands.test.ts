/**
 * Running a Swiss event by commands: players join, rounds pair and report, a
 * late arrival is folded into a round already paired, drops leave the field,
 * and a top cut seeds from the standings.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCommand,
  type Command,
  type CommandContext,
  type NewPlayer,
  secondsLeft
} from '../../shared/tournament/commands.ts';
import { DEFAULT_ROUND_MINUTES, emptyTournament } from '../../shared/tournament/create.ts';
import { readCommand } from '../../shared/tournament/readCommand.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { writeTdf } from '../../shared/tournament/tdf.ts';
import { joinedLate, playerPod, podOf } from '../../shared/tournament/rounds.ts';
import { bracketMatches, placeFinals, swissStandings, thirdPlaceMatch } from '../../shared/tournament/standings.ts';
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
  return run(emptyTournament({ name: 'Test Cup' }), ...adds);
}

/** Reports every open match in the current round as a win for player one. */
function reportAll(t: Tournament): Tournament {
  const r = round(t);
  const reports: Command[] = r.matches
    .filter(m => m.outcome === 'pending')
    .map(m => ({
      type: 'reportResult',
      pod: pod(t).category,
      round: r.number,
      table: m.table,
      p1: m.p1,
      p2: m.p2,
      outcome: 'p1'
    }));
  return run(t, ...reports);
}

test('pairs a first round with a bye for the odd player out', () => {
  const t = run(withPlayers(5), { type: 'pairRound', pod: 'masters' });
  const { matches } = round(t);
  assert.equal(matches.length, 3);
  assert.deepEqual(
    matches.map(m => m.table),
    [0, 1, 2]
  );
  assert.equal(matches[0]?.outcome, 'bye');
});

test('will not pair the next round while results are missing', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' });
  assert.match(attempt(t, { type: 'pairRound', pod: 'masters' }), /Report every match/);
});

test('a late player gets a loss for each round they missed', () => {
  let t = reportAll(run(withPlayers(4), { type: 'pairRound', pod: 'masters' }));
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Comer', id: '999' } });
  const missed = round(t).matches.find(m => m.p1 === '999');
  assert.deepEqual(missed && { p2: missed.p2, outcome: missed.outcome }, { p2: null, outcome: 'loss' });
  const late = swissStandings(pod(t), t.players).find(row => row.playerId === '999');
  assert.deepEqual(late?.record, { wins: 0, losses: 1, ties: 0 });
});

test('re-pairing a round keeps reported matches and seats a late arrival', () => {
  let t = run(withPlayers(6), { type: 'pairRound', pod: 'masters' });
  const first = round(t).matches[0];
  assert.ok(first);
  t = run(t, {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    table: first.table,
    p1: first.p1,
    p2: first.p2,
    outcome: 'p2'
  });
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Comer', id: '999' } });
  t = run(t, { type: 'repairRound', pod: 'masters', keepReported: true });
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
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = run(t, { type: 'dropPlayer', id: '100' }, { type: 'pairRound', pod: 'masters' });
  const second = round(t);
  assert.ok(!second.matches.some(m => m.p1 === '100' || m.p2 === '100'));
  const firstPairs = new Set(round(t, 1).matches.map(m => [m.p1, m.p2].sort().join('v')));
  for (const match of second.matches) {
    assert.ok(!firstPairs.has([match.p1, match.p2].sort().join('v')));
  }
  assert.equal(t.players.find(p => p.id === '100')?.droppedAfter, 1);
});

test('swaps two players between tables in the current round', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' });
  const [a, b] = round(t).matches;
  assert.ok(a && b && a.p2);
  const swapped = run(t, { type: 'swapPlayers', pod: 'masters', a: a.p2, b: b.p1 });
  assert.equal(round(swapped).matches[0]?.p2, b.p1);
  assert.equal(round(swapped).matches[1]?.p1, a.p2);
});

test('a player who has played cannot be removed, only dropped', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' });
  assert.match(attempt(t, { type: 'removePlayer', id: '100' }), /drop them instead/);
  const before = run(withPlayers(3), { type: 'removePlayer', id: '101' });
  assert.equal(before.players.length, 2);
});

test('deletes an unreported round, not a reported one', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' });
  assert.equal(pod(run(t, { type: 'deleteRound', pod: 'masters' })).rounds.length, 0);
  assert.match(attempt(reportAll(t), { type: 'deleteRound', pod: 'masters' }), /Clear this round/);
});

test('a player added mid-event is tagged late, and is known by the round they missed', () => {
  let t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' });
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Comer', id: '999' } });
  assert.equal(t.players.find(p => p.id === '999')?.late, true);
  assert.ok(joinedLate(pod(t), '999'));
  assert.ok(!joinedLate(pod(t), t.players[0]?.id ?? ''));
});

test('a player who drops mid-round loses the match they are in', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' });
  const [match] = round(t).matches;
  assert.ok(match?.p2);
  const dropped = run(t, { type: 'dropPlayer', id: match.p2 });
  const after = round(dropped).matches.find(m => m.table === match.table);
  assert.equal(after?.outcome, 'p1', 'their opponent wins');
  assert.equal(round(dropped).matches.filter(m => m.outcome === 'pending').length, 1, 'other tables play on');
  const done = reportAll(t);
  const late = run(done, { type: 'dropPlayer', id: match.p1 });
  assert.deepEqual(
    round(late).matches.map(m => m.outcome),
    round(done).matches.map(m => m.outcome),
    'a drop after the match leaves its result alone'
  );
  const back = run(dropped, { type: 'undropPlayer', id: match.p2 });
  assert.equal(round(back).matches.find(m => m.table === match.table)?.outcome, 'pending', 'reinstating reopens it');
  const decided = run(
    dropped,
    { type: 'reportResult', pod: 'masters', round: 1, table: match.table, p1: match.p1, p2: match.p2, outcome: 'tie' },
    { type: 'undropPlayer', id: match.p2 }
  );
  assert.equal(
    round(decided).matches.find(m => m.table === match.table)?.outcome,
    'tie',
    'a result entered since the drop stands'
  );
});

test('a disqualified player leaves the standings but still counts for their opponents', () => {
  const t = reportAll(run(withPlayers(4), { type: 'pairRound', pod: 'masters' }));
  const [match] = round(t).matches;
  assert.ok(match?.p2);
  // Their record counts for their opponent as a dropped player's would, capped at 75%.
  const drop = run(t, { type: 'dropPlayer', id: match.p1 });
  const before = swissStandings(pod(drop), drop.players).find(row => row.playerId === match.p2);
  const out = run(t, { type: 'disqualifyPlayer', id: match.p1 });
  const rows = swissStandings(pod(out), out.players);
  assert.equal(rows.length, 3);
  assert.ok(!rows.some(row => row.playerId === match.p1));
  assert.deepEqual(
    rows.map(row => row.place),
    [1, 2, 3]
  );
  assert.equal(rows.find(row => row.playerId === match.p2)?.owp, before?.owp);
  assert.equal(out.players.find(p => p.id === match.p1)?.droppedAfter, 1);
  const back = run(out, { type: 'undropPlayer', id: match.p1 });
  assert.equal(back.players.find(p => p.id === match.p1)?.disqualified, undefined);
  assert.equal(readCommand({ type: 'disqualifyPlayer', id: '1' })?.type, 'disqualifyPlayer');
  const written = writeTdf(out, { finalized: true });
  assert.match(written, new RegExp(`<player id="${match.p1}" />`), 'the .tdf puts disqualified players in dnf');
});

test('a sanctioned event needs four players, three Swiss rounds before a cut, and 30-minute rounds', () => {
  const sanctioned = { ...context(), sanctioned: true };
  const refused = (t: Tournament, command: Command) => {
    const result = applyCommand(t, command, sanctioned);
    return result.ok ? '' : result.error;
  };
  assert.match(refused(withPlayers(3), { type: 'pairRound', pod: 'masters' }), /at least 4 players/);
  assert.ok(applyCommand(withPlayers(3), { type: 'pairRound', pod: 'masters' }, context()).ok, 'unsanctioned');
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  assert.match(refused(t, { type: 'startTopCut', pod: 'masters', size: 4 }), /at least 3 Swiss rounds/);
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  assert.ok(applyCommand(t, { type: 'startTopCut', pod: 'masters', size: 4 }, sanctioned).ok);
  assert.match(refused(t, { type: 'updateInfo', info: { roundTime: 25 } }), /at least 30 minutes/);
  assert.match(refused(t, { type: 'updateInfo', info: { finalsRoundTime: 20 } }), /at least 30 minutes/);
  assert.ok(applyCommand(t, { type: 'updateInfo', info: { roundTime: 50 } }, sanctioned).ok);
});

test('a League Challenge has no top cut, and its type can be set as event info', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = run(t, { type: 'updateInfo', info: { eventType: 'challenge' } });
  assert.equal(t.info.eventType, 'challenge');
  assert.match(attempt(t, { type: 'startTopCut', pod: 'masters', size: 4 }), /League Challenge has no top cut/);
  assert.equal(readCommand({ type: 'updateInfo', info: { eventType: 'challenge' } })?.type, 'updateInfo');
  assert.equal(readCommand({ type: 'updateInfo', info: { eventType: 'regionals' } }), null);
});

test('a top cut that plays for third pairs the semifinal losers beside the final, and places them third and fourth', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'startTopCut', pod: 'masters', size: 4, playoff3rd4th: true }));
  assert.equal(pod(t).playoff3rd4th, true);
  assert.match(writeTdf(t), /<playoff3rd4th>true<\/playoff3rd4th>/, 'TOM sees the match announced');
  const semis = round(t).matches;
  const [winners, losers] = [semis.map(m => m.p1), semis.map(m => m.p2)];
  t = run(t, { type: 'pairRound', pod: 'masters' });
  const last = round(t);
  assert.deepEqual(
    last.matches.map(m => [m.p1, m.p2]),
    [winners, losers],
    'the final first, then the match for third'
  );
  assert.equal(thirdPlaceMatch(pod(t), last), last.matches[1]);
  assert.deepEqual(bracketMatches(pod(t), last), [last.matches[0]]);
  t = reportAll(t);
  assert.match(attempt(t, { type: 'pairRound', pod: 'masters' }), /top cut is finished/);
  const places = placeFinals(pod(t), swissStandings(pod(t), t.players)).slice(0, 4);
  assert.deepEqual(
    places.map(row => row.playerId),
    [winners[0], winners[1], losers[0], losers[1]]
  );
});

test('a semifinal loser who has dropped forfeits the match for third', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'startTopCut', pod: 'masters', size: 4, playoff3rd4th: true }));
  const losers = round(t).matches.map(m => m.p2 as string);
  const one = run(run(t, { type: 'dropPlayer', id: losers[0] as string }), { type: 'pairRound', pod: 'masters' });
  assert.deepEqual(
    round(one).matches.map(m => [m.p1, m.p2, m.outcome]),
    [
      [round(one).matches[0]?.p1, round(one).matches[0]?.p2, 'pending'],
      [losers[0], losers[1], 'p2']
    ]
  );
  const both = run(
    t,
    { type: 'dropPlayer', id: losers[0] as string },
    { type: 'dropPlayer', id: losers[1] as string },
    { type: 'pairRound', pod: 'masters' }
  );
  assert.equal(round(both).matches.length, 1, 'with both gone, only the final is played');
});

test('the event type stays as it is once the top cut has started', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  t = run(t, { type: 'startTopCut', pod: 'masters', size: 4 });
  assert.match(attempt(t, { type: 'updateInfo', info: { eventType: 'challenge' } }), /top cut has started/);
  assert.equal(run(t, { type: 'updateInfo', info: { name: 'Renamed' } }).info.name, 'Renamed');
});

test('a top cut of two cannot play for third, and one without the match plays the final alone', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  assert.equal(
    run(t, { type: 'startTopCut', pod: 'masters', size: 2, playoff3rd4th: true }).pods[0]?.playoff3rd4th,
    false
  );
  t = reportAll(run(t, { type: 'startTopCut', pod: 'masters', size: 4 }));
  assert.equal(round(run(t, { type: 'pairRound', pod: 'masters' })).matches.length, 1);
});

test('a top cut seeds from standings and plays down to a winner', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  // Everyone is a Master, so the combined pod cuts as a whole with no division asked.
  t = run(t, { type: 'startTopCut', pod: 'masters', size: 4 });
  const seeds = swissStandings(pod(t), t.players)
    .slice(0, 4)
    .map(row => row.playerId);
  assert.deepEqual(
    round(t).matches.map(m => [m.p1, m.p2]),
    [
      [seeds[0], seeds[3]],
      [seeds[2], seeds[1]]
    ]
  );
  const semi = round(t).matches[0];
  assert.ok(semi);
  assert.match(
    attempt(t, {
      type: 'reportResult',
      pod: 'masters',
      round: 3,
      table: semi.table,
      p1: semi.p1,
      p2: semi.p2,
      outcome: 'tie'
    }),
    /needs a winner/
  );
  t = reportAll(t);
  t = run(t, { type: 'pairRound', pod: 'masters' });
  assert.equal(round(t).matches.length, 1);
  assert.match(
    attempt(t, {
      type: 'reportResult',
      pod: 'masters',
      round: 3,
      table: semi.table,
      p1: semi.p1,
      p2: semi.p2,
      outcome: 'p2'
    }),
    /already paired/
  );
  t = reportAll(t);
  assert.match(attempt(t, { type: 'pairRound', pod: 'masters' }), /top cut is finished/);
});

test('a fixed table does not move a top cut player to another side of the bracket', () => {
  let t = reportAll(run(withPlayers(8), { type: 'pairRound', pod: 'masters' }));
  t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  const seeds = swissStandings(pod(t), t.players).map(row => row.playerId);
  // The first seed sits at the last quarterfinal table, after the others in table order.
  t = run(t, { type: 'setFixedTable', id: seeds[0] ?? '', table: 4 }, { type: 'startTopCut', pod: 'masters', size: 8 });
  t = run(reportAll(t), { type: 'pairRound', pod: 'masters' });
  const semis = round(t).matches.map(m => new Set([m.p1, m.p2]));
  assert.deepEqual(semis, [new Set([seeds[0], seeds[4]]), new Set([seeds[2], seeds[6]])]);
});

test('before round 1 the pods follow the field: a division under six plays with the next', () => {
  const kid = (i: number) => ({ firstName: 'Kid', lastName: `${i}`, birthDate: '01/01/2016' });
  const adult = (i: number) => ({ firstName: 'Adult', lastName: `${i}`, birthDate: '01/01/1990' });
  const add = (player: NewPlayer): Command => ({ type: 'addPlayer', player });
  const shape = (t: Tournament) => t.pods.map(p => [p.category, p.playerIds.length]);
  let t = run(emptyTournament({ name: 'Split' }), ...[1, 2].map(kid).map(add), ...[1, 2].map(adult).map(add));
  assert.deepEqual(shape(t), [['mixed', 4]], 'two Juniors play with the Masters');
  t = run(t, ...[3, 4, 5, 6].map(kid).map(add), ...[3, 4, 5, 6].map(adult).map(add));
  assert.deepEqual(
    shape(t),
    [
      ['junior', 6],
      ['senior-masters', 6]
    ],
    'six of each play apart'
  );
  const leaving = t.players.find(p => p.lastName === '6' && p.birthDate.endsWith('2016'));
  t = run(t, { type: 'removePlayer', id: leaving?.id ?? '' });
  assert.deepEqual(shape(t), [['mixed', 11]], 'and together again when one falls under six');
});

test('once play starts the pods stand, and a late player of a division nobody played joins the next pod', () => {
  const adults = Array.from({ length: 6 }, (_, i) => ({
    type: 'addPlayer' as const,
    player: { firstName: 'Adult', lastName: `${i}`, birthDate: '01/01/1990' }
  }));
  let t = run(emptyTournament({ name: 'Late' }), ...adults, { type: 'pairRound', pod: 'masters' });
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Senior', birthDate: '01/01/2012' } });
  assert.deepEqual(
    t.pods.map(p => [p.category, p.playerIds.length]),
    [['senior-masters', 7]]
  );
  assert.equal(t.pods[0]?.rounds.length, 1, 'the round played stays with the pod');
});

test('the clock runs, stops and takes extra time', () => {
  let t = run(withPlayers(2), { type: 'pairRound', pod: 'masters' });
  const started = applyCommand(t, { type: 'startClock', pod: 'masters' }, context(1, 0));
  assert.ok(started.ok);
  t = started.tournament;
  assert.equal(secondsLeft(round(t), 60_000), DEFAULT_ROUND_MINUTES * 60 - 60);
  const stopped = applyCommand(t, { type: 'stopClock', pod: 'masters' }, context(1, 120_000));
  assert.ok(stopped.ok);
  t = run(stopped.tournament, { type: 'adjustClock', pod: 'masters', seconds: 180 });
  assert.equal(secondsLeft(round(t), 999_999), DEFAULT_ROUND_MINUTES * 60 - 120 + 180);
});

test('divisions paired apart play at once without sharing a table', () => {
  const add = (year: string) => (i: number) =>
    ({ type: 'addPlayer', player: { firstName: year, lastName: `${i}`, birthDate: `01/01/${year}` } }) as Command;
  const six = [1, 2, 3, 4, 5, 6];
  let t = run(emptyTournament({ name: 'Apart' }), ...six.map(add('2016')), ...six.map(add('1990')));
  t = run(t, { type: 'pairRound', pod: 'junior' }, { type: 'pairRound', pod: 'senior-masters' });
  const tables = (category: string) => t.pods.find(p => p.category === category)?.rounds[0]?.matches.map(m => m.table);
  assert.deepEqual(
    [tables('junior'), tables('senior-masters')],
    [
      [1, 2, 3],
      [4, 5, 6]
    ]
  );
});

test('a combined pod shares its cut rounds and refuses late entrants once cuts start', () => {
  let t = run(
    emptyTournament({ name: 'Mixed' }),
    ...['2016', '2016', '2016', '2016', '1990', '1990', '1990', '1990'].map(
      (year, i) =>
        ({
          type: 'addPlayer',
          player: { firstName: 'P', lastName: String(i), id: String(300 + i), birthDate: `02/27/${year}` }
        }) as Command
    )
  );
  t = reportAll(run(t, { type: 'pairRound', pod: 'mixed' }));
  assert.match(attempt(t, { type: 'startTopCut', pod: 'mixed', size: 4 }), /Pick the division/);
  t = run(
    t,
    { type: 'startTopCut', pod: 'mixed', size: 4, division: 'junior' },
    { type: 'startTopCut', pod: 'mixed', size: 2, division: 'masters' }
  );
  assert.equal(t.pods.length, 1);
  assert.equal(podOf(t, '300')?.category, 'mixed');
  assert.deepEqual(
    playerPod(t, '300')?.rounds.map(r => r.kind),
    ['swiss', 'elimination']
  );
  assert.equal(round(t).matches.length, 3);
  t = run(reportAll(t), { type: 'pairRound', pod: 'mixed' });
  assert.equal(round(t).matches.length, 1);
  assert.match(
    attempt(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Kid', birthDate: '01/01/2016' } }),
    /top cuts are under way/
  );
});

test('a report for a match that has since changed is refused', () => {
  const t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' });
  const [first] = round(t).matches;
  assert.ok(first);
  assert.match(
    attempt(t, {
      type: 'reportResult',
      pod: 'masters',
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
    { type: 'reportResult', pod: 'masters', round: 1, table: first.table, p1: first.p1, p2: first.p2, outcome: 'p1' },
    {
      type: 'reportResult',
      pod: 'masters',
      round: 1,
      table: first.table,
      p1: first.p1,
      p2: first.p2,
      outcome: 'pending'
    }
  );
  assert.equal(round(cleared).matches[0]?.timestamp, round(cleared).pairTime, 'an open match carries its pairing time');
});

test('a drop can be taken back until the next round is paired, not after', () => {
  let t = run(withPlayers(4), { type: 'pairRound', pod: 'masters' }, { type: 'dropPlayer', id: '100' });
  t = run(t, { type: 'undropPlayer', id: '100' }, { type: 'dropPlayer', id: '100' });
  t = run(reportAll(t), { type: 'pairRound', pod: 'masters' });
  assert.match(attempt(t, { type: 'undropPlayer', id: '100' }), /before round 2 was paired/);
});

test('static seating keeps a player at their table every round, re-pairs included', () => {
  let t = run(withPlayers(8), { type: 'setFixedTable', id: '105', table: 3 });
  t = run(t, { type: 'pairRound', pod: 'masters' });
  const at = (id: string) => round(t).matches.find(m => m.p1 === id || m.p2 === id)?.table;
  assert.equal(at('105'), 3);
  assert.deepEqual(
    round(t).matches.map(m => m.table),
    [1, 2, 3, 4],
    'the others fill the tables left, in order'
  );
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'One', id: '990' } });
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Two', id: '991' } });
  t = run(t, { type: 'repairRound', pod: 'masters', keepReported: true });
  assert.equal(at('105'), 3);
  t = run(reportAll(t), { type: 'pairRound', pod: 'masters' });
  assert.equal(at('105'), 3);
});

test('two players cannot share a fixed table, and one can be cleared', () => {
  const t = run(withPlayers(2), { type: 'setFixedTable', id: '100', table: 5 });
  assert.match(attempt(t, { type: 'setFixedTable', id: '101', table: 5 }), /already fixed for Player 1/);
  assert.match(attempt(t, { type: 'setFixedTable', id: '101', table: 0 }), /whole number/);
  const cleared = run(t, { type: 'setFixedTable', id: '100', table: null });
  assert.equal(cleared.players[0]?.fixedTable, undefined);
});
