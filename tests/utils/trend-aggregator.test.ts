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
    }
  ];

  const dataset = buildCardTrendDataset(decks, tournaments, {
    minAppearances: 1,
    topCount: 1,
    now: '2025-04-01'
  });

  assert.equal(dataset.rising.length, 1);
  assert.equal(dataset.falling.length, 1);
  assert.equal(dataset.rising[0].name, 'Mew');
  assert.equal(dataset.falling[0].name, 'Pikachu');
  assert.equal(dataset.rising[0].delta, 0);
  assert.equal(dataset.falling[0].delta, -100);
});
