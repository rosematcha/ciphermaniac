/**
 * Centralized storage utilities with error handling and validation
 * @module StorageManager
 */

import { logger } from './logger.js';
import { safeSync, AppError, ErrorTypes } from './errorHandler.js';

/**
 * Storage configuration with versioning and defaults
 */
const STORAGE_CONFIG = {
  favorites: { key: 'favoritesV1', version: 1, default: [] },
  gridCache: { key: 'gridCacheV1', version: 1, default: {} },
  metaCache: { key: 'metaCacheV1', version: 1, default: {} },
  pickCache: { key: 'pickCacheV1', version: 1, default: {} },
  searchCache: { key: 'searchCacheV1', version: 1, default: { names: [] } }
};

/**
 * Storage manager class with type safety and validation
 */
class StorageManager {
  /**
   * Check if localStorage is available
   * @returns {boolean}
   */
  get isAvailable() {
    return safeSync(() => {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    }, 'localStorage availability check', false);
  }

  /**
   * Get data from localStorage with parsing and validation
   * @template T
   * @param {keyof STORAGE_CONFIG} storageKey
   * @returns {T}
   */
  get(storageKey) {
    const config = STORAGE_CONFIG[storageKey];
    if (!config) {
      throw new AppError(`Unknown storage key: ${storageKey}`, ErrorTypes.VALIDATION);
    }

    return safeSync(() => {
      const rawData = localStorage.getItem(config.key);
      if (!rawData) {
        logger.debug(`No data found for ${storageKey}, returning default`);
        return config.default;
      }

      const parsed = JSON.parse(rawData);
      logger.debug(`Retrieved ${storageKey} from localStorage`, { size: JSON.stringify(parsed).length });
      return parsed;
    }, `retrieving ${storageKey} from localStorage`, config.default);
  }

  /**
   * Set data to localStorage with serialization
   * @param {keyof STORAGE_CONFIG} storageKey
   * @param {any} data
   * @returns {boolean} Success status
   */
  set(storageKey, data) {
    const config = STORAGE_CONFIG[storageKey];
    if (!config) {
      throw new AppError(`Unknown storage key: ${storageKey}`, ErrorTypes.VALIDATION);
    }

    return safeSync(() => {
      const serialized = JSON.stringify(data);
      localStorage.setItem(config.key, serialized);
      logger.debug(`Saved ${storageKey} to localStorage`, { size: serialized.length });
      return true;
    }, `saving ${storageKey} to localStorage`, false);
  }

  /**
   * Remove data from localStorage
   * @param {keyof STORAGE_CONFIG} storageKey
   * @returns {boolean} Success status
   */
  remove(storageKey) {
    const config = STORAGE_CONFIG[storageKey];
    if (!config) {
      throw new AppError(`Unknown storage key: ${storageKey}`, ErrorTypes.VALIDATION);
    }

    return safeSync(() => {
      localStorage.removeItem(config.key);
      logger.debug(`Removed ${storageKey} from localStorage`);
      return true;
    }, `removing ${storageKey} from localStorage`, false);
  }

  /**
   * Clear all application data from localStorage
   */
  clearAll() {
    Object.values(STORAGE_CONFIG).forEach(config => {
      safeSync(() => {
        localStorage.removeItem(config.key);
      }, `clearing ${config.key}`, null);
    });
    logger.info('Cleared all application data from localStorage');
  }

  /**
   * Get storage usage statistics
   * @returns {Object} Storage statistics
   */
  getStats() {
    const stats = {};
    let totalSize = 0;

    Object.entries(STORAGE_CONFIG).forEach(([key, config]) => {
      const data = safeSync(() => localStorage.getItem(config.key), `getting ${key} size`, '');
      const size = new Blob([data || '']).size;
      stats[key] = { size, exists: !!data };
      totalSize += size;
    });

    stats.total = totalSize;
    return stats;
  }
}

// Create and export singleton instance
export const storage = new StorageManager();
