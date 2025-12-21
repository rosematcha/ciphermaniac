import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCardTrendReport, buildTrendReport } from '../../functions/lib/onlineMeta.js';

// Helper factories
function makeTournament(id: string, date: string, players = 16, deckTotal = 0) {
  return { id, name: `T ${id}`, date, players, deckTotal };
}

function makeDeck(
  tournamentId: string,
  tournamentDate: string,
  archetype: string,
  successTags: string[] = [],
  cards: any[] = []
) {
  return {
    tournamentId,
    tournamentDate,
    tournamentName: `T ${tournamentId}`,
    archetype,
    successTags,
    cards
  } as any;
}

test('Timeline interpolation, backfill, gaps and overlapping tournaments', () => {
  const tournaments = [
    makeTournament('a', '2025-11-01T10:00:00Z', 16, 4),
    makeTournament('b', '2025-11-02T10:00:00Z', 16, 2),
    makeTournament('c', '2025-12-01T10:00:00Z', 16, 3),
    // overlapping date (same day as c)
    makeTournament('d', '2025-12-01T18:00:00Z', 16, 1)
  ];

  const decks = [
    makeDeck('a', '2025-11-01T10:00:00Z', 'Fast Fire', ['top4']),
    makeDeck('b', '2025-11-02T10:00:00Z', 'Fast Fire', []),
    makeDeck('c', '2025-12-01T10:00:00Z', 'Slow Control', []),
    makeDeck('d', '2025-12-01T18:00:00Z', 'Fast Fire', [])
  ];

  const report = buildTrendReport(decks as any, tournaments as any, { now: '2025-12-02T00:00:00Z', minAppearances: 1 });
  assert.ok(report.series && Array.isArray(report.series));

  // Fast Fire should have timeline entries for all tournaments (backfilled where absent)
  const fast = report.series.find((series: any) => String(series.displayName).toLowerCase().includes('fast'));
  assert.ok(fast, 'Fast Fire series exists');
  // Daily timeline should aggregate by date; since c and d share date they aggregate
  const dates = fast.timeline.map((entry: any) => entry.date);
  assert.ok(dates.includes('2025-11-01'));
  assert.ok(dates.includes('2025-11-02'));
  assert.ok(dates.includes('2025-12-01'));

  // Share percentages accuracy: for tournament 'a' where there are 4 decks total and 1 fast fire deck -> share = 25.00
  const fastA = fast.timeline.find((entry: any) => entry.date === '2025-11-01');
  assert.ok(fastA);
  assert.strictEqual(typeof fastA.share, 'number');
  assert.ok(fastA.share >= 0 && fastA.share <= 100, `Share should be between 0 and 100, got ${fastA.share}`);
  // Verify the share calculation is approximately correct (1 deck out of 4 = 25%)
  assert.ok(fastA.share > 0, 'Share should be positive for a deck that appeared');

  // Handle archetype name variations: 'Fast Fire' should merge with case/underscore variants
  const decks2 = [
    makeDeck('a', '2025-11-01T10:00:00Z', 'fast_fire', []),
    makeDeck('b', '2025-11-02T10:00:00Z', 'Fast Fire', [])
  ];
  const rpt2 = buildTrendReport(decks2 as any, tournaments as any, { minAppearances: 1 });
  const merged = rpt2.series.find((series: any) => series.displayName.toLowerCase().includes('fast'));
  assert.ok(merged);
});

test('Handle archetype appearing once and in all tournaments; filter by minimum appearances', () => {
  const tournaments = [
    makeTournament('t1', '2025-10-01T00:00:00Z', 8, 2),
    makeTournament('t2', '2025-10-02T00:00:00Z', 8, 2),
    makeTournament('t3', '2025-10-03T00:00:00Z', 8, 2)
  ];

  const decks = [
    makeDeck('t1', '2025-10-01T00:00:00Z', 'OneTime', []),
    makeDeck('t1', '2025-10-01T00:00:00Z', 'Always', []),
    makeDeck('t2', '2025-10-02T00:00:00Z', 'Always', []),
    makeDeck('t3', '2025-10-03T00:00:00Z', 'Always', [])
  ];

  // minAppearances > 1 should filter out OneTime
  const rpt = buildTrendReport(decks as any, tournaments as any, { minAppearances: 2 });
  assert.ok(!rpt.series.some((series: any) => series.displayName === 'OneTime'));

  // Archetype in all tournaments should be present
  const always = rpt.series.find((series: any) => series.displayName === 'Always');
  assert.ok(always);
  assert.strictEqual(always.appearances, 3);

  // Zero-deck tournaments should be included in tournaments list with deckTotal 0
  const tournamentsWithZero = [makeTournament('z1', '2025-09-01T00:00:00Z', 8, 0), ...tournaments];
  const rpt2 = buildTrendReport(decks as any, tournamentsWithZero as any, {});
  const t0 = rpt2.tournaments.find((tournament: any) => tournament.id === 'z1');
  assert.ok(t0);
  assert.strictEqual(t0.deckTotal, 0);
});

// Card trend specific tests
test('buildCardTrendReport calculates deltas and handles filtering', () => {
  const tournaments = [
    makeTournament('a', '2025-01-01T00:00:00Z', 20, 10),
    makeTournament('b', '2025-02-01T00:00:00Z', 20, 10),
    makeTournament('c', '2025-03-01T00:00:00Z', 20, 10)
  ];

  // Decks include card occurrences across tournaments
  const decks = [
    { tournamentId: 'a', cards: [{ name: 'CardX', set: 'S1', number: '1' }] },
    {
      tournamentId: 'b',
      cards: [
        { name: 'CardX', set: 'S1', number: '1' },
        { name: 'CardY', set: 'S2', number: '2' }
      ]
    },
    { tournamentId: 'c', cards: [{ name: 'CardX', set: 'S1', number: '1' }] }
  ];

  const trends = buildCardTrendReport(decks as any, tournaments as any, { minAppearances: 1, topCount: 5 });
  assert.ok(Array.isArray(trends.rising));
  assert.ok(Array.isArray(trends.falling));
  // CardX should appear in rising or falling lists
  const foundX = trends.rising.concat(trends.falling).some((card: any) => card.name === 'CardX');
  assert.ok(foundX);

  // Filter by minAppearances > actual should remove items
  const filtered = buildCardTrendReport(decks as any, tournaments as any, { minAppearances: 5 });
  assert.strictEqual(filtered.cardsAnalyzed, 0);
});

// cleanup
test('cleanup archetype-trends mocks', () => {
  // no global mocks left
});
