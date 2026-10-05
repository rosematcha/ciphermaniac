/**
 * Players reporting their own results: a report can change for a short
 * window and then locks, two agreeing locked reports settle a match, two
 * differing ones settle nothing, and a result from anywhere clears the
 * reports for that match.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import {
  dueResults,
  fileReport,
  isDisputed,
  isLocked,
  type OpenMatch,
  type PlayerReport,
  playerReport,
  pruneReports,
  publicReports,
  REPORT_WINDOW_MS,
  reportableMatch,
  reportedOutcome,
  reportsFor,
  resultOf,
  stillShown
} from '../../shared/tournament/reports.ts';
import type { Match, Pod, Round, Tournament } from '../../shared/tournament/types.ts';
import { applyPending } from '../../shared/tournament/view.ts';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  let current = tournament;
  for (const command of commands) {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '09/28/2026 10:00:00',
      season: 2027,
      random: seededRandom(3)
    });
    assert.ok(result.ok, result.ok ? '' : result.error);
    current = result.tournament;
  }
  return current;
}

const NAMES: [string, string][] = [
  ['Ash', 'Ketchum'],
  ['Misty', 'Waterflower'],
  ['Brock', 'Harrison'],
  ['Gary', 'Oak'],
  ['Daisy', 'Oak']
];

function paired(count = 4): Tournament {
  const adds: Command[] = NAMES.slice(0, count).map(([firstName, lastName], i) => ({
    type: 'addPlayer',
    player: { firstName, lastName, id: String(100 + i) }
  }));
  return run(emptyTournament({ name: 'Cup' }), ...adds, { type: 'pairRound', pod: 'masters' });
}

const matchesOf = (t: Tournament): Match[] => t.pods[0]?.rounds.at(-1)?.matches ?? [];

function openFor(t: Tournament, id: string): OpenMatch {
  const open = reportableMatch(t, id);
  assert.ok(typeof open !== 'string', String(open));
  return open;
}

function report(t: Tournament, id: string, result: 'win' | 'loss' | 'tie', at = 1): PlayerReport {
  const made = playerReport(openFor(t, id), id, result, { at });
  assert.ok(typeof made !== 'string', String(made));
  return made;
}

test('a result is told from either seat', () => {
  const match = { p1: 'a' };
  assert.equal(reportedOutcome(match, 'a', 'win'), 'p1');
  assert.equal(reportedOutcome(match, 'a', 'loss'), 'p2');
  assert.equal(reportedOutcome(match, 'b', 'win'), 'p2');
  assert.equal(reportedOutcome(match, 'b', 'loss'), 'p1');
  assert.equal(reportedOutcome(match, 'b', 'tie'), 'tie');
});

test('agreeing reports stand once both have locked, and not before', () => {
  const t = paired();
  const [match] = matchesOf(t);
  assert.ok(match?.p2);
  const first = fileReport([], report(t, match.p1, 'win', 0));
  assert.ok(typeof first !== 'string');
  const both = fileReport(first, report(t, match.p2, 'loss', 10_000));
  assert.ok(typeof both !== 'string');
  assert.deepEqual(dueResults(both, 10_000 + REPORT_WINDOW_MS - 1), [], 'the later report can still change');
  const due = dueResults(both, 10_000 + REPORT_WINDOW_MS);
  assert.equal(due.length, 1, 'one result per match');
  assert.deepEqual(resultOf(due[0] as PlayerReport), {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    table: match.table,
    p1: match.p1,
    p2: match.p2,
    outcome: 'p1'
  });
});

test('two ties agree, but two wins are a dispute that never stands on its own', () => {
  const t = paired();
  const [match] = matchesOf(t);
  assert.ok(match?.p2);
  const ties = [report(t, match.p1, 'tie', 0), report(t, match.p2, 'tie', 0)];
  assert.equal(dueResults(ties, REPORT_WINDOW_MS)[0]?.outcome, 'tie');
  const wins = [report(t, match.p1, 'win', 0), report(t, match.p2, 'win', 0)];
  assert.deepEqual(dueResults(wins, REPORT_WINDOW_MS * 10), []);
  assert.ok(isDisputed(reportsFor(wins, 'masters', 1, match)));
});

test('a player can change their report inside the window, and not after', () => {
  const t = paired();
  const [match] = matchesOf(t);
  assert.ok(match?.p2);
  const filed = [report(t, match.p1, 'win', 0), report(t, match.p2, 'win', 0)];
  const changed = fileReport(filed, report(t, match.p2, 'loss', REPORT_WINDOW_MS - 1));
  assert.ok(typeof changed !== 'string');
  assert.equal(changed.length, 2, 'replaced, not added');
  assert.ok(!isDisputed(changed));
  assert.ok(isLocked({ at: 0 }, REPORT_WINDOW_MS));
  assert.match(String(fileReport(filed, report(t, match.p1, 'loss', REPORT_WINDOW_MS))), /locked/);
});

test('only an open match against an opponent in the current round can be reported', () => {
  const odd = paired(3);
  const bye = matchesOf(odd).find(m => m.p2 === null);
  assert.ok(bye);
  assert.equal(reportableMatch(odd, bye.p1), 'A bye has no result to report');
  const t = paired();
  const [match] = matchesOf(t);
  assert.ok(match?.p2);
  const pending = [
    { pod: 'masters' as const, round: 1, table: match.table, p1: match.p1, p2: match.p2, outcome: 'p1' as const, at: 0 }
  ];
  assert.equal(reportableMatch(applyPending(t, pending), match.p1), 'This match already has a result');
  assert.equal(reportableMatch(t, 'nobody'), 'You are not paired this round');
});

test('a top cut match takes no tie from a player', () => {
  let t = paired();
  for (const m of matchesOf(t)) {
    t = run(t, { type: 'reportResult', pod: 'masters', round: 1, table: m.table, p1: m.p1, p2: m.p2, outcome: 'p1' });
  }
  t = run(t, { type: 'startTopCut', pod: 'masters', size: 2 });
  const [final] = matchesOf(t);
  assert.ok(final);
  assert.equal(playerReport(openFor(t, final.p1), final.p1, 'tie', { at: 0 }), 'A top cut match needs a winner');
});

test('reports go once their match has a result or is re-paired, and go public under public keys', () => {
  const t = paired();
  const [first, second] = matchesOf(t);
  assert.ok(first?.p2 && second?.p2);
  const reports = [report(t, first.p1, 'win'), report(t, second.p1, 'win')];
  const decided = run(t, {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    table: first.table,
    p1: first.p1,
    p2: first.p2,
    outcome: 'p2'
  });
  assert.deepEqual(
    pruneReports(decided, reports).map(r => r.table),
    [second.table]
  );
  const repaired = run(t, { type: 'repairRound', pod: 'masters', keepReported: false });
  const kept = pruneReports(repaired, reports);
  assert.ok(kept.every(r => matchesOf(repaired).some(m => m.table === r.table && m.p1 === r.p1 && m.p2 === r.p2)));
  const shown = publicReports(reports.slice(0, 1), { [first.p1]: '1', [first.p2]: '2' });
  assert.deepEqual([shown[0]?.p1, shown[0]?.p2, shown[0]?.by], ['1', '2', '1']);
});

test('a report follows its players when a late player of a new division renames their pod', () => {
  const t = paired();
  const [first] = matchesOf(t);
  assert.ok(first?.p2);
  const filed = [report(t, first.p1, 'win')];
  // A Senior when nobody else is one joins the Masters, whose pod then plays both.
  const joined = run(t, {
    type: 'addPlayer',
    player: { firstName: 'Late', lastName: 'Senior', birthDate: '01/01/2012' }
  });
  assert.equal(joined.pods[0]?.category, 'senior-masters');
  assert.deepEqual(
    pruneReports(joined, filed).map(r => [r.pod, r.table]),
    [['senior-masters', first.table]]
  );
});

test('a page that names a division still matches its cut in the pod that plays that division', () => {
  const match: Match = { table: 3, p1: 'a', p2: 'b', outcome: 'pending', timestamp: '' };
  const round = { number: 5, kind: 'elimination', matches: [match] } as Round;
  const pod = { category: 'senior-masters', playerIds: ['a', 'b'], rounds: [round] } as unknown as Pod;
  const open: OpenMatch = { pod, round, match: { ...match, p2: 'b' } };
  assert.ok(stillShown(open, { pod: 'masters', round: 5, table: 3 }));
  assert.ok(stillShown(open, { pod: 'senior-masters', round: 5, table: 3 }));
  assert.ok(!stillShown(open, { pod: 'junior', round: 5, table: 3 }), 'a division the pod does not play');
  assert.ok(!stillShown(open, { pod: 'masters', round: 5, table: 4 }), 'another table');
});
