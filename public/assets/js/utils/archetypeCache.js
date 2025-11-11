/*
 * Aggressive caching layer for deduplicated archetype include-exclude data.
 *
 * New structure (root-level at r2.ciphermaniac.com):
 * /include-exclude/{tournament}/{archetype}/
 *   index.json              - Master index with filterMap and subsets metadata
 *   unique_subsets/
 *     subset_001.json       - Unique deck subset data
 *     subset_002.json
 *     ...
 */

import { CONFIG } from '../config.js';
import { logger } from './logger.js';
import { AppError, ErrorTypes } from './errorHandler.js';

/**
 * @typedef {object} SubsetData
 * @property {number} deckTotal
 * @property {Array} items
 * @property {object} filters
 * @property {object} source
 */

/**
 * @typedef {object} ArchetypeIndex
 * @property {string} archetype
 * @property {number} deckTotal
 * @property {number} totalCombinations
 * @property {number} uniqueSubsets
 * @property {number} deduplicationRate
 * @property {object} cards - Card metadata
 * @property {Record<string, string>} filterMap - Maps "inc:X|exc:Y" to subset_id
 * @property {object} subsets - Subset metadata
 * @property {string} generatedAt
 */

class ArchetypeCacheManager {
  constructor() {
    /** @type {Map<string, Promise<ArchetypeIndex>>} */
    this.indexCache = new Map();

    /** @type {Map<string, Promise<SubsetData>>} */
    this.subsetCache = new Map();

    /** @type {Map<string, Promise<any>>} */
    this.archetypeReportCache = new Map();

    /** @type {Map<string, number>} */
    this.hoverTimers = new Map();

    /** @type {Set<string>} */
    this.pendingFetches = new Set();

    this.HOVER_DELAY_MS = 200; // 0.2 seconds
  }

  /**
   * Build the candidate base URLs for an archetype's include-exclude directory
   * New path structure: include-exclude/{tournament}/{archetype}/
   * Available at: r2.ciphermaniac.com/include-exclude/{tournament}/{archetype}/
   * @param {string} tournament
   * @param {string} archetypeBase
   * @returns {string[]}
   */
  static getArchetypeBaseUrls(tournament, archetypeBase) {
    const r2Base = (CONFIG.API.R2_BASE || '').trim();
    const suffix = `include-exclude/${encodeURIComponent(tournament)}/${encodeURIComponent(archetypeBase)}`;
    /** @type {Set<string>} */
    const candidates = new Set();

    // Primary: R2 storage at root level
    if (r2Base) {
      const normalizedR2Base = r2Base.replace(/\/+$/, '');
      candidates.add(`${normalizedR2Base}/${suffix}`);
    }

    // Fallback: Relative path (for local development)
    candidates.add(`/${suffix}`);

    return Array.from(candidates);
  }

  /**
   * Build filter key for index.json lookup
   * @param {string|null} includeId - Card ID like "PAL~188"
   * @param {string|null} excludeId - Card ID like "SVI~089"
   * @returns {string}
   */
  static buildFilterKey(includeId, excludeId) {
    const incKey = includeId ? includeId : '';
    const excKey = excludeId ? excludeId : '';
    return `inc:${incKey}|exc:${excKey}`;
  }

  /**
   * Build cache key for index files
   * @param {string} tournament
   * @param {string} archetypeBase
   * @returns {string}
   */
  static getIndexCacheKey(tournament, archetypeBase) {
    return `${tournament}::${archetypeBase}::index`;
  }

  /**
   * Build cache key for subset files
   * @param {string} tournament
   * @param {string} archetypeBase
   * @param {string} subsetId
   * @returns {string}
   */
  static getSubsetCacheKey(tournament, archetypeBase, subsetId) {
    return `${tournament}::${archetypeBase}::${subsetId}`;
  }

  /**
   * Fetch and cache an archetype's index.json
   * @param {string} tournament
   * @param {string} archetypeBase
   * @returns {Promise<ArchetypeIndex>}
   */
  fetchIndex(tournament, archetypeBase) {
    const cacheKey = ArchetypeCacheManager.getIndexCacheKey(tournament, archetypeBase);

    if (this.indexCache.has(cacheKey)) {
      logger.debug(`Index cache hit for ${archetypeBase}`);
      return this.indexCache.get(cacheKey);
    }

    const fetchPromise = (async () => {
      const baseUrls = ArchetypeCacheManager.getArchetypeBaseUrls(tournament, archetypeBase);
      this.pendingFetches.add(cacheKey);

      try {
        let lastError = null;

        for (const baseUrl of baseUrls) {
          const url = `${baseUrl}/index.json`;
          logger.debug(`Fetching index for ${archetypeBase}`, { url });

          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new AppError(ErrorTypes.NETWORK, `HTTP ${response.status}: ${response.statusText}`, null, {
                url,
                status: response.status
              });
            }

            const data = await response.json();
            logger.info(`Loaded index for ${archetypeBase}`, {
              uniqueSubsets: data.uniqueSubsets,
              totalCombinations: data.totalCombinations,
              deduplicationRate: data.deduplicationRate
            });
            return data;
          } catch (error) {
            lastError = error;
            logger.debug(`Index fetch attempt failed for ${archetypeBase}`, {
              url,
              message: error?.message || error
            });
          }
        }

        this.indexCache.delete(cacheKey);
        const message = lastError?.message || `Failed to fetch index for ${archetypeBase}`;
        logger.warn(message);
        throw lastError || new AppError(ErrorTypes.NETWORK, message, null, { tournament, archetypeBase });
      } finally {
        this.pendingFetches.delete(cacheKey);
      }
    })();

    this.indexCache.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Fetch and cache a specific subset
   * @param {string} tournament
   * @param {string} archetypeBase
   * @param {string} subsetId
   * @returns {Promise<SubsetData>}
   */
  fetchSubset(tournament, archetypeBase, subsetId) {
    const cacheKey = ArchetypeCacheManager.getSubsetCacheKey(tournament, archetypeBase, subsetId);

    if (this.subsetCache.has(cacheKey)) {
      logger.debug(`Subset cache hit for ${archetypeBase}/${subsetId}`);
      return this.subsetCache.get(cacheKey);
    }

    const fetchPromise = (async () => {
      const baseUrls = ArchetypeCacheManager.getArchetypeBaseUrls(tournament, archetypeBase);
      this.pendingFetches.add(cacheKey);

      try {
        let lastError = null;

        for (const baseUrl of baseUrls) {
          const url = `${baseUrl}/unique_subsets/${subsetId}.json`;
          logger.debug(`Fetching subset ${subsetId} for ${archetypeBase}`, { url });

          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new AppError(ErrorTypes.NETWORK, `HTTP ${response.status}: ${response.statusText}`, null, {
                url,
                status: response.status
              });
            }

            const data = await response.json();
            logger.info(`Loaded subset ${subsetId} for ${archetypeBase}`, {
              deckTotal: data.deckTotal,
              items: data.items?.length || 0
            });
            return data;
          } catch (error) {
            lastError = error;
            logger.debug(`Subset fetch attempt failed for ${archetypeBase}`, {
              url,
              message: error?.message || error
            });
          }
        }

        this.subsetCache.delete(cacheKey);
        const message = lastError?.message || `Failed to fetch subset ${subsetId} for ${archetypeBase}`;
        logger.warn(message);
        throw (
          lastError ||
          new AppError(ErrorTypes.NETWORK, message, null, {
            tournament,
            archetypeBase,
            subsetId
          })
        );
      } finally {
        this.pendingFetches.delete(cacheKey);
      }
    })();

    this.subsetCache.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Resolve filter combination to subset ID and fetch the data
   * @param {string} tournament
   * @param {string} archetypeBase
   * @param {string|null} includeId
   * @param {string|null} excludeId
   * @returns {Promise<SubsetData>}
   */
  async getFilteredData(tournament, archetypeBase, includeId, excludeId) {
    // First, fetch the index to get the filterMap
    const index = await this.fetchIndex(tournament, archetypeBase);

    // Build the filter key
    const filterKey = ArchetypeCacheManager.buildFilterKey(includeId, excludeId);

    // Look up the subset ID
    const subsetId = index.filterMap[filterKey];
    if (!subsetId) {
      logger.warn(`No subset found for filter combination`, {
        archetype: archetypeBase,
        include: includeId,
        exclude: excludeId,
        filterKey
      });
      throw new AppError(ErrorTypes.PARSE, `Filter combination not found: ${filterKey}`, null, {
        filterKey,
        archetype: archetypeBase
      });
    }

    logger.debug(`Resolved filter to subset`, {
      archetype: archetypeBase,
      filterKey,
      subsetId
    });

    // Fetch the subset data
    return this.fetchSubset(tournament, archetypeBase, subsetId);
  }

  /**
   * Pre-cache an archetype's index.json (triggered by hover)
   * @param {string} tournament
   * @param {string} archetypeBase
   * @returns {Promise<void>}
   */
  async preCacheIndex(tournament, archetypeBase) {
    try {
      await this.fetchIndex(tournament, archetypeBase);
      logger.debug(`Pre-cached index for ${archetypeBase}`);
    } catch (error) {
      // Silent failure for pre-caching
      logger.debug(`Pre-cache index failed for ${archetypeBase}`, error.message);
    }
  }

  /**
   * Pre-resolve a filter combination to subset ID (triggered by hover)
   * Does NOT fetch the subset data yet, just resolves the mapping
   * @param {string} tournament
   * @param {string} archetypeBase
   * @param {string|null} includeId
   * @param {string|null} excludeId
   * @returns {Promise<string|null>} Returns subset ID or null if not found
   */
  async preResolveFilter(tournament, archetypeBase, includeId, excludeId) {
    try {
      const index = await this.fetchIndex(tournament, archetypeBase);
      const filterKey = ArchetypeCacheManager.buildFilterKey(includeId, excludeId);
      const subsetId = index.filterMap[filterKey];

      if (subsetId) {
        logger.debug(`Pre-resolved filter to ${subsetId}`, {
          archetype: archetypeBase,
          filterKey
        });
      }

      return subsetId || null;
    } catch (error) {
      logger.debug(`Pre-resolve filter failed for ${archetypeBase}`, error.message);
      return null;
    }
  }

  /**
   * Start hover timer for archetype (triggers pre-caching after delay)
   * @param {string} tournament
   * @param {string} archetypeBase
   * @param {Function} onTrigger - Optional callback when hover delay expires
   */
  startHoverTimer(tournament, archetypeBase, onTrigger) {
    const key = `${tournament}::${archetypeBase}`;

    // Clear existing timer if any
    this.clearHoverTimer(tournament, archetypeBase);

    const timerId = window.setTimeout(() => {
      logger.debug(`Hover delay expired for ${archetypeBase}, triggering pre-cache`);
      this.preCacheIndex(tournament, archetypeBase);
      if (onTrigger) {
        onTrigger();
      }
    }, this.HOVER_DELAY_MS);

    this.hoverTimers.set(key, timerId);
  }

  /**
   * Clear hover timer for archetype
   * @param {string} tournament
   * @param {string} archetypeBase
   */
  clearHoverTimer(tournament, archetypeBase) {
    const key = `${tournament}::${archetypeBase}`;
    const timerId = this.hoverTimers.get(key);
    if (timerId) {
      window.clearTimeout(timerId);
      this.hoverTimers.delete(key);
    }
  }

  /**
   * Start hover timer for filter option (triggers pre-resolution after delay)
   * @param {string} tournament
   * @param {string} archetypeBase
   * @param {string|null} includeId
   * @param {string|null} excludeId
   */
  startFilterHoverTimer(tournament, archetypeBase, includeId, excludeId) {
    const filterKey = ArchetypeCacheManager.buildFilterKey(includeId, excludeId);
    const key = `${tournament}::${archetypeBase}::filter::${filterKey}`;

    // Clear existing timer if any
    if (this.hoverTimers.has(key)) {
      const existingTimer = this.hoverTimers.get(key);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
    }

    const timerId = window.setTimeout(() => {
      logger.debug(`Filter hover delay expired, pre-resolving ${filterKey}`);
      this.preResolveFilter(tournament, archetypeBase, includeId, excludeId);
    }, this.HOVER_DELAY_MS);

    this.hoverTimers.set(key, timerId);
  }

  /**
   * Clear filter hover timer
   * @param {string} tournament
   * @param {string} archetypeBase
   * @param {string|null} includeId
   * @param {string|null} excludeId
   */
  clearFilterHoverTimer(tournament, archetypeBase, includeId, excludeId) {
    const filterKey = ArchetypeCacheManager.buildFilterKey(includeId, excludeId);
    const key = `${tournament}::${archetypeBase}::filter::${filterKey}`;
    const timerId = this.hoverTimers.get(key);
    if (timerId) {
      window.clearTimeout(timerId);
      this.hoverTimers.delete(key);
    }
  }

  /**
   * Get cache statistics
   * @returns {object}
   */
  getStats() {
    return {
      indexCacheSize: this.indexCache.size,
      subsetCacheSize: this.subsetCache.size,
      archetypeReportCacheSize: this.archetypeReportCache.size,
      activeHoverTimers: this.hoverTimers.size,
      pendingFetches: this.pendingFetches.size
    };
  }

  /**
   * Clear all caches (useful for testing or memory management)
   */
  clearAll() {
    this.indexCache.clear();
    this.subsetCache.clear();
    this.archetypeReportCache.clear();
    this.hoverTimers.forEach(timerId => clearTimeout(timerId));
    this.hoverTimers.clear();
    this.pendingFetches.clear();
    logger.info('Cleared all archetype caches');
  }
}

// Export singleton instance
export const archetypeCache = new ArchetypeCacheManager();
