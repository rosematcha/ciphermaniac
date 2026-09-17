/**
 * What packs cost, bought the cheapest way the sealed list allows.
 *
 * No product is "the" price of a pack. A 151 Elite Trainer Box runs twice a
 * single pack's price per pack, while a Pitch Black box undercuts its singles,
 * so every cost the tool shows comes from whichever mix of priced products
 * buys the packs for least.
 * @module shared/packEv/cost
 */

import type { SealedProduct } from './types';

type PricedProduct = SealedProduct & { price: number };

function priced(sealed: SealedProduct[]): PricedProduct[] {
  return sealed.filter((product): product is PricedProduct => product.price !== null && product.packs > 0);
}

/**
 * The least it costs to buy exactly `packs` packs, or null when no mix of
 * priced products adds up to that many.
 *
 * Exact rather than at-least: the opener rips the packs it pays for, so a
 * bundle's six packs can't be priced as a box with thirty left over.
 */
export function cheapestCost(sealed: SealedProduct[], packs: number): number | null {
  const products = priced(sealed);
  const best = [0];
  for (let count = 1; count <= packs; count += 1) {
    best[count] = products.reduce(
      (least, product) =>
        product.packs <= count ? Math.min(least, best[count - product.packs] + product.price) : least,
      Infinity
    );
  }
  return Number.isFinite(best[packs]) ? best[packs] : null;
}

export interface CheapestPack {
  product: SealedProduct;
  costPerPack: number;
}

/** The product with the lowest price per pack, or null when nothing is priced. */
export function cheapestPerPack(sealed: SealedProduct[]): CheapestPack | null {
  let cheapest: CheapestPack | null = null;
  for (const product of priced(sealed)) {
    const costPerPack = product.price / product.packs;
    if (!cheapest || costPerPack < cheapest.costPerPack) {
      cheapest = { product, costPerPack };
    }
  }
  return cheapest;
}
