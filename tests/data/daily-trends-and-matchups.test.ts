/**
 * Tests for daily trend aggregation and matchup matrix generation.
 * These tests cover the enhanced functionality added to archetypeTrends.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatchupMatrix, generateArchetypeTrends } from '../../shared/data/analysis/archetypeTrends.js';

// ============================================================================
// Helper Factories
// ============================================================================

function makeTournament(id: string, date: string, players = 16) {
  return { id, name: `Tournament ${id}`, date, players };
}

function makeDeck(
  tournamentId: string,
  tournamentDate: string,
  archetype: string,
  successTags: string[] = [],
  cards: Array<{ name: string; count: number; set?: string; number?: string }> = []
) {
  return {
    tournamentId,
    tournamentDate,
    tournamentName: `Tournament ${tournamentId}`,
    archetype,
    successTags,
    cards
  };
}

function makeStanding(playerId: string, deckName: string, placing = 1) {
  return {
    player: playerId,
    name: `Player ${playerId}`,
    placing,
    deck: { id: deckName.toLowerCase().replace(/\s+/g, '-'), name: deckName }
  };
}

function makePairing(player1: string, player2: string | null, winner: string | 0 | -1, round = 1) {
  return { round, player1, player2, winner };
}

// ============================================================================
// Daily Aggregation Tests
// ============================================================================

test('generateArchetypeTrends produces daily granularity data', () => {
  const tournaments = [
    makeTournament('t1', '2025-12-01T10:00:00Z'),
    makeTournament('t2', '2025-12-02T10:00:00Z'),
    makeTournament('t3', '2025-12-03T10:00:00Z')
  ];

  const decks = [
    makeDeck(
      't1',
      '2025-12-01T10:00:00Z',
      'Gardevoir',
      ['top8'],
      [{ name: 'Gardevoir ex', count: 3, set: 'SVI', number: '086' }]
    ),
    makeDeck(
      't2',
      '2025-12-02T10:00:00Z',
      'Gardevoir',
      ['top8'],
      [{ name: 'Gardevoir ex', count: 4, set: 'SVI', number: '086' }]
    ),
    makeDeck(
      't3',
      '2025-12-03T10:00:00Z',
      'Gardevoir',
      ['top8'],
      [{ name: 'Gardevoir ex', count: 3, set: 'SVI', number: '086' }]
    )
  ];

  const result = generateArchetypeTrends(decks, tournaments, null);

  // Should have days array
  assert.ok(Array.isArray(result.days), 'result.days should be an array');
  assert.strictEqual(result.days.length, 3, 'Should have 3 days');

  // Days should be in chronological order
  assert.strictEqual(result.days[0].date, '2025-12-01');
  assert.strictEqual(result.days[1].date, '2025-12-02');
  assert.strictEqual(result.days[2].date, '2025-12-03');

  // Each day should have totals
  result.days.forEach(day => {
    assert.ok(day.totals, 'Day should have totals');
    assert.ok(typeof day.totals.all === 'number', 'totals.all should be a number');
  });

  // Meta should include dayCount
  assert.strictEqual(result.meta.dayCount, 3, 'meta.dayCount should be 3');
});

test('generateArchetypeTrends aggregates multiple tournaments on same day', () => {
  const tournaments = [
    makeTournament('t1', '2025-12-01T10:00:00Z'),
    makeTournament('t2', '2025-12-01T18:00:00Z') // Same day, different time
  ];

  const decks = [
    makeDeck(
      't1',
      '2025-12-01T10:00:00Z',
      'Dragapult',
      ['top8'],
      [{ name: 'Dragapult ex', count: 4, set: 'TWM', number: '130' }]
    ),
    makeDeck(
      't2',
      '2025-12-01T18:00:00Z',
      'Dragapult',
      ['top8'],
      [{ name: 'Dragapult ex', count: 4, set: 'TWM', number: '130' }]
    )
  ];

  const result = generateArchetypeTrends(decks, tournaments, null);

  // Should aggregate to single day
  assert.strictEqual(result.days.length, 1, 'Should aggregate to 1 day');
  assert.strictEqual(result.days[0].date, '2025-12-01');
  assert.strictEqual(result.days[0].totals.all, 2, 'Should have 2 decks total');
  assert.deepStrictEqual(result.days[0].tournamentIds.sort(), ['t1', 't2'], 'Should include both tournament IDs');
});

test('generateArchetypeTrends maintains backward compatibility with weeks array', () => {
  const tournaments = [
    makeTournament('t1', '2025-12-01T10:00:00Z'), // Week 1
    makeTournament('t2', '2025-12-08T10:00:00Z') // Week 2
  ];

  const decks = [
    makeDeck(
      't1',
      '2025-12-01T10:00:00Z',
      'Charizard',
      ['top8'],
      [{ name: 'Charizard ex', count: 2, set: 'OBF', number: '125' }]
    ),
    makeDeck(
      't2',
      '2025-12-08T10:00:00Z',
      'Charizard',
      ['top8'],
      [{ name: 'Charizard ex', count: 3, set: 'OBF', number: '125' }]
    )
  ];

  const result = generateArchetypeTrends(decks, tournaments, null);

  // Should still have weeks array for backward compatibility
  assert.ok(Array.isArray(result.weeks), 'result.weeks should be an array');
  assert.strictEqual(result.weeks.length, 2, 'Should have 2 weeks');
  assert.ok(result.weeks[0].weekStart, 'Week should have weekStart');
  assert.ok(result.weeks[0].weekEnd, 'Week should have weekEnd');

  // Meta should include both counts
  assert.ok(result.meta.dayCount >= 2, 'meta.dayCount should be at least 2');
  assert.strictEqual(result.meta.weekCount, 2, 'meta.weekCount should be 2');
});

test('generateArchetypeTrends handles empty input gracefully', () => {
  const result = generateArchetypeTrends([], [], null);

  assert.strictEqual(result.meta.tournamentCount, 0);
  assert.strictEqual(result.meta.dayCount, 0);
  assert.strictEqual(result.meta.weekCount, 0);
  assert.deepStrictEqual(result.days, []);
  assert.deepStrictEqual(result.weeks, []);
  assert.deepStrictEqual(result.cards, {});
  assert.deepStrictEqual(result.matchups, {});
});

test('generateArchetypeTrends tracks card playrate across days', () => {
  const tournaments = [makeTournament('t1', '2025-12-01T10:00:00Z'), makeTournament('t2', '2025-12-02T10:00:00Z')];

  const decks = [
    // Day 1: 2 decks, 1 with card (50% playrate)
    makeDeck(
      't1',
      '2025-12-01T10:00:00Z',
      'TestDeck',
      ['top8'],
      [{ name: 'Test Card', count: 4, set: 'TST', number: '001' }]
    ),
    makeDeck('t1', '2025-12-01T10:00:00Z', 'TestDeck', ['top8'], []),
    // Day 2: 2 decks, 2 with card (100% playrate)
    makeDeck(
      't2',
      '2025-12-02T10:00:00Z',
      'TestDeck',
      ['top8'],
      [{ name: 'Test Card', count: 4, set: 'TST', number: '001' }]
    ),
    makeDeck(
      't2',
      '2025-12-02T10:00:00Z',
      'TestDeck',
      ['top8'],
      [{ name: 'Test Card', count: 4, set: 'TST', number: '001' }]
    )
  ];

  const result = generateArchetypeTrends(decks, tournaments, null);

  // Check that cards have timeline data
  const cardKeys = Object.keys(result.cards);
  assert.ok(cardKeys.length > 0, 'Should have at least one card');

  const testCard = Object.values(result.cards).find((c: any) => c.name === 'Test Card');
  assert.ok(testCard, 'Test Card should be in results');

  // Playrate should increase from day 1 to day 2
  assert.ok((testCard as any).playrateChange > 0, 'Playrate should increase');
});

// ============================================================================
// Matchup Matrix Tests
// ============================================================================

test('buildMatchupMatrix aggregates wins/losses/ties correctly', () => {
  const targetArchetype = 'Dragapult Dusknoir';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [
        makeStanding('p1', 'Dragapult Dusknoir'),
        makeStanding('p2', 'Gholdengo Lunatone'),
        makeStanding('p3', 'Gardevoir'),
        makeStanding('p4', 'Dragapult Dusknoir') // Mirror opponent
      ],
      pairings: [
        // Games vs Gholdengo (need at least 3 for threshold)
        makePairing('p1', 'p2', 'p1'), // Dragapult beats Gholdengo
        makePairing('p1', 'p2', 'p2'), // Gholdengo beats Dragapult
        makePairing('p4', 'p2', 'p2'), // Gholdengo beats Dragapult
        makePairing('p4', 'p2', 'p4'), // Dragapult beats Gholdengo
        // Games vs Gardevoir (need at least 3 for threshold)
        makePairing('p1', 'p3', 'p3'), // Gardevoir beats Dragapult
        makePairing('p1', 'p3', 'p1'), // Dragapult beats Gardevoir
        makePairing('p4', 'p3', 'p3'), // Gardevoir beats Dragapult
        // Mirror matches (need at least 3)
        makePairing('p1', 'p4', 'p1'), // Dragapult mirror - p1 wins
        makePairing('p1', 'p4', 'p4'), // Dragapult mirror - p4 wins
        makePairing('p1', 'p4', 0) // Dragapult mirror - tie
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  // Check Gholdengo matchup (4 games total)
  assert.ok(result['Gholdengo Lunatone'], 'Should have Gholdengo matchup');
  const gholdengo = result['Gholdengo Lunatone'];
  assert.strictEqual(gholdengo.wins, 2, 'Should have 2 wins vs Gholdengo');
  assert.strictEqual(gholdengo.losses, 2, 'Should have 2 losses vs Gholdengo');
  assert.strictEqual(gholdengo.total, 4, 'Should have 4 total games vs Gholdengo');

  // Check Gardevoir matchup (3 games total)
  assert.ok(result.Gardevoir, 'Should have Gardevoir matchup');
  const gardevoir = result.Gardevoir;
  assert.strictEqual(gardevoir.wins, 1, 'Should have 1 win vs Gardevoir');
  assert.strictEqual(gardevoir.losses, 2, 'Should have 2 losses vs Gardevoir');

  // Mirror matches (both players on the target archetype) are kept as a
  // self-keyed entry — the frontend renders the "(mirror)" row from it — but
  // counted symmetrically so pairing order can't bias the record (P-26).
  assert.ok(result['Dragapult Dusknoir'], 'Mirror matchup should keep its self-keyed entry');
  const mirror = result['Dragapult Dusknoir'];
  assert.strictEqual(mirror.total, 3, 'Mirror counts each match once');
  assert.strictEqual(mirror.ties, 1, 'Mirror ties recorded');
  assert.strictEqual(mirror.wins, mirror.losses, 'Mirror record is symmetric');
  assert.strictEqual(mirror.winRate, 50, 'Mirror win rate pinned at 50');
});

test('buildMatchupMatrix handles ties correctly', () => {
  const targetArchetype = 'TestDeck';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [makeStanding('p1', 'TestDeck'), makeStanding('p2', 'OpponentDeck')],
      pairings: [
        makePairing('p1', 'p2', 0), // Tie
        makePairing('p1', 'p2', 0), // Another tie
        makePairing('p1', 'p2', 'p1') // Win
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  assert.ok(result.OpponentDeck, 'Should have OpponentDeck matchup');
  const opponent = result.OpponentDeck;
  assert.strictEqual(opponent.ties, 2, 'Should have 2 ties');
  assert.strictEqual(opponent.wins, 1, 'Should have 1 win');
  assert.strictEqual(opponent.total, 3, 'Should have 3 total games');
});

test('buildMatchupMatrix handles double losses (winner = -1)', () => {
  const targetArchetype = 'TestDeck';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [makeStanding('p1', 'TestDeck'), makeStanding('p2', 'OpponentDeck')],
      pairings: [
        makePairing('p1', 'p2', -1), // Double loss
        makePairing('p1', 'p2', 'p1'), // Win
        makePairing('p1', 'p2', 'p1'), // Win
        makePairing('p1', 'p2', 'p1') // Win - now 4 total games
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  const opponent = result.OpponentDeck;
  assert.ok(opponent, 'Should have matchup data');
  assert.strictEqual(opponent.losses, 1, 'Double loss counts as 1 loss');
  assert.strictEqual(opponent.wins, 3, 'Should have 3 wins');
});

test('buildMatchupMatrix skips byes (no player2)', () => {
  const targetArchetype = 'TestDeck';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [makeStanding('p1', 'TestDeck'), makeStanding('p2', 'OpponentDeck')],
      pairings: [
        makePairing('p1', null, 'p1'), // Bye - should be skipped
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p1') // 3 real games
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  const opponent = result.OpponentDeck;
  assert.ok(opponent, 'Should have matchup data');
  assert.strictEqual(opponent.total, 3, 'Should only count real games, not byes');
});

test('buildMatchupMatrix filters out matchups with insufficient sample size', () => {
  const targetArchetype = 'TestDeck';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [
        makeStanding('p1', 'TestDeck'),
        makeStanding('p2', 'FrequentOpponent'),
        makeStanding('p3', 'RareOpponent')
      ],
      pairings: [
        // 5 games vs FrequentOpponent (above threshold)
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p1'),
        // Only 2 games vs RareOpponent (below MIN_MATCHUP_GAMES = 3)
        makePairing('p1', 'p3', 'p1'),
        makePairing('p1', 'p3', 'p1')
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  assert.ok(result.FrequentOpponent, 'Should include frequent matchup');
  assert.ok(!result.RareOpponent, 'Should filter out rare matchup (< 3 games)');
});

test('buildMatchupMatrix calculates winRate correctly', () => {
  const targetArchetype = 'TestDeck';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [makeStanding('p1', 'TestDeck'), makeStanding('p2', 'OpponentDeck')],
      pairings: [
        makePairing('p1', 'p2', 'p1'), // Win
        makePairing('p1', 'p2', 'p1'), // Win
        makePairing('p1', 'p2', 'p2'), // Loss
        makePairing('p1', 'p2', 0) // Tie
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  const opponent = result.OpponentDeck;
  // Win rate = wins / total = 2 / 4 = 50%
  assert.strictEqual(opponent.winRate, 50, 'Win rate should be 50%');
});

test('buildMatchupMatrix aggregates across multiple tournaments', () => {
  const targetArchetype = 'Pikachu';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [makeStanding('p1', 'Pikachu'), makeStanding('p2', 'Charizard')],
      pairings: [makePairing('p1', 'p2', 'p1'), makePairing('p1', 'p2', 'p1')]
    },
    {
      tournamentId: 't2',
      standings: [makeStanding('p3', 'Pikachu'), makeStanding('p4', 'Charizard')],
      pairings: [
        makePairing('p3', 'p4', 'p4'), // Loss
        makePairing('p3', 'p4', 'p3') // Win
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  const charizard = result.Charizard;
  assert.ok(charizard, 'Should have Charizard matchup');
  assert.strictEqual(charizard.wins, 3, 'Should have 3 wins total across tournaments');
  assert.strictEqual(charizard.losses, 1, 'Should have 1 loss');
  assert.strictEqual(charizard.total, 4, 'Should have 4 total games');
});

test('buildMatchupMatrix handles empty pairings data', () => {
  const result = buildMatchupMatrix('TestDeck', []);
  assert.deepStrictEqual(result, {}, 'Should return empty object for empty input');
});

test('buildMatchupMatrix handles missing deck info gracefully', () => {
  const targetArchetype = 'TestDeck';

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [
        makeStanding('p1', 'TestDeck')
        // p2 not in standings - deck unknown
      ],
      pairings: [
        makePairing('p1', 'p2', 'p1'), // Should be skipped - unknown opponent
        makePairing('p1', 'p3', 'p1') // Should be skipped - unknown opponent
      ]
    }
  ];

  const result = buildMatchupMatrix(targetArchetype, pairingsData);

  // No matchups should be recorded since opponents are unknown
  assert.deepStrictEqual(result, {}, 'Should skip matches with unknown decks');
});

// ============================================================================
// Integration Test: generateArchetypeTrends with matchup data
// ============================================================================

test('generateArchetypeTrends includes matchups when pairingsData is provided', () => {
  const archetypeName = 'Dragapult Dusknoir';

  const tournaments = [makeTournament('t1', '2025-12-01T10:00:00Z')];

  const decks = [
    makeDeck(
      't1',
      '2025-12-01T10:00:00Z',
      archetypeName,
      ['top8'],
      [{ name: 'Dragapult ex', count: 4, set: 'TWM', number: '130' }]
    )
  ];

  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [makeStanding('p1', archetypeName), makeStanding('p2', 'Gholdengo Lunatone')],
      pairings: [
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p1'),
        makePairing('p1', 'p2', 'p2'),
        makePairing('p1', 'p2', 'p1')
      ]
    }
  ];

  const result = generateArchetypeTrends(decks, tournaments, null, {
    pairingsData,
    archetypeName
  });

  // Should have matchups section
  assert.ok(result.matchups, 'Result should have matchups');
  assert.ok(result.matchups['Gholdengo Lunatone'], 'Should have Gholdengo matchup');

  const gholdengo = result.matchups['Gholdengo Lunatone'];
  assert.strictEqual(gholdengo.wins, 3);
  assert.strictEqual(gholdengo.losses, 1);
  assert.strictEqual(gholdengo.total, 4);
  assert.strictEqual(gholdengo.winRate, 75); // 75% win rate
});

test('generateArchetypeTrends returns empty matchups when no pairingsData', () => {
  const tournaments = [makeTournament('t1', '2025-12-01T10:00:00Z')];
  const decks = [makeDeck('t1', '2025-12-01T10:00:00Z', 'TestDeck', ['top8'], [])];

  const result = generateArchetypeTrends(decks, tournaments, null);

  assert.ok(result.matchups !== undefined, 'matchups should be defined');
  assert.deepStrictEqual(result.matchups, {}, 'matchups should be empty object');
});

// ============================================================================
// Regression tests for review findings
// ============================================================================

// P-09: a card that drops to 0% on the final day must report currentPlayrate 0
// and a correct negative playrateChange (previously stuck on last nonzero day).
test('generateArchetypeTrends reports 0 playrate when card absent on last day (P-09)', () => {
  const tournaments = [
    makeTournament('t1', '2026-01-01T12:00:00Z', 1),
    makeTournament('t2', '2026-01-02T12:00:00Z', 1)
  ];
  const decks = [
    makeDeck('t1', '2026-01-01T12:00:00Z', 'A', ['top8'], [{ name: 'X', count: 1, set: 'TST', number: '001' }]),
    makeDeck('t2', '2026-01-02T12:00:00Z', 'A', ['top8'], [])
  ];

  const result = generateArchetypeTrends(decks, tournaments, null);
  const card = Object.values(result.cards).find((c: any) => c.name === 'X') as any;

  assert.ok(card, 'Card X should be present');
  assert.strictEqual(card.currentPlayrate, 0, 'currentPlayrate should be 0 on the absent final day');
  assert.strictEqual(card.playrateChange, -100, 'playrateChange should be -100 (100% -> 0%)');
});

// P-10: two synonym variants of the same card in one deck must count once per
// deck. Previously playrate could reach 200% and copy-distribution buckets went
// negative (tierTotal - counts.length).
test('generateArchetypeTrends dedupes synonym variants per deck (P-10)', () => {
  const synonymDb = { synonyms: { 'X::OLD::002': 'X::NEW::001' }, canonicals: {} };
  const tournaments = [makeTournament('t1', '2026-01-01T12:00:00Z', 1)];
  const decks = [
    makeDeck(
      't1',
      '2026-01-01T12:00:00Z',
      'A',
      ['top8'],
      [
        { name: 'X', count: 2, set: 'OLD', number: '002' },
        { name: 'X', count: 1, set: 'NEW', number: '001' }
      ]
    )
  ];

  const result = generateArchetypeTrends(decks, tournaments, synonymDb as any);
  const entries = Object.entries(result.cards);
  assert.strictEqual(entries.length, 1, 'Both variants collapse to a single canonical card');

  const [uid, card] = entries[0] as [string, any];
  assert.strictEqual(uid, 'X::NEW::001', 'Card keyed on canonical UID');
  assert.ok(card.currentPlayrate <= 100, `playrate must be <= 100 (got ${card.currentPlayrate})`);
  assert.strictEqual(card.set, 'NEW', 'meta.set derived from canonical UID');
  assert.strictEqual(card.number, '001', 'meta.number derived from canonical UID');

  // Copy distribution buckets must never be negative.
  const dist = card.timeline[0].all.dist as number[];
  for (const bucket of dist) {
    assert.ok(bucket >= 0, `distribution bucket must be non-negative (got ${bucket})`);
  }
});

// P-26: mirror matches must not bias the directional win rate by pairing order.
test('buildMatchupMatrix counts mirror matches symmetrically (P-26)', () => {
  const pairingsData = [
    {
      tournamentId: 't1',
      standings: [makeStanding('p1', 'TestDeck'), makeStanding('p2', 'TestDeck')],
      pairings: [makePairing('p1', 'p2', 'p1'), makePairing('p1', 'p2', 'p1'), makePairing('p1', 'p2', 'p1')]
    }
  ];

  const result = buildMatchupMatrix('TestDeck', pairingsData);
  const mirror = result.TestDeck;
  assert.ok(mirror, 'Mirror-only pairings keep the self-keyed entry');
  assert.strictEqual(mirror.total, 3, 'Each mirror match counted once');
  assert.strictEqual(mirror.winRate, 50, 'Win rate pinned at 50 regardless of who is player1');
  assert.strictEqual(mirror.wins + mirror.losses + mirror.ties, 3, 'Record reconciles with total');
  assert.ok(Math.abs(mirror.wins - mirror.losses) <= 1, 'Wins and losses split as evenly as possible');
});
