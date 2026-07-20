/**
 * tests/utils/ptcgio.test.ts
 * Vintage-set image URLs: set-code mapping, zero-stripped numbers, the XY
 * promo number prefix, and tier ordering.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hasPtcgioImages, ptcgioImageUrls, ptcgioSrcset } from '../../src/utils/ptcgio.ts';

test('vintage sets map to their pokemontcg.io ids with zero-stripped numbers', () => {
  assert.deepStrictEqual(ptcgioImageUrls('BS', '094', 'lg'), [
    'https://images.pokemontcg.io/base1/94_hires.png',
    'https://images.pokemontcg.io/base1/94.png'
  ]);
  assert.deepStrictEqual(ptcgioImageUrls('LC', '110', 'lg')[0], 'https://images.pokemontcg.io/base6/110_hires.png');
  assert.deepStrictEqual(ptcgioImageUrls('UF', '095', 'lg')[0], 'https://images.pokemontcg.io/ex10/95_hires.png');
});

test('small tiers lead with the plain scan; case-insensitive set codes', () => {
  assert.deepStrictEqual(ptcgioImageUrls('sw', 127, 'xs'), [
    'https://images.pokemontcg.io/dp3/127.png',
    'https://images.pokemontcg.io/dp3/127_hires.png'
  ]);
});

test('XY promo numbers get the XY prefix', () => {
  assert.strictEqual(ptcgioImageUrls('XYP', '027', 'sm')[0], 'https://images.pokemontcg.io/xyp/XY27.png');
});

test('modern sets are not claimed', () => {
  assert.strictEqual(hasPtcgioImages('MEG'), false);
  assert.strictEqual(hasPtcgioImages('SFA'), false);
  assert.deepStrictEqual(ptcgioImageUrls('MEG', '114', 'lg'), []);
  assert.strictEqual(ptcgioSrcset('MEG', '114'), null);
});

test('srcset offers both scans with width descriptors', () => {
  assert.strictEqual(
    ptcgioSrcset('BS', '094'),
    'https://images.pokemontcg.io/base1/94.png 245w, https://images.pokemontcg.io/base1/94_hires.png 735w'
  );
});
