/**
 * Search, sort, and filter controls for the card grid
 * @module Controls
 */

import { render } from './render.js';
import { logger } from './utils/logger.js';
import { CONFIG } from './config.js';
import { getCardPrice } from './api.js';
import { normalizeSetCode, readCardType, readSelectedSets } from './utils/filterState.js';

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
  const selectedSets = readSelectedSets();
  const cardType = readCardType();

  return {
    query: searchInput?.value?.trim()?.toLowerCase() || '',
    sort: sortSelect?.value || 'percent-desc',
    sets: selectedSets,
    cardType
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
    if (!item.name) {
      return false;
    }

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

  logger.debug(`Search filtered ${items.length} items to ${filtered.length}`, {
    query
  });
  return filtered;
}

/**
 * Extract all known set codes for a card item.
 * @param {any} item
 * @returns {Set<string>}
 */
function extractItemSets(item) {
  const sets = new Set();
  if (item.set) {
    sets.add(normalizeSetCode(item.set));
  }
  if (typeof item.uid === 'string' && item.uid.includes('::')) {
    const [, setCode] = item.uid.split('::');
    if (setCode) {
      sets.add(normalizeSetCode(setCode));
    }
  }
  return sets;
}

/**
 * Check if an item matches the active set filter.
 * @param {any} item
 * @param {string[]} activeSets
 * @returns {boolean}
 */
function matchesSetFilter(item, activeSets = []) {
  if (!Array.isArray(activeSets) || activeSets.length === 0) {
    return true;
  }
  const itemSets = extractItemSets(item);
  if (itemSets.size === 0) {
    return false;
  }
  return activeSets.some(setCode => itemSets.has(setCode));
}

/**
 * Determine whether an item matches the requested card type filter.
 * @param {any} item
 * @param {string} cardType
 * @returns {boolean}
 */
function matchesCardType(item, cardType) {
  if (!cardType || cardType === '__all__' || cardType === 'any') {
    return true;
  }

  const getBaseCategory = value => {
    const slug = typeof value === 'string' ? value.toLowerCase() : '';
    return slug.split('/')[0] || '';
  };
  const category = getBaseCategory(item.category);
  const trainerType = (item.trainerType || '').toLowerCase();
  const energyType = (item.energyType || '').toLowerCase();

  if (cardType === 'pokemon') {
    return category === 'pokemon';
  }

  if (cardType === 'trainer') {
    return category === 'trainer';
  }

  if (cardType.startsWith('trainer:')) {
    const subtype = cardType.split(':')[1];
    return category === 'trainer' && trainerType === subtype;
  }

  if (cardType === 'energy') {
    return category === 'energy';
  }

  if (cardType.startsWith('energy:')) {
    const subtype = cardType.split(':')[1];
    return category === 'energy' && energyType === subtype;
  }

  return true;
}

/**
 * Apply advanced filters (set, type, etc.) to the items list.
 * @param {any[]} items
 * @param {{ sets?: string[], cardType?: string }} filters
 * @returns {any[]}
 */
function applyAdvancedFilters(items, filters) {
  return items.filter(item => matchesSetFilter(item, filters.sets) && matchesCardType(item, filters.cardType));
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
  filtered = applyAdvancedFilters(filtered, filters);

  // Enrich with pricing data if needed for sorting
  if (filters.sort.startsWith('price-')) {
    filtered = await enrichWithPricingData(filtered);
  }

  // Apply sorting
  const sorted = applySorting(filtered, filters.sort);

  logger.info(`Filtered and sorted: ${allItems.length} -> ${sorted.length} items`);

  // Render the results
  render(sorted, overrides, {
    showPrice: filters.sort.startsWith('price-')
  });
}

/**
 * Enrich items with pricing data for sorting
 * @param {any[]} items
 * @returns {Promise<any[]>}
 */
async function enrichWithPricingData(items) {
  const enriched = await Promise.all(
    items.map(async item => {
      try {
        // Build card identifier from item data
        const cardId = buildCardIdentifier(item);
        const price = cardId ? await getCardPrice(cardId) : null;

        const normalizedPrice = typeof price === 'number' && Number.isFinite(price) ? price : null;

        return {
          ...item,
          price: normalizedPrice
        };
      } catch (error) {
        logger.debug(`Failed to get price for ${item.name}`, error.message);
        return {
          ...item,
          price: null
        };
      }
    })
  );

  return enriched;
}

/**
 * Build card identifier from item data
 * @param {object} item
 * @returns {string|null}
 */
function buildCardIdentifier(item) {
  if (!item.name) {
    return null;
  }

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
