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
    '/thumbnails/ptcgio/base1/94_hires',
    '/thumbnails/ptcgio/base1/94',
    'https://images.pokemontcg.io/base1/94_hires.png',
    'https://images.pokemontcg.io/base1/94.png'
  ]);
  assert.deepStrictEqual(ptcgioImageUrls('LC', '110', 'lg')[0], '/thumbnails/ptcgio/base6/110_hires');
  assert.deepStrictEqual(ptcgioImageUrls('UF', '095', 'lg')[0], '/thumbnails/ptcgio/ex10/95_hires');
});

test('small tiers lead with the plain scan; case-insensitive set codes', () => {
  assert.deepStrictEqual(ptcgioImageUrls('sw', 127, 'xs'), [
    '/thumbnails/ptcgio/dp3/127',
    '/thumbnails/ptcgio/dp3/127_hires',
    'https://images.pokemontcg.io/dp3/127.png',
    'https://images.pokemontcg.io/dp3/127_hires.png'
  ]);
});

/**
 * The proxy leads because pokemontcg.io sends no `Access-Control-Allow-Origin`:
 * a hotlinked scan paints, but the tier list's rasteriser cannot read it back,
 * so every vintage print exported as an empty frame. The direct URLs stay on as
 * a display fallback.
 */
test('the same-origin proxy leads and the hotlinks trail it', () => {
  const urls = ptcgioImageUrls('BS', '094', 'sm');
  assert.ok(
    urls.slice(0, 2).every(u => u.startsWith('/thumbnails/ptcgio/')),
    urls.join(' ')
  );
  assert.ok(
    urls.slice(2).every(u => u.startsWith('https://images.pokemontcg.io/')),
    urls.join(' ')
  );
});

test('XY promo numbers get the XY prefix', () => {
  assert.strictEqual(ptcgioImageUrls('XYP', '027', 'sm')[0], '/thumbnails/ptcgio/xyp/XY27');
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
    '/thumbnails/ptcgio/base1/94 245w, /thumbnails/ptcgio/base1/94_hires 735w'
  );
});
