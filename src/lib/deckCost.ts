/**
 * Rough market price of a "typical" list for an archetype: the cards that appear
 * in at least half of lists, each counted at its most common copy count, priced
 * with TCGPlayer market prices.
 *
 * This is deliberately a floor-ish estimate, not a shopping list — it ignores
 * fringe tech and values every card at its modal count. Missing prices (energy,
 * un-indexed reprints) are treated as $0 but still count against a coverage
 * threshold, so a mostly-unpriced list returns null rather than a misleadingly
 * cheap number.
 *
 * Kept free of Solid + DOM so it's unit-testable.
 */
import type { CardItem } from '../types';
import type { PricingEntry } from './data';

/** A card must be in at least this share of lists to count toward the estimate. */
export const INCLUSION_FLOOR = 50;
/** Skip the whole estimate if more than this share of included cards lack a price. */
export const MAX_MISSING_RATIO = 0.2;

export interface DeckCostEstimate {
  /** Summed market price in USD. */
  cost: number;
  includedCount: number;
  missingCount: number;
}

/** Price map key: `Name::SET::NUMBER` (matches `PricingPayload.cardPrices`). */
function priceKey(name: string, set: string, number: string | number): string {
  return `${name}::${set}::${number}`;
}

/** The copy count the most players ran (falls back to 1 with no distribution). */
export function modalCopies(card: CardItem): number {
  const { dist } = card;
  if (!dist || dist.length === 0) {
    return 1;
  }
  let best = dist[0];
  for (const d of dist) {
    if ((d.players ?? 0) > (best.players ?? 0)) {
      best = d;
    }
  }
  return best.copies ?? 1;
}

/**
 * Estimate build cost, or null when the archetype has no cards in ≥
 * {@link INCLUSION_FLOOR}% of lists, or when more than {@link MAX_MISSING_RATIO}
 * of those cards have no price (too little coverage to trust the number).
 */
export function estimateDeckCost(items: CardItem[], prices: Record<string, PricingEntry>): DeckCostEstimate | null {
  const included = items.filter(i => (i.pct ?? 0) >= INCLUSION_FLOOR);
  if (included.length === 0) {
    return null;
  }
  let cost = 0;
  let missing = 0;
  for (const card of included) {
    const key =
      card.set && card.number !== undefined && card.number !== null ? priceKey(card.name, card.set, card.number) : null;
    const price = key ? prices[key]?.price : undefined;
    if (price === undefined || price === null || !Number.isFinite(price)) {
      missing++;
      continue;
    }
    cost += price * modalCopies(card);
  }
  if (missing / included.length > MAX_MISSING_RATIO) {
    return null;
  }
  return { cost, includedCount: included.length, missingCount: missing };
}
