import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type Deck,
  filterDecks,
  filterDecksBySuccess,
  generateReportForFilters
} from '../../shared/clientSideFiltering.ts';

function makeDeck(overrides: Partial<Deck>): Deck {
  return {
    id: 'deck',
    archetype: 'Mew',
    cards: [],
    ...overrides
  } as Deck;
}

test('generateReportForFilters narrows decks by archetype and quantity', () => {
  const decks: Deck[] = [
    makeDeck({
      id: 'd1',
      archetype: 'Mew',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }]
    }),
    makeDeck({
      id: 'd2',
      archetype: 'Mew',
      cards: [
        { name: 'Pikachu', set: 'SVI', number: '7', count: 1 },
        { name: 'Eevee', set: 'SVI', number: '8', count: 1 }
      ]
    }),
    makeDeck({
      id: 'd3',
      archetype: 'Gardevoir',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 4 }]
    })
  ];

  const report = generateReportForFilters(decks, 'Mew', [{ cardId: 'SVI~007', operator: '>=', count: 2 }]);

  assert.equal(report.deckTotal, 1);
  assert.ok(report.items.length > 0);
  assert.equal(report.raw?.generatedClientSide, true);
});

test('filterDecks returns the same subset generateReportForFilters aggregates', () => {
  const decks: Deck[] = [
    makeDeck({ id: 'd1', archetype: 'Mew', cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }] }),
    makeDeck({ id: 'd2', archetype: 'Mew', cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 1 }] }),
    makeDeck({ id: 'd3', archetype: 'Gardevoir', cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 4 }] })
  ];
  const filters = [{ cardId: 'SVI~007', operator: '>=', count: 2 }];

  const matched = filterDecks(decks, 'Mew', filters);
  const report = generateReportForFilters(decks, 'Mew', filters);

  assert.deepEqual(
    matched.map(d => d.id),
    ['d1']
  );
  assert.equal(matched.length, report.deckTotal);
});

test('filterDecks with no filters returns every archetype deck', () => {
  const decks: Deck[] = [
    makeDeck({ id: 'd1', archetype: 'Mew' }),
    makeDeck({ id: 'd2', archetype: 'Mew' }),
    makeDeck({ id: 'd3', archetype: 'Gardevoir' })
  ];
  assert.deepEqual(
    filterDecks(decks, 'Mew', []).map(d => d.id),
    ['d1', 'd2']
  );
});

test('filterDecksBySuccess derives success tags from placement data', () => {
  const decks: Deck[] = [
    makeDeck({ id: 'winner', placement: 1, tournamentPlayers: 32, tournamentId: 'A' }),
    makeDeck({ id: 'mid', placement: 12, tournamentPlayers: 32, tournamentId: 'A' }),
    makeDeck({ id: 'tagged', successTags: ['top8'], tournamentId: 'B' })
  ];

  const filtered = filterDecksBySuccess(decks, 'top8');
  const ids = filtered.map(deck => deck.id).sort();
  assert.deepEqual(ids, ['tagged', 'winner']);
});

test('one deck with two printings of the same cardId counts once (pct <= 100)', () => {
  // After canonicalization, two variant printings of one card share a cardId.
  // The aggregator must credit the deck's presence once — never >100% playrate —
  // while summing the copies for the count distribution.
  const decks: Deck[] = [
    makeDeck({
      id: 'd1',
      archetype: 'Mew',
      cards: [
        { name: 'Dragapult ex', set: 'PRE', number: '073', count: 2 },
        { name: 'Dragapult ex', set: 'PRE', number: '073', count: 1 }
      ]
    })
  ];

  const report = generateReportForFilters(decks, 'Mew', []);
  const item = report.items.find(i => i.cardId === 'PRE~073');
  assert.ok(item, 'canonical card should be present');
  assert.equal(item!.found, 1, 'presence counts the deck once, not per printing');
  assert.ok(item!.pct <= 100, `pct must not exceed 100, got ${item!.pct}`);
  // Copies summed across the duplicate rows land in one distribution bucket.
  const threeCopyBucket = item!.dist.find(d => d.copies === 3);
  assert.ok(threeCopyBucket, 'summed copies (2 + 1) should form a 3-copy bucket');
  assert.equal(threeCopyBucket!.players, 1);
});

test('filterDecksBySuccess throws on unknown tags instead of silently matching all', () => {
  const decks: Deck[] = [makeDeck({ id: 'd1' }), makeDeck({ id: 'd2' })];
  // A typo'd bucket used to return every deck (silently broadening results);
  // it must now reject loudly so callers can 400 rather than mislead.
  assert.throws(() => filterDecksBySuccess(decks, 'unknown'), /Unknown success filter/);
});
