/**
 * Slim per-card facets: category path, evolution stage, and pre-evolution name.
 *
 * The full card-types database is ~2.6MB, far too heavy to load for a sort, and
 * a report's own `category` can be stale — a report generated before a set was
 * scraped keeps a bare `"trainer"` with no subtype forever, which can't tell a
 * supporter from an item. This reads the ~100KB slim companion that
 * `scripts/build-card-types.mjs` publishes alongside `evolves-from.json`.
 *
 * Facets are decoration, not load-bearing: every failure resolves to an empty
 * map and callers fall back to whatever the report carries.
 * @module src/lib/data/cardFacets
 */

import { R2_BASE } from './client';
import { fetchEvolutionMap } from './evolution';

/** One card's facets, as stored in the slim artifact (terse keys). */
interface RawFacet {
  /** Category path, e.g. `"trainer/item"`, `"pokemon"`, `"energy/special"`. */
  c?: string;
  /** Evolution stage, e.g. `"basic"`, `"stage1"`, `"stage2"`, `"vstar"`. */
  s?: string;
  /** Lowercase name of the Pokémon this card evolves from. */
  e?: string;
}

export interface CardFacet {
  category: string | null;
  stage: string | null;
  evolvesFrom: string | null;
}

/** `"SET::NUMBER"` → that card's facets. */
export type CardFacetMap = Map<string, CardFacet>;

const EMPTY: CardFacetMap = new Map();

let facetsPromise: Promise<CardFacetMap> | null = null;

/**
 * Fetch the slim card-facets map, once per session.
 *
 * Mirrors `fetchEvolutionMap`: a transient failure drops the pinned promise so
 * a later call can retry rather than disabling facet-aware sorting for the rest
 * of the session.
 * @returns The facet map, or an empty map when the artifact can't be read
 */
export function fetchCardFacets(): Promise<CardFacetMap> {
  if (facetsPromise) {
    return facetsPromise;
  }
  facetsPromise = (async () => {
    try {
      const response = await fetch(`${R2_BASE}/assets/data/card-facets.json`, { mode: 'cors' });
      if (!response.ok) {
        // The facets artifact is published by the same daily job as
        // evolves-from. Until that job has run once, fall back to the older
        // companion: it carries no categories or stages, but it's enough to
        // group evolution lines, which is the larger half of deck order.
        return await facetsFromEvolutionMap();
      }
      const raw = (await response.json()) as Record<string, RawFacet>;
      const map: CardFacetMap = new Map();
      for (const [key, facet] of Object.entries(raw)) {
        map.set(key, {
          category: facet?.c ?? null,
          stage: facet?.s ?? null,
          evolvesFrom: facet?.e ?? null
        });
      }
      return map;
    } catch {
      facetsPromise = null;
      return EMPTY;
    }
  })();
  return facetsPromise;
}

/**
 * Degraded facet map built from the `evolves-from` companion: pre-evolution
 * names only, no category or stage.
 * @returns The partial map, or an empty one when that artifact is missing too
 */
async function facetsFromEvolutionMap(): Promise<CardFacetMap> {
  const evolutionMap = await fetchEvolutionMap();
  if (evolutionMap.size === 0) {
    facetsPromise = null;
    return EMPTY;
  }
  const map: CardFacetMap = new Map();
  for (const [key, parent] of evolutionMap) {
    map.set(key, { category: null, stage: null, evolvesFrom: parent });
  }
  return map;
}
