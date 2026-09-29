/**
 * Players reporting their own results: two agreeing reports settle a match,
 * two differing ones settle nothing, and a result from anywhere clears the
 * reports for that match.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import {
  fileReport,
  isDisputed,
  type OpenMatch,
  type PlayerReport,
  playerReport,
  pruneReports,
  publicReports,
  reportableMatch,
  reportedOutcome,
  reportsFor
} from '../../shared/tournament/reports.ts';
import type { Match, Tournament } from '../../shared/tournament/types.ts';
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
  return run(emptyTournament({ name: 'Cup' }, true), ...adds, { type: 'pairRound', pod: 'mixed' });
}

const matchesOf = (t: Tournament): Match[] => t.pods[0]?.rounds.at(-1)?.matches ?? [];

function openFor(t: Tournament, id: string): OpenMatch {
  const open = reportableMatch(t, id);
  assert.ok(typeof open !== 'string', String(open));
  return open;
}

function report(t: Tournament, id: string, result: 'win' | 'loss' | 'tie', at = 1): PlayerReport {
  const made = playerReport(openFor(t, id), id, result, at);
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

test('two agreeing reports settle the match and leave no reports behind', () => {
  const t = paired();
  const [match] = matchesOf(t);
  assert.ok(match?.p2);
  const first = fileReport([], report(t, match.p1, 'win'));
  assert.equal(first.agreed, null);
  assert.equal(first.reports.length, 1);
  const second = fileReport(first.reports, report(t, match.p2, 'loss'));
  assert.equal(second.agreed, 'p1');
  assert.deepEqual(second.reports, []);
});

test('two ties agree, but two wins are a dispute that settles nothing', () => {
  const t = paired();
  const [match] = matchesOf(t);
  assert.ok(match?.p2);
  const tie = fileReport(fileReport([], report(t, match.p1, 'tie')).reports, report(t, match.p2, 'tie'));
  assert.equal(tie.agreed, 'tie');
  const both = fileReport(fileReport([], report(t, match.p1, 'win')).reports, report(t, match.p2, 'win'));
  assert.equal(both.agreed, null);
  const forMatch = reportsFor(both.reports, 'mixed', 1, match);
  assert.equal(forMatch.length, 2);
  assert.ok(isDisputed(forMatch));
});

test('a player who changes their report replaces it, which can end a dispute', () => {
  const t = paired();
  const [match] = matchesOf(t);
  assert.ok(match?.p2);
  const disputed = fileReport(fileReport([], report(t, match.p1, 'win')).reports, report(t, match.p2, 'win'));
  const changed = fileReport(disputed.reports, report(t, match.p2, 'loss', 2));
  assert.equal(changed.agreed, 'p1');
  const again = fileReport([report(t, match.p1, 'win')], report(t, match.p1, 'loss', 2));
  assert.equal(again.reports.length, 1);
  assert.equal(again.reports[0]?.outcome, 'p2');
  assert.ok(!isDisputed(again.reports));
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
    { pod: 'mixed' as const, round: 1, table: match.table, p1: match.p1, p2: match.p2, outcome: 'p1' as const, at: 0 }
  ];
  assert.equal(reportableMatch(applyPending(t, pending), match.p1), 'This match already has a result');
  assert.equal(reportableMatch(t, 'nobody'), 'You are not paired this round');
});

test('a top cut match takes no tie from a player', () => {
  let t = paired();
  for (const m of matchesOf(t)) {
    t = run(t, { type: 'reportResult', pod: 'mixed', round: 1, table: m.table, p1: m.p1, p2: m.p2, outcome: 'p1' });
  }
  t = run(t, { type: 'startTopCut', pod: 'mixed', size: 2, division: 'masters' });
  const [final] = matchesOf(t);
  assert.ok(final);
  assert.equal(playerReport(openFor(t, final.p1), final.p1, 'tie', 0), 'A top cut match needs a winner');
});

test('reports go once their match has a result or is re-paired, and go public under public keys', () => {
  const t = paired();
  const [first, second] = matchesOf(t);
  assert.ok(first?.p2 && second?.p2);
  const reports = [report(t, first.p1, 'win'), report(t, second.p1, 'win')];
  const decided = run(t, {
    type: 'reportResult',
    pod: 'mixed',
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
  const repaired = run(t, { type: 'repairRound', pod: 'mixed', keepReported: false });
  const kept = pruneReports(repaired, reports);
  assert.ok(kept.every(r => matchesOf(repaired).some(m => m.table === r.table && m.p1 === r.p1 && m.p2 === r.p2)));
  const shown = publicReports(reports.slice(0, 1), { [first.p1]: '1', [first.p2]: '2' });
  assert.deepEqual([shown[0]?.p1, shown[0]?.p2, shown[0]?.by], ['1', '2', '1']);
});
