/**
 * The R2 mirror's source per tier: Limitless's pre-sized PNG for the sets it
 * carries, pokemontcg.io's scan resized to the tier for the vintage sets it
 * lacks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { tierSource } from '../../scripts/cardImageSource.ts';

test('a set on the Limitless CDN mirrors its pre-sized tier as is', () => {
  assert.deepEqual(tierSource('SVI', '181', 'SM'), {
    urls: ['https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVI/SVI_181_R_EN_SM.png'],
    width: null
  });
});

test('a vintage set mirrors the pokemontcg.io scan, resized to the Limitless tier width', () => {
  const scans = ['https://images.pokemontcg.io/ex7/19_hires.png', 'https://images.pokemontcg.io/ex7/19.png'];
  assert.deepEqual(tierSource('TRR', '019', 'XS'), { urls: scans, width: 136 });
  assert.deepEqual(tierSource('TRR', '019', 'SM'), { urls: scans, width: 274 });
  assert.deepEqual(tierSource('TRR', '019', 'LG'), { urls: scans, width: 460 });
});

test('a newly mapped POP series set no longer falls through to the Limitless CDN', () => {
  assert.equal(tierSource('P4', '010', 'LG').urls[0], 'https://images.pokemontcg.io/pop4/10_hires.png');
});
