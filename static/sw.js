/*
 * Ciphermaniac service worker (mobile plan P3.3).
 *
 * Deliberately conservative — three behaviors only:
 *
 *  1. Report JSON from r2.ciphermaniac.com: stale-while-revalidate. Repeat
 *     visits render from the last-seen data instantly while a background
 *     refresh updates the cache. Data changes ~daily, so briefly-stale is
 *     fine (same policy as the 6h HTTP cache, but instant and offline-safe).
 *     Live files change by the minute, so they are left to the network.
 *  2. Same-origin /assets/ + /fonts/: cache-first. Bundle filenames are
 *     content-hashed and fonts are frozen, so these never go stale.
 *  3. Navigations: network-first on the app shell, cached copy only as the
 *     offline fallback. The shell must never be served stale: it points at
 *     content-hashed bundles, and after a deploy the old hashes are gone from
 *     the server — a stale shell means a blank page until refresh.
 *
 * Card images are intentionally NOT cached here: they're no-cors/opaque
 * responses (quota-padded heavily by browsers) and already long-cached by
 * the HTTP cache.
 *
 * Bump VERSION to invalidate all SW caches.
 */
const VERSION = 'v4'; // v4: event listings leave the JSON cache (see below)
const JSON_CACHE = `cm-json-${VERSION}`;
const ASSET_CACHE = `cm-assets-${VERSION}`;
const SHELL_CACHE = `cm-shell-${VERSION}`;
const JSON_MAX_ENTRIES = 120;
let jsonTrimPending = null;

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

function scheduleJsonTrim() {
  if (jsonTrimPending) {
    return jsonTrimPending;
  }
  jsonTrimPending = new Promise(resolve => setTimeout(resolve, 1000))
    .then(() => trimCache(JSON_CACHE, JSON_MAX_ENTRIES))
    .finally(() => {
      jsonTrimPending = null;
    });
  return jsonTrimPending;
}

// Never cache an HTML body under a data/asset URL. During an outage the
// server can 200 the SPA shell for any path (that is exactly what the July
// 2026 _redirects catch-all did), and cache-first would then serve the
// poisoned entry forever.
function cacheable(response) {
  const type = response.headers.get('content-type') ?? '';
  return response.ok && !type.includes('text/html');
}

// Storage failures must not turn a usable network response into a fetch error.
async function writeCache(cache, request, response, trim = false) {
  try {
    await cache.put(request, response);
    if (trim) {
      await scheduleJsonTrim();
    }
  } catch {
    // Quota, eviction, and trimming failures are safe to retry next request.
  }
}

// Register waitUntil during dispatch, before any cache lookup can yield.
// The response can resolve while its refresh/write/trim work is still pending.
function respondWithBackground(event, handler) {
  const background = [];
  const response = handler(event.request, work => background.push(work)).catch(() =>
    // Cache storage can be unavailable even when the network is usable.
    fetch(event.request).catch(() => Response.error())
  );
  event.respondWith(response);
  event.waitUntil(response.then(() => Promise.all(background)).catch(() => {}));
}

async function staleWhileRevalidate(request, keepAlive) {
  const cache = await caches.open(JSON_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).catch(() => null);
  keepAlive(
    refresh.then(response => {
      if (response && cacheable(response)) {
        return writeCache(cache, request, cached ? response : response.clone(), true);
      }
    })
  );
  if (cached) {
    return cached;
  }
  const fresh = await refresh;
  return fresh ?? Response.error();
}

async function cacheFirst(request, keepAlive) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  // Never let this handler reject: a rejected respondWith surfaces as an
  // opaque "ServiceWorker encountered an unexpected error" and kills the
  // module load outright. A clean network error at least hits the page's
  // recovery path.
  let response;
  try {
    response = await fetch(request);
  } catch {
    return Response.error();
  }
  if (cacheable(response)) {
    keepAlive(writeCache(cache, request, response.clone()));
  }
  return response;
}

async function navigationNetworkFirst(request, keepAlive) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Keep one shell copy purely as the offline fallback.
      keepAlive(writeCache(cache, '/', response.clone()));
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
    respondWithBackground(event, navigationNetworkFirst);
    return;
  }
  // Mutable release pointers must always reach the network.
  //
  // Event listings bypass the cache: an old index may name a deleted run.
  // Live rounds and deck reports bypass it too, so each poll gets the latest
  // result. Published tournament views also need fresh pairings each poll.
  if (
    url.host === 'r2.ciphermaniac.com' &&
    url.pathname !== '/current.json' &&
    url.pathname !== '/manifest.webmanifest' &&
    !url.pathname.startsWith('/channels/') &&
    !url.pathname.startsWith('/card-images/') &&
    !url.pathname.startsWith('/events/') &&
    !url.pathname.startsWith('/live/') &&
    !url.pathname.startsWith('/tournaments/')
  ) {
    respondWithBackground(event, staleWhileRevalidate);
    return;
  }
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/'))
  ) {
    respondWithBackground(event, cacheFirst);
  }
});
