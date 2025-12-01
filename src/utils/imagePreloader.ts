import { buildThumbCandidates as _buildThumbCandidates } from '../thumbs.js';

interface PreloadStats {
    preloaded: number;
    loading: number;
    queued: number;
    currentlyLoading: number;
}

interface PreloadRequest {
    name: string;
    candidates: string[];
    useSm: boolean;
}

class ImagePreloader {
    private preloadedImages: Set<string>;
    private loadingImages: Set<string>;
    private preloadQueue: PreloadRequest[];
    private maxConcurrent: number;
    private currentlyLoading: number;

    constructor() {
        this.preloadedImages = new Set();
        this.loadingImages = new Set();
        this.preloadQueue = [];
        this.maxConcurrent = 3;
        this.currentlyLoading = 0;
    }

    /**
     * Preload images for a list of card names
     * @param _cardNames - Array of card names to preload
     * @param _useSm - Whether to use small or extra-small thumbnails
     * @param _overrides - Image filename overrides
     * @param _priority - Higher number = higher priority (default: 1)
     */
    preloadImages(_cardNames: any[], _useSm: boolean = false, _overrides: Record<string, any> = {}, _priority: number = 1): void {
        // DISABLED: Using parallelImageLoader instead
    }

    /**
     * Process the preload queue
     */
    processQueue(): void {
        while (this.currentlyLoading < this.maxConcurrent && this.preloadQueue.length > 0) {
            const request = this.preloadQueue.shift();
            if (request) {
                this.loadImageCandidates(request);
            }
        }
    }

    /**
     * Load the first available image from candidates
     * @param params
     */
    async loadImageCandidates({ name, candidates, useSm }: PreloadRequest): Promise<void> {
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
    loadSingleImage(src: string): Promise<boolean> {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = src;
        });
    }

    /**
     * Preload visible and near-visible cards in the grid
     * @param _items
     * @param _overrides
     */
    preloadVisibleCards(_items: any[], _overrides: Record<string, any> = {}): void {
        // DISABLED: Using parallelImageLoader instead
    }

    /**
     * Clear preload cache (useful when switching tournaments)
     */
    clearCache(): void {
        this.preloadedImages.clear();
        this.loadingImages.clear();
        this.preloadQueue.length = 0;
        this.currentlyLoading = 0;
    }

    /**
     * Get preload statistics
     */
    getStats(): PreloadStats {
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
const _scrollTimeout: null = null;
/**
 *
 * @param _items
 * @param _overrides
 */
export function setupImagePreloading(_items: any[], _overrides: Record<string, any> = {}): () => void {
    // DISABLED: Using parallelImageLoader instead
    return () => { }; // Return empty cleanup function
}
