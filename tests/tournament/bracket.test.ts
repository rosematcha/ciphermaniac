/**
 * The top cut as a bracket: seeded positions whatever order the matches are
 * stored in, winners carried into rounds not paired yet, results entered on
 * the site shown as unconfirmed, and the match for third kept apart.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import type { Pod, Round, Tournament } from '../../shared/tournament/types.ts';
import type { PendingResult } from '../../shared/tournament/view.ts';
import { type Bracket, buildBracket, cutSeeds } from '../../src/lib/tournament/bracket.ts';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(5)
    });
    assert.ok(result.ok, result.ok ? '' : `${command.type}: ${result.error}`);
    return result.tournament;
  }, tournament);
}

const pod = (t: Tournament): Pod => t.pods[0] as Pod;
const latest = (t: Tournament): Round => pod(t).rounds.at(-1) as Round;

/** Every open match in the current round won by its first seat, the higher seed in a top cut. */
function reportAll(t: Tournament): Tournament {
  const r = latest(t);
  return run(
    t,
    ...r.matches
      .filter(m => m.outcome === 'pending')
      .map((m): Command => ({
        type: 'reportResult',
        pod: 'masters',
        round: r.number,
        table: m.table,
        p1: m.p1,
        p2: m.p2,
        outcome: 'p1'
      }))
  );
}

/** Sixteen players through four Swiss rounds, then a top cut of `size`. */
function cutOf(size: number, playoff3rd4th = false): Tournament {
  const adds: Command[] = Array.from({ length: 16 }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: 'Player', lastName: String(i + 1), id: String(100 + i), birthDate: '01/01/1990' }
  }));
  let t = run(emptyTournament({ name: 'Bracket Cup' }), ...adds);
  for (let i = 0; i < 4; i += 1) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  }
  return run(t, { type: 'startTopCut', pod: 'masters', size, playoff3rd4th });
}

const seedsOf = (bracket: Bracket, column: number) =>
  bracket.rounds[column]?.matches.map(m => [m.top.seed, m.bottom.seed]);

test('a top 8 is drawn as quarterfinals, semifinals and a final, seeds placed so the top two meet last', () => {
  const t = cutOf(8);
  const bracket = buildBracket(pod(t), cutSeeds(t, pod(t)), []);
  assert.ok(bracket);
  assert.deepEqual(
    bracket.rounds.map(r => [r.label, r.matches.length]),
    [
      ['Quarterfinals', 4],
      ['Semifinals', 2],
      ['Final', 1]
    ]
  );
  assert.deepEqual(seedsOf(bracket, 0), [
    [1, 8],
    [4, 5],
    [2, 7],
    [3, 6]
  ]);
  assert.ok(bracket.rounds[0]?.matches.every(m => m.playing && m.table > 0));
  assert.deepEqual(seedsOf(bracket, 1), [
    [null, null],
    [null, null]
  ]);
  assert.equal(bracket.third, null);
});

test('winners go through to a round not paired yet, and the bracket keeps them there once it is', () => {
  let t = reportAll(cutOf(8));
  const waiting = buildBracket(pod(t), cutSeeds(t, pod(t)), []);
  assert.deepEqual(
    waiting?.rounds[0]?.matches.map(m => [m.top.mark, m.bottom.mark]),
    Array.from({ length: 4 }, () => ['W', 'L'])
  );
  assert.deepEqual(waiting && seedsOf(waiting, 1), [
    [1, 4],
    [2, 3]
  ]);
  assert.ok(
    waiting?.rounds[1]?.matches.every(m => m.table === 0 && !m.playing),
    'not paired, so not playing'
  );
  t = run(t, { type: 'pairRound', pod: 'masters' });
  const paired = buildBracket(pod(t), cutSeeds(t, pod(t)), []);
  assert.deepEqual(paired && seedsOf(paired, 1), [
    [1, 4],
    [2, 3]
  ]);
  assert.ok(paired?.rounds[1]?.matches.every(m => m.playing && m.table > 0));
});

test('a first round stored in table order, as a TOM file may keep it, is drawn in seed order', () => {
  const t = cutOf(8);
  const first = latest(t);
  const shuffled: Pod = {
    ...pod(t),
    rounds: [...pod(t).rounds.slice(0, -1), { ...first, matches: [...first.matches].reverse() }]
  };
  assert.deepEqual(buildBracket(shuffled, cutSeeds(t, pod(t)), []), buildBracket(pod(t), cutSeeds(t, pod(t)), []));
});

test('a result entered on the site shows in the bracket as unconfirmed, and its winner goes through', () => {
  const t = cutOf(4);
  const [semi] = latest(t).matches;
  assert.ok(semi);
  const { table, p1, p2 } = semi;
  const pending: PendingResult[] = [{ pod: 'masters', round: latest(t).number, table, p1, p2, outcome: 'p2', at: 0 }];
  const bracket = buildBracket(pod(t), cutSeeds(t, pod(t)), pending);
  const shown = bracket?.rounds[0]?.matches[0];
  assert.deepEqual([shown?.top.mark, shown?.bottom.mark, shown?.unconfirmed, shown?.playing], ['L', 'W', true, false]);
  assert.equal(bracket?.rounds[1]?.matches[0]?.top.id, semi.p2);
});

test('the match for third sits apart from the bracket', () => {
  const t = run(reportAll(cutOf(4, true)), { type: 'pairRound', pod: 'masters' });
  const bracket = buildBracket(pod(t), cutSeeds(t, pod(t)), []);
  assert.deepEqual(
    bracket?.rounds.map(r => r.matches.length),
    [2, 1]
  );
  assert.deepEqual([bracket?.third?.top.seed, bracket?.third?.bottom.seed], [4, 3]);
});

test('a pod with no top cut has no bracket', () => {
  const t = cutOf(8);
  const swissOnly: Pod = { ...pod(t), rounds: pod(t).rounds.filter(r => r.kind === 'swiss') };
  assert.equal(buildBracket(swissOnly, cutSeeds(t, swissOnly), []), null);
});

/** The quarterfinals of a top 8 all won by their first seat, with `pairings` as the semifinals after them. */
function semifinalsOf(pairings: (t: Tournament, winners: string[], losers: string[]) => [string, string][]) {
  const t = reportAll(cutOf(8));
  const quarters = latest(t);
  const winners = quarters.matches.map(m => m.p1);
  const losers = quarters.matches.map(m => m.p2 ?? '');
  const semis: Round = {
    ...quarters,
    number: quarters.number + 1,
    status: 'paired',
    matches: pairings(t, winners, losers).map(([p1, p2], i) => ({
      table: i + 1,
      p1,
      p2,
      outcome: 'pending',
      timestamp: ''
    }))
  };
  const paired: Pod = { ...pod(t), rounds: [...pod(t).rounds, semis] };
  return { t, quarters, bracket: buildBracket(paired, cutSeeds(t, pod(t)), []) };
}

test('semifinals paired other than by neighbours put each beside its own quarterfinals, every match once', () => {
  // As a file from elsewhere might pair them: the first quarterfinal's winner meets the third's.
  const { quarters, bracket } = semifinalsOf((_, w) => [
    [w[0] as string, w[2] as string],
    [w[1] as string, w[3] as string]
  ]);
  assert.ok(bracket);
  const [qf, sf] = bracket.rounds;
  assert.deepEqual(
    qf?.matches.map(m => m.table).sort(),
    quarters.matches.map(m => m.table).sort(),
    'no quarterfinal repeated or lost'
  );
  sf?.matches.forEach((semi, j) => {
    const fed = [qf?.matches[2 * j], qf?.matches[2 * j + 1]].map(m => (m?.top.mark === 'W' ? m.top.id : m?.bottom.id));
    assert.deepEqual([semi.top.id, semi.bottom.id], fed);
  });
  assert.equal(bracket.rounds[2]?.matches.length, 1);
});

test('a round that does not follow from the one before draws no bracket, so the pages show the table', () => {
  const { bracket } = semifinalsOf((_, w, l) => [
    [w[0] as string, l[1] as string],
    [w[2] as string, w[3] as string]
  ]);
  assert.equal(bracket, null);
});
