import { GRANULARITY_MIN_PERCENT } from '../constants.js';
import { deriveCategorySlug, getCategorySortWeight, getUsagePercent, toLower } from '../cardCategories.js';
import { sortedItemsCache } from '../state.js';
import type { CardItemData } from '../types.js';

function sortItemsForDisplayInternal(items: CardItemData[]): CardItemData[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const decorated = items.map((card, index) => {
    const categorySlug = deriveCategorySlug(card);
    const weight = getCategorySortWeight(categorySlug);
    const rank = Number.isFinite(card?.rank) ? Number(card.rank) : index;
    const usage = getUsagePercent(card);
    return {
      card,
      categorySlug,
      weight,
      rank,
      usage,
      index
    };
  });

  decorated.sort((left, right) => {
    if (left.weight !== right.weight) {
      return left.weight - right.weight;
    }
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    if (right.usage !== left.usage) {
      return right.usage - left.usage;
    }
    const leftName = toLower(left.card?.name);
    const rightName = toLower(right.card?.name);
    if (leftName && rightName && leftName !== rightName) {
      return leftName.localeCompare(rightName);
    }
    return left.index - right.index;
  });

  return decorated.map(entry => {
    if (!entry.card) {
      return entry.card;
    }
    if (entry.card.category === entry.categorySlug) {
      return entry.card;
    }
    return { ...entry.card, category: entry.categorySlug };
  });
}

/**
 * Sort card items for display ordering.
 * @param items - Card items to sort.
 */
export function sortItemsForDisplay(items: CardItemData[]): CardItemData[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const cached = sortedItemsCache.get(items);
  if (cached) {
    return cached;
  }
  const sorted = sortItemsForDisplayInternal(items);
  sortedItemsCache.set(items, sorted);
  return sorted;
}

/**
 * Filter items by the usage threshold, if set.
 * @param items - Card items to filter.
 * @param threshold - Minimum percent threshold.
 */
export function filterItemsByThreshold(items: CardItemData[], threshold: number | null): CardItemData[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const numericThreshold = Number.isFinite(threshold) ? Number(threshold) : GRANULARITY_MIN_PERCENT;
  const filtered = items.filter(item => getUsagePercent(item) >= numericThreshold);
  if (filtered.length === 0 && items.length > 0) {
    return [items[0]];
  }
  return filtered;
}
