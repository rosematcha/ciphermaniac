import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// --- Every advertised URL must resolve to a real route ---
//
// The sitemap once listed /suggested, /feedback, /toys/meta-binder and
// /toys/player-connections, none of which were ever routes — so Google was
// handed four 404s. Nothing tied the two lists together, so nothing caught it.
// This test does: it parses the router's own <Route path='...'> declarations
// and requires each <loc> in the sitemap to match one of them.

/** Route patterns declared in the SPA router, minus the `*` 404 catch-all. */
function declaredRoutes(): string[] {
  const source = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf-8');
  return [...source.matchAll(/<Route\s+path='([^']+)'/g)].map(m => m[1]).filter(path => path !== '*');
}

/** `/cards/:set/:number` matches `/cards/TEF/123`; param segments match anything. */
function routeMatches(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) {
    return false;
  }
  return patternParts.every((part, i) => part.startsWith(':') || part === pathParts[i]);
}

test('every sitemap URL resolves to a declared route', async () => {
  const { restore } = installMockCaches();
  try {
    const response = await onRequest({
      request: new Request('https://ciphermaniac.com/sitemap.xml'),
      env: {} as never
    });
    assert.strictEqual(response.status, 200);

    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
    assert.ok(locs.length > 0, 'sitemap produced no URLs');

    const routes = declaredRoutes();
    assert.ok(routes.length > 0, 'failed to parse routes out of src/main.tsx');

    const orphans = locs.filter(path => !routes.some(pattern => routeMatches(pattern, path)));
    assert.deepStrictEqual(orphans, [], `sitemap advertises paths with no matching route: ${orphans.join(', ')}`);
  } finally {
    restore();
  }
});
