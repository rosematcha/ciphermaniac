/**
 * What the tournament pages derive from an event: labels, pending overlays,
 * per-division standings in a combined pod, a player's history, the clock,
 * the deck breakdown, who is waiting for a seat, and the .tdf export.
 */

import { divisionLookup } from '../../shared/tournament/divisions.ts';
import { juniorsCutApart } from '../__utils__/divisionCuts.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { cutPodOf } from '../../shared/tournament/rounds.ts';
import { recommendedStructure } from '../../shared/tournament/structure.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { PlayerReport } from '../../shared/tournament/reports.ts';
import type { EventType, Match, Pod, Round, Tournament } from '../../shared/tournament/types.ts';
import { assignKeys, DEFAULT_SETTINGS, publicTournament } from '../../shared/tournament/view.ts';
import { tdfFilename, tdfText } from '../../src/lib/tournament/exportTdf.ts';
import { ordinal } from '../../src/lib/format.ts';
import {
  champion,
  clockLabel,
  currentMatchOf,
  cutSplit,
  deckBreakdown,
  divisionCuts,
  divisionHeading,
  eventStatus,
  filterMatches,
  matchHistory,
  namesById,
  nextStep,
  outcomeLabel,
  plannedRounds,
  podLabel,
  podProgress,
  podStandings,
  recordsBefore,
  reportState,
  RESULT_WORDS,
  roundCapOf,
  roundLabel,
  roundStatus,
  seatMark,
  shownDecks,
  shownOutcome,
  staffReport,
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

const NO_ROUND = { round: undefined, tables: 0, open: 0, champion: null, label: '', next: '' };

test('labels rounds and results', () => {
  assert.equal(roundLabel(round2, pod), 'Round 2');
  assert.equal(roundLabel({ ...round2, kind: 'elimination', matches: round2.matches.slice(0, 1) }, pod), 'Final');
  assert.equal(roundLabel({ ...round2, kind: 'elimination', matches: round2.matches.slice(0, 2) }, pod), 'Semifinals');
  assert.equal(
    roundLabel(
      {
        ...round2,
        kind: 'elimination',
        matches: [...round2.matches, ...round2.matches, ...round2.matches, ...round2.matches]
      },
      pod
    ),
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
  const everyone = podStandings(CHALLENGE, pod, () => 'masters');
  assert.deepEqual(
    everyone.map(group => [group.division, group.rows.length]),
    [[null, 8]],
    'a combined pod of one division, as at an unsanctioned event, names none'
  );
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
    emptyTournament({ name: 'Seats' }),
    ...[0, 1, 2, 3].map(
      i => ({ type: 'addPlayer', player: { firstName: 'P', lastName: `${i}`, id: `${10 + i}` } }) as Command
    ),
    { type: 'pairRound', pod: 'masters' }
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
  assert.throws(() => tdfText({ tournament: CHALLENGE, pending: [], finished: true }), /Enter all match results/);
  const completed = round2.matches
    .filter(m => m.outcome === 'pending')
    .map(match => ({
      pod: 'mixed' as const,
      round: 2,
      ...match,
      p2: match.p2!,
      outcome: 'p1' as const,
      at: 0
    }));
  assert.match(tdfText({ tournament: CHALLENGE, pending: completed, finished: true }), /<standings>/);
  assert.equal(tdfFilename(CHALLENGE), 'Fixture Challenge Friends.tdf');
  assert.equal(tdfFilename(emptyTournament({ name: '???' })), 'tournament.tdf');
});

test('the organizer’s and the public’s standings break exact ties the same way', () => {
  const t = run(
    emptyTournament({ name: 'Ties' }),
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

test('the public copy names only what the room may see of each player', () => {
  const t = run(
    emptyTournament({ name: 'Private' }),
    { type: 'addPlayer', player: { firstName: 'Ash', lastName: 'Ketchum', id: '4242', birthDate: '01/01/1990' } },
    { type: 'setFixedTable', id: '4242', table: 7 }
  );
  const player = { ...(t.players[0] as Tournament['players'][number]), late: true, fromList: true };
  const keys = assignKeys(t, {});
  const [shown] = publicTournament({ ...t, players: [player] }, keys).players;
  assert.deepEqual(shown, {
    id: keys['4242'],
    firstName: 'Ash',
    lastName: 'Ketchum',
    birthDate: '',
    droppedAfter: null,
    late: true,
    created: '',
    modified: ''
  });
});

test('divisions that played together each take their places from their own cut', () => {
  const t = juniorsCutApart();
  const mixed = t.pods.find(p => p.category === 'mixed') as Pod;
  const juniorCut = cutPodOf(t, mixed, 'junior') as Pod;
  const groups = podStandings(t, mixed, divisionLookup(t));
  assert.deepEqual(
    groups.map(g => [g.division, g.cut, g.cutStarted, g.rows.length]),
    [
      ['junior', 4, true, 4],
      ['masters', 0, false, 4]
    ]
  );
  const final = juniorCut.rounds.at(-1)?.matches[0];
  assert.equal(groups[0]?.rows[0]?.playerId, final?.p1, 'the Juniors’ champion first');
  assert.deepEqual(podStandings(t, juniorCut, divisionLookup(t)), [groups[0]], 'the cut reads as its division');
  assert.equal(podLabel(juniorCut), 'Juniors top cut');
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
  assert.deepEqual(none, { chosen: null, disputed: false, locked: false, final: false, due: false });
  const won = [{ ...mine, by: match.p1, outcome: 'p1' as const }];
  assert.deepEqual(reportState(at, { pending: [], reports: won }, match.p1, 1000), {
    chosen: 'win',
    disputed: false,
    locked: false,
    final: false,
    due: false
  });
  const both = [...won, { ...mine, by: match.p2, outcome: 'p2' as const }];
  const disputed = reportState(at, { pending: [], reports: both }, match.p2, 30_000);
  assert.deepEqual(disputed, { chosen: 'win', disputed: true, locked: true, final: false, due: false });
  const agreed = [...won, { ...mine, by: match.p2, outcome: 'p1' as const }];
  assert.equal(reportState(at, { pending: [], reports: agreed }, match.p2, 29_999).final, false);
  assert.deepEqual(reportState(at, { pending: [], reports: agreed }, match.p2, 30_000), {
    chosen: 'loss',
    disputed: false,
    locked: true,
    final: true,
    due: true
  });
  const oneDevice = agreed.map(report => ({ ...report, device: 'shared' }));
  assert.equal(
    reportState(at, { pending: [], reports: oneDevice }, match.p2, 30_000).final,
    false,
    'reports from one device wait for staff'
  );
  const staff = [{ ...mine, outcome: 'tie' as const }];
  assert.deepEqual(reportState(at, { pending: staff, reports: both }, match.p1, 0), {
    chosen: 'tie',
    disputed: false,
    locked: true,
    final: true,
    due: false
  });
  // A TOM event holds the agreed result as pending until TOM takes it in: it stands, and
  // the page has nothing to ask the server for, however long TOM takes.
  const held = [{ ...mine, outcome: 'p1' as const }];
  assert.equal(reportState(at, { pending: held, reports: agreed }, match.p2, 600_000).due, false);
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
  assert.deepEqual(nextStep(NO_ROUND, false), {
    kind: 'pair',
    label: 'Pair round 1',
    ready: true
  });
  assert.deepEqual(nextStep({ ...open, open: 0, champion: 'x' }, false), { kind: 'close', champion: 'x', ready: true });
  assert.deepEqual(nextStep({ ...open, open: 1, champion: 'x' }, false), {
    kind: 'close',
    champion: 'x',
    ready: false,
    reason: '1 table open'
  });
  assert.deepEqual(nextStep(open, true), { kind: 'none' });
});

test('a cut round leads to the next stage by name, and a finished final crowns its winner', () => {
  const quarter: Round = { ...round2, kind: 'elimination', matches: round2.matches.slice(0, 4) };
  const done = (round: Round) => ({ ...podProgress({ ...pod, rounds: [round] }, []), open: 0 });
  assert.equal((nextStep(done(quarter), false) as { label: string }).label, 'Pair semifinals');
  const semi: Round = { ...round2, kind: 'elimination', matches: round2.matches.slice(0, 2) };
  assert.equal((nextStep(done(semi), false) as { label: string }).label, 'Pair the final');
  const [first] = round2.matches;
  assert.ok(first);
  const final: Round = { ...round2, kind: 'elimination', matches: [{ ...first, outcome: 'p1' }] };
  assert.equal(champion(final, pod), first.p1);
  assert.equal(champion({ ...final, matches: [{ ...first, outcome: 'pending' }] }, pod), null);
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
  assert.deepEqual(statusParts(NO_ROUND, false, null), ['Registration']);
  assert.deepEqual(statusParts(open, true, null), ['Finished']);
});

test('against a plan, the status counts the Swiss rounds, and names a round past the plan alone', () => {
  const open = podProgress(pod, []);
  assert.equal(statusParts(open, false, null, 3)[0], 'Round 2 of 3');
  assert.equal(statusParts(open, false, null, 1)[0], 'Round 2', 'a round past the plan');
  const quarter: Round = { ...round2, kind: 'elimination', matches: round2.matches.slice(0, 4) };
  assert.equal(statusParts(podProgress({ ...pod, rounds: [quarter] }, []), false, null, 3)[0], 'Quarterfinals');
});

test('the console leads with where the round stands: in progress, complete, or before and after the rounds', () => {
  const open = podProgress(pod, []);
  assert.equal(roundStatus(open, false), 'Round 2 in progress');
  assert.equal(roundStatus({ ...open, open: 0 }, false), 'Round 2 complete');
  assert.equal(roundStatus(NO_ROUND, false), 'Registration');
  assert.equal(roundStatus(open, true), 'Finished');
});

test('against a plan, the lead counts the Swiss rounds, and names a round past the plan alone', () => {
  const open = podProgress(pod, []);
  assert.equal(roundStatus(open, false, 3), 'Round 2 of 3 in progress');
  assert.equal(roundStatus(open, false, 1), 'Round 2 in progress', 'a round past the plan');
  const quarter: Round = { ...round2, kind: 'elimination', matches: round2.matches.slice(0, 4) };
  assert.equal(roundStatus(podProgress({ ...pod, rounds: [quarter] }, []), false, 3), 'Quarterfinals in progress');
});

/** A pod of `n` players, for the plan: only its size counts. */
const podOf = (n: number): Pod => ({
  ...pod,
  rounds: [],
  startingPlayerIds: undefined,
  divisionCounts: undefined,
  playerIds: Array.from({ length: n }, (_, i) => String(i + 1))
});

/** `pod` with round 1 paired among its players, then `late` more added with that round missed. */
function lateTo(start: Pod, late: number): Pod {
  const ids = start.playerIds;
  const seated = Array.from({ length: ids.length / 2 }, (_, i) => ({
    table: i + 1,
    p1: ids[i * 2] as string,
    p2: ids[i * 2 + 1] as string,
    outcome: 'pending' as const,
    timestamp: ''
  }));
  const added = Array.from({ length: late }, (_, i) => `late-${i}`);
  const missed = added.map(id => ({ table: 0, p1: id, p2: null, outcome: 'loss' as const, timestamp: '' }));
  const round = {
    ...(CHALLENGE.pods[0]?.rounds[0] as Round),
    number: 1,
    kind: 'swiss' as const,
    matches: [...seated, ...missed]
  };
  return { ...start, playerIds: [...ids, ...added], rounds: [round] };
}

/** A tournament of `n` players, the first `dropped` of them dropped. */
const fieldOf = (n: number, dropped = 0, eventType: EventType = 'cup'): Tournament => ({
  ...CHALLENGE,
  info: { ...CHALLENGE.info, eventType },
  players: Array.from({ length: n }, (_, i) => ({
    ...(CHALLENGE.players[0] as Tournament['players'][number]),
    id: String(i + 1),
    droppedAfter: i < dropped ? 1 : null
  }))
});

test('the rounds are Play! Pokémon’s structure for the attendance, held to the round cap', () => {
  assert.equal(plannedRounds(podOf(16), 0, 'cup'), 5);
  assert.equal(plannedRounds(podOf(16), 3, 'cup'), 3, 'a league that plays three rounds');
  assert.equal(plannedRounds(podOf(6), 5, 'cup'), 3, 'a cap above the structure changes nothing');
  assert.equal(plannedRounds(podOf(40), 0, 'cup'), 6);
  assert.equal(plannedRounds(lateTo(podOf(8), 1), 0, 'cup'), 3, 'a player added after round 1 does not count');
  assert.equal(roundCapOf({ mode: 'tom', settings: { ...DEFAULT_SETTINGS, roundCap: 3 } }), null);
  assert.equal(roundCapOf({ mode: 'swiss', settings: { ...DEFAULT_SETTINGS, roundCap: 3 } }), 3);
});

test('each division cuts by its own attendance, and not past the players still in', () => {
  assert.deepEqual(
    divisionCuts(fieldOf(16), podOf(16), () => 'masters'),
    [{ division: 'masters', active: 16, cut: 4, started: false }]
  );
  assert.deepEqual(
    divisionCuts(fieldOf(24, 17), podOf(24), () => 'masters'),
    [{ division: 'masters', active: 7, cut: 0, started: false }],
    'drops left too few for a top 8'
  );
  // 20 Masters and 5 Juniors played together: a top 4 of Masters, no cut for Juniors.
  const juniors = new Set(['21', '22', '23', '24', '25']);
  assert.deepEqual(
    divisionCuts(fieldOf(25), podOf(25), id => (juniors.has(id) ? 'junior' : 'masters')),
    [
      { division: 'junior', active: 5, cut: 0, started: false },
      { division: 'masters', active: 20, cut: 4, started: false }
    ]
  );
  assert.deepEqual(
    divisionCuts(fieldOf(21), lateTo(podOf(20), 1), () => 'masters'),
    [{ division: 'masters', active: 21, cut: 4, started: false }],
    'a player added after round 1 does not move the cut'
  );
  assert.deepEqual(
    divisionCuts(fieldOf(16, 0, 'challenge'), podOf(16), () => 'masters'),
    [{ division: 'masters', active: 16, cut: 0, started: false }],
    'a League Challenge has no top cut'
  );
});

test('a League Challenge plays its own table of Swiss rounds', () => {
  assert.deepEqual(recommendedStructure(16, 'challenge'), { rounds: 4, cut: 0 });
  assert.deepEqual(recommendedStructure(17, 'challenge'), { rounds: 5, cut: 0 });
  assert.deepEqual(recommendedStructure(256, 'challenge'), { rounds: 8, cut: 0 });
  assert.deepEqual(recommendedStructure(600, 'challenge'), { rounds: 10, cut: 0 });
  assert.equal(plannedRounds(podOf(16), 0, 'challenge'), 4);
  assert.equal(plannedRounds(podOf(16), 0, 'cup'), 5);
});

test('once the plan’s rounds are played, the next step is a decision, which waits on open tables', () => {
  const open = podProgress(pod, []);
  const early = nextStep({ ...open, open: 0 }, false, { rounds: 3, cut: 4 });
  assert.deepEqual(early, { kind: 'pair', label: 'Pair round 3', ready: true }, 'round 2 of 3');
  assert.deepEqual(nextStep({ ...open, open: 0 }, false, { rounds: 2, cut: 4 }), {
    kind: 'decide',
    label: 'Pair round 3',
    cut: 4,
    ready: true
  });
  assert.deepEqual(nextStep({ ...open, open: 2 }, false, { rounds: 2, cut: 0 }), {
    kind: 'decide',
    label: 'Pair round 3',
    cut: 0,
    ready: false,
    reason: '2 tables open'
  });
  const semi: Round = { ...round2, kind: 'elimination', matches: round2.matches.slice(0, 2) };
  assert.equal(
    nextStep({ ...open, round: semi, open: 0 }, false, { rounds: 1, cut: 4 }).kind,
    'pair',
    'a cut pairs on'
  );
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

test('the public status names registration, the round in play, or how the event finished', () => {
  const registering = { ...CHALLENGE, pods: CHALLENGE.pods.map(p => ({ ...p, rounds: [] })) };
  const players = registering.players.filter(p => p.droppedAfter === null).length;
  assert.deepEqual(eventStatus(registering, { pending: [], finished: false, firstRound: '11:00 AM', roundCap: 0 }, 0), [
    'Registration',
    `${players} players`,
    'Round 1 at 11:00 AM'
  ]);
  assert.deepEqual(eventStatus(registering, { pending: [], finished: false, firstRound: null, roundCap: 0 }, 0), [
    'Registration',
    `${players} players`
  ]);
  // TOM decides a TOM event's rounds, so its round is named alone.
  const live = eventStatus(CHALLENGE, { pending: [], finished: false, firstRound: null, roundCap: null }, 0);
  assert.equal(live[0], roundLabel(pod.rounds.at(-1) as Round, pod));
  const swiss = pod.rounds.filter(r => r.kind === 'swiss').length;
  const final: Round = { ...(pod.rounds.at(-1) as Round), number: pod.rounds.length + 1, kind: 'elimination' };
  const cut = { ...CHALLENGE, pods: [{ ...pod, cut: 8, rounds: [...pod.rounds, final] }] };
  const finished = { pending: [], finished: true, firstRound: null, roundCap: 0 };
  assert.deepEqual(eventStatus(cut, finished, 0), ['Finished', `${swiss} round${swiss === 1 ? '' : 's'}`, 'Top 8']);
  // The cut is chosen when play starts; an event that ended without playing it has no top cut to name.
  const chosen = { ...CHALLENGE, pods: [{ ...pod, cut: 8 }] };
  assert.deepEqual(eventStatus(chosen, finished, 0), ['Finished', `${swiss} round${swiss === 1 ? '' : 's'}`]);
});

test('places read as ordinals and results as the pairings show them', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), [
    '1st',
    '2nd',
    '3rd',
    '4th',
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '101st',
    '111th'
  ]);
  assert.equal(RESULT_WORDS.p1, '1–0');
  assert.equal(RESULT_WORDS['double-loss'], 'Double loss');
  assert.equal(RESULT_WORDS.pending, undefined);
});

describe("what staff see of an open match's reports", () => {
  const match: Match = { table: 4, p1: 'ash', p2: 'misty', outcome: 'pending', timestamp: '' };
  const names = new Map([
    ['ash', 'Ash Ketchum'],
    ['misty', 'Misty Waterflower']
  ]);
  const report = (by: string, outcome: PlayerReport['outcome'], device?: string): PlayerReport => ({
    pod: 'masters',
    round: 3,
    table: 4,
    p1: 'ash',
    p2: 'misty',
    by,
    outcome,
    at: 0,
    ...(device ? { device } : {})
  });

  test('an outcome reads as staff confirm it', () => {
    assert.equal(outcomeLabel('p2', match, names), 'Misty Waterflower wins');
    assert.equal(outcomeLabel('tie', match, names), 'Tie');
    assert.equal(outcomeLabel('pending', match, names), 'Clear the result');
  });

  test('no reports leave the cell at Open', () => {
    assert.equal(staffReport([], match, names), null);
  });

  test('one report reads Reported, and tags its sender with their win or loss', () => {
    const won = staffReport([report('misty', 'p2')], match, names);
    assert.equal(won?.label, 'Reported');
    assert.equal(won?.problem, false);
    assert.equal(won?.detail, 'Reported: Misty Waterflower wins');
    assert.deepEqual(won?.tags.get('misty'), { text: 'Won', title: 'Reported: won', problem: false });
    assert.equal(won?.tags.has('ash'), false);
    assert.equal(staffReport([report('ash', 'p2')], match, names)?.tags.get('ash')?.text, 'Lost');
    assert.equal(staffReport([report('ash', 'tie')], match, names)?.tags.get('ash')?.text, 'Tie');
  });

  test('reports that differ read Disputed, with both senders tagged as a problem', () => {
    const disputed = staffReport([report('ash', 'p1'), report('misty', 'p2')], match, names);
    assert.equal(disputed?.label, 'Disputed');
    assert.equal(
      disputed?.detail,
      'Reports differ. Ash Ketchum: Ash Ketchum wins; Misty Waterflower: Misty Waterflower wins'
    );
    assert.deepEqual(
      [...(disputed?.tags.values() ?? [])].map(tag => [tag.text, tag.problem]),
      [
        ['Won', true],
        ['Won', true]
      ]
    );
  });

  test('two agreeing reports from one device read One device, not Reported', () => {
    const shared = staffReport([report('ash', 'p1', 'd1'), report('misty', 'p1', 'd1')], match, names);
    assert.equal(shared?.label, 'One device');
    assert.equal(shared?.problem, true);
    assert.equal(shared?.detail, 'Both reports came from one device. Reported: Ash Ketchum wins');
    assert.equal(shared?.tags.get('misty')?.text, 'Lost');
  });
});

test('combined cut labels and completion use each division bracket instead of total matches', () => {
  const tournament = juniorsCutApart();
  const pod = tournament.pods[0]!;
  const final = pod.rounds.at(-1)!;
  const semifinals = pod.rounds.at(-2)!;
  assert.equal(roundLabel(semifinals, pod), 'Semifinals');
  assert.equal(roundLabel(final, pod), 'Final');
  assert.equal(champion(final, pod), final.matches[0]!.p1);
  const unfinished = { ...pod, rounds: pod.rounds.slice(0, -1) };
  assert.equal(champion(semifinals, unfinished), null);
  const waiting = {
    ...pod,
    divisionCuts: {
      ...pod.divisionCuts,
      masters: {
        size: 4,
        playoff3rd4th: false,
        playerIds: pod.playerIds.filter(id => !pod.divisionCuts!.junior!.playerIds!.includes(id))
      }
    }
  };
  assert.equal(champion(final, waiting), null);
});
