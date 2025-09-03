import { buildThumbCandidates } from '../thumbs.js';

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
   * @param {Array} cardNames - Array of card names to preload
   * @param {boolean} useSm - Whether to use small or extra-small thumbnails
   * @param {object} overrides - Image filename overrides
   * @param {number} priority - Higher number = higher priority (default: 1)
   */
  preloadImages(cardNames, useSm = false, overrides = {}, priority = 1) {
    // DISABLED: Using parallelImageLoader instead
    return;

    if (!Array.isArray(cardNames)) {
      return;
    }

    const requests = cardNames.map(name => ({
      name,
      useSm,
      overrides,
      priority,
      candidates: buildThumbCandidates(name, useSm, overrides)
    }));

    // Sort by priority (higher first)
    requests.sort((a, b) => b.priority - a.priority);

    // Add to queue
    this.preloadQueue.push(...requests);

    // Process queue
    this.processQueue();
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
   * @param root0
   * @param root0.name
   * @param root0.candidates
   * @param root0.useSm
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
   * @param src
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
   * @param items
   * @param overrides
   */
  preloadVisibleCards(items, overrides = {}) {
    // DISABLED: Using parallelImageLoader instead
    return;

    if (!Array.isArray(items)) {
      return;
    }

    // Get currently visible cards based on scroll position
    const viewportHeight = window.innerHeight;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const grid = document.getElementById('grid');

    if (!grid) {
      return;
    }

    const rows = grid.querySelectorAll('.row');
    const visibleCardNames = [];
    const nearVisibleCardNames = [];

    rows.forEach(row => {
      const rect = row.getBoundingClientRect();
      const rowTop = rect.top + scrollTop;
      const rowBottom = rowTop + rect.height;

      // Check if row is visible or near-visible
      const buffer = viewportHeight; // Preload 1 viewport height ahead
      const isVisible = rowBottom >= scrollTop && rowTop <= scrollTop + viewportHeight;
      const isNearVisible = rowBottom >= scrollTop - buffer && rowTop <= scrollTop + viewportHeight + buffer;

      if (isVisible || isNearVisible) {
        const cards = row.querySelectorAll('.card');
        cards.forEach(card => {
          const name = card.querySelector('.name')?.textContent;
          if (name) {
            const item = items.find(i => i.name === name);
            if (item) {
              if (isVisible) {
                visibleCardNames.push(name);
              } else {
                nearVisibleCardNames.push(name);
              }
            }
          }
        });
      }
    });

    // Preload visible cards with high priority
    if (visibleCardNames.length > 0) {
      this.preloadImages(visibleCardNames, true, overrides, 3); // sm thumbnails, high priority
      this.preloadImages(visibleCardNames, false, overrides, 2); // xs thumbnails, medium priority
    }

    // Preload near-visible cards with lower priority
    if (nearVisibleCardNames.length > 0) {
      this.preloadImages(nearVisibleCardNames, true, overrides, 1); // sm thumbnails, low priority
      this.preloadImages(nearVisibleCardNames, false, overrides, 1); // xs thumbnails, low priority
    }
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
let scrollTimeout = null;
/**
 *
 * @param items
 * @param overrides
 */
export function setupImagePreloading(items, overrides = {}) {
  // DISABLED: Using parallelImageLoader instead
  return () => {}; // Return empty cleanup function

  const handleScroll = () => {
    if (scrollTimeout) {
      return;
    }
    scrollTimeout = setTimeout(() => {
      imagePreloader.preloadVisibleCards(items, overrides);
      scrollTimeout = null;
    }, 100);
  };

  // Initial preload
  imagePreloader.preloadVisibleCards(items, overrides);

  // Set up scroll listener
  window.addEventListener('scroll', handleScroll, { passive: true });

  // Return cleanup function
  return () => {
    window.removeEventListener('scroll', handleScroll);
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
      scrollTimeout = null;
    }
  };
}
