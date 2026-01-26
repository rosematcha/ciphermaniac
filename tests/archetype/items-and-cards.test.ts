import test from 'node:test';
import assert from 'node:assert/strict';

import { filterItemsByThreshold, sortItemsForDisplay } from '../../src/archetype/data/items.ts';
import {
  buildCardId,
  buildCardLookup,
  getMaxCopiesForCard,
  isBasicEnergyCard
} from '../../src/archetype/data/cards.ts';
import { CARD_COUNT_BASIC_ENERGY_MAX, CARD_COUNT_DEFAULT_MAX } from '../../src/archetype/constants.js';
import { getState, setState } from '../../src/archetype/state.js';
import type { CardItemData, CardLookupEntry } from '../../src/archetype/types.ts';

const originalState = getState();
const originalAllCards = originalState.allCards;
const originalDefaultDeckTotal = originalState.defaultDeckTotal;
const originalArchetypeDeckTotal = originalState.archetypeDeckTotal;
const originalCardLookup = originalState.cardLookup;

test.afterEach(() => {
  setState({
    allCards: originalAllCards,
    defaultDeckTotal: originalDefaultDeckTotal,
    archetypeDeckTotal: originalArchetypeDeckTotal,
    cardLookup: originalCardLookup
  });
});

test('sortItemsForDisplay orders by category weight and normalizes category', () => {
  const items: CardItemData[] = [
    { name: 'Supporter Card', category: 'Trainer/Supporter', rank: 2, found: 2, total: 10 },
    { name: 'Pokemon Card', category: 'pokemon', rank: 3, found: 6, total: 10 },
    { name: 'Energy Card', category: 'Energy/Basic', rank: 1, found: 9, total: 10 }
  ];

  const sorted = sortItemsForDisplay(items);
  assert.equal(sorted[0].name, 'Pokemon Card');
  assert.equal(sorted[1].name, 'Supporter Card');
  assert.equal(sorted[2].name, 'Energy Card');
  assert.equal(sorted[2].category, 'energy/basic');
  assert.strictEqual(sortItemsForDisplay(items), sorted);
});

test('filterItemsByThreshold filters by percent and falls back to first item', () => {
  const items: CardItemData[] = [
    { name: 'High Usage', found: 8, total: 10 },
    { name: 'Low Usage', found: 1, total: 10 }
  ];

  const filtered = filterItemsByThreshold(items, 50);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'High Usage');

  const fallback = filterItemsByThreshold(items, 90);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].name, 'High Usage');

  assert.equal(filterItemsByThreshold(items, null).length, 2);
});

test('buildCardId normalizes set/number and returns null when invalid', () => {
  const valid = buildCardId({ name: 'Pikachu', set: 'svi', number: '7' } as CardItemData);
  const missingSet = buildCardId({ name: 'Pikachu', set: '', number: '7' } as CardItemData);

  assert.equal(valid, 'SVI~007');
  assert.equal(missingSet, null);
});

test('buildCardLookup populates lookup and getMaxCopiesForCard handles energy rules', () => {
  const cards: CardItemData[] = [
    {
      name: 'Lightning Energy',
      set: 'SVI',
      number: '7',
      found: 10,
      total: 10,
      category: 'Energy/Basic',
      energyType: 'Basic'
    },
    {
      name: 'Switch',
      set: 'SVI',
      number: '8',
      found: 2,
      total: 10,
      category: 'Trainer'
    }
  ];

  setState({ allCards: cards, defaultDeckTotal: 10, archetypeDeckTotal: 0 });

  const lookup = buildCardLookup();
  const energy = lookup.get('SVI~007');
  assert.ok(energy);
  assert.equal(energy?.pct, 100);
  assert.equal(energy?.alwaysIncluded, true);
  assert.equal(energy?.category, 'energy/basic');
  assert.equal(energy?.energyType, 'basic');

  const trainer = lookup.get('SVI~008');
  assert.ok(trainer);
  assert.equal(trainer?.pct, 20);

  assert.equal(getMaxCopiesForCard('SVI~007'), CARD_COUNT_BASIC_ENERGY_MAX);
  assert.equal(getMaxCopiesForCard('SVI~008'), CARD_COUNT_DEFAULT_MAX);
});

test('isBasicEnergyCard recognizes multiple energy signals', () => {
  assert.equal(isBasicEnergyCard({ energyType: 'basic' } as CardLookupEntry), true);
  assert.equal(isBasicEnergyCard({ category: 'energy/basic' } as CardLookupEntry), true);
  assert.equal(isBasicEnergyCard({ category: 'energy', set: 'SVE' } as CardLookupEntry), true);
  assert.equal(isBasicEnergyCard({ category: 'trainer' } as CardLookupEntry), false);
});
