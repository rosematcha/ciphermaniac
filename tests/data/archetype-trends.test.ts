import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCardTrendReport, buildTrendReport } from '../../shared/onlineMeta/index.js';

// Helper factories
function makeTournament(id: string, date: string, players = 16, deckTotal = 0) {
  return { id, name: `T ${id}`, date, players, deckTotal };
}

function makeDeck(tournamentId: string, tournamentDate: string, archetype: string) {
  return {
    tournamentId,
    tournamentDate,
    tournamentName: `T ${tournamentId}`,
    archetype,
    successTags: [],
    cards: []
  } as any;
}

test('same-day tournaments share one timeline bucket and one denominator', () => {
  const tournaments = [
    makeTournament('a', '2025-11-01T10:00:00Z'),
    makeTournament('c', '2025-12-01T10:00:00Z'),
    // overlapping date (same day as c)
    makeTournament('d', '2025-12-01T18:00:00Z')
  ];
  const decks = [
    makeDeck('a', '2025-11-01T10:00:00Z', 'Fast Fire'),
    makeDeck('c', '2025-12-01T10:00:00Z', 'Slow Control'),
    makeDeck('d', '2025-12-01T18:00:00Z', 'Fast Fire')
  ];

  const report = buildTrendReport(decks, tournaments as any, { now: '2025-12-02T00:00:00Z', minAppearances: 1 });
  const fast = report.series.find((series: any) => series.displayName === 'Fast Fire');
  assert.ok(fast, 'Fast Fire series exists');
  assert.deepEqual(
    fast.timeline.map((entry: any) => [entry.date, entry.decks, entry.totalDecks, entry.share]),
    [
      ['2025-11-01', 1, 1, 100],
      ['2025-12-01', 1, 2, 50]
    ]
  );
});

test('archetype name variants merge into one series', () => {
  const tournaments = [makeTournament('a', '2025-11-01T10:00:00Z'), makeTournament('b', '2025-11-02T10:00:00Z')];
  const decks = [
    makeDeck('a', '2025-11-01T10:00:00Z', 'fast_fire'),
    makeDeck('b', '2025-11-02T10:00:00Z', 'Fast Fire')
  ];

  const report = buildTrendReport(decks, tournaments as any, { minAppearances: 1 });
  assert.equal(report.series.length, 1);
  assert.equal(report.series[0].appearances, 2);
});

test('minAppearances drops rare archetypes while zero-deck tournaments stay listed', () => {
  const tournaments = [
    makeTournament('z1', '2025-09-01T00:00:00Z'),
    makeTournament('t1', '2025-10-01T00:00:00Z'),
    makeTournament('t2', '2025-10-02T00:00:00Z')
  ];
  const decks = [
    makeDeck('t1', '2025-10-01T00:00:00Z', 'OneTime'),
    makeDeck('t1', '2025-10-01T00:00:00Z', 'Always'),
    makeDeck('t2', '2025-10-02T00:00:00Z', 'Always')
  ];

  const report = buildTrendReport(decks, tournaments as any, { minAppearances: 2 });
  assert.deepEqual(
    report.series.map((series: any) => series.displayName),
    ['Always']
  );
  assert.equal(report.tournaments.find((tournament: any) => tournament.id === 'z1')?.deckTotal, 0);
});

test('buildCardTrendReport drops cards seen in fewer events than minAppearances', () => {
  const tournaments = [
    makeTournament('a', '2025-01-01T00:00:00Z', 20, 10),
    makeTournament('b', '2025-02-01T00:00:00Z', 20, 10),
    makeTournament('c', '2025-03-01T00:00:00Z', 20, 10)
  ];
  const cardX = { name: 'CardX', set: 'S1', number: '1' };
  const decks = [
    { tournamentId: 'a', cards: [cardX] },
    { tournamentId: 'b', cards: [cardX, { name: 'CardY', set: 'S2', number: '2' }] },
    { tournamentId: 'c', cards: [cardX] },
    { tournamentId: 'c', cards: [cardX] }
  ];

  assert.equal(buildCardTrendReport(decks as any, tournaments as any, { minAppearances: 1 }).cardsAnalyzed, 2);
  assert.equal(buildCardTrendReport(decks as any, tournaments as any, { minAppearances: 2 }).cardsAnalyzed, 1);
  assert.equal(buildCardTrendReport(decks as any, tournaments as any, { minAppearances: 5 }).cardsAnalyzed, 0);
});
