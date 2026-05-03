const CACHE_NAME = 'cm-v1';
const IMAGE_CACHE = 'cm-images-v1';
const STATIC_CACHE = 'cm-static-v1';

const STATIC_ASSETS = ['/assets/fonts/fraunces.woff2'];

// Cache static assets on install
self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME && key !== IMAGE_CACHE && key !== STATIC_CACHE)
            .map(key => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Card images from Limitless CDN: cache-first (images rarely change)
  if (url.hostname.includes('limitlesstcg') || url.hostname.includes('digitaloceanspaces')) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // R2 images: cache-first
  if (url.hostname === 'r2.ciphermaniac.com') {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Same-origin static assets (CSS, JS, fonts): stale-while-revalidate
  if (url.origin === self.location.origin && isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }

  // Everything else (HTML, API): network-first (don't cache navigations or dynamic data)
});

function isStaticAsset(pathname) {
  return /\.(css|js|woff2?|png|jpg|svg|ico)(\?|$)/.test(pathname);
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkFetch;
}
