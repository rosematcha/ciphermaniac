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

test('promo numbers get their set prefix', () => {
  assert.strictEqual(ptcgioImageUrls('XYP', '027', 'sm')[0], '/thumbnails/ptcgio/xyp/XY27');
  // DP promos are where the 2010 format's Garchomp C and Luxray GL live.
  assert.strictEqual(ptcgioImageUrls('DPP', '046', 'sm')[0], '/thumbnails/ptcgio/dpp/DP46');
});

/**
 * The EX and Platinum eras arrived with the tier list's past formats, which
 * rank decks built entirely out of them. Missing one is a whole format of blank
 * tiles, so the boundaries of each era are pinned rather than sampled.
 */
test('the EX and Platinum eras are mapped end to end', () => {
  const ex = ['RS', 'SS', 'DR', 'MA', 'HL', 'RG', 'TRR', 'DX', 'EM', 'UF', 'DS', 'LM', 'HP', 'CG', 'DF', 'PK'];
  const platinum = ['DP', 'MT', 'SW', 'GE', 'MD', 'LA', 'SF', 'PL', 'RR', 'SV', 'AR', 'DPP'];
  for (const set of [...ex, ...platinum]) {
    assert.ok(hasPtcgioImages(set), `${set} unmapped`);
  }
  assert.strictEqual(ptcgioImageUrls('TRR', '019', 'sm')[0], '/thumbnails/ptcgio/ex7/19');
  assert.strictEqual(ptcgioImageUrls('RR', '109', 'sm')[0], '/thumbnails/ptcgio/pl2/109');
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
