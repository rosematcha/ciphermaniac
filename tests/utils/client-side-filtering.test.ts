import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type Deck,
  filterDecksBySuccess,
  generateFilteredReport,
  generateReportForFilters
} from '../../src/utils/clientSideFiltering.ts';

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

test('filterDecksBySuccess returns input for unknown tags', () => {
  const decks: Deck[] = [makeDeck({ id: 'd1' }), makeDeck({ id: 'd2' })];
  const filtered = filterDecksBySuccess(decks, 'unknown');
  assert.equal(filtered.length, decks.length);
});

test('generateFilteredReport flags client-side generation', () => {
  const decks: Deck[] = [
    makeDeck({
      id: 'd1',
      archetype: 'Mew',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }]
    })
  ];

  const report = generateFilteredReport(decks, 'Mew', 'SVI~007', null, '>=', 2);
  assert.equal(report.generatedClientSide, true);
});
