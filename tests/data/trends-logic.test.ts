import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCardTrendReport, buildTrendReport } from '../../shared/onlineMeta/index.ts';

const tournament = (id: string, date: string, deckTotal: number) => ({
  id,
  name: `Tournament ${id}`,
  date,
  players: deckTotal,
  deckTotal,
  format: 'STANDARD'
});

const deck = (
  tournamentId: string,
  archetype: string,
  cards: Array<{ name: string; set?: string; number?: string }> = []
) => ({
  tournamentId,
  archetype,
  successTags: [],
  cards: cards.map(card => ({ count: 1, ...card }))
});

describe('Trends Logic', () => {
  describe('buildTrendReport', () => {
    it('should include small tournaments (MIN_TREND_PLAYERS is 0)', () => {
      const tournaments = [
        tournament('t1', '2023-01-01', 20),
        tournament('t2', '2023-01-02', 8), // Small
        tournament('t3', '2023-01-03', 30)
      ];

      const decks = [deck('t1', 'Deck A'), deck('t2', 'Deck A'), deck('t3', 'Deck A')];

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
      const tournaments = [tournament('t1', '2023-01-01', 20), tournament('t2', '2023-01-02', 20)];

      // Deck A is only in t1
      const decks = [deck('t1', 'Deck A')];

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
      const tournaments = [tournament('t1', '2023-01-01', 20), tournament('t2', '2023-01-02', 20)];

      // Card A was in t1 but not t2
      const decks = [deck('t1', 'Deck', [{ name: 'Card A' }])];

      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 5 });

      const risingNames = report.rising.map(card => card.name);
      assert.ok(!risingNames.includes('Card A'));
    });

    it('should produce disjoint rising and falling lists', () => {
      const tournaments = [
        tournament('t1', '2023-01-01', 20),
        tournament('t2', '2023-01-15', 20),
        tournament('t3', '2023-01-29', 20)
      ];
      const decks = [
        // Riser climbs t1=1 → t3=10
        ...Array.from({ length: 1 }, () => deck('t1', 'A', [{ name: 'Riser', set: 'SVI', number: '1' }])),
        ...Array.from({ length: 10 }, () => deck('t3', 'A', [{ name: 'Riser', set: 'SVI', number: '1' }])),
        // Faller drops t1=10 → t3=1
        ...Array.from({ length: 10 }, () => deck('t1', 'B', [{ name: 'Faller', set: 'SVI', number: '2' }])),
        ...Array.from({ length: 1 }, () => deck('t3', 'B', [{ name: 'Faller', set: 'SVI', number: '2' }]))
      ];

      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 10 });

      const risingKeys = new Set(report.rising.map(card => card.key));
      const fallingKeys = new Set(report.falling.map(card => card.key));
      for (const key of risingKeys) {
        assert.ok(!fallingKeys.has(key), `${key} should not appear in both rising and falling`);
      }
    });

    it('should drop delta=0 entries from both rising and falling lists', () => {
      const tournaments = [tournament('t1', '2023-01-01', 20), tournament('t2', '2023-01-02', 20)];
      // Flat card: same share both events
      const decks = [
        deck('t1', 'A', [{ name: 'Flat', set: 'SVI', number: '1' }]),
        deck('t2', 'A', [{ name: 'Flat', set: 'SVI', number: '1' }])
      ];
      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 5 });
      assert.ok(!report.rising.some(card => card.name === 'Flat'));
      assert.ok(!report.falling.some(card => card.name === 'Flat'));
    });

    // P-27: appearances must be the number of events the card was present in,
    // not the total number of events in the window.
    it('should report appearances as present-event count, not total events', () => {
      const tournaments = [
        tournament('t1', '2023-01-01', 20),
        tournament('t2', '2023-01-15', 20),
        tournament('t3', '2023-01-29', 20)
      ];
      // Riser present in t1 and t3 only (2 of 3 events).
      const decks = [
        deck('t1', 'A', [{ name: 'Riser', set: 'SVI', number: '1' }]),
        ...Array.from({ length: 10 }, () => deck('t3', 'A', [{ name: 'Riser', set: 'SVI', number: '1' }]))
      ];

      const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1, topCount: 5 });
      const riser = [...report.rising, ...report.falling].find(card => card.name === 'Riser');
      assert.ok(riser, 'Riser should appear in the trend report');
      assert.strictEqual(riser!.appearances, 2, 'appearances should count only present events (2 of 3)');
    });
  });
});

describe('buildTrendReport signal guards', () => {
  it('drops days under the deck floor from every timeline', () => {
    const tournaments = [
      tournament('big', '2026-08-20T18:00:00Z', 2),
      tournament('tiny', '2026-08-21T18:00:00Z', 1),
      tournament('big2', '2026-08-22T18:00:00Z', 2)
    ];
    const decks = [
      deck('big', 'Deck A'),
      deck('big', 'Deck B'),
      deck('tiny', 'Deck A'),
      deck('big2', 'Deck A'),
      deck('big2', 'Deck B')
    ];

    const report = buildTrendReport(decks, tournaments, { minAppearances: 1, minDayDecks: 2 });
    for (const series of report.series) {
      assert.deepStrictEqual(
        series.timeline.map(point => point.date),
        ['2026-08-20', '2026-08-22'],
        `${series.displayName} should skip the one-deck day`
      );
    }
    // The floor removes days from the chart, not decks from the totals.
    assert.strictEqual(report.deckTotal, 5);
  });

  it('leaves the Other bucket out of the series', () => {
    const tournaments = [tournament('t1', '2026-08-20T18:00:00Z', 3)];
    const decks = [deck('t1', 'Deck A'), deck('t1', 'Other'), deck('t1', 'Unknown')];

    const report = buildTrendReport(decks, tournaments, { minAppearances: 1 });
    assert.deepStrictEqual(
      report.series.map(series => series.displayName),
      ['Deck A']
    );
    // Bucket decks still sit in the denominator: Deck A is 1 of 3.
    assert.strictEqual(report.series[0].timeline[0].share, 33.33);
  });
});

describe('buildCardTrendReport movers', () => {
  it('weights start and end shares by decks, not by events', () => {
    // First third: one 100-deck event with the card in 10 decks (10%) and one
    // 2-deck pod with the card in both (100%). Unweighted that averaged to
    // 55%; weighted it is 12 of 102.
    const tournaments = [
      tournament('open', '2026-08-01T18:00:00Z', 100),
      tournament('pod', '2026-08-02T18:00:00Z', 2),
      tournament('mid', '2026-08-10T18:00:00Z', 10),
      tournament('mid2', '2026-08-11T18:00:00Z', 10),
      tournament('late', '2026-08-20T18:00:00Z', 100),
      tournament('late2', '2026-08-21T18:00:00Z', 100)
    ];
    const card = { name: 'Switch', set: 'MEG', number: '130' };
    const decks = [
      ...Array.from({ length: 10 }, () => deck('open', 'A', [card])),
      ...Array.from({ length: 90 }, () => deck('open', 'A')),
      deck('pod', 'A', [card]),
      deck('pod', 'A', [card]),
      ...Array.from({ length: 10 }, () => deck('mid', 'A')),
      ...Array.from({ length: 10 }, () => deck('mid2', 'A')),
      ...Array.from({ length: 30 }, () => deck('late', 'A', [card])),
      ...Array.from({ length: 70 }, () => deck('late', 'A')),
      ...Array.from({ length: 30 }, () => deck('late2', 'A', [card])),
      ...Array.from({ length: 70 }, () => deck('late2', 'A'))
    ];

    const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1 });
    const switchCard = report.rising.find(item => item.name === 'Switch');
    assert.ok(switchCard, 'Switch should be rising');
    assert.strictEqual(switchCard.startShare, 11.8);
    assert.strictEqual(switchCard.endShare, 30);
    assert.strictEqual(switchCard.delta, 18.2);
  });

  it('collapses an evolution line that moves together into its final stage', () => {
    const tournaments = [
      tournament('t1', '2026-08-01T18:00:00Z', 10),
      tournament('t2', '2026-08-10T18:00:00Z', 10),
      tournament('t3', '2026-08-20T18:00:00Z', 10)
    ];
    const line = [
      { name: "Marnie's Impidimp", set: 'DRI', number: '134' },
      { name: "Marnie's Morgrem", set: 'DRI', number: '135' },
      { name: "Marnie's Grimmsnarl ex", set: 'DRI', number: '136' }
    ];
    const other = { name: 'Air Balloon', set: 'ASC', number: '181' };
    const decks = [
      ...Array.from({ length: 5 }, () => deck('t1', 'A', [...line, other])),
      ...Array.from({ length: 5 }, () => deck('t1', 'A')),
      ...Array.from({ length: 10 }, () => deck('t2', 'A')),
      ...Array.from({ length: 10 }, () => deck('t3', 'A'))
    ];

    const report = buildCardTrendReport(decks, tournaments, { minAppearances: 1 });
    // The three DRI cards collapse to the final stage. Air Balloon shares the
    // timeline but not the set, so it stays its own row.
    assert.deepStrictEqual(report.falling.map(item => item.name).sort(), ['Air Balloon', "Marnie's Grimmsnarl ex"]);
    assert.strictEqual(report.cardsAnalyzed, 4);
  });
});
