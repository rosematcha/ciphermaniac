import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCardTrendReport, buildTrendReport } from '../functions/lib/onlineMeta.ts';

// Mock data helpers
const createTournament = (id, date, players, deckTotal) => ({
  id,
  name: `Tournament ${id}`,
  date,
  players,
  deckTotal,
  format: 'STANDARD'
});

const createDeck = (tournamentId, archetype, successTags = []) => ({
  tournamentId,
  archetype,
  successTags
});

describe('Trends Logic', () => {
  describe('buildTrendReport', () => {
    it('should filter out small tournaments (< 16 players)', () => {
      const tournaments = [
        createTournament('t1', '2023-01-01', 20, 20),
        createTournament('t2', '2023-01-02', 8, 8), // Small
        createTournament('t3', '2023-01-03', 30, 30)
      ];

      const decks = [createDeck('t1', 'Deck A'), createDeck('t2', 'Deck A'), createDeck('t3', 'Deck A')];

      const report = buildTrendReport(decks, tournaments, { minAppearances: 1 });

      // Should only have 2 tournaments in the report
      assert.strictEqual(report.tournamentCount, 2);
      assert.strictEqual(
        report.tournaments.find(tournament => tournament.id === 't2'),
        undefined
      );

      // Deck A should only have 2 appearances tracked
      const series = report.series.find(ser => ser.displayName === 'Deck A');
      assert.strictEqual(series.appearances, 2);
    });

    it('should backfill missing tournaments with 0 share', () => {
      const tournaments = [createTournament('t1', '2023-01-01', 20, 20), createTournament('t2', '2023-01-02', 20, 20)];

      // Deck A is only in t1
      const decks = [createDeck('t1', 'Deck A')];

      const report = buildTrendReport(decks, tournaments, { minAppearances: 1 });
      const series = report.series.find(ser => ser.displayName === 'Deck A');

      // Should have entries for both tournaments
      assert.strictEqual(series.timeline.length, 2);

      const t1Entry = series.timeline.find(tournament => tournament.tournamentId === 't1');
      const t2Entry = series.timeline.find(tournament => tournament.tournamentId === 't2');

      assert.ok(t1Entry.share > 0, 'T1 should have share > 0');
      assert.strictEqual(t2Entry.share, 0, 'T2 should have share 0');
      assert.strictEqual(t2Entry.decks, 0, 'T2 should have 0 decks');
    });
  });

  describe('buildCardTrendReport', () => {
    it('should exclude cards with 0% current share from Rising list', () => {
      const tournaments = [createTournament('t1', '2023-01-01', 20, 20), createTournament('t2', '2023-01-02', 20, 20)];

      // Card A was in t1 but not t2
      const decks = [{ ...createDeck('t1', 'Deck'), cards: [{ name: 'Card A', count: 1 }] }];

      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 5 });

      const risingNames = report.rising.map(card => card.name);
      assert.ok(!risingNames.includes('Card A'));
    });

    it('should produce disjoint rising and falling lists', () => {
      const tournaments = [
        createTournament('t1', '2023-01-01', 20, 20),
        createTournament('t2', '2023-01-15', 20, 20),
        createTournament('t3', '2023-01-29', 20, 20)
      ];
      const decks = [
        // Riser climbs t1=1 → t3=10
        ...Array.from({ length: 1 }, () => ({
          ...createDeck('t1', 'A'),
          cards: [{ name: 'Riser', set: 'SVI', number: '1' }]
        })),
        ...Array.from({ length: 10 }, () => ({
          ...createDeck('t3', 'A'),
          cards: [{ name: 'Riser', set: 'SVI', number: '1' }]
        })),
        // Faller drops t1=10 → t3=1
        ...Array.from({ length: 10 }, () => ({
          ...createDeck('t1', 'B'),
          cards: [{ name: 'Faller', set: 'SVI', number: '2' }]
        })),
        ...Array.from({ length: 1 }, () => ({
          ...createDeck('t3', 'B'),
          cards: [{ name: 'Faller', set: 'SVI', number: '2' }]
        }))
      ];

      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 10 });

      const risingKeys = new Set(report.rising.map(card => card.key));
      const fallingKeys = new Set(report.falling.map(card => card.key));
      for (const key of risingKeys) {
        assert.ok(!fallingKeys.has(key), `${key} should not appear in both rising and falling`);
      }
    });

    it('should emit recentAvg and startAvg fields on each card', () => {
      const tournaments = [
        createTournament('t1', '2023-01-01', 20, 20),
        createTournament('t2', '2023-01-15', 20, 20),
        createTournament('t3', '2023-01-29', 20, 20)
      ];
      const decks = [
        ...Array.from({ length: 1 }, () => ({
          ...createDeck('t1', 'A'),
          cards: [{ name: 'Riser', set: 'SVI', number: '1' }]
        })),
        ...Array.from({ length: 10 }, () => ({
          ...createDeck('t3', 'A'),
          cards: [{ name: 'Riser', set: 'SVI', number: '1' }]
        }))
      ];
      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 5 });
      const all = [...report.rising, ...report.falling];
      assert.ok(all.length > 0, 'expected at least one card');
      for (const card of all) {
        assert.ok(typeof card.recentAvg === 'number', `recentAvg missing for ${card.name}`);
        assert.ok(typeof card.startAvg === 'number', `startAvg missing for ${card.name}`);
      }
    });

    it('should drop delta=0 entries from both rising and falling lists', () => {
      const tournaments = [createTournament('t1', '2023-01-01', 20, 20), createTournament('t2', '2023-01-02', 20, 20)];
      // Flat card: same share both events
      const decks = [
        { ...createDeck('t1', 'A'), cards: [{ name: 'Flat', set: 'SVI', number: '1' }] },
        { ...createDeck('t2', 'A'), cards: [{ name: 'Flat', set: 'SVI', number: '1' }] }
      ];
      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 5 });
      assert.ok(!report.rising.some(card => card.name === 'Flat'));
      assert.ok(!report.falling.some(card => card.name === 'Flat'));
    });
  });
});
