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
 *  3. Navigations: network-first, falling back to the last-cached app shell
 *     when offline. The cached shell is refreshed on every successful nav.
 *
 * Card images are intentionally NOT cached here: they're no-cors/opaque
 * responses (quota-padded heavily by browsers) and already long-cached by
 * the HTTP cache.
 *
 * Bump VERSION to invalidate all SW caches.
 */
const VERSION = 'v1';
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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(JSON_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(response => {
      if (response.ok) {
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
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function navigationNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Keep one shell copy fresh for offline fallback.
      cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match('/');
    return cached ?? Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(request));
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
