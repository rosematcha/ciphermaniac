import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlayerProfile, PlayerRound } from '../../shared/playerTypes.ts';
import {
  careerRoundAggregates,
  careerSummary,
  finishLabel,
  groupRoundsByPhase,
  shortTournamentName
} from '../../src/pages/playerProfile/model.ts';

function round(over: Partial<PlayerRound>): PlayerRound {
  return {
    round: 1,
    phase: 1,
    outcome: 'win',
    opponentId: null,
    opponentName: 'Someone',
    opponentCountry: null,
    opponentArchetype: 'Dragapult',
    opponentPlacement: null,
    ...over
  };
}

const A = '2026-05-29, Regional Championship Indianapolis';
const B = '2026-06-12, International Championship New Orleans';

function rounds(): NonNullable<PlayerProfile['rounds']> {
  return {
    [A]: [
      round({ round: 1, opponentId: '8956', opponentName: 'Tim Franklin', opponentCountry: 'AU', outcome: 'loss' }),
      round({ round: 2, opponentArchetype: 'Gardevoir', outcome: 'tie' }),
      round({ round: 3, opponentArchetype: 'Gardevoir', outcome: 'win' }),
      round({ round: 4, phase: 2, opponentArchetype: 'Gardevoir', outcome: 'win' }),
      round({ round: 5, phase: 3, opponentId: '8956', opponentName: 'Tim Franklin', outcome: 'win' })
    ],
    [B]: [
      round({ round: 1, opponentName: null, opponentArchetype: null, outcome: 'bye' }),
      round({ round: 2, opponentId: '8956', opponentName: 'Tim Franklin', outcome: 'tie' }),
      round({ round: 3, outcome: 'double_loss' })
    ]
  };
}

test('shortTournamentName folds the championship type after the city', () => {
  assert.equal(shortTournamentName(A), 'Indianapolis Regionals');
  assert.equal(shortTournamentName(B), 'New Orleans Internationals');
  assert.equal(shortTournamentName('2025-08-15, World Championships 2025'), 'Worlds 2025');
  assert.equal(shortTournamentName('2026-06-06, Special Event Turin'), 'Turin Special Event');
  assert.equal(shortTournamentName('2026-01-01, Something Else'), 'Something Else');
});

test('finishLabel names a win, a whole-number top share, or a bare placement', () => {
  assert.equal(finishLabel({ placement: 1, totalPlayers: 470 }), 'Won');
  assert.equal(finishLabel({ placement: 46, totalPlayers: 959 }), 'Top 5%');
  assert.equal(finishLabel({ placement: 2, totalPlayers: 3000 }), 'Top 1%');
  assert.equal(finishLabel({ placement: 12, totalPlayers: null }), '#12');
  assert.equal(finishLabel({ placement: null, totalPlayers: 100 }), '—');
});

test('career matchups counts each opponent deck, most-faced first, and skips byes', () => {
  const rows = careerRoundAggregates(rounds()).matchups;
  assert.deepEqual(
    rows.map(r => [r.archetype, r.wins, r.losses, r.ties, r.games]),
    [
      ['Dragapult', 1, 2, 1, 4],
      ['Gardevoir', 2, 0, 1, 3]
    ]
  );
  assert.equal(rows[1].winRate, 1);
  assert.equal(rows[0].winRate, 1 / 3);
});

test('career phases records Day 1, Day 2 and top cut in order, counting the bye as a win', () => {
  // The Day 1 row holds the New Orleans bye. Upstream standings count a bye as
  // a win, and these three rows split the same career record the hero band
  // prints, so leaving it out put the band a win behind the figure above it.
  assert.deepEqual(careerRoundAggregates(rounds()).phases, [
    { label: 'Day 1', wins: 2, losses: 2, ties: 2 },
    { label: 'Day 2', wins: 1, losses: 0, ties: 0 },
    { label: 'Top cut', wins: 1, losses: 0, ties: 0 }
  ]);
});

test('career opponents keys by career id, counts meetings and lists events newest first', () => {
  const rows = careerRoundAggregates(rounds()).repeats;
  // "Someone" (no career id, keyed by name) was met four times; Tim three.
  assert.deepEqual(
    rows.map(r => [r.name, r.meetings]),
    [
      ['Someone', 4],
      ['Tim Franklin', 3]
    ]
  );
  const tim = rows[1];
  assert.equal(tim.playerId, '8956');
  assert.equal(tim.meetings, 3);
  assert.deepEqual([tim.wins, tim.losses, tim.ties], [1, 1, 1]);
  assert.deepEqual(tim.events, [B, A]);
  assert.equal(careerRoundAggregates(rounds()).opponents, 2);
});

test('groupRoundsByPhase splits consecutive phases and labels them', () => {
  const groups = groupRoundsByPhase(rounds()[A]);
  assert.deepEqual(
    groups.map(g => [g.label, g.rounds.length]),
    [
      ['Day 1', 3],
      ['Day 2', 1],
      ['Top cut', 1]
    ]
  );
});

test('careerSummary derives the record line, rates and median finish', () => {
  const summary = careerSummary({
    playerId: '1',
    name: 'X',
    countries: ['US'],
    generatedAt: 'now',
    archetypeNames: {},
    archetypes: [],
    rounds: {},
    summary: {
      eventCount: 4,
      firstEventDate: '2024-09-13',
      lastEventDate: '2026-06-12',
      wins: 30,
      losses: 10,
      ties: 2,
      day2s: 3,
      topCuts: 1,
      tournamentWins: 1,
      bestPlacement: 1,
      medianPlacement: 40
    },
    tournaments: [
      {
        tournamentId: A,
        tournamentDate: '2026-05-29',
        totalPlayers: 1000,
        placement: 1,
        wins: 0,
        losses: 0,
        ties: 0,
        madePhase2: true,
        madeTopCut: true,
        archetype: null,
        deckId: null
      },
      {
        tournamentId: B,
        tournamentDate: '2026-06-12',
        totalPlayers: 1000,
        placement: 100,
        wins: 0,
        losses: 0,
        ties: 0,
        madePhase2: true,
        madeTopCut: false,
        archetype: null,
        deckId: null
      },
      {
        tournamentId: B,
        tournamentDate: '2026-06-12',
        totalPlayers: 1000,
        placement: 50,
        wins: 0,
        losses: 0,
        ties: 0,
        madePhase2: true,
        madeTopCut: false,
        archetype: null,
        deckId: null
      },
      {
        tournamentId: B,
        tournamentDate: '2026-06-12',
        totalPlayers: 1000,
        placement: 700,
        wins: 0,
        losses: 0,
        ties: 0,
        madePhase2: false,
        madeTopCut: false,
        archetype: null,
        deckId: null
      }
    ]
  });
  assert.equal(summary.record, '30-10-2');
  assert.equal(summary.winRate, 75);
  assert.equal(summary.day2Rate, 75);
  // Shares sorted: 0.001, 0.05, 0.1, 0.7 → upper median 0.1 → Top 10%.
  assert.equal(summary.medianFinish, 'Top 10%');
  assert.equal(summary.titleEvent, 'Indianapolis Regionals');
});

test('career aggregates handle missing histories and events with no rounds', () => {
  const empty = { hasEvents: false, matchups: [], phases: [], repeats: [], opponents: 0 };
  assert.deepEqual(careerRoundAggregates({}), empty);
  assert.deepEqual(careerRoundAggregates({ [A]: [] }), { ...empty, hasEvents: true });
});

test('career aggregates preserve tie-only rates and ignore undecided results in records', () => {
  const result = careerRoundAggregates({
    [A]: [
      round({ outcome: 'tie', phase: null, opponentArchetype: 'Tie only' }),
      round({ outcome: 'unknown', opponentArchetype: 'Undecided' }),
      round({ outcome: 'unpaired', opponentName: null, opponentArchetype: null }),
      round({ outcome: 'bye', opponentName: null, opponentArchetype: null })
    ]
  });
  assert.deepEqual(result.matchups, [
    { archetype: 'Tie only', wins: 0, losses: 0, ties: 1, games: 1, winRate: null },
    { archetype: 'Undecided', wins: 0, losses: 0, ties: 0, games: 0, winRate: null }
  ]);
  assert.deepEqual(result.phases, [{ label: 'Day 1', wins: 1, losses: 0, ties: 0 }]);
  assert.equal(result.opponents, 1);
  assert.deepEqual([result.repeats[0].wins, result.repeats[0].losses, result.repeats[0].ties], [0, 0, 1]);
});

test('career aggregates use newest opponent metadata and deduplicate events without mutating rounds', () => {
  const history = {
    [A]: [round({ opponentId: '1', opponentName: 'Old name', opponentCountry: 'US' })],
    [B]: [
      round({ opponentId: '1', opponentName: 'New name', opponentCountry: 'CA', outcome: 'loss' }),
      round({ opponentId: '1', opponentName: 'New name', outcome: 'tie' }),
      round({ opponentId: '2', opponentName: 'New name' })
    ]
  };
  const original = structuredClone(history);
  for (const eventRounds of Object.values(history)) {
    eventRounds.forEach(Object.freeze);
    Object.freeze(eventRounds);
  }
  Object.freeze(history);
  const result = careerRoundAggregates(history);
  assert.equal(result.opponents, 2);
  assert.deepEqual(result.repeats, [
    {
      playerId: '1',
      name: 'New name',
      country: 'CA',
      meetings: 3,
      wins: 1,
      losses: 1,
      ties: 1,
      events: [B, A]
    }
  ]);
  assert.deepEqual(history, original);
  assert.deepEqual(careerRoundAggregates(history), result);
});

test('career aggregates traverse each event once across long tournament histories', () => {
  const history: NonNullable<PlayerProfile['rounds']> = {};
  const visits = { reads: 0 };
  for (let event = 0; event < 100; event += 1) {
    const eventRounds = [
      round({ opponentId: '1', outcome: 'win' }),
      round({ opponentId: '1', outcome: 'double_loss', phase: 2 }),
      round({ opponentId: '2', outcome: 'tie', phase: 3 })
    ];
    Object.defineProperty(history, `event-${String(event).padStart(3, '0')}`, {
      enumerable: true,
      get() {
        visits.reads += 1;
        return eventRounds;
      }
    });
  }
  const result = careerRoundAggregates(history);
  assert.equal(visits.reads, 100);
  assert.equal(result.matchups[0].games, 300);
  assert.equal(result.matchups[0].winRate, 0.5);
  assert.equal(result.opponents, 2);
  assert.equal(result.repeats[0].meetings, 200);
  assert.equal(result.repeats[0].events.length, 100);
  assert.equal(result.repeats[0].events[0], 'event-099');
  assert.deepEqual(result.phases, [
    { label: 'Day 1', wins: 100, losses: 0, ties: 0 },
    { label: 'Day 2', wins: 0, losses: 100, ties: 0 },
    { label: 'Top cut', wins: 0, losses: 0, ties: 100 }
  ]);
});
