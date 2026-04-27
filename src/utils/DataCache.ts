import { storage } from './storage.js';
import { CONFIG } from '../config.js';

interface MasterCacheEntry {
  ts: number;
  deckTotal: number;
  items: any[];
}

interface MasterCacheMetaEntry {
  ts: number;
  deckTotal: number;
  itemCount: number;
}

interface ArcheIndexCacheEntry {
  ts: number;
  list: any[];
}

interface GridCache {
  master?: Record<string, MasterCacheMetaEntry>;
  archeIndex?: Record<string, ArcheIndexCacheEntry>;
}

/**
 * Cache management for tournament data
 * @module DataCache
 */
export class DataCache {
  private cache: GridCache;
  private ttl: number;
  private masterMemory: Map<string, MasterCacheEntry>;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const persisted = (storage.get('gridCache') as GridCache | null) || {};
    this.cache = {
      master: {},
      archeIndex: persisted.archeIndex || {}
    };
    this.ttl = CONFIG.CACHE.TTL_MS;
    this.masterMemory = new Map();

    // Migrate/trim persisted master cache to metadata-only shape.
    const persistedMaster = (persisted as { master?: Record<string, any> }).master || {};
    Object.entries(persistedMaster).forEach(([tournament, value]) => {
      if (!value || typeof value !== 'object') {
        return;
      }
      const raw = value as Record<string, unknown>;
      const ts = Number(raw.ts);
      const deckTotal = Number(raw.deckTotal);
      const itemCount = Array.isArray(raw.items) ? raw.items.length : Number(raw.itemCount);
      this.cache.master![tournament] = {
        ts: Number.isFinite(ts) ? ts : Date.now(),
        deckTotal: Number.isFinite(deckTotal) ? deckTotal : 0,
        itemCount: Number.isFinite(itemCount) ? itemCount : 0
      };
    });
    storage.set('gridCache', this.cache);
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      storage.set('gridCache', this.cache);
    }, 500);
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
    const memoryEntry = this.masterMemory.get(tournament);
    if (!memoryEntry) {
      return null;
    }
    if (this.isExpired(memoryEntry.ts)) {
      this.masterMemory.delete(tournament);
      if (this.cache.master?.[tournament]) {
        delete this.cache.master[tournament];
        this.schedulePersist();
      }
      return null;
    }
    return memoryEntry;
  }

  /**
   * Set cached master data for a tournament
   * @param tournament
   * @param data
   * @param data.deckTotal
   * @param data.items
   */
  setCachedMaster(tournament: string, data: { deckTotal: number; items: any[] }): void {
    const entry: MasterCacheEntry = {
      ts: Date.now(),
      deckTotal: data.deckTotal,
      items: data.items
    };
    this.masterMemory.set(tournament, entry);

    this.cache.master = this.cache.master || {};
    this.cache.master[tournament] = {
      ts: entry.ts,
      deckTotal: data.deckTotal,
      itemCount: Array.isArray(data.items) ? data.items.length : 0
    };
    this.schedulePersist();
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
    this.schedulePersist();
  }
}
