import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequest } from '../../functions/sitemap.xml.ts';

// Minimal in-memory stand-in for the Cloudflare Cache API so we can observe the
// keys the sitemap function reads/writes.
function installMockCaches(): { keys: string[]; restore: () => void } {
  const keys: string[] = [];
  const store = new Map<string, Response>();
  const original = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = {
    default: {
      async match(key: string) {
        keys.push(`match:${key}`);
        const hit = store.get(key);
        return hit ? hit.clone() : undefined;
      },
      async put(key: string, res: Response) {
        keys.push(`put:${key}`);
        store.set(key, res.clone());
      }
    }
  };
  return {
    keys,
    restore: () => {
      (globalThis as { caches?: unknown }).caches = original;
    }
  };
}

// --- P-39: cache key must be normalized to origin + '/sitemap.xml' ---

test('sitemap cache key ignores query string (nonce cannot bypass cache)', async () => {
  const { keys, restore } = installMockCaches();
  try {
    const env = {} as never;
    const first = await onRequest({
      request: new Request('https://ciphermaniac.com/sitemap.xml?nonce=abc123'),
      env
    });
    assert.strictEqual(first.status, 200);

    const second = await onRequest({
      request: new Request('https://ciphermaniac.com/sitemap.xml?nonce=different'),
      env
    });
    assert.strictEqual(second.status, 200);

    // Every cache key used must be the normalized URL, regardless of the query.
    const normalized = 'https://ciphermaniac.com/sitemap.xml';
    for (const k of keys) {
      const url = k.split(':').slice(1).join(':');
      assert.strictEqual(url, normalized, `cache key should be normalized, got ${url}`);
    }

    // The second request must have been served from cache (a match hit), proving
    // the differing nonce did not bypass it.
    assert.ok(keys.includes(`match:${normalized}`));
    assert.ok(keys.includes(`put:${normalized}`));
  } finally {
    restore();
  }
});
