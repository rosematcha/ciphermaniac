/*
 * Ciphermaniac service worker (mobile plan P3.3).
 *
 * Deliberately conservative — three behaviors only:
 *
 *  1. Report JSON from r2.ciphermaniac.com: stale-while-revalidate. Repeat
 *     visits render from the last-seen data instantly while a background
 *     refresh updates the cache. Data changes ~daily, so briefly-stale is
 *     fine (same policy as the 6h HTTP cache, but instant and offline-safe).
 *  2. Same-origin /assets/ + /fonts/: cache-first. Bundle filenames are
 *     content-hashed and fonts are frozen, so these never go stale.
 *  3. Navigations: stale-while-revalidate on the app shell. Repeat visitors
 *     paint instantly from the cached shell (all content is client-rendered
 *     from hashed assets + JSON, so a briefly-stale shell is harmless); a
 *     background refresh keeps the cache current and covers offline.
 *
 * Card images are intentionally NOT cached here: they're no-cors/opaque
 * responses (quota-padded heavily by browsers) and already long-cached by
 * the HTTP cache.
 *
 * Bump VERSION to invalidate all SW caches.
 */
const VERSION = 'v2'; // v2: flush caches poisoned by the July 2026 _redirects outage
const JSON_CACHE = `cm-json-${VERSION}`;
const ASSET_CACHE = `cm-assets-${VERSION}`;
const SHELL_CACHE = `cm-shell-${VERSION}`;
const JSON_MAX_ENTRIES = 120;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keep = [JSON_CACHE, ASSET_CACHE, SHELL_CACHE];
      for (const key of await caches.keys()) {
        if (!keep.includes(key)) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })()
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // Cache.keys() is insertion-ordered; drop oldest first.
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

// Never cache an HTML body under a data/asset URL. During an outage the
// server can 200 the SPA shell for any path (that is exactly what the July
// 2026 _redirects catch-all did), and cache-first would then serve the
// poisoned entry forever.
function cacheable(response) {
  const type = response.headers.get('content-type') ?? '';
  return response.ok && !type.includes('text/html');
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(JSON_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(response => {
      if (cacheable(response)) {
        cache.put(request, response.clone()).then(() => trimCache(JSON_CACHE, JSON_MAX_ENTRIES));
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    return cached;
  }
  const fresh = await refresh;
  if (fresh) {
    return fresh;
  }
  return Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (cacheable(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

async function navigationStaleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match('/');
  const refresh = fetch(request)
    .then(response => {
      if (response.ok) {
        // Keep one shell copy fresh (also the offline fallback). The shell is
        // tiny HTML pointing at hashed assets, so serving it stale never
        // serves stale code — the asset URLs inside decide that.
        cache.put('/', response.clone());
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    return cached;
  }
  const fresh = await refresh;
  return fresh ?? Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(navigationStaleWhileRevalidate(request));
    return;
  }
  if (url.host === 'r2.ciphermaniac.com' && !url.pathname.startsWith('/card-images/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/'))) {
    event.respondWith(cacheFirst(request));
  }
});
