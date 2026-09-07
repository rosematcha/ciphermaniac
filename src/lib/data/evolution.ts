/**
 * Card evolution metadata: `"SET::NUMBER"` → the Pokemon a card evolves from.
 *
 * Reads a static asset rather than a report, so it bypasses the report client
 * and its release-path resolution entirely.
 * @module src/lib/data/evolution
 */

import { R2_BASE } from './client';

/**
 * Maps `"SET::NUMBER"` → the lowercase name of the Pokémon this card evolves from.
 * Sourced from the same `card-types.json` the workers use to enrich decks; loaded
 * once per session. Returns an empty map if the asset can't be fetched (callers
 * should treat evolution data as optional decoration, not load-bearing).
 */
export type EvolutionFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Build a cached loader around an injectable fetcher. The app uses the
 * browser fetcher below; the factory keeps the fallback and retry policy
 * independently testable without adding a cache-reset hook to production.
 */
export function createEvolutionMapLoader(fetcher: EvolutionFetcher): () => Promise<Map<string, string>> {
  let evolutionMapPromise: Promise<Map<string, string>> | null = null;

  return () => {
    if (evolutionMapPromise) {
      return evolutionMapPromise;
    }
    // Don't cache failures forever — a transient network blip shouldn't
    // permanently disable evolution collapsing for the session, so the pinned
    // promise is dropped before resolving the fallback empty map.
    evolutionMapPromise = (async () => {
      try {
        // Prefer the slim precomputed map (~20KB vs the 700KB full database);
        // fall back to deriving it from card-types.json until the pipeline has
        // published the slim artifact for the first time.
        const slim = await fetcher(`${R2_BASE}/assets/data/evolves-from.json`, { mode: 'cors' });
        if (slim.ok) {
          const entries = (await slim.json()) as Record<string, string>;
          return new Map<string, string>(Object.entries(entries));
        }
        const response = await fetcher(`${R2_BASE}/assets/data/card-types.json`, { mode: 'cors' });
        if (!response.ok) {
          evolutionMapPromise = null;
          return new Map<string, string>();
        }
        const db = (await response.json()) as Record<string, { evolutionInfo?: string }>;
        const map = new Map<string, string>();
        for (const [key, info] of Object.entries(db)) {
          const parent = parseEvolvesFrom(info?.evolutionInfo);
          if (parent) {
            map.set(key, parent.toLowerCase());
          }
        }
        return map;
      } catch {
        evolutionMapPromise = null;
        return new Map<string, string>();
      }
    })();
    return evolutionMapPromise;
  };
}

const browserFetch: EvolutionFetcher = (input, init) => globalThis.fetch(input, init);
export const fetchEvolutionMap = createEvolutionMapLoader(browserFetch);

function parseEvolvesFrom(info: string | undefined): string | null {
  if (!info) {
    return null;
  }
  const m = info.match(/Evolves from\s+(.+?)\s*$/i);
  if (!m) {
    return null;
  }
  return decodeHtmlEntities(m[1]).trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}
