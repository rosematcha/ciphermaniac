/**
 * Build/version management to bust cached client state between deploys.
 * Update BUILD_VERSION when a deploy introduces breaking client changes.
 */

import { storage } from './storage.js';
import { logger } from './logger.js';

export const BUILD_VERSION = '2025-10-27T22:45Z';

const VERSION_STORAGE_KEY = 'cm:build-version';
const CACHE_CLEANUP_FLAG = 'cm:build-cache-cleared';

let initialized = false;

/**
 * Ensure the current browser session is aligned with the latest build.
 * Clears local caches when a new version is detected.
 * @returns {string} The active build version
 */
export function ensureBuildVersion() {
  if (initialized) {
    return BUILD_VERSION;
  }

  initialized = true;

  if (typeof window === 'undefined') {
    return BUILD_VERSION;
  }

  try {
    const { localStorage, sessionStorage } = window;
    if (!localStorage) {
      return BUILD_VERSION;
    }

    const previousVersion = localStorage.getItem(VERSION_STORAGE_KEY);
    const isUpgrade = Boolean(previousVersion && previousVersion !== BUILD_VERSION);

    if (isUpgrade) {
      try {
        storage.clearAll();
      } catch (error) {
        logger.warn('Failed to clear storage caches during build upgrade', error);
      }

      try {
        sessionStorage?.setItem(CACHE_CLEANUP_FLAG, '1');
      } catch {
        // Ignore sessionStorage failures (Safari private mode, etc.)
      }

      if ('caches' in window && typeof window.caches?.keys === 'function') {
        window.caches
          .keys()
          .then(cacheKeys => {
            cacheKeys.forEach(cacheKey => {
              window.caches.delete(cacheKey).catch(() => {
                logger.debug(`Failed to delete cache ${cacheKey}`);
              });
            });
          })
          .catch(error => {
            logger.debug('Failed to iterate CacheStorage during build upgrade', error);
          });
      }

      logger.info('Client caches cleared after build version change', {
        previousVersion,
        buildVersion: BUILD_VERSION
      });
    }

    localStorage.setItem(VERSION_STORAGE_KEY, BUILD_VERSION);

    try {
      if (sessionStorage?.getItem(CACHE_CLEANUP_FLAG)) {
        sessionStorage.removeItem(CACHE_CLEANUP_FLAG);
      }
    } catch {
      // Ignore
    }
  } catch (error) {
    logger.warn('Build version initialization failed', error);
  }

  return BUILD_VERSION;
}

ensureBuildVersion();
