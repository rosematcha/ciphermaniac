/**
 * tests/utils/ptcgio.test.ts
 * Vintage-set image URLs: set-code mapping, zero-stripped numbers, the XY
 * promo number prefix, and tier ordering.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hasPtcgioImages, ptcgioImageUrls, ptcgioScanUrls, ptcgioSrcset } from '../../src/utils/ptcgio.ts';

/**
 * The same-origin proxy leads because pokemontcg.io sends no
 * `Access-Control-Allow-Origin`: a hotlinked scan paints, but the tier list's
 * rasteriser cannot read it back, so every vintage print exported as an empty
 * frame. The direct URLs stay on as a display fallback.
 */
test('vintage sets map to their pokemontcg.io ids with zero-stripped numbers, proxy first', () => {
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

/**
 * Every pre-BLW set in the set catalog that Limitless's CDN lacks. The HGSS
 * sets (HS through CL, HSP) are on that CDN and stay off this list; Rumble is
 * not. Each id was read off the Limitless card page and, where the API
 * answered, matched there too (2026-10-27): P4 10 is Scramble Energy on both.
 */
test('the POP series, promos and the older WotC sets are mapped', () => {
  const expected: Record<string, string> = {
    P1: 'pop1',
    P2: 'pop2',
    P3: 'pop3',
    P4: 'pop4',
    P6: 'pop6',
    P7: 'pop7',
    P9: 'pop9',
    NP: 'np',
    WP: 'basep',
    BG: 'bp',
    RM: 'ru1',
    E3: 'ecard3',
    N2: 'neo2',
    N3: 'neo3',
    N4: 'neo4',
    SI: 'si1',
    TR: 'base5'
  };
  for (const [set, id] of Object.entries(expected)) {
    assert.strictEqual(ptcgioImageUrls(set, '010', 'sm')[0], `/thumbnails/ptcgio/${id}/10`, set);
  }
  for (const set of ['HS', 'UL', 'UD', 'TM', 'CL', 'HSP', 'BLW', 'BWP']) {
    assert.strictEqual(hasPtcgioImages(set), false, `${set} is on the Limitless CDN`);
  }
});

test('scan URLs for the R2 mirror are direct, hi-res first', () => {
  assert.deepStrictEqual(ptcgioScanUrls('p4', '010'), [
    'https://images.pokemontcg.io/pop4/10_hires.png',
    'https://images.pokemontcg.io/pop4/10.png'
  ]);
  assert.deepStrictEqual(ptcgioScanUrls('DPP', '046'), [
    'https://images.pokemontcg.io/dpp/DP46_hires.png',
    'https://images.pokemontcg.io/dpp/DP46.png'
  ]);
  assert.deepStrictEqual(ptcgioScanUrls('MEG', '114'), []);
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
