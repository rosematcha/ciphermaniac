/**
 * Cache management for tournament data
 * @module DataCache
 */

import { storage } from './storage.js';
import { CONFIG } from '../config.js';

/**
 *
 */
export class DataCache {
  constructor() {
    this.cache = storage.get('gridCache');
    this.ttl = CONFIG.CACHE.TTL_MS;
  }

  /**
   *
   * @param timestamp
   */
  isExpired(timestamp) {
    return Date.now() - (timestamp || 0) > this.ttl;
  }

  /**
   *
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
   *
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
   *
   * @param tournament
   * @param idx
   */
  setCachedCardIndex(tournament, idx) {
    this.cache.cardIndex = this.cache.cardIndex || {};
    this.cache.cardIndex[tournament] = { ts: Date.now(), idx };
    storage.set('gridCache', this.cache);
  }

  /**
   *
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
   *
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
   *
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
