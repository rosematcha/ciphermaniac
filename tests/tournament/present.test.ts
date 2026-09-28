/**
 * What the tournament pages derive from an event: labels, pending overlays,
 * per-division standings in a combined pod, a player's history, the clock,
 * the deck breakdown, who is waiting for a seat, and the .tdf export.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { Pod, Round, Tournament } from '../../shared/tournament/types.ts';
import { assignKeys, publicTournament } from '../../shared/tournament/view.ts';
import { tdfFilename, tdfText } from '../../src/lib/tournament/exportTdf.ts';
import {
  clockLabel,
  currentMatchOf,
  deckBreakdown,
  divisionHeading,
  divisionLookup,
  filterMatches,
  matchHistory,
  namesById,
  podStandings,
  recommendedStructure,
  recordsBefore,
  roundLabel,
  seatMark,
  shownOutcome,
  unseated
} from '../../src/lib/tournament/present.ts';

const CHALLENGE = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const pod = CHALLENGE.pods[0] as Pod;
const round2 = pod.rounds[1] as Round;

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(3)
    });
    assert.ok(result.ok, result.ok ? '' : result.error);
    return result.tournament;
  }, tournament);
}

test('labels rounds and results', () => {
  assert.equal(roundLabel(round2), 'Round 2');
  assert.equal(roundLabel({ ...round2, kind: 'elimination', matches: round2.matches.slice(0, 1) }), 'Final');
  assert.equal(roundLabel({ ...round2, kind: 'elimination', matches: round2.matches.slice(0, 2) }), 'Semifinals');
  assert.equal(
    roundLabel({
      ...round2,
      kind: 'elimination',
      matches: [...round2.matches, ...round2.matches, ...round2.matches, ...round2.matches]
    }),
    'Top 32'
  );
  assert.deepEqual(
    ['p1', 'p2', 'tie', 'pending'].map(outcome => seatMark(outcome as 'p1', 1)),
    ['W', 'L', 'T', '']
  );
  assert.equal(namesById(CHALLENGE).get('7200001'), 'Mary Jackson');
});

test('a pending result shows until TOM has its own', () => {
  const open = round2.matches[1];
  assert.ok(open);
  const pending = [
    { pod: 'mixed' as const, round: 2, table: open.table, p1: open.p1, p2: open.p2, outcome: 'p2' as const, at: 0 }
  ];
  assert.deepEqual(shownOutcome(open, pod, round2, pending), { outcome: 'p2', unconfirmed: true });
  assert.deepEqual(shownOutcome(open, pod, round2, []), { outcome: 'pending', unconfirmed: false });
  const decided = round2.matches[2];
  assert.ok(decided);
  assert.deepEqual(shownOutcome(decided, pod, round2, pending), { outcome: 'p2', unconfirmed: false });
});

test('a combined pod is ranked per division', () => {
  const groups = podStandings(CHALLENGE, pod, divisionLookup(CHALLENGE));
  assert.deepEqual(
    groups.map(group => [group.division, group.rows.length]),
    [
      ['junior', 1],
      ['masters', 7]
    ]
  );
  assert.equal(divisionHeading('junior'), 'Juniors');
  assert.equal(divisionHeading(null), '');
  const single: Pod = { ...pod, category: 'masters' };
  assert.equal(podStandings(CHALLENGE, single, () => 'masters')[0]?.division, null);
});

test('a player’s history, current match and records going in', () => {
  assert.deepEqual(
    matchHistory(pod, '7200007').map(row => [row.round, row.opponent, row.mark]),
    [
      [1, null, 'L'],
      [2, '7200005', 'W']
    ]
  );
  const current = currentMatchOf(CHALLENGE, '7200001');
  assert.equal(current?.match.table, 1);
  assert.equal(currentMatchOf(CHALLENGE, 'nobody'), null);
  assert.equal(recordsBefore(pod, round2).get('7200001'), '1-0-0');
});

test('the clock counts down and past zero', () => {
  const running = { ...round2, timeLeft: 90, clockStartedAt: 0 };
  assert.equal(clockLabel(running, 30_000), '1:00');
  assert.equal(clockLabel(running, 95_000), '-0:05');
});

test('the deck breakdown counts players and decided matches', () => {
  const decks = { '7200005': 'Dragapult ex', '7200007': 'Gardevoir ex', '7200001': 'Gardevoir ex' };
  const rows = deckBreakdown(CHALLENGE, decks);
  assert.deepEqual(rows[0], { label: 'Gardevoir ex', players: 2, winRate: 1 });
  assert.deepEqual(rows[1], { label: 'Dragapult ex', players: 1, winRate: 0 });
  assert.deepEqual(deckBreakdown(CHALLENGE, {}), []);
});

test('recommends rounds and a cut by attendance', () => {
  assert.deepEqual(recommendedStructure(6), { rounds: 3, cut: 0 });
  assert.deepEqual(recommendedStructure(24), { rounds: 5, cut: 8 });
  assert.deepEqual(recommendedStructure(1000), { rounds: 10, cut: 8 });
});

test('finds matches by either player’s name', () => {
  const names = namesById(CHALLENGE);
  assert.equal(filterMatches(round2.matches, names, 'lamarr').length, 1);
  assert.equal(filterMatches(round2.matches, names, '  ').length, round2.matches.length);
});

test('lists who a re-pair would seat', () => {
  let t = run(
    emptyTournament({ name: 'Seats' }, true),
    ...[0, 1, 2, 3].map(
      i => ({ type: 'addPlayer', player: { firstName: 'P', lastName: `${i}`, id: `${10 + i}` } }) as Command
    ),
    { type: 'pairRound', pod: 'mixed' }
  );
  assert.deepEqual(unseated(t, t.pods[0] as Pod), []);
  t = run(t, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'One', id: '99' } });
  assert.deepEqual(unseated(t, t.pods[0] as Pod), ['99']);
  assert.deepEqual(unseated(t, { ...(t.pods[0] as Pod), rounds: [] }), []);
});

test('exports pending results into the .tdf, finalized once the event closes', () => {
  const open = round2.matches[1];
  assert.ok(open);
  const pending = [
    { pod: 'mixed' as const, round: 2, table: open.table, p1: open.p1, p2: open.p2, outcome: 'p1' as const, at: 0 }
  ];
  const written = tdfText({ tournament: CHALLENGE, pending, finished: false });
  assert.equal(parseTdf(written).pods[0]?.rounds[1]?.matches[1]?.outcome, 'p1');
  assert.match(written, /stage="4"/);
  assert.match(tdfText({ tournament: CHALLENGE, pending: [], finished: true }), /<standings>/);
  assert.equal(tdfFilename(CHALLENGE), 'Fixture Challenge Friends.tdf');
  assert.equal(tdfFilename(emptyTournament({ name: '???' }, true)), 'tournament.tdf');
});

test('the organizer’s and the public’s standings break exact ties the same way', () => {
  const t = run(
    emptyTournament({ name: 'Ties' }, true),
    ...['9', '10', '4', '3'].map(id => ({ type: 'addPlayer', player: { firstName: 'P', lastName: id, id } }) as Command)
  );
  const keys = assignKeys(t, {});
  const byKey = new Map(Object.entries(keys).map(([id, key]) => [key, id]));
  const staff = podStandings(t, t.pods[0] as Pod, () => 'masters')[0]?.rows.map(row => row.playerId);
  const publicCopy = publicTournament(t, keys);
  const shown = podStandings(publicCopy, publicCopy.pods[0] as Pod, () => 'masters')[0]?.rows.map(
    row => byKey.get(row.playerId) ?? ''
  );
  assert.deepEqual(shown, staff);
});
