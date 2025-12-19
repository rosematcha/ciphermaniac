import fs from 'fs/promises';
import path from 'path';

const FIXTURES_DIR = path.join(__dirname, '..', '__fixtures__', 'generated');

/**
 * Utility to normalize and validate keys to file system safe paths.
 * Prevents path traversal by disallowing '..' segments and leading slashes.
 */
function sanitizeKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new TypeError('Storage key must be a non-empty string');
  }
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) {
    throw new Error('Invalid storage key: path traversal is not allowed');
  }
  return normalized;
}

/**
 * LocalTestStorage simulates Cloudflare R2/KV using the local filesystem.
 * Data is written to `tests/__fixtures__/generated/` relative to this file.
 */
export class LocalTestStorage {
  private baseDir: string;

  constructor(baseDir = FIXTURES_DIR) {
    this.baseDir = baseDir;
  }

  /** Ensure directory exists for a given filepath */
  private async ensureDirForFile(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Put a value into storage.
   * - If `value` is an object, it will be stored as JSON.
   * - If `value` is a string or Buffer, it will be stored as text.
   */
  async put(key: string, value: unknown): Promise<void> {
    const safeKey = sanitizeKey(key);
    const filePath = path.join(this.baseDir, safeKey);

    try {
      await this.ensureDirForFile(filePath);
      let data: string | Buffer;
      if (value === null || value === undefined) {
        data = '';
      } else if (typeof value === 'string' || Buffer.isBuffer(value)) {
        data = value as any;
      } else {
        // Attempt to serialize as JSON
        data = JSON.stringify(value, null, 2);
      }

      await fs.writeFile(filePath, data, { encoding: typeof data === 'string' ? 'utf8' : undefined });
    } catch (err: any) {
      throw new Error(`Failed to put key ${key} into LocalTestStorage: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * Get a value from storage. Attempts to parse JSON; falls back to string.
   * Returns `null` if the file does not exist.
   */
  async get(key: string): Promise<unknown | null> {
    const safeKey = sanitizeKey(key);
    const filePath = path.join(this.baseDir, safeKey);

    try {
      const buf = await fs.readFile(filePath);
      const text = buf.toString('utf8');
      // Try to parse JSON
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        return null;
      }
      throw new Error(`Failed to get key ${key} from LocalTestStorage: ${err?.message ?? String(err)}`);
    }
  }

  /** Delete a key from storage. Returns true if deleted, false if it did not exist. */
  async delete(key: string): Promise<boolean> {
    const safeKey = sanitizeKey(key);
    const filePath = path.join(this.baseDir, safeKey);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        return false;
      }
      throw new Error(`Failed to delete key ${key} from LocalTestStorage: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * List keys under a prefix. Returns array of keys relative to the storage base.
   */
  async list(prefix = ''): Promise<string[]> {
    const safePrefix = sanitizeKey(prefix);
    const dirPath = path.join(this.baseDir, safePrefix);
    const results: string[] = [];

    async function walk(dir: string) {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (err: any) {
        if (err && err.code === 'ENOENT') {
          return; // no files under prefix
        }
        throw err;
      }

      for (const entry of entries) {
        const full = path.join(dir, entry);
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await walk(full);
        } else if (stat.isFile()) {
          const rel = path.relative(path.join(FileHelper.baseDir()), full).replace(/\\/g, '/');
          results.push(rel);
        }
      }
    }

    // Helper to access the same baseDir inside nested function
    const FileHelper = {
      baseDir: () => this.baseDir
    };

    try {
      await walk(dirPath);
      return results;
    } catch (err: any) {
      throw new Error(`Failed to list keys under prefix ${prefix}: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * Remove all stored fixtures under the base directory. Use with caution in tests.
   */
  async clear(): Promise<void> {
    try {
      await fs.rm(this.baseDir, { recursive: true, force: true });
    } catch (err: any) {
      throw new Error(`Failed to clear LocalTestStorage at ${this.baseDir}: ${err?.message ?? String(err)}`);
    }
  }
}
