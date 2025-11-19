/**
 * Cache management for tournament data
 * @module DataCache
 */

import { storage } from './storage.js';
import { CONFIG } from '../config.js';

export class DataCache {
    constructor() {
        this.cache = storage.get('gridCache');
        this.ttl = CONFIG.CACHE.TTL_MS;
    }

    isExpired(timestamp) {
        return Date.now() - (timestamp || 0) > this.ttl;
    }

    getCachedMaster(tournament) {
        const entry = this.cache?.master?.[tournament];
        if (!entry || this.isExpired(entry.ts)) {
            return null;
        }
        return entry;
    }

    setCachedMaster(tournament, data) {
        this.cache.master = this.cache.master || {};
        this.cache.master[tournament] = {
            ts: Date.now(),
            deckTotal: data.deckTotal,
            items: data.items
        };
        storage.set('gridCache', this.cache);
    }

    setCachedCardIndex(tournament, idx) {
        this.cache.cardIndex = this.cache.cardIndex || {};
        this.cache.cardIndex[tournament] = { ts: Date.now(), idx };
        storage.set('gridCache', this.cache);
    }

    getCachedCardIndex(tournament) {
        const entry = this.cache?.cardIndex?.[tournament];
        if (!entry || this.isExpired(entry.ts)) {
            return null;
        }
        return entry.idx;
    }

    getCachedArcheIndex(tournament) {
        const entry = this.cache?.archeIndex?.[tournament];
        if (!entry || this.isExpired(entry.ts)) {
            return null;
        }
        return entry.list;
    }

    setCachedArcheIndex(tournament, list) {
        this.cache.archeIndex = this.cache.archeIndex || {};
        this.cache.archeIndex[tournament] = {
            ts: Date.now(),
            list
        };
        storage.set('gridCache', this.cache);
    }
}
