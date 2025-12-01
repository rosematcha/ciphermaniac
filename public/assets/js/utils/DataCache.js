import { storage } from './storage.js';
import { CONFIG } from '../config.js';
/**
 * Cache management for tournament data
 * @module DataCache
 */
export class DataCache {
    cache;
    ttl;
    constructor() {
        this.cache = storage.get('gridCache') || {};
        this.ttl = CONFIG.CACHE.TTL_MS;
    }
    /**
     * Check if a timestamp is expired
     * @param timestamp
     */
    isExpired(timestamp) {
        return Date.now() - (timestamp || 0) > this.ttl;
    }
    /**
     * Get cached master data for a tournament
     * @param tournament
     */
    getCachedMaster(tournament) {
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
    setCachedMaster(tournament, data) {
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
    setCachedCardIndex(tournament, idx) {
        this.cache.cardIndex = this.cache.cardIndex || {};
        this.cache.cardIndex[tournament] = { ts: Date.now(), idx };
        storage.set('gridCache', this.cache);
    }
    /**
     * Get cached card index for a tournament
     * @param tournament
     */
    getCachedCardIndex(tournament) {
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
    getCachedArcheIndex(tournament) {
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
    setCachedArcheIndex(tournament, list) {
        this.cache.archeIndex = this.cache.archeIndex || {};
        this.cache.archeIndex[tournament] = {
            ts: Date.now(),
            list
        };
        storage.set('gridCache', this.cache);
    }
}
