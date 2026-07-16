import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCardTrendReport, buildTrendReport } from '../../shared/onlineMeta/index.ts';

// Mock data helpers
const createTournament = (id: string, date: string, players: number, deckTotal: number) => ({
  id,
  name: `Tournament ${id}`,
  date,
  players,
  deckTotal,
  format: 'STANDARD'
});

const createDeck = (tournamentId: string, archetype: string, successTags: string[] = []) => ({
  tournamentId,
  archetype,
  successTags
});

describe('Trends Logic', () => {
  describe('buildTrendReport', () => {
    it('should include small tournaments (MIN_TREND_PLAYERS is 0)', () => {
      const tournaments = [
        createTournament('t1', '2023-01-01', 20, 20),
        createTournament('t2', '2023-01-02', 8, 8), // Small
        createTournament('t3', '2023-01-03', 30, 30)
      ];

      const decks = [createDeck('t1', 'Deck A'), createDeck('t2', 'Deck A'), createDeck('t3', 'Deck A')];

      const report = buildTrendReport(decks, tournaments, { minAppearances: 1 });

      // All tournaments count: archetype shares represent what was actually played
      assert.strictEqual(report.tournamentCount, 3);
      assert.ok(report.tournaments.find(tournament => tournament.id === 't2'));

      // Deck A appears in all 3 tournaments
      const series = report.series.find(ser => ser.displayName === 'Deck A');
      assert.ok(series, 'Deck A series should exist');
      assert.strictEqual(series.appearances, 3);
    });

    it('should backfill missing tournaments with 0 share', () => {
      const tournaments = [createTournament('t1', '2023-01-01', 20, 20), createTournament('t2', '2023-01-02', 20, 20)];

      // Deck A is only in t1
      const decks = [createDeck('t1', 'Deck A')];

      const report = buildTrendReport(decks, tournaments, { minAppearances: 1 });
      const series = report.series.find(ser => ser.displayName === 'Deck A');
      assert.ok(series, 'Deck A series should exist');

      // Timeline is aggregated by day; should have entries for both dates
      assert.strictEqual(series.timeline.length, 2);

      const t1Entry = series.timeline.find(entry => entry.date === '2023-01-01');
      const t2Entry = series.timeline.find(entry => entry.date === '2023-01-02');
      assert.ok(t1Entry, 'day 1 entry should exist');
      assert.ok(t2Entry, 'day 2 entry should exist');

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

    // P-27: appearances must be the number of events the card was present in,
    // not the total number of events in the window.
    it('should report appearances as present-event count, not total events', () => {
      const tournaments = [
        createTournament('t1', '2023-01-01', 20, 20),
        createTournament('t2', '2023-01-15', 20, 20),
        createTournament('t3', '2023-01-29', 20, 20)
      ];
      // Riser present in t1 and t3 only (2 of 3 events).
      const decks = [
        { ...createDeck('t1', 'A'), cards: [{ name: 'Riser', set: 'SVI', number: '1' }] },
        ...Array.from({ length: 10 }, () => ({
          ...createDeck('t3', 'A'),
          cards: [{ name: 'Riser', set: 'SVI', number: '1' }]
        }))
      ];

      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 5 });
      const riser = [...report.rising, ...report.falling].find(card => card.name === 'Riser');
      assert.ok(riser, 'Riser should appear in the trend report');
      assert.strictEqual(riser!.appearances, 2, 'appearances should count only present events (2 of 3)');
    });
  });
});
