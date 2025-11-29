import { storage } from './storage.js';
import { CONFIG } from '../config.js';

interface MasterCacheEntry {
    ts: number;
    deckTotal: number;
    items: any[];
}

interface CardIndexCacheEntry {
    ts: number;
    idx: any;
}

interface ArcheIndexCacheEntry {
    ts: number;
    list: any[];
}

interface GridCache {
    master?: Record<string, MasterCacheEntry>;
    cardIndex?: Record<string, CardIndexCacheEntry>;
    archeIndex?: Record<string, ArcheIndexCacheEntry>;
}

/**
 * Cache management for tournament data
 * @module DataCache
 */
export class DataCache {
    private cache: GridCache;
    private ttl: number;

    constructor() {
        this.cache = (storage.get('gridCache') as GridCache) || {};
        this.ttl = CONFIG.CACHE.TTL_MS;
    }

    /**
     * Check if a timestamp is expired
     * @param timestamp
     */
    isExpired(timestamp?: number): boolean {
        return Date.now() - (timestamp || 0) > this.ttl;
    }

    /**
     * Get cached master data for a tournament
     * @param tournament
     */
    getCachedMaster(tournament: string): MasterCacheEntry | null {
        const entry = this.cache?.master?.[tournament];
        if (!entry || this.isExpired(entry.ts)) {
            return null;
        }
        return entry;
    }

    /**
     * Set cached master data for a tournament
     * @param tournament
     * @param data
     */
    setCachedMaster(tournament: string, data: { deckTotal: number; items: any[] }): void {
        this.cache.master = this.cache.master || {};
        this.cache.master[tournament] = {
            ts: Date.now(),
            deckTotal: data.deckTotal,
            items: data.items
        };
        storage.set('gridCache', this.cache);
    }

    /**
     * Set cached card index for a tournament
     * @param tournament
     * @param idx
     */
    setCachedCardIndex(tournament: string, idx: any): void {
        this.cache.cardIndex = this.cache.cardIndex || {};
        this.cache.cardIndex[tournament] = { ts: Date.now(), idx };
        storage.set('gridCache', this.cache);
    }

    /**
     * Get cached card index for a tournament
     * @param tournament
     */
    getCachedCardIndex(tournament: string): any | null {
        const entry = this.cache?.cardIndex?.[tournament];
        if (!entry || this.isExpired(entry.ts)) {
            return null;
        }
        return entry.idx;
    }

    /**
     * Get cached archetype index for a tournament
     * @param tournament
     */
    getCachedArcheIndex(tournament: string): any[] | null {
        const entry = this.cache?.archeIndex?.[tournament];
        if (!entry || this.isExpired(entry.ts)) {
            return null;
        }
        return entry.list;
    }

    /**
     * Set cached archetype index for a tournament
     * @param tournament
     * @param list
     */
    setCachedArcheIndex(tournament: string, list: any[]): void {
        this.cache.archeIndex = this.cache.archeIndex || {};
        this.cache.archeIndex[tournament] = {
            ts: Date.now(),
            list
        };
        storage.set('gridCache', this.cache);
    }
}
