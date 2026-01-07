/**
 * Centralized storage utilities with error handling and validation
 * @module StorageManager
 */

import { logger } from './logger.js';
import { AppError, ErrorTypes, safeSync } from './errorHandler.js';

interface StorageConfigEntry<T> {
  key: string;
  version: number;
  default: T;
}

interface GridCache {
  master?: Record<string, any>;
  archeIndex?: Record<string, any>;
}

interface MetaCache {
  [key: string]: any;
}

interface PickCache {
  [key: string]: any;
}

interface SearchCache {
  names: string[];
}

interface BinderSelections {
  tournaments: string[];
  archetypes: string[];
}

type StorageConfig = {
  gridCache: StorageConfigEntry<GridCache>;
  metaCache: StorageConfigEntry<MetaCache>;
  pickCache: StorageConfigEntry<PickCache>;
  searchCache: StorageConfigEntry<SearchCache>;
  binderSelections: StorageConfigEntry<BinderSelections>;
};

/**
 * Storage configuration with versioning and defaults
 */
const STORAGE_CONFIG: StorageConfig = {
  gridCache: { key: 'gridCacheV1', version: 1, default: {} },
  metaCache: { key: 'metaCacheV1', version: 1, default: {} },
  pickCache: { key: 'pickCacheV1', version: 1, default: {} },
  searchCache: { key: 'searchCacheV1', version: 1, default: { names: [] } },
  binderSelections: {
    key: 'binderSelectionsV1',
    version: 1,
    default: { tournaments: [], archetypes: [] }
  }
};

type StorageKey = keyof typeof STORAGE_CONFIG;

/**
 * Storage manager class with type safety and validation
 */
class StorageManager {
  /**
   * Check if localStorage is available
   * @returns
   */
  static get isAvailable(): boolean {
    return (
      safeSync(
        () => {
          const test = '__storage_test__';
          localStorage.setItem(test, test);
          localStorage.removeItem(test);
          return true;
        },
        'localStorage availability check',
        false
      ) ?? false
    );
  }

  /**
   * Get data from localStorage with parsing and validation
   * @param storageKey
   * @returns
   */
  static get<K extends StorageKey>(storageKey: K): StorageConfig[K]['default'] {
    const config = STORAGE_CONFIG[storageKey];
    if (!config) {
      throw new AppError(ErrorTypes.VALIDATION, `Unknown storage key: ${storageKey}`);
    }

    return safeSync(
      () => {
        const rawData = localStorage.getItem(config.key);
        if (!rawData) {
          logger.debug(`No data found for ${storageKey}, returning default`);
          return config.default;
        }

        const parsed = JSON.parse(rawData);
        logger.debug(`Retrieved ${storageKey} from localStorage`, {
          size: JSON.stringify(parsed).length
        });
        return parsed;
      },
      `retrieving ${storageKey} from localStorage`,
      config.default
    );
  }

  /**
   * Set data to localStorage with serialization
   * @param storageKey
   * @param data
   * @returns Success status
   */
  static set<K extends StorageKey>(storageKey: K, data: StorageConfig[K]['default']): boolean {
    const config = STORAGE_CONFIG[storageKey];
    if (!config) {
      throw new AppError(ErrorTypes.VALIDATION, `Unknown storage key: ${storageKey}`);
    }

    return (
      safeSync(
        () => {
          const serialized = JSON.stringify(data);
          localStorage.setItem(config.key, serialized);
          logger.debug(`Saved ${storageKey} to localStorage`, {
            size: serialized.length
          });
          return true;
        },
        `saving ${storageKey} to localStorage`,
        false
      ) ?? false
    );
  }

  /**
   * Remove data from localStorage
   * @param storageKey
   * @returns Success status
   */
  static remove(storageKey: StorageKey): boolean {
    const config = STORAGE_CONFIG[storageKey];
    if (!config) {
      throw new AppError(ErrorTypes.VALIDATION, `Unknown storage key: ${storageKey}`);
    }

    return (
      safeSync(
        () => {
          localStorage.removeItem(config.key);
          logger.debug(`Removed ${storageKey} from localStorage`);
          return true;
        },
        `removing ${storageKey} from localStorage`,
        false
      ) ?? false
    );
  }

  /**
   * Clear all application data from localStorage
   */
  static clearAll(): void {
    Object.values(STORAGE_CONFIG).forEach(config => {
      safeSync(
        () => {
          localStorage.removeItem(config.key);
        },
        `clearing ${config.key}`,
        null
      );
    });
    logger.info('Cleared all application data from localStorage');
  }

  /**
   * Get storage usage statistics
   * @returns Storage statistics
   */
  static getStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    let totalSize = 0;

    Object.entries(STORAGE_CONFIG).forEach(([key, config]) => {
      const data = safeSync(() => localStorage.getItem(config.key), `getting ${key} size`, '');
      const { size } = new Blob([data || '']);
      stats[key] = { size, exists: Boolean(data) };
      totalSize += size;
    });

    stats.total = totalSize;
    return stats;
  }
}

// Export the class itself since all methods are static
export const storage = StorageManager;
