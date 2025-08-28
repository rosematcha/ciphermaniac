/**
 * Parallel Image Loading Utility
 * Loads multiple image candidates simultaneously instead of sequentially
 */

class ParallelImageLoader {
  constructor() {
    this.loadingImages = new Map(); // key -> Promise
    this.loadedImages = new Set(); // successful URLs
    this.maxConcurrentPerImage = 3; // Try first 3 candidates in parallel
  }

  /**
   * Load image from candidates in parallel, return first successful URL
   * @param {Array<string>} candidates - Array of image URLs to try
   * @param {number} maxParallel - Maximum candidates to try in parallel
   * @returns {Promise<string|null>} - First successful URL or null
   */
  async loadImageParallel(candidates, maxParallel = this.maxConcurrentPerImage) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    // Use first candidate as cache key
    const cacheKey = candidates[0];
    
    // Return existing promise if already loading
    if (this.loadingImages.has(cacheKey)) {
      return this.loadingImages.get(cacheKey);
    }

    // Check if we already have a successful URL for this set
    for (const candidate of candidates) {
      if (this.loadedImages.has(candidate)) {
        return candidate;
      }
    }

    // Create loading promise
    const loadingPromise = this._loadCandidatesParallel(candidates, maxParallel);
    this.loadingImages.set(cacheKey, loadingPromise);

    try {
      const result = await loadingPromise;
      if (result) {
        this.loadedImages.add(result);
      }
      return result;
    } finally {
      this.loadingImages.delete(cacheKey);
    }
  }

  /**
   * Internal method to load candidates in parallel
   * @private
   */
  async _loadCandidatesParallel(candidates, maxParallel) {
    // Try first batch in parallel
    const firstBatch = candidates.slice(0, maxParallel);
    const remainingCandidates = candidates.slice(maxParallel);

    try {
      // Race the first batch - return as soon as any succeeds
      const result = await Promise.any(
        firstBatch.map(url => this._loadSingleImage(url))
      );
      return result;
    } catch (firstBatchError) {
      // All first batch failed, try remaining candidates sequentially
      for (const candidate of remainingCandidates) {
        try {
          const result = await this._loadSingleImage(candidate);
          return result;
        } catch {
          continue; // Try next candidate
        }
      }
      return null; // All candidates failed
    }
  }

  /**
   * Load a single image and return the URL on success
   * @private
   */
  _loadSingleImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        resolve(url); // Return the successful URL
      };
      
      img.onerror = () => {
        reject(new Error(`Failed to load: ${url}`));
      };
      
      // Start loading
      img.src = url;
    });
  }

  /**
   * Setup image element with parallel loading
   * @param {HTMLImageElement} img - Image element to setup
   * @param {Array<string>} candidates - Image URL candidates
   * @param {Object} options - Loading options
   */
  async setupImageElement(img, candidates, options = {}) {
    const {
      alt = '',
      fadeIn = true,
      onSuccess = null,
      onFailure = null,
      maxParallel = this.maxConcurrentPerImage
    } = options;

    // Set basic attributes
    img.alt = alt;
    img.decoding = 'async';
    img.loading = img.loading || 'lazy';

    // Setup fade-in effect
    if (fadeIn) {
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.18s ease-out';
    }

    try {
      // Load image in parallel
      const successfulUrl = await this.loadImageParallel(candidates, maxParallel);
      
      if (successfulUrl) {
        // Set the successful URL
        img.src = successfulUrl;
        
        // Handle load event for fade-in
        if (fadeIn) {
          img.onload = () => {
            img.style.opacity = '1';
            if (onSuccess) onSuccess(successfulUrl);
          };
        } else if (onSuccess) {
          img.onload = () => onSuccess(successfulUrl);
        }

        // If image is already cached and loaded, trigger fade-in immediately
        if (img.complete && img.naturalHeight !== 0) {
          img.style.opacity = '1';
          if (onSuccess) onSuccess(successfulUrl);
        }
      } else {
        // All candidates failed
        if (onFailure) onFailure();
      }
    } catch (error) {
      console.warn('Parallel image loading failed:', error);
      if (onFailure) onFailure();
    }
  }

  /**
   * Preload images for better performance
   * @param {Array<Array<string>>} candidatesList - Array of candidate arrays
   * @param {number} concurrency - Max concurrent preloads
   */
  async preloadImages(candidatesList, concurrency = 6) {
    const chunks = [];
    for (let i = 0; i < candidatesList.length; i += concurrency) {
      chunks.push(candidatesList.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map(candidates => this.loadImageParallel(candidates))
      );
    }
  }

  /**
   * Clear cache (useful when switching contexts)
   */
  clearCache() {
    this.loadingImages.clear();
    this.loadedImages.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      loading: this.loadingImages.size,
      loaded: this.loadedImages.size
    };
  }
}

// Global instance
export const parallelImageLoader = new ParallelImageLoader();

// Export class for testing
export { ParallelImageLoader };
