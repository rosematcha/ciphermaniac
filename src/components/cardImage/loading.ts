import { R2_CARD_IMAGES } from './sources';

/** One storage read and at most one readiness request per page, including failures. */
export function createReadinessProbe(onReady: () => void): () => void {
  let started = false;
  return () => {
    if (typeof window === 'undefined' || started) {
      return;
    }
    started = true;
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem('cm:r2CardImages');
    } catch {
      /* storage unavailable */
    }
    if (cached === '1') {
      onReady();
    } else if (cached === null) {
      void fetch(`${R2_CARD_IMAGES}/_ready`)
        .then(res => {
          void res.body?.cancel().catch(() => undefined);
          try {
            sessionStorage.setItem('cm:r2CardImages', res.ok ? '1' : '0');
          } catch {
            /* storage unavailable */
          }
          if (res.ok) {
            onReady();
          }
        })
        .catch(() => {
          /* leave the proxy as the source this page */
        });
    }
  };
}

const preloads = new Map<string, Promise<void>>();

/** Share concurrent downloads and decodes; leave settled caching to the browser. */
export function preloadImage(url: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  const cached = preloads.get(url);
  if (cached) {
    return cached;
  }
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  const pending = img
    .decode()
    .catch(() => undefined)
    .finally(() => preloads.delete(url));
  preloads.set(url, pending);
  return pending;
}
