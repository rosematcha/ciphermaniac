import test from 'node:test';
import assert from 'node:assert/strict';

import { cropFrame } from '../../src/components/cardCropFrame.ts';
import type { CardItem } from '../../src/types';

const row = (fields: Partial<CardItem>): CardItem => ({ name: 'Card', found: 1, total: 1, pct: 100, ...fields });

test('a Filters-tab row frames from its energy or trainer type when the category is bare', () => {
  assert.equal(
    cropFrame(row({ name: 'Neo Upper Energy', category: 'energy', energyType: 'special' })),
    'energy-special'
  );
  assert.equal(cropFrame(row({ name: 'Psychic Energy', category: 'energy', energyType: 'basic' })), 'energy-basic');
  assert.equal(cropFrame(row({ name: 'Mystery Trainer', supertype: 'Trainer' })), 'trainer');
  assert.equal(cropFrame(row({ name: 'Rare Candy', trainerType: 'item' })), 'trainer');
});
