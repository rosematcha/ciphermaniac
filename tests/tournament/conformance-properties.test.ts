import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand } from '../../shared/tournament/commands.ts';
import { addToFlight, dealFlights, validFlightCount } from '../../shared/tournament/flights.ts';
import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import {
  type Entrant,
  PairingError,
  type PairingHistory,
  pairSwiss,
  pairTopCut,
  rankForPairing,
  sortSwissPairings
} from '../../shared/tournament/pairing.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import {
  activeIds,
  latestRound,
  pairingHistory,
  pointsBefore,
  regularRounds,
  seatPairings
} from '../../shared/tournament/rounds.ts';
import { eliminationResult, swissStandings } from '../../shared/tournament/standings.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

const emptyHistory = (): PairingHistory => ({ opponents: new Map(), byes: new Set() });

function assertSwiss(t: Tournament, prior: Tournament): void {
  for (const pod of t.pods) {
    const old = prior.pods.find(p => p.category === pod.category)!;
    const round = latestRound(pod)!;
    const history = pairingHistory(old, round.number);
    const seats = round.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]));
    assert.equal(new Set(seats).size, seats.length);
    assert.deepEqual([...seats].sort(), activeIds(t, pod).sort());
    assert.equal(
      new Set(round.matches.filter(m => m.p2 !== null).map(m => m.table)).size,
      round.matches.filter(m => m.p2 !== null).length
    );
    for (const flight of pod.flights!) {
      assertFlight(pod, flight.playerIds, history);
    }
    assert.equal(
      round.matches.filter(m => m.p2 === null).every(m => m.table === 0),
      true
    );
  }
}

function assertFlight(pod: Pod, ids: string[], history: PairingHistory): void {
  const round = latestRound(pod)!;
  const matches = round.matches.filter(m => ids.includes(m.p1));
  const points = pointsBefore(pod, round.number);
  for (const match of matches.filter(m => m.p2 !== null)) {
    assert.ok(ids.includes(match.p2!));
    assert.ok(!history.opponents.get(match.p1)?.has(match.p2!));
  }
  const ordinary = matches.filter(m => !['assigned-bye', 'loss'].includes(m.outcome));
  const eligible = ids.filter(id => ordinary.some(m => m.p1 === id || m.p2 === id));
  const byes = ordinary.filter(m => m.p2 === null);
  assert.equal(byes.length, eligible.length % 2);
  for (const bye of byes) {
    assert.ok(!history.byes.has(bye.p1));
    const lowest = Math.min(...eligible.filter(id => !history.byes.has(id)).map(id => points.get(id) ?? 0));
    assert.equal(points.get(bye.p1) ?? 0, lowest);
  }
}

test('rules 1–6, 12–16, 20–22: generated Swiss events retain flights, eligibility, byes and tables', () => {
  for (let seed = 1; seed <= 160; seed += 1) {
    const ctx = context(seed);
    let t = generatedEvent(24 + (seed % 33), ctx, { byes: seed % 3 });
    for (let number = 1; number <= 5; number += 1) {
      const prior = t;
      t = operated(t, { type: number === 1 ? 'start' : 'pair' }, ctx);
      assertSwiss(t, prior);
      t = completed(t, ctx);
    }
    assert.deepEqual(readTournament(t), t, `Persisted lifecycle seed ${seed}`);
  }
});

test('rules 2–4, 34: generated multi-flight events deal balanced independent fields and retain joins', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const ctx = context(seed);
    const ids = Array.from({ length: 64 + (seed % 5) }, (_, i) => String(i));
    const flights = dealFlights(ids, 2, ctx.random);
    assert.equal(new Set(flights.flatMap(f => f.playerIds)).size, ids.length);
    assert.ok(Math.abs(flights[0]!.playerIds.length - flights[1]!.playerIds.length) <= 2);
    const pod = generatedEvent(ids.length, ctx, { flights: 2 }).pods[0]!;
    const joined = addToFlight({ ...pod, flights }, 'new', ctx.random);
    const odd = flights.find(f => f.playerIds.length % 2 === 1);
    if (odd) {
      assert.ok(joined.flights!.find(f => f.number === odd.number)!.playerIds.includes('new'));
    }
    assert.equal(joined.flights!.flatMap(f => f.playerIds).length, ids.length + 1);
    const t = generatedEvent(ids.length, ctx, { flights: 2 });
    assertSwiss(operated(t, { type: 'start' }, ctx), t);
    assert.equal(validFlightCount(ids.length, 2), true);
    assert.equal(validFlightCount(ids.length, 3), false);
    assert.equal(validFlightCount(63, 2), false);
    assert.equal(validFlightCount(512, 16), true);
    const failed = applyLifecycleOperation(t, { type: 'setFlights', count: 3 }, ctx);
    assert.equal(failed.ok, false);
    assert.equal(failed.tournament, t);
  }
});

test('rules 7–11, 13: priorities and permitted differences expand only when tighter matching cannot seat the field', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const random = seededRandom(seed);
    const entrants: Entrant[] = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      points: Math.floor(random() * 5),
      category: Math.floor(random() * 3)
    }));
    const rank = rankForPairing(entrants, random);
    for (let i = 1; i < rank.length; i += 1) {
      const a = entrants.find(e => e.id === rank[i - 1])!;
      const b = entrants.find(e => e.id === rank[i])!;
      assert.ok(a.points > b.points || (a.points === b.points && a.category! >= b.category!));
    }
    const seats = pairSwiss(entrants, emptyHistory(), random);
    const constraints = minimumConstraints(entrants);
    for (const seat of seats) {
      const a = entrants.find(e => e.id === seat.p1)!;
      const b = entrants.find(e => e.id === seat.p2)!;
      assert.ok(Math.abs(a.points - b.points) <= constraints.points);
      assert.ok(Math.abs(a.category! - b.category!) <= constraints.division);
    }
  }
});

function feasible(entrants: Entrant[], points: number, division: number): boolean {
  if (!entrants.length) {
    return true;
  }
  const [first, ...rest] = entrants;
  return rest.some(
    (other, index) =>
      Math.abs(first!.points - other.points) <= points &&
      Math.abs(first!.category! - other.category!) <= division &&
      feasible(
        rest.filter((_, i) => i !== index),
        points,
        division
      )
  );
}
function minimumConstraints(entrants: Entrant[]): { points: number; division: number } {
  for (let points = 0; points <= 4; points += 1) {
    for (let division = 0; division <= Math.min(points, 2); division += 1) {
      if (feasible(entrants, points, division)) {
        return { points, division };
      }
    }
  }
  throw new Error('Reference matching failed');
}

test('rules 15–17, 31, 33: mixed first-round byes follow odd division eligibility and exhausted byes refuse', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const random = seededRandom(seed);
    const counts = [2 + (seed % 5), 2 + (seed % 7), 2 + (seed % 9)];
    if (counts.reduce((a, b) => a + b) % 2 === 0) {
      counts[2]! += 1;
    }
    const entrants = counts.flatMap((count, category) =>
      Array.from({ length: count }, (_, i) => ({ id: `${category}:${i}`, category, points: 0 }))
    );
    const seats = pairSwiss(entrants, emptyHistory(), random, { round: 1 });
    const bye = seats.find(s => s.p2 === null)!;
    const odd = [2, 1, 0].filter(d => counts[d]! % 2 === 1);
    if (odd.length !== 3 && counts[odd[0]!]! >= 3) {
      assert.equal(entrants.find(e => e.id === bye.p1)!.category, odd[0]);
    }
    const allByes = { ...emptyHistory(), byes: new Set(entrants.map(e => e.id)) };
    assert.throws(() => pairSwiss(entrants, allByes, random), /No eligible player/);
    assert.throws(
      () => pairSwiss([{ id: 'sole', points: 0 }], { ...emptyHistory(), byes: new Set(['sole']) }, random),
      PairingError
    );
  }
});

test('rules 20–21: own ordering is stable for settled equal compositions, and tables avoid blocked and static seats', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const random = seededRandom(seed);
    const entrants = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      points: Math.floor(random() * 9),
      category: 2
    }));
    const seats = sortSwissPairings(pairSwiss(entrants, emptyHistory(), random), entrants);
    const totals = seats.map(
      s => entrants.find(e => e.id === s.p1)!.points + entrants.find(e => e.id === s.p2)!.points
    );
    assert.deepEqual(
      totals,
      [...totals].sort((a, b) => b - a)
    );
    const matches = seatPairings(seats, {
      firstTable: 1,
      timestamp: '',
      blocked: [{ start: 2, end: 3 }],
      fixed: new Map([[seats[0]!.p1, 8]]),
      ceiling: 15,
      overflow: 30
    });
    assert.equal(matches[0]!.table, 8);
    assert.equal(new Set(matches.map(m => m.table)).size, matches.length);
    assert.ok(matches.every(m => ![2, 3].includes(m.table)));
    const ordinary = matches.slice(1).map(m => m.table);
    assert.deepEqual(
      ordinary,
      [...ordinary].sort((a, b) => a - b)
    );
  }
});

test('rule 14: repairs preserve an already paired field and recorded survivors retain seats and tables', () => {
  const ctx = context(91);
  const paired = operated(generatedEvent(12, ctx), { type: 'start' }, ctx);
  const unchanged = operated(paired, { type: 'pair', repair: true }, ctx);
  assert.deepEqual(unchanged, paired);
  const late = operated(
    paired,
    {
      type: 'late',
      player: { id: 'late', firstName: 'Generated', lastName: 'Late', birthDate: '02/27/1995' },
      markLate: false,
      forcedLoss: false,
      timestamp: ctx.localTime
    },
    ctx
  );
  const retainedTables = [1, 2, 4, 5, 6];
  const repaired = operated(late, { type: 'pair', repair: true }, { ...ctx, recorded: { retainedTables } });
  const before = latestRound(paired.pods[0]!)!.matches;
  const after = latestRound(repaired.pods[0]!)!.matches;
  for (const table of retainedTables) {
    assert.deepEqual(
      after.find(m => m.table === table),
      before.find(m => m.table === table)
    );
  }
  assert.equal(after.filter(m => m.outcome === 'bye').length, 1);
  assert.equal(after.filter(m => m.p2 !== null && !retainedTables.includes(m.table)).length, 1);
  assert.ok(after.some(m => m.table === 3));
  assertRefusal(late, { type: 'pair', repair: true }, { ...ctx, recorded: { retainedTables: [99] } });
});

test('rule 20: first-seat division precedes combined points after equal division sums', () => {
  const entrants = [
    { id: 'master', category: 2, points: 0 },
    { id: 'junior', category: 0, points: 0 },
    { id: 'senior1', category: 1, points: 3 },
    { id: 'senior2', category: 1, points: 1 },
    { id: 'senior3', category: 1, points: 1 },
    { id: 'junior2', category: 0, points: 1 },
    { id: 'junior3', category: 0, points: 4 },
    { id: 'senior4', category: 1, points: 3 }
  ];
  const expected = [
    { p1: 'master', p2: 'junior' },
    { p1: 'senior1', p2: 'senior2' },
    { p1: 'senior3', p2: 'junior2' },
    { p1: 'junior3', p2: 'senior4' }
  ];
  assert.deepEqual(sortSwissPairings([...expected].reverse(), entrants), expected);
});

test('rule 21: manual tables continue beyond allotment and overflow, skipping overlapping ranges', () => {
  const seats = Array.from({ length: 6 }, (_, i) => ({ p1: String(i * 2), p2: String(i * 2 + 1) }));
  const matches = seatPairings(seats, {
    firstTable: 1,
    timestamp: '',
    blocked: [
      { start: 2, end: 4 },
      { start: 3, end: 12 }
    ],
    fixed: new Map([
      [seats[0]!.p1, 5],
      [seats[1]!.p1, 14]
    ]),
    overflow: 16
  });
  assert.deepEqual(
    matches.map(m => m.table),
    [5, 14, 1, 13, 15, 16]
  );
  const automatic = seatPairings(seats, { firstTable: 1, timestamp: '', ceiling: 3, overflow: 16 });
  assert.deepEqual(
    automatic.map(m => m.table),
    [1, 2, 3, 16, 17, 18]
  );
});
test(
  'rules 30, 44–45 and day-two portions of 2/12',
  { skip: 'Championship and two-day events are explicitly outside the requested scope' },
  () => {}
);

function assertRefusal(
  t: Tournament,
  op: Parameters<typeof applyLifecycleOperation>[1],
  ctx: ReturnType<typeof context>
): void {
  const before = writeTdf(t, { now: ctx.now });
  const result = applyLifecycleOperation(t, op, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(writeTdf(result.tournament, { now: ctx.now }), before);
}

test('rules 12, 31–33, 35–36, 41–43: unavailable fields refuse atomically without partial rounds', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const ctx = context(seed);
    const empty = generatedEvent(0, ctx);
    assert.equal(operated(empty, { type: 'start' }, ctx).pods.length, 0);
    const sole = generatedEvent(1, ctx);
    const started = operated(sole, { type: 'start' }, ctx);
    assert.equal(started.pods[0]!.rounds[0]!.matches[0]!.outcome, 'bye');
    assertRefusal(started, { type: 'pair' }, ctx);
    let two = operated(generatedEvent(2, ctx), { type: 'start' }, ctx);
    two = completed(two, ctx);
    assertRefusal(two, { type: 'pair' }, ctx);
    const assigned = generatedEvent(1, ctx, { byes: 1 });
    const blocked = applyLifecycleOperation(assigned, { type: 'start' }, ctx);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.tournament.settings!.stage, 4);
    assert.equal(blocked.tournament.pods[0]!.rounds.length, 0);
    for (const count of [0, 1]) {
      const elimination = operated(generatedEvent(count, ctx, { type: 1 }), { type: 'start' }, ctx);
      assert.equal(elimination.pods.flatMap(p => p.rounds).length, 0);
    }
    let flights = operated(generatedEvent(64, ctx, { flights: 2 }), { type: 'start' }, ctx);
    flights = completed(flights, ctx);
    const emptied = new Set(flights.pods[0]!.flights![1]!.playerIds);
    flights = { ...flights, players: flights.players.map(p => (emptied.has(p.id) ? { ...p, droppedAfter: 1 } : p)) };
    assertRefusal(flights, { type: 'pair' }, ctx);
    const done = throughSwiss(generatedEvent(12, ctx, { additionalRounds: 0 }), ctx);
    assertRefusal(done, { type: 'pair' }, ctx);
  }
});

test('rules 14, 18–19, 43: returning and late entrants preserve flights and assigned byes', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const ctx = context(seed);
    let t = operated(generatedEvent(24, ctx, { byes: 2 }), { type: 'start' }, ctx);
    const pod = t.pods[0]!;
    const assigned = pod.rounds[0]!.matches.find(m => m.outcome === 'assigned-bye')!;
    const target = pod.rounds[0]!.matches.find(m => m.p2 !== null)!.p1;
    t = operated(t, { type: 'drop', id: target, disqualified: false, timestamp: ctx.localTime }, ctx);
    t = operated(t, { type: 'reenter', id: target }, ctx);
    t = operated(t, { type: 'pair', repair: true }, ctx);
    assert.deepEqual(
      t.pods[0]!.rounds[0]!.matches.find(m => m.p1 === assigned.p1),
      assigned
    );
    assert.equal(new Set(t.pods[0]!.rounds[0]!.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]))).size, 24);
    t = completed(t, ctx);
    t = operated(t, { type: 'drop', id: target, disqualified: false, timestamp: ctx.localTime }, ctx);
    t = operated(t, { type: 'pair' }, ctx);
    t = operated(t, { type: 'startRound' }, ctx);
    t = operated(t, { type: 'reenter', id: target }, ctx);
    assert.equal(latestRound(t.pods[0]!)!.matches.find(m => m.p1 === target)!.outcome, 'bye');
    assertRefusal(t, { type: 'pair', repair: true }, ctx);
    const before = t;
    t = operated(
      t,
      {
        type: 'late',
        player: { id: 'late', firstName: 'Generated', lastName: 'Late', birthDate: '02/27/1995' },
        markLate: true,
        forcedLoss: true,
        timestamp: ctx.localTime
      },
      ctx
    );
    assert.equal(t.players.at(-1)!.tiebreaker, 0);
    assert.ok(t.pods[0]!.rounds.every(r => r.matches.at(-1)!.outcome === 'loss'));
    assert.deepEqual(t.pods[0]!.rounds[0]!.matches.slice(0, -1), before.pods[0]!.rounds[0]!.matches);
  }
});

function throughSwiss(t: Tournament, ctx: ReturnType<typeof context>): Tournament {
  let next = operated(t, { type: 'start' }, ctx);
  const rounds = regularRounds(next, next.pods[0]!);
  for (let number = 1; number <= rounds; number += 1) {
    next = completed(next, ctx);
    next = operated(next, { type: 'viewRecords' }, ctx);
    if (number < rounds) {
      next = operated(next, { type: 'pair' }, ctx);
    }
  }
  return next;
}

test('rules 23–27, 29: generated cuts select flight standings, complementary seeds and adjacent winners', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const ctx = context(seed);
    const swiss = throughSwiss(generatedEvent(64, ctx, { type: 3, cut: 4, flights: 2, additionalRounds: 0 }), ctx);
    const pod = swiss.pods[0]!;
    const rows = pod.flights!.map(f => swissStandings(pod, swiss.players, { only: new Set(f.playerIds) }).slice(0, 2));
    const seeds = [rows[0]![0]!.playerId, rows[1]![0]!.playerId, rows[0]![1]!.playerId, rows[1]![1]!.playerId];
    let t = operated(swiss, { type: 'topCut' }, ctx);
    assert.deepEqual(t.pods[0]!.divisionCuts!.masters!.playerIds, seeds);
    assert.deepEqual(
      latestRound(t.pods[0]!)!.matches.map(m => [m.p1, m.p2]),
      [
        [seeds[0], seeds[3]],
        [seeds[2], seeds[1]]
      ]
    );
    t = completed(t, ctx);
    const winners = latestRound(t.pods[0]!)!.matches.map(m => eliminationResult(m)!.winner);
    t = operated(t, { type: 'pair' }, ctx);
    assert.deepEqual(
      latestRound(t.pods[0]!)!.matches.map(m => [m.p1, m.p2]),
      [[winners[0], winners[1]]]
    );
    assert.equal(t.pods[0]!.stage, 1);
    assert.equal(latestRound(t.pods[0]!)!.number, pod.rounds.length + 2);
    const only = operated(generatedEvent(7, ctx, { type: 1 }), { type: 'start' }, ctx);
    assert.equal(only.pods.length, 1);
    assert.equal(only.pods[0]!.category, 'mixed');
    assert.equal(
      new Set(latestRound(only.pods[0]!)!.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]))).size,
      7
    );
  }
});

test('rules 24, 28, 37–40: division cuts retain their pod and incomplete playoffs refuse unchanged', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const ctx = context(seed);
    const swiss = throughSwiss(
      generatedEvent(12, ctx, { type: 3, cut: 4, thirdPlace: true, additionalRounds: 0 }),
      ctx
    );
    for (const remaining of [0, 1, 2, 3]) {
      assertIncompleteCut(swiss, remaining, ctx);
    }
    let t = operated(swiss, { type: 'topCut' }, ctx);
    const match = latestRound(t.pods[0]!)!.matches[0]!;
    t = operated(t, { type: 'drop', id: match.p1, disqualified: false, timestamp: ctx.localTime }, ctx);
    assert.equal(latestRound(t.pods[0]!)!.matches[0]!.outcome, 'p2');
    assertRefusal(t, { type: 'drop', id: match.p2!, disqualified: false, timestamp: ctx.localTime }, ctx);
    t = operated(t, { type: 'startRound' }, ctx);
    const other = latestRound(t.pods[0]!)!.matches[1]!;
    t = operated(t, { type: 'results', results: [{ ...other, outcome: 'p1' }] }, ctx);
    t = operated(t, { type: 'pair' }, ctx);
    assert.equal(latestRound(t.pods[0]!)!.matches.length, 1);
  }
});

function assertIncompleteCut(swiss: Tournament, remaining: number, ctx: ReturnType<typeof context>): void {
  const active = new Set(swiss.players.slice(0, remaining).map(p => p.id));
  const reduced = {
    ...swiss,
    players: swiss.players.map(p => (active.has(p.id) ? p : { ...p, droppedAfter: swiss.pods[0]!.rounds.length }))
  };
  const result = applyLifecycleOperation(reduced, { type: 'topCut' }, ctx);
  assert.equal(result.tournament.pods[0]!.stage, 1);
  if (remaining < 2) {
    assert.equal(result.ok, false);
    assert.deepEqual(result.tournament.pods[0]!.rounds, swiss.pods[0]!.rounds);
    assert.ok(result.tournament.players.every(p => p.seed === undefined));
    return;
  }
  assert.equal(result.ok, true);
  const played = completed(result.tournament, ctx);
  assertRefusal(played, { type: 'pair' }, ctx);
}

test('workflow and production commands retain stages, clocks and persistence', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const ctx = context(seed);
    let t = operated(generatedEvent(12, ctx), { type: 'start' }, ctx);
    t = operated(t, { type: 'viewPairings' }, ctx);
    assert.deepEqual(operated(t, { type: 'viewPairings' }, ctx), t);
    const command = applyCommand(t, { type: 'startClock', pod: t.pods[0]!.category }, ctx);
    assert.equal(command.ok, true);
    t = command.tournament;
    assert.deepEqual(
      operated(t, { type: 'startRound' }, { ...ctx, now: ctx.now + 60000, localTime: '10/01/2026 12:01:00' }),
      t
    );
    assert.deepEqual(readTournament(t), t);
    assertRefusal(t, { type: 'finish' }, ctx);
    t = completed(t, ctx);
    assertRefusal(t, { type: 'finish' }, ctx);
  }
});

function feasibleHistory(ids: string[], history: PairingHistory): boolean {
  if (!ids.length) {
    return true;
  }
  const [first, ...rest] = ids;
  return rest.some(
    (other, index) =>
      !history.opponents.get(first!)?.has(other) &&
      feasibleHistory(
        rest.filter((_, i) => i !== index),
        history
      )
  );
}

test('rules 8–13: generated opponent histories require backtracking or expansion and never permit rematches', () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const random = seededRandom(seed);
    const entrants = Array.from({ length: 8 }, (_, i) => ({ id: String(i), points: i < 4 ? 3 : 0, category: 2 }));
    const opponents = new Map(entrants.map(e => [e.id, new Set<string>()]));
    for (let a = 0; a < entrants.length; a += 1) {
      for (let b = a + 1; b < entrants.length; b += 1) {
        if (a >= 4 || random() < 0.15) {
          opponents.get(String(a))!.add(String(b));
          opponents.get(String(b))!.add(String(a));
        }
      }
    }
    const history = { opponents, byes: new Set<string>() };
    if (
      !feasibleHistory(
        entrants.map(e => e.id),
        history
      )
    ) {
      assert.throws(() => pairSwiss(entrants, history, random), PairingError);
      continue;
    }
    const seats = pairSwiss(entrants, history, random);
    assert.equal(new Set(seats.flatMap(s => [s.p1, s.p2])).size, 8);
    assert.ok(seats.every(s => !opponents.get(s.p1)!.has(s.p2!)));
    assert.ok(
      seats.every(s => Number(s.p1) < 4 !== Number(s.p2) < 4),
      'the exhausted lower bracket needs cross-bracket matches'
    );
  }
});

test('rules 19, 27–28 and late cutoff: missed rounds, exact playoff losers and overwritten elimination wins', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const ctx = context(seed);
    let t = throughSwiss(generatedEvent(12, ctx, { type: 3, cut: 4, thirdPlace: true, additionalRounds: 0 }), ctx);
    assertRefusal(
      t,
      {
        type: 'late',
        player: { id: 'late', firstName: 'Generated', lastName: 'Late', birthDate: '02/27/1995' },
        markLate: false,
        forcedLoss: false,
        timestamp: ctx.localTime
      },
      ctx
    );
    t = operated(t, { type: 'topCut' }, ctx);
    const first = latestRound(t.pods[0]!)!.matches[0]!;
    t = operated(t, { type: 'results', results: [{ ...first, outcome: 'p1' }] }, ctx);
    t = operated(t, { type: 'drop', id: first.p1, disqualified: false, timestamp: ctx.localTime }, ctx);
    assert.equal(latestRound(t.pods[0]!)!.matches[0]!.outcome, 'p2');
    const second = latestRound(t.pods[0]!)!.matches[1]!;
    t = operated(t, { type: 'results', results: [{ ...second, outcome: 'p1' }] }, ctx);
    t = operated(t, { type: 'pair' }, ctx);
    assert.equal(latestRound(t.pods[0]!)!.matches.length, 1);
  }
});

test('imports preserve unknown attributes and fields when production commands activate lifecycle state', () => {
  const ctx = context(1);
  const original = writeTdf(operated(generatedEvent(12, ctx), { type: 'start' }, ctx));
  const extended = original
    .replace('<tournament ', '<tournament custom="retained" ')
    .replace('</data>', '<custom>retained</custom>\n</data>')
    .replace('</poddata>', '<custompod>retained</custompod>\n</poddata>');
  const imported = parseTdf(extended);
  const result = applyCommand(imported, { type: 'startClock', pod: imported.pods[0]!.category }, ctx);
  assert.ok(result.ok);
  const output = writeTdf(result.tournament);
  for (const literal of ['custom="retained"', '<custom>retained</custom>', '<custompod>retained</custompod>']) {
    assert.ok(output.includes(literal));
  }
});

test('production adapters resume clocks and reconcile fixed seating and event settings', () => {
  const ctx = context(1);
  const configured = generatedEvent(12, ctx);
  const started = operated(configured, { type: 'start' }, ctx);
  const execute = (t: Tournament, command: Parameters<typeof applyCommand>[1], now = ctx.now) => {
    const result = applyCommand(t, command, { ...ctx, now });
    assert.ok(result.ok);
    return result.tournament;
  };
  let t = execute(started, { type: 'startClock', pod: started.pods[0]!.category });
  const initialStart = latestRound(t.pods[0]!)!.startTime;
  t = execute(t, { type: 'stopClock', pod: t.pods[0]!.category }, ctx.now + 60000);
  t = execute(t, { type: 'startClock', pod: t.pods[0]!.category }, ctx.now + 120000);
  assert.equal(latestRound(t.pods[0]!)!.startTime, initialStart);
  assert.equal(latestRound(t.pods[0]!)!.clockStartedAt, ctx.now + 120000);
  const fixed = execute(configured, { type: 'setFixedTable', id: configured.players[0]!.id, table: 100 });
  assert.equal(fixed.settings!.autoTables, false);
  const cup = execute(configured, { type: 'updateInfo', info: { eventType: 'cup' } });
  assert.equal(cup.settings!.type, 3);
  const converted = execute(generatedEvent(12, ctx, { type: 1 }), { type: 'updateInfo', info: { eventType: 'cup' } });
  assert.equal(converted.settings!.type, 3);
  assert.equal(converted.pods[0]!.category, 'masters');
  assert.match(writeTdf(cup), /<tournament type="3"/);
  const pending = started;
  for (const type of ['playAnotherRound', 'register'] as const) {
    assertRefusal(pending, type === 'register' ? { type, players: [] } : { type }, ctx);
  }
});
