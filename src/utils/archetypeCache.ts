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
import { FilteredReport } from './clientSideFiltering.js';

export interface SubsetData {
    deckTotal: number;
    items: any[]; // Using any[] for items to be flexible, or could use ReportItem[] if shared
    filters?: any;
    source?: any;
    generatedClientSide?: boolean;
    raw?: any;
}

export interface ArchetypeIndex {
    archetype: string;
    deckTotal: number;
    totalCombinations: number;
    uniqueSubsets: number;
    deduplicationRate: number;
    cards: any;
    filterMap: Record<string, string>; // Maps "inc:X|exc:Y" to subset_id
    subsets: any;
    generatedAt: string;
}

class ArchetypeCacheManager {
    private indexCache: Map<string, Promise<ArchetypeIndex>>;
    private subsetCache: Map<string, Promise<SubsetData>>;
    private archetypeReportCache: Map<string, Promise<any>>;
    private hoverTimers: Map<string, number>;
    private pendingFetches: Set<string>;
    private readonly HOVER_DELAY_MS: number;

    constructor() {
        this.indexCache = new Map();
        this.subsetCache = new Map();
        this.archetypeReportCache = new Map();
        this.hoverTimers = new Map();
        this.pendingFetches = new Set();
        this.HOVER_DELAY_MS = 200; // 0.2 seconds
    }

    /**
     * Build the candidate base URLs for an archetype's include-exclude directory
     * New path structure: include-exclude/{tournament}/{archetype}/
     * Available at: r2.ciphermaniac.com/include-exclude/{tournament}/{archetype}/
     * @param tournament
     * @param archetypeBase
     * @returns
     */
    static getArchetypeBaseUrls(tournament: string, archetypeBase: string): string[] {
        const r2Base = (CONFIG.API.R2_BASE || '').trim();
        const suffix = `include-exclude/${encodeURIComponent(tournament)}/${encodeURIComponent(archetypeBase)}`;
        const candidates = new Set<string>();

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
     * Build filter key for looking up subset IDs in the index
     * MUST match the generator logic in .github/scripts/run-online-meta.mjs buildFilterKey()
     *
     * Simple presence/exclusion only - no count ranges
     * @param includeId
     * @param excludeId
     * @returns
     */
    static buildFilterKey(includeId: string | null, excludeId: string | null): string {
        const incKey = includeId || '';
        const excKey = excludeId || '';
        return `inc:${incKey}|exc:${excKey}`;
    }

    /**
     * Build cache key for index files
     * @param tournament
     * @param archetypeBase
     * @returns
     */
    static getIndexCacheKey(tournament: string, archetypeBase: string): string {
        return `${tournament}::${archetypeBase}::index`;
    }

    /**
     * Build cache key for subset files
     * @param tournament
     * @param archetypeBase
     * @param subsetId
     * @returns
     */
    static getSubsetCacheKey(tournament: string, archetypeBase: string, subsetId: string): string {
        return `${tournament}::${archetypeBase}::${subsetId}`;
    }

    /**
     * Fetch and cache an archetype's index.json
     * @param tournament
     * @param archetypeBase
     * @returns
     */
    fetchIndex(tournament: string, archetypeBase: string): Promise<ArchetypeIndex> {
        const cacheKey = ArchetypeCacheManager.getIndexCacheKey(tournament, archetypeBase);

        if (this.indexCache.has(cacheKey)) {
            logger.debug(`Index cache hit for ${archetypeBase}`);
            return this.indexCache.get(cacheKey)!;
        }

        const fetchPromise = (async () => {
            const baseUrls = ArchetypeCacheManager.getArchetypeBaseUrls(tournament, archetypeBase);
            this.pendingFetches.add(cacheKey);

            try {
                let lastError: any = null;

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
                        return data as ArchetypeIndex;
                    } catch (error: any) {
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
                throw (
                    lastError ||
                    new AppError(ErrorTypes.NETWORK, message, null, {
                        tournament,
                        archetypeBase
                    })
                );
            } finally {
                this.pendingFetches.delete(cacheKey);
            }
        })();

        this.indexCache.set(cacheKey, fetchPromise);
        return fetchPromise;
    }

    /**
     * Fetch and cache a specific subset
     * @param tournament
     * @param archetypeBase
     * @param subsetId
     * @returns
     */
    fetchSubset(tournament: string, archetypeBase: string, subsetId: string): Promise<SubsetData> {
        const cacheKey = ArchetypeCacheManager.getSubsetCacheKey(tournament, archetypeBase, subsetId);

        if (this.subsetCache.has(cacheKey)) {
            logger.debug(`Subset cache hit for ${archetypeBase}/${subsetId}`);
            return this.subsetCache.get(cacheKey)!;
        }

        const fetchPromise = (async () => {
            const baseUrls = ArchetypeCacheManager.getArchetypeBaseUrls(tournament, archetypeBase);
            this.pendingFetches.add(cacheKey);

            try {
                let lastError: any = null;

                for (const baseUrl of baseUrls) {
                    const url = `${baseUrl}/unique_subsets/${subsetId}.json`;
                    logger.debug(`Fetching subset ${subsetId} for ${archetypeBase}`, {
                        url
                    });

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
                        return data as SubsetData;
                    } catch (error: any) {
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
     * Falls back to client-side generation if filter not found
     * @param tournament
     * @param archetypeBase
     * @param includeId
     * @param excludeId
     * @param includeOperator - Quantity operator (=, <, <=, >, >=)
     * @param includeCount - Quantity threshold
     * @returns
     */
    async getFilteredData(
        tournament: string,
        archetypeBase: string,
        includeId: string | null,
        excludeId: string | null,
        includeOperator: string | null = null,
        includeCount: number | null = null
    ): Promise<SubsetData | FilteredReport> {
        // If quantity filtering is requested, always use client-side generation
        const useQuantityFilter = includeOperator && includeCount !== null && includeCount !== undefined;

        if (!useQuantityFilter) {
            // First, try to fetch the pre-generated index
            try {
                const index = await this.fetchIndex(tournament, archetypeBase);

                // Build the filter key
                const filterKey = ArchetypeCacheManager.buildFilterKey(includeId, excludeId);

                // Look up the subset ID
                const subsetId = index.filterMap[filterKey];

                if (subsetId) {
                    logger.debug('Resolved filter combination to pre-generated subset', {
                        filterKey,
                        subsetId,
                        includeId,
                        excludeId
                    });

                    // Fetch the pre-generated subset
                    return await this.fetchSubset(tournament, archetypeBase, subsetId);
                }

                // Filter not found in pre-generated data
                logger.info('Filter combination not pre-generated, attempting client-side generation', {
                    filterKey,
                    includeId,
                    excludeId
                });
            } catch (error: any) {
                logger.warn('Could not fetch filter index, falling back to client-side generation', {
                    error: error.message
                });
            }
        } else {
            logger.info('Quantity filter requested, using client-side generation', {
                includeId,
                includeOperator,
                includeCount
            });
        }

        // Fallback: Generate the filtered report client-side
        try {
            logger.info('Starting client-side generation fallback', {
                archetypeBase,
                includeId,
                excludeId,
                includeOperator,
                includeCount,
                tournament
            });

            const { fetchAllDecks, generateFilteredReport } = await import('./clientSideFiltering.js');

            logger.info('Client-side filtering module loaded, fetching decks');

            const decks = await fetchAllDecks(tournament);

            logger.info('Decks fetched, generating filtered report', {
                totalDecks: decks.length
            });

            const report = generateFilteredReport(
                decks,
                archetypeBase,
                includeId,
                excludeId,
                includeOperator as any, // Cast to Operator type
                includeCount
            );

            logger.info('Successfully generated client-side filtered report', {
                archetypeBase,
                includeId,
                excludeId,
                includeOperator,
                includeCount,
                deckTotal: report.deckTotal,
                itemCount: report.items?.length
            });

            return report;
        } catch (clientError: any) {
            logger.error('Client-side filtering failed', {
                error: clientError.message,
                stack: clientError.stack,
                includeId,
                excludeId,
                includeOperator,
                includeCount,
                archetypeBase,
                tournament
            });

            throw new AppError(
                ErrorTypes.PARSE,
                `Filter combination not found and client-side generation failed: inc:${includeId || ''}|exc:${excludeId || ''}`,
                clientError.message, // Pass message as userMessage
                {
                    filterKey: `inc:${includeId || ''}|exc:${excludeId || ''}`,
                    archetype: archetypeBase,
                    clientSideFailed: true
                }
            );
        }
    }

    /**
     * Pre-cache an archetype's index.json (triggered by hover)
     * @param tournament
     * @param archetypeBase
     * @returns
     */
    async preCacheIndex(tournament: string, archetypeBase: string): Promise<void> {
        try {
            await this.fetchIndex(tournament, archetypeBase);
            logger.debug(`Pre-cached index for ${archetypeBase}`);
        } catch (error: any) {
            // Silent failure for pre-caching
            logger.debug(`Pre-cache index failed for ${archetypeBase}`, error.message);
        }
    }

    /**
     * Pre-resolve a filter combination to subset ID (triggered by hover)
     * Does NOT fetch the subset data yet, just resolves the mapping
     * @param tournament
     * @param archetypeBase
     * @param includeId
     * @param excludeId
     * @returns Returns subset ID or null if not found
     */
    async preResolveFilter(
        tournament: string,
        archetypeBase: string,
        includeId: string | null,
        excludeId: string | null
    ): Promise<string | null> {
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
        } catch (error: any) {
            logger.debug(`Pre-resolve filter failed for ${archetypeBase}`, error.message);
            return null;
        }
    }

    /**
     * Start hover timer for archetype (triggers pre-caching after delay)
     * @param tournament
     * @param archetypeBase
     * @param onTrigger - Optional callback when hover delay expires
     */
    startHoverTimer(tournament: string, archetypeBase: string, onTrigger?: () => void): void {
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
     * @param tournament
     * @param archetypeBase
     */
    clearHoverTimer(tournament: string, archetypeBase: string): void {
        const key = `${tournament}::${archetypeBase}`;
        const timerId = this.hoverTimers.get(key);
        if (timerId) {
            window.clearTimeout(timerId);
            this.hoverTimers.delete(key);
        }
    }

    /**
     * Start hover timer for filter option (triggers pre-resolution after delay)
     * @param tournament
     * @param archetypeBase
     * @param includeId
     * @param excludeId
     */
    startFilterHoverTimer(tournament: string, archetypeBase: string, includeId: string | null, excludeId: string | null): void {
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
     * @param tournament
     * @param archetypeBase
     * @param includeId
     * @param excludeId
     */
    clearFilterHoverTimer(tournament: string, archetypeBase: string, includeId: string | null, excludeId: string | null): void {
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
     * @returns
     */
    getStats(): {
        indexCacheSize: number;
        subsetCacheSize: number;
        archetypeReportCacheSize: number;
        activeHoverTimers: number;
        pendingFetches: number;
    } {
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
    clearAll(): void {
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
