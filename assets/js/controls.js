/**
 * Search, sort, and filter controls for the card grid
 * @module Controls
 */

import { render } from './render.js';
import { isFavorite } from './favorites.js';
import { logger } from './utils/logger.js';
import { CONFIG } from './config.js';

/**
 * @typedef {Object} SortOption
 * @property {'percent-desc'|'percent-asc'|'alpha-asc'|'alpha-desc'} key
 * @property {string} label
 * @property {(a: any, b: any) => number} compareFn
 */

/**
 * Available sort options with their comparison functions
 * @type {Record<string, (a: any, b: any) => number>}
 */
const SORT_COMPARATORS = {
  'percent-desc': (a, b) => (b.pct ?? -1) - (a.pct ?? -1),
  'percent-asc': (a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity),
  'alpha-asc': (a, b) => a.name.localeCompare(b.name),
  'alpha-desc': (a, b) => b.name.localeCompare(a.name),
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
 * @returns {Object} Current filter state
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
 * @param {Object} [overrides={}] - Thumbnail overrides
 */
export function applyFiltersSort(allItems, overrides = {}) {
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

  // Apply sorting
  const sorted = applySorting(filtered, filters.sort);

  logger.info(`Filtered and sorted: ${allItems.length} → ${sorted.length} items`);

  // Render the results
  render(sorted, overrides);
}
