import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCardTrendDataset, buildTrendDataset } from '../../src/utils/trendAggregator.ts';

test('buildTrendDataset filters by success tag and computes share', () => {
  const tournaments = [
    { id: 't1', name: 'Event One', date: '2025-01-01' },
    { id: 't2', name: 'Event Two', date: '2025-02-01' }
  ];
  const decks = [
    { tournamentId: 't1', tournamentName: 'Event One', archetype: 'Mew', successTags: ['winner'] },
    { tournamentId: 't1', tournamentName: 'Event One', archetype: 'Mew', successTags: ['top8'] },
    { tournamentId: 't2', tournamentName: 'Event Two', archetype: 'Mew', successTags: ['winner'] },
    { tournamentId: 't2', tournamentName: 'Event Two', archetype: 'Gardevoir', successTags: ['top8'] }
  ];

  const dataset = buildTrendDataset(decks, tournaments, {
    minAppearances: 1,
    successFilter: 'winner',
    now: '2025-03-01'
  });

  assert.equal(dataset.deckTotal, 2);
  assert.equal(dataset.series.length, 1);
  assert.equal(dataset.series[0].displayName, 'Mew');
  assert.deepEqual(
    dataset.series[0].timeline.map(entry => entry.share),
    [100, 100]
  );
});

test('buildTrendDataset backfills missing tournaments and uses weighted share', () => {
  const tournaments = [
    { id: 't1', name: 'Event One', date: '2025-01-01' },
    { id: 't2', name: 'Event Two', date: '2025-01-02' }
  ];
  const decks = [
    { tournamentId: 't1', tournamentName: 'Event One', archetype: 'Mew', successTags: ['top8'] },
    { tournamentId: 't1', tournamentName: 'Event One', archetype: 'Pikachu', successTags: ['top8'] },
    { tournamentId: 't2', tournamentName: 'Event Two', archetype: 'Pikachu', successTags: ['top8'] }
  ];

  const dataset = buildTrendDataset(decks, tournaments, {
    minAppearances: 1,
    now: '2025-03-01'
  });

  const mew = dataset.series.find(series => series.displayName === 'Mew');
  assert.ok(mew, 'Mew series should exist');
  assert.equal(mew!.timeline.length, 2);
  assert.equal(mew!.appearances, 1);
  assert.deepEqual(
    mew!.timeline.map(entry => entry.share),
    [50, 0]
  );
  // Weighted share: 1 deck out of 3 total decks across the window = 33.3%
  assert.equal(mew!.avgShare, 33.3);
});

test('buildCardTrendDataset ranks rising and falling cards', () => {
  const tournaments = [
    { id: 't1', date: '2025-01-01', deckTotal: 2 },
    { id: 't2', date: '2025-02-01', deckTotal: 2 },
    { id: 't3', date: '2025-03-01', deckTotal: 2 }
  ];
  const decks = [
    {
      tournamentId: 't1',
      cards: [
        { name: 'Pikachu', set: 'SVI', number: '7' },
        { name: 'Mew', set: 'SVI', number: '10' }
      ]
    },
    {
      tournamentId: 't1',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7' }]
    },
    {
      tournamentId: 't2',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7' }]
    },
    {
      tournamentId: 't3',
      cards: [{ name: 'Mew', set: 'SVI', number: '10' }]
    },
    {
      tournamentId: 't3',
      cards: [{ name: 'Mew', set: 'SVI', number: '10' }]
    }
  ];

  const dataset = buildCardTrendDataset(decks, tournaments, {
    minAppearances: 1,
    topCount: 5,
    now: '2025-04-01'
  });

  // Mew rises (0% → 100% across t1..t3), Pikachu falls (100% → 0%)
  const risingNames = dataset.rising.map(card => card.name);
  const fallingNames = dataset.falling.map(card => card.name);
  assert.ok(risingNames.includes('Mew'), 'Mew should rise');
  assert.ok(fallingNames.includes('Pikachu'), 'Pikachu should fall');
  assert.ok(!risingNames.includes('Pikachu'), 'Pikachu should not be in rising');
  assert.ok(!fallingNames.includes('Mew'), 'Mew should not be in falling');
});

test('buildCardTrendDataset uses recent-window avg, not last-tournament share', () => {
  // Card present in 4/5 events but absent in the latest tournament should still
  // report a non-zero recentAvg (this is the bug behind "Seen in 0% of decks").
  const tournaments = [
    { id: 't1', date: '2025-01-01', deckTotal: 10 },
    { id: 't2', date: '2025-01-08', deckTotal: 10 },
    { id: 't3', date: '2025-01-15', deckTotal: 10 },
    { id: 't4', date: '2025-01-22', deckTotal: 10 },
    { id: 't5', date: '2025-01-29', deckTotal: 10 }
  ];
  const presentDeck = (tid: string) => ({
    tournamentId: tid,
    cards: [{ name: 'Steady', set: 'SVI', number: '1' }]
  });
  const decks = [presentDeck('t1'), presentDeck('t2'), presentDeck('t3'), presentDeck('t4')];
  // t5 has decks with other cards but Steady is absent
  for (let i = 0; i < 5; i += 1) {
    decks.push({ tournamentId: 't5', cards: [{ name: 'Other', set: 'SVI', number: '99' }] });
  }

  const dataset = buildCardTrendDataset(decks, tournaments, {
    minAppearances: 1,
    topCount: 10,
    now: '2025-02-01'
  });
  const all = [...dataset.rising, ...dataset.falling];
  const steady = all.find(card => card.name === 'Steady');
  if (steady) {
    // recentAvg averages the last 1/3 of events; last 2 events here include t4 (10%) + t5 (0%)
    assert.ok(steady.recentAvg > 0, `recentAvg should be > 0 (was ${steady.recentAvg})`);
  }
});

test('buildCardTrendDataset produces disjoint rising and falling lists', () => {
  const tournaments = [
    { id: 't1', date: '2025-01-01', deckTotal: 10 },
    { id: 't2', date: '2025-01-15', deckTotal: 10 },
    { id: 't3', date: '2025-01-29', deckTotal: 10 }
  ];
  const mkDeck = (tid: string, cards: { name: string; set: string; number: string }[]) => ({
    tournamentId: tid,
    cards
  });
  const decks = [
    mkDeck('t1', [{ name: 'Riser', set: 'SVI', number: '1' }]),
    mkDeck('t2', [{ name: 'Riser', set: 'SVI', number: '1' }]),
    mkDeck('t3', [{ name: 'Riser', set: 'SVI', number: '1' }]),
    mkDeck('t3', [{ name: 'Riser', set: 'SVI', number: '1' }]),
    mkDeck('t3', [{ name: 'Riser', set: 'SVI', number: '1' }]),
    mkDeck('t1', [{ name: 'Faller', set: 'SVI', number: '2' }]),
    mkDeck('t1', [{ name: 'Faller', set: 'SVI', number: '2' }]),
    mkDeck('t1', [{ name: 'Faller', set: 'SVI', number: '2' }])
  ];

  const dataset = buildCardTrendDataset(decks, tournaments, {
    minAppearances: 1,
    topCount: 10,
    now: '2025-02-01'
  });

  const risingKeys = new Set(dataset.rising.map(card => card.key));
  const fallingKeys = new Set(dataset.falling.map(card => card.key));
  for (const key of risingKeys) {
    assert.ok(!fallingKeys.has(key), `${key} should not appear in both lists`);
  }
});

test('buildCardTrendDataset excludes cards with low historical share from falling', () => {
  // A card that briefly appeared at 1 deck in 1 of 100 decks (1%) and disappeared
  // should still be allowed; but a card that was effectively never present should not.
  const tournaments = [
    { id: 't1', date: '2025-01-01', deckTotal: 1000 },
    { id: 't2', date: '2025-01-15', deckTotal: 1000 },
    { id: 't3', date: '2025-01-29', deckTotal: 1000 }
  ];
  // Whisper appeared once in 1000 decks at t1 (0.1% share) -- below MIN_VISIBLE_SHARE
  const decks = [{ tournamentId: 't1', cards: [{ name: 'Whisper', set: 'SVI', number: '99' }] }];

  const dataset = buildCardTrendDataset(decks, tournaments, {
    minAppearances: 1,
    topCount: 10,
    now: '2025-02-01'
  });

  const fallingNames = dataset.falling.map(card => card.name);
  assert.ok(!fallingNames.includes('Whisper'), 'Whisper had only 0.1% start share, should be excluded');
});
