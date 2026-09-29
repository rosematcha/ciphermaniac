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
import { assignKeys, DEFAULT_SETTINGS, publicTournament } from '../../shared/tournament/view.ts';
import { tdfFilename, tdfText } from '../../src/lib/tournament/exportTdf.ts';
import {
  champion,
  clockLabel,
  currentMatchOf,
  cutSplit,
  deckBreakdown,
  divisionHeading,
  divisionLookup,
  filterMatches,
  matchHistory,
  namesById,
  nextStep,
  podProgress,
  podStandings,
  recommendedStructure,
  recordsBefore,
  reportState,
  roundLabel,
  seatMark,
  shownDecks,
  shownOutcome,
  statusParts,
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
  assert.deepEqual(rows[0], { label: 'Gardevoir ex', players: 2, matches: 2, winRate: 1 });
  assert.deepEqual(rows[1], { label: 'Dragapult ex', players: 1, matches: 2, winRate: 0 });
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

test('deck sprites are drawn only while the event tracks archetypes', () => {
  const decks = { '1': 'Gardevoir' };
  assert.deepEqual(shownDecks({ decks, settings: { ...DEFAULT_SETTINGS, deckVisibility: 'after' } }), decks);
  assert.deepEqual(shownDecks({ decks, settings: { ...DEFAULT_SETTINGS, deckVisibility: 'off' } }), {});
});

test('a player’s report state: pressed, disputed, locked, and final once it stands', () => {
  const match = round2.matches.find(m => m.outcome === 'pending' && m.p2 !== null);
  assert.ok(match?.p2);
  const at = { pod, round: round2, match };
  const mine = { pod: pod.category, round: 2, table: match.table, p1: match.p1, p2: match.p2, at: 0 };
  const none = reportState(at, { pending: [], reports: [] }, match.p1, 0);
  assert.deepEqual(none, { chosen: null, disputed: false, locked: false, final: false });
  const won = [{ ...mine, by: match.p1, outcome: 'p1' as const }];
  assert.deepEqual(reportState(at, { pending: [], reports: won }, match.p1, 1000), {
    chosen: 'win',
    disputed: false,
    locked: false,
    final: false
  });
  const both = [...won, { ...mine, by: match.p2, outcome: 'p2' as const }];
  const disputed = reportState(at, { pending: [], reports: both }, match.p2, 30_000);
  assert.deepEqual(disputed, { chosen: 'win', disputed: true, locked: true, final: false });
  const agreed = [...won, { ...mine, by: match.p2, outcome: 'p1' as const }];
  assert.equal(reportState(at, { pending: [], reports: agreed }, match.p2, 29_999).final, false);
  assert.deepEqual(reportState(at, { pending: [], reports: agreed }, match.p2, 30_000), {
    chosen: 'loss',
    disputed: false,
    locked: true,
    final: true
  });
  const staff = [{ ...mine, outcome: 'tie' as const }];
  assert.deepEqual(reportState(at, { pending: staff, reports: both }, match.p1, 0), {
    chosen: 'tie',
    disputed: false,
    locked: true,
    final: true
  });
});

test('the console’s next step: pair when every table is in, wait while any is open, close after the final', () => {
  const open = podProgress(pod, []);
  assert.equal(open.round?.number, 2);
  assert.ok(open.open > 0);
  assert.deepEqual(nextStep(open, false), {
    kind: 'pair',
    label: 'Pair round 3',
    ready: false,
    reason: `${open.open} ${open.open === 1 ? 'table' : 'tables'} open`
  });
  assert.deepEqual(nextStep({ ...open, open: 0 }, false), { kind: 'pair', label: 'Pair round 3', ready: true });
  assert.deepEqual(nextStep({ round: undefined, tables: 0, open: 0, champion: null }, false), {
    kind: 'pair',
    label: 'Pair round 1',
    ready: true
  });
  assert.deepEqual(nextStep({ ...open, champion: 'x' }, false), { kind: 'close', champion: 'x' });
  assert.deepEqual(nextStep(open, true), { kind: 'none' });
});

test('a cut round leads to the next stage by name, and a finished final crowns its winner', () => {
  const quarter: Round = { ...round2, kind: 'elimination', matches: round2.matches.slice(0, 4) };
  const done = { round: quarter, tables: 4, open: 0, champion: null };
  assert.equal((nextStep(done, false) as { label: string }).label, 'Pair semifinals');
  const semi: Round = { ...round2, kind: 'elimination', matches: round2.matches.slice(0, 2) };
  assert.equal((nextStep({ ...done, round: semi }, false) as { label: string }).label, 'Pair the final');
  const [first] = round2.matches;
  assert.ok(first);
  const final: Round = { ...round2, kind: 'elimination', matches: [{ ...first, outcome: 'p1' }] };
  assert.equal(champion(final), first.p1);
  assert.equal(champion({ ...final, matches: [{ ...first, outcome: 'pending' }] }), null);
});

test('the status sentence names the round, what is still playing and the clock', () => {
  const open = podProgress(pod, []);
  assert.deepEqual(statusParts(open, false, '23:41'), [
    'Round 2',
    `${open.open} ${open.open === 1 ? 'table' : 'tables'} playing`,
    '23:41 left'
  ]);
  assert.equal(statusParts(open, false, '-4:05')[2], '4:05 over', 'past time reads as over, not negative');
  assert.deepEqual(statusParts({ ...open, open: 0 }, false, '23:41'), ['Round 2', `all ${open.tables} tables in`]);
  assert.deepEqual(statusParts({ round: undefined, tables: 0, open: 0, champion: null }, false, null), [
    'Registration'
  ]);
  assert.deepEqual(statusParts(open, true, null), ['Finished']);
});

test('the cut line says what split the last player in from the first one out', () => {
  const row = (place: number, points: number, owp: number, oowp = 0.5) => ({
    playerId: String(place),
    place,
    record: { wins: 0, losses: 0, ties: 0 },
    points,
    owp,
    oowp,
    dropped: false,
    late: false
  });
  assert.equal(cutSplit([row(1, 9, 0.6), row(2, 6, 0.7)], 1), '1st and 2nd split on points: 9 / 6');
  assert.equal(cutSplit([row(1, 6, 0.6397), row(2, 6, 0.4833)], 1), '1st and 2nd split on OWP: 63.97% / 48.33%');
  assert.equal(cutSplit([row(1, 6, 0.5, 0.61), row(2, 6, 0.5, 0.52)], 1), '1st and 2nd split on OOWP: 61.00% / 52.00%');
  assert.equal(cutSplit([row(1, 6, 0.5)], 8), null, 'no one outside the cut');
  const long = Array.from({ length: 12 }, (_, i) => row(i + 1, 12 - i, 0.5));
  assert.match(cutSplit(long, 11) ?? '', /^11th and 12th/);
});
