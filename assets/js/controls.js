/**
 * Search, sort, and filter controls for the card grid
 * @module Controls
 */

import { render } from './render.js';
import { isFavorite } from './favorites.js';
import { logger } from './utils/logger.js';
import { CONFIG } from './config.js';
import { getCardPrice } from './api.js';

/**
 * @typedef {object} SortOption
 * @property {'percent-desc'|'percent-asc'|'alpha-asc'|'alpha-desc'|'price-desc'|'price-asc'} key
 * @property {string} label
 * @property {(a: any, b: any) => number} compareFn
 */

/**
 * Available sort options with their comparison functions
 * @type {Record<string, (a: any, b: any) => number>}
 */
const SORT_COMPARATORS = {
  'percent-desc': (first, second) => (second.pct ?? -1) - (first.pct ?? -1),
  'percent-asc': (first, second) => (first.pct ?? Infinity) - (second.pct ?? Infinity),
  'alpha-asc': (first, second) => first.name.localeCompare(second.name),
  'alpha-desc': (first, second) => second.name.localeCompare(first.name),
  'price-desc': (first, second) => (second.price ?? -1) - (first.price ?? -1),
  'price-asc': (first, second) => (first.price ?? Infinity) - (second.price ?? Infinity)
};

/**
 * Get comparator function for a given sort key
 * @param {string} sortKey
 * @returns {(a: any, b: any) => number}
 */
export function getComparator(sortKey) {
  const comparator = SORT_COMPARATORS[sortKey];
  if (!comparator) {
    logger.warn(`Unknown sort key: ${sortKey}, using default`);
    return SORT_COMPARATORS['percent-desc'];
  }
  return comparator;
}

/**
 * Get current filter and sort values from DOM
 * @returns {object} Current filter state
 */
function getCurrentFilters() {
  const searchInput = document.getElementById('search');
  const sortSelect = document.getElementById('sort');
  const favSelect = document.getElementById('fav-filter');

  return {
    query: searchInput?.value?.trim()?.toLowerCase() || '',
    sort: sortSelect?.value || 'percent-desc',
    favoritesOnly: favSelect?.value === 'fav'
  };
}

/**
 * Apply search filter to items
 * @param {any[]} items
 * @param {string} query
 * @returns {any[]}
 */
function applySearchFilter(items, query) {
  if (!query || query.length < CONFIG.UI.SEARCH_MIN_LENGTH) {
    return items;
  }

  const filtered = items.filter(item => {
    if (!item.name) {return false;}

    // Search in card name
    if (item.name.toLowerCase().includes(query)) {
      return true;
    }

    // Search in UID if it exists
    if (item.uid && item.uid.toLowerCase().includes(query)) {
      return true;
    }

    // Also search in set and number for cards that have them (trainers, energy, pokemon)
    if (item.set && item.set.toLowerCase().includes(query)) {
      return true;
    }

    if (item.number && item.number.toLowerCase().includes(query)) {
      return true;
    }

    // Search in combined "name set number" format
    if (item.set && item.number) {
      const combinedSearch = `${item.name} ${item.set} ${item.number}`.toLowerCase();
      if (combinedSearch.includes(query)) {
        return true;
      }
    }

    return false;
  });

  logger.debug(`Search filtered ${items.length} items to ${filtered.length}`, { query });
  return filtered;
}

/**
 * Apply favorites filter to items
 * @param {any[]} items
 * @param {boolean} favoritesOnly
 * @returns {any[]}
 */
function applyFavoritesFilter(items, favoritesOnly) {
  if (!favoritesOnly) {
    return items;
  }

  const filtered = items.filter(item => isFavorite(item.name));
  logger.debug(`Favorites filtered ${items.length} items to ${filtered.length}`);
  return filtered;
}

/**
 * Apply sorting to items
 * @param {any[]} items
 * @param {string} sortKey
 * @returns {any[]}
 */
function applySorting(items, sortKey) {
  const comparator = getComparator(sortKey);
  const sorted = [...items].sort(comparator);
  logger.debug(`Applied ${sortKey} sorting to ${items.length} items`);
  return sorted;
}

/**
 * Apply all filters and sorting, then render the results
 * @param {any[]} allItems - Complete dataset
 * @param {object} [overrides] - Thumbnail overrides
 */
export async function applyFiltersSort(allItems, overrides = {}) {
  if (!Array.isArray(allItems)) {
    logger.error('applyFiltersSort called with non-array items', allItems);
    return;
  }

  const filters = getCurrentFilters();
  logger.debug('Applying filters and sort', filters);

  let filtered = allItems;

  // Apply filters in sequence
  filtered = applySearchFilter(filtered, filters.query);
  filtered = applyFavoritesFilter(filtered, filters.favoritesOnly);

  // Enrich with pricing data if needed for sorting
  if (filters.sort.startsWith('price-')) {
    filtered = await enrichWithPricingData(filtered);
  }

  // Apply sorting
  const sorted = applySorting(filtered, filters.sort);

  logger.info(`Filtered and sorted: ${allItems.length} → ${sorted.length} items`);

  // Render the results
  render(sorted, overrides);
}

/**
 * Enrich items with pricing data for sorting
 * @param {any[]} items
 * @returns {Promise<any[]>}
 */
async function enrichWithPricingData(items) {
  const enriched = await Promise.all(items.map(async item => {
    try {
      // Build card identifier from item data
      const cardId = buildCardIdentifier(item);
      const price = cardId ? await getCardPrice(cardId) : null;

      return {
        ...item,
        price: price || 0
      };
    } catch (error) {
      logger.debug(`Failed to get price for ${item.name}`, error.message);
      return {
        ...item,
        price: 0
      };
    }
  }));

  return enriched;
}

/**
 * Build card identifier from item data
 * @param {object} item
 * @returns {string|null}
 */
function buildCardIdentifier(item) {
  if (!item.name) {return null;}

  // Try to use UID if available
  if (item.uid) {
    return item.uid;
  }

  // Build from name, set, and number if available
  if (item.set && item.number) {
    const paddedNumber = item.number.toString().padStart(3, '0');
    return `${item.name}::${item.set}::${paddedNumber}`;
  }

  // For trainers/energies without set info, just use name
  return item.name;
}
