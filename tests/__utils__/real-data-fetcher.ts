import fs from 'fs/promises';
import path from 'path';

const DEFAULT_BASE_URL = 'https://play.limitlesstcg.com/api';
const DEFAULT_CACHE_DIR = path.join(process.cwd(), 'tests', '__fixtures__', 'real-tournaments');

/** Minimal shape for a tournament object from Limitless API. */
export interface LimitlessTournament {
  id: string | number;
  date?: string;
  players?: number;
  [key: string]: unknown;
}

export interface RealDataFetcherOptions {
  baseUrl?: string;
  cacheDir?: string;
  fetchTimeoutMs?: number;
}

/**
 * Utility to fetch real tournament data from the Limitless API with local filesystem caching.
 * Cache files are stored under `tests/__fixtures__/real-tournaments/` by default.
 */
export class RealDataFetcher {
  private baseUrl: string;
  private cacheDir: string;
  private fetchTimeoutMs: number;

  constructor(opts: RealDataFetcherOptions = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    this.cacheDir = opts.cacheDir || DEFAULT_CACHE_DIR;
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? 30_000; // 30s default
  }

  private cachePathForId(id: string | number): string {
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.cacheDir, `${safeId}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * Read cached tournament JSON by id. Returns null if not cached.
   */
  async readCache(id: string | number): Promise<LimitlessTournament | null> {
    const cachePath = this.cachePathForId(id);
    try {
      const raw = await fs.readFile(cachePath, { encoding: 'utf8' });
      const parsed = JSON.parse(raw) as LimitlessTournament;
      return parsed;
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        return null;
      }
      throw new Error(`Failed to read cache for tournament ${id}: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * Write tournament data to cache. Overwrites existing file.
   */
  async writeCache(id: string | number, data: LimitlessTournament): Promise<void> {
    await this.ensureCacheDir();
    const cachePath = this.cachePathForId(id);
    try {
      const json = JSON.stringify(data, null, 2);
      await fs.writeFile(cachePath, json, { encoding: 'utf8' });
    } catch (err: any) {
      throw new Error(`Failed to write cache for tournament ${id}: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * Clear all cached tournament data.
   */
  async clearCache(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (err: any) {
      throw new Error(`Failed to clear tournament cache at ${this.cacheDir}: ${err?.message ?? String(err)}`);
    }
  }

  private async doFetch<T = unknown>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as T;
      return data;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${this.fetchTimeoutMs}ms`);
      }
      throw new Error(`Failed to fetch ${url}: ${err?.message ?? String(err)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch a single tournament by id, using the cache when available.
   * If cached data exists it will be returned immediately; otherwise the API will be queried and the response cached.
   */
  async fetchTournament(id: string | number): Promise<LimitlessTournament> {
    // Try cache first
    const cached = await this.readCache(id);
    if (cached) {
      return cached;
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/tournaments/${encodeURIComponent(String(id))}`;
    try {
      const data = (await this.doFetch<LimitlessTournament>(url)) as LimitlessTournament;
      // Persist to cache (best-effort; propagate errors to caller if they occur)
      await this.writeCache(id, data);
      return data;
    } catch (err: any) {
      throw new Error(`Failed to fetch tournament ${id}: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * Fetch a list of recent tournaments. This method will attempt to use a simple API endpoint
   * at `/tournaments?limit={count}`. If the API responds with a different shape, the raw data will be returned.
   */
  async fetchRecentTournaments(count = 10): Promise<LimitlessTournament[]> {
    if (count <= 0) {
      return [];
    }
    const url = `${this.baseUrl.replace(/\/$/, '')}/tournaments?limit=${encodeURIComponent(String(count))}`;
    try {
      const data = await this.doFetch<LimitlessTournament[]>(url);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      throw new Error(`Failed to fetch recent tournaments: ${err?.message ?? String(err)}`);
    }
  }
}
