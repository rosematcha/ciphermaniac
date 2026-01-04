/**
 * Parallel Image Loading Utility
 * Loads multiple image candidates simultaneously instead of sequentially
 */

interface SetupImageOptions {
  alt?: string;
  fadeIn?: boolean;
  onSuccess?: (url: string) => void;
  onFailure?: () => void;
  maxParallel?: number;
}

/**
 *
 */
class ParallelImageLoader {
  private loadingImages: Map<string, Promise<string | null>>;
  private loadedImages: Set<string>;
  private maxConcurrentPerImage: number;

  constructor() {
    this.loadingImages = new Map(); // key -> Promise
    this.loadedImages = new Set(); // successful URLs
    this.maxConcurrentPerImage = 3; // Try first 3 candidates in parallel
  }

  /**
   * Load image from candidates in parallel, return first successful URL
   * @param candidates - Array of image URLs to try
   * @param maxParallel - Maximum candidates to try in parallel
   * @returns First successful URL or null
   */
  async loadImageParallel(
    candidates: string[],
    maxParallel: number = this.maxConcurrentPerImage
  ): Promise<string | null> {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    // Use first candidate as cache key
    const cacheKey = candidates[0];

    // Return existing promise if already loading
    if (this.loadingImages.has(cacheKey)) {
      return this.loadingImages.get(cacheKey)!;
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
   * @param candidates
   * @param maxParallel
   */
  private async _loadCandidatesParallel(candidates: string[], maxParallel: number): Promise<string | null> {
    // Try first batch in parallel
    const firstBatch = candidates.slice(0, maxParallel);
    const remainingCandidates = candidates.slice(maxParallel);

    try {
      // Race the first batch - return as soon as any succeeds
      const result = await Promise.any(firstBatch.map(url => this._loadSingleImage(url)));
      return result;
    } catch {
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
   * @param url
   */
  private _loadSingleImage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        resolve(url);
      };

      img.onerror = () => {
        reject(new Error(`Failed to load: ${url}`));
      };

      img.src = url;
    });
  }

  /**
   * Setup image element with parallel loading
   * @param img - Image element to setup
   * @param candidates - Image URL candidates
   * @param options - Loading options
   */
  async setupImageElement(img: HTMLImageElement, candidates: string[], options: SetupImageOptions = {}): Promise<void> {
    const { alt = '', onSuccess = null, onFailure = null, maxParallel = this.maxConcurrentPerImage } = options;

    // Set basic attributes
    // eslint-disable-next-line no-param-reassign
    img.alt = alt;
    // eslint-disable-next-line no-param-reassign
    img.decoding = 'async';
    // eslint-disable-next-line no-param-reassign
    img.loading = img.loading || 'lazy';

    // Fade-in effect disabled to prevent flashing

    try {
      // Load image in parallel
      const successfulUrl = await this.loadImageParallel(candidates, maxParallel);

      if (successfulUrl) {
        // Set the successful URL
        // eslint-disable-next-line no-param-reassign
        img.src = successfulUrl;

        // Handle load event
        if (onSuccess) {
          // eslint-disable-next-line no-param-reassign
          img.onload = () => onSuccess(successfulUrl);
          // If image is already cached and loaded, trigger immediately
          if (img.complete && img.naturalHeight !== 0) {
            onSuccess(successfulUrl);
          }
        }
      } else {
        // All candidates failed
        if (onFailure) {
          onFailure();
        }
      }
    } catch (error) {
      console.warn('Parallel image loading failed:', error);
      if (onFailure) {
        onFailure();
      }
    }
  }

  /**
   * Preload images for better performance
   * @param candidatesList - Array of candidate arrays
   * @param concurrency - Max concurrent preloads
   */
  async preloadImages(candidatesList: string[][], concurrency = 6): Promise<void> {
    const chunks: string[][][] = [];
    for (let i = 0; i < candidatesList.length; i += concurrency) {
      chunks.push(candidatesList.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(candidates => this.loadImageParallel(candidates)));
    }
  }

  /**
   * Clear cache (useful when switching contexts)
   */
  clearCache(): void {
    this.loadingImages.clear();
    this.loadedImages.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { loading: number; loaded: number } {
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
