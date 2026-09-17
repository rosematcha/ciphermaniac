/**
 * Pricing packs the cheapest way the sealed list allows.
 *
 * The fixtures are two real TCGplayer markets that pull in opposite
 * directions: 151 singles undercut every product that holds them, while
 * Pitch Black's box undercuts its singles and its case undercuts the box.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { cheapestCost, cheapestPerPack } from '../../shared/packEv/cost.ts';
import type { SealedProduct } from '../../shared/packEv/types.ts';

function sealed(kind: SealedProduct['kind'], packs: number, price: number | null): SealedProduct {
  return { kind, label: kind, id: packs, packs, price, url: 'https://example.invalid' };
}

const MEW = [sealed('etb', 9, 531.31), sealed('bundle', 6, 174.32), sealed('pack', 1, 26.71)];

const PBL = [
  sealed('case', 216, 1051.84),
  sealed('box', 36, 192.11),
  sealed('etb', 9, 72.19),
  sealed('bundle', 6, 39.54),
  sealed('pack', 1, 5.93)
];

function cents(value: number | null): string | undefined {
  return value?.toFixed(2);
}

test('a 151 bundle is priced as six singles, which undercut it', () => {
  assert.equal(cents(cheapestCost(MEW, 6)), '160.26');
  assert.equal(cents(cheapestCost(MEW, 36)), '961.56');
});

test('a Pitch Black box is priced as the box, and a case as the case', () => {
  assert.equal(cents(cheapestCost(PBL, 1)), '5.93');
  assert.equal(cents(cheapestCost(PBL, 6)), '35.58');
  assert.equal(cents(cheapestCost(PBL, 36)), '192.11');
  assert.equal(cents(cheapestCost(PBL, 216)), '1051.84');
});

test('products mix when no single product gets there cheapest', () => {
  // A box of 36 can't be split, so 42 packs is the box plus a bundle's six singles.
  assert.equal(cents(cheapestCost(PBL, 42)), cents(192.11 + 6 * 5.93));
});

test('an unpriced product is skipped, and packs nothing can buy have no price', () => {
  const noSingles = [sealed('box', 36, 192.11), sealed('pack', 1, null)];
  assert.equal(cheapestCost(noSingles, 6), null);
  assert.equal(cents(cheapestCost(noSingles, 72)), '384.22');
  assert.equal(cheapestCost([], 1), null);
});

test('the headline cost per pack is the cheapest product per pack', () => {
  assert.equal(cheapestPerPack(MEW)?.product.kind, 'pack');
  assert.equal(cheapestPerPack(MEW)?.costPerPack, 26.71);
  assert.equal(cheapestPerPack(PBL)?.product.kind, 'case');
  assert.equal(cents(cheapestPerPack(PBL)?.costPerPack ?? null), '4.87');
  assert.equal(cheapestPerPack([sealed('box', 36, null)]), null);
});
