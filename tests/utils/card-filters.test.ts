import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type CardFilters,
  cardPriceBand,
  countActiveCardFilters,
  matchesCardFilters
} from '../../src/lib/cardFilters.ts';
import type { CardItem } from '../../src/types/index.ts';

const INERT: CardFilters = { type: 'all', subtype: 'all', reg: 'all', aceSpec: false, priceBand: 'all' };

function card(overrides: Partial<CardItem>): CardItem {
  return { name: 'X', found: 1, total: 1, pct: 1, ...overrides };
}

test('cardPriceBand buckets at the documented boundaries', () => {
  assert.equal(cardPriceBand(null), null);
  assert.equal(cardPriceBand(0.5), 'lt1');
  assert.equal(cardPriceBand(1), '1to5');
  assert.equal(cardPriceBand(4.99), '1to5');
  assert.equal(cardPriceBand(5), '5to15');
  assert.equal(cardPriceBand(14.99), '5to15');
  assert.equal(cardPriceBand(15), 'gte15');
  assert.equal(cardPriceBand(120), 'gte15');
});

test('inert filters accept every card', () => {
  assert.equal(matchesCardFilters(card({ category: 'pokemon' }), INERT, null), true);
});

test('type filter uses the supercategory mapping', () => {
  const filters: CardFilters = { ...INERT, type: 'trainer' };
  assert.equal(matchesCardFilters(card({ category: 'trainer/supporter' }), filters, null), true);
  assert.equal(matchesCardFilters(card({ category: 'pokemon' }), filters, null), false);
});

test('contextual subtype only compares the matching field', () => {
  const trainer: CardFilters = { ...INERT, type: 'trainer', subtype: 'item' };
  assert.equal(matchesCardFilters(card({ category: 'trainer', trainerType: 'item' }), trainer, null), true);
  assert.equal(matchesCardFilters(card({ category: 'trainer', trainerType: 'tool' }), trainer, null), false);

  const energy: CardFilters = { ...INERT, type: 'energy', subtype: 'special' };
  assert.equal(matchesCardFilters(card({ category: 'energy', energyType: 'special' }), energy, null), true);
  assert.equal(matchesCardFilters(card({ category: 'energy', energyType: 'basic' }), energy, null), false);
});

test('regulation mark filter excludes cards missing the mark', () => {
  const filters: CardFilters = { ...INERT, reg: 'I' };
  assert.equal(matchesCardFilters(card({ regulationMark: 'I' }), filters, null), true);
  assert.equal(matchesCardFilters(card({ regulationMark: 'H' }), filters, null), false);
  assert.equal(matchesCardFilters(card({}), filters, null), false);
});

test('ace spec toggle requires an explicit true', () => {
  const filters: CardFilters = { ...INERT, aceSpec: true };
  assert.equal(matchesCardFilters(card({ aceSpec: true }), filters, null), true);
  assert.equal(matchesCardFilters(card({ aceSpec: false }), filters, null), false);
  assert.equal(matchesCardFilters(card({}), filters, null), false);
});

test('price band filter excludes unknown prices', () => {
  const filters: CardFilters = { ...INERT, priceBand: '1to5' };
  assert.equal(matchesCardFilters(card({}), filters, 3), true);
  assert.equal(matchesCardFilters(card({}), filters, 9), false);
  assert.equal(matchesCardFilters(card({}), filters, null), false);
});

test('countActiveCardFilters ignores inert facets', () => {
  assert.equal(countActiveCardFilters(INERT), 0);
  assert.equal(
    countActiveCardFilters({ type: 'trainer', subtype: 'item', reg: 'I', aceSpec: true, priceBand: 'gte15' }),
    5
  );
});
