import { R2_CARD_IMAGES } from './sources';
import { isRecord } from '../../../shared/data/validate';

/**
 * The marker's answer: R2 holds the art, whether it holds every printing too, and which cards
 * (`SET_NUM`, as image keys spell them) no source had.
 */
export interface R2Readiness {
  prints: boolean;
  unmirrored: readonly string[];
}

const CARDS_ONLY: R2Readiness = { prints: false, unmirrored: [] };

function readinessOf(marker: unknown): R2Readiness {
  if (!isRecord(marker) || marker.prints !== true) {
    return CARDS_ONLY;
  }
  const unmirrored = Array.isArray(marker.unmirrored) ? marker.unmirrored.filter(key => typeof key === 'string') : [];
  return { prints: true, unmirrored };
}

/** Session values: '0' not ready, '1' cards only, or the printings marker as JSON. */
function fromSession(cached: string | null): R2Readiness | null {
  if (cached === '1') {
    return CARDS_ONLY;
  }
  if (!cached?.startsWith('{')) {
    return null;
  }
  try {
    return readinessOf(JSON.parse(cached));
  } catch {
    return null;
  }
}

function toSession(readiness: R2Readiness | null): string {
  if (!readiness) {
    return '0';
  }
  return readiness.prints ? JSON.stringify({ prints: true, unmirrored: readiness.unmirrored }) : '1';
}

/** One storage read and at most one readiness request per page, including failures. */
export function createReadinessProbe(onReady: (readiness: R2Readiness) => void): () => void {
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
    const known = fromSession(cached);
    if (known) {
      onReady(known);
    } else if (cached !== '0') {
      // Nothing stored, or a value this code cannot read: ask the bucket.
      void fetch(`${R2_CARD_IMAGES}/_ready`)
        .then(async res => {
          const readiness = res.ok ? readinessOf(await res.json().catch(() => null)) : null;
          try {
            sessionStorage.setItem('cm:r2CardImages', toSession(readiness));
          } catch {
            /* storage unavailable */
          }
          if (readiness) {
            onReady(readiness);
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
