import { buildThumbCandidates as _buildThumbCandidates } from '../thumbs.js';

class ImagePreloader {
  constructor() {
    this.preloadedImages = new Set();
    this.loadingImages = new Set();
    this.preloadQueue = [];
    this.maxConcurrent = 3;
    this.currentlyLoading = 0;
  }

  /**
   * Preload images for a list of card names
   * @param {Array} _cardNames - Array of card names to preload
   * @param {boolean} _useSm - Whether to use small or extra-small thumbnails
   * @param {object} _overrides - Image filename overrides
   * @param {number} _priority - Higher number = higher priority (default: 1)
   */
  preloadImages(_cardNames, _useSm = false, _overrides = {}, _priority = 1) {
    // DISABLED: Using parallelImageLoader instead
    return;
  }

  /**
   * Process the preload queue
   */
  processQueue() {
    while (this.currentlyLoading < this.maxConcurrent && this.preloadQueue.length > 0) {
      const request = this.preloadQueue.shift();
      this.loadImageCandidates(request);
    }
  }

  /**
   * Load the first available image from candidates
   * @param {{name: string, candidates: string[], useSm: boolean}} params
   */
  async loadImageCandidates({ name, candidates, useSm }) {
    if (this.preloadedImages.has(`${name}_${useSm}`)) {
      this.processQueue();
      return;
    }

    const cacheKey = `${name}_${useSm}`;
    if (this.loadingImages.has(cacheKey)) {
      return; // Already loading
    }

    this.loadingImages.add(cacheKey);
    this.currentlyLoading++;

    try {
      // Try to load the first successful candidate
      for (const candidate of candidates) {
        if (await this.loadSingleImage(candidate)) {
          this.preloadedImages.add(cacheKey);
          break;
        }
      }
    } catch (error) {
      // Silently handle preload failures
      void error;
    } finally {
      this.loadingImages.delete(cacheKey);
      this.currentlyLoading--;
      this.processQueue();
    }
  }

  /**
   * Load a single image and return success/failure
   * @param {string} src
   */
  loadSingleImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  /**
   * Preload visible and near-visible cards in the grid
   * @param {Array} _items
   * @param {object} _overrides
   */
  preloadVisibleCards(_items, _overrides = {}) {
    // DISABLED: Using parallelImageLoader instead
    return;
  }

  /**
   * Clear preload cache (useful when switching tournaments)
   */
  clearCache() {
    this.preloadedImages.clear();
    this.loadingImages.clear();
    this.preloadQueue.length = 0;
    this.currentlyLoading = 0;
  }

  /**
   * Get preload statistics
   */
  getStats() {
    return {
      preloaded: this.preloadedImages.size,
      loading: this.loadingImages.size,
      queued: this.preloadQueue.length,
      currentlyLoading: this.currentlyLoading
    };
  }
}

// Global instance
export const imagePreloader = new ImagePreloader();

// Throttled scroll handler for preloading
let _scrollTimeout = null;
/**
 *
 * @param {Array} _items
 * @param {object} _overrides
 */
export function setupImagePreloading(_items, _overrides = {}) {
  // DISABLED: Using parallelImageLoader instead
  return () => {}; // Return empty cleanup function
}
