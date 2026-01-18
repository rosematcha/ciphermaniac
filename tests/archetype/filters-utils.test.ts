import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeFilters,
  describeSuccessFilter,
  formatCardOptionLabel,
  getFilterKey,
  getFilterRowCardsData,
  normalizeThreshold
} from '../../src/archetype/filters/utils.ts';
import { filterRowCardsCache, getState, setState } from '../../src/archetype/state.ts';
import type { CardItemData, FilterDescriptor } from '../../src/archetype/types.ts';

const originalCardLookup = getState().cardLookup;

test.afterEach(() => {
  filterRowCardsCache.sourceArray = null;
  filterRowCardsCache.deckTotal = 0;
  filterRowCardsCache.sortedCards = [];
  filterRowCardsCache.duplicateCounts = new Map();
  setState({ cardLookup: originalCardLookup });
});

test('getFilterRowCardsData sorts cards and tracks duplicates', () => {
  const cards: CardItemData[] = [
    { name: 'Pikachu', set: 'SVI', number: '7', found: 10, total: 20 },
    { name: 'Eevee', set: 'SVI', number: '8', found: 3, total: 20 },
    { name: 'Pikachu', set: 'PAL', number: '2', found: 5, total: 20 }
  ];

  const result = getFilterRowCardsData(cards, 20);
  assert.equal(result.sortedCards[0].name, 'Pikachu');
  assert.equal(result.sortedCards[1].name, 'Pikachu');
  assert.equal(result.sortedCards[2].name, 'Eevee');
  assert.equal(result.duplicateCounts.get('Pikachu'), 2);

  const cached = getFilterRowCardsData(cards, 20);
  assert.strictEqual(cached.sortedCards, result.sortedCards);
});

test('formatCardOptionLabel includes set/number when duplicates exist', () => {
  const card: CardItemData = { name: 'Pikachu', set: 'SVI', number: '7' };
  const duplicateCounts = new Map([['Pikachu', 2]]);
  const label = formatCardOptionLabel(card, duplicateCounts);
  assert.equal(label, 'Pikachu (SVI 007)');
});

test('describeFilters and getFilterKey use card lookup labels', () => {
  const cardLookup = new Map([
    [
      'SVI~007',
      {
        id: 'SVI~007',
        name: 'Pikachu',
        set: 'SVI',
        number: '007',
        found: 1,
        total: 1,
        pct: 100,
        alwaysIncluded: false,
        category: null,
        energyType: null
      }
    ],
    [
      'PAL~002',
      {
        id: 'PAL~002',
        name: 'Eevee',
        set: 'PAL',
        number: '002',
        found: 1,
        total: 1,
        pct: 100,
        alwaysIncluded: false,
        category: null,
        energyType: null
      }
    ]
  ]);
  setState({ cardLookup });

  const filters: FilterDescriptor[] = [
    { cardId: 'SVI~007', operator: '>=', count: 2 },
    { cardId: 'PAL~002', operator: 'any', count: null }
  ];

  const description = describeFilters(filters);
  assert.equal(description, 'including Pikachu (at least 2) and Eevee (any count)');

  const key = getFilterKey(filters, 'top8');
  assert.equal(key, 'top8::SVI~007::>=2||PAL~002::any');
});

test('describeSuccessFilter maps known tags', () => {
  assert.equal(describeSuccessFilter('top8'), 'Top 8');
  assert.equal(describeSuccessFilter('all'), '');
});

test('normalizeThreshold clamps and rounds to step size', () => {
  assert.equal(normalizeThreshold(47, 0, 100), 45);
  assert.equal(normalizeThreshold(102, 0, 100), 100);
});
