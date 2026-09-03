/**
 * Card-art grouping: which printings of a card show the same illustration.
 *
 * Produced by `.github/scripts/build-art-groups.py`, which compares each
 * printing's art band and collapses printings that share both a drawing and a
 * colourway. A gold secret rare stays its own entry — same drawing, different
 * art — which is how a collector reads it.
 *
 * Optional artifact: the grouping workflow may not have run yet, and a Tier
 * List with no card-art tab is better than one that throws. Absence degrades to
 * an empty catalogue.
 * @module src/lib/data/artGroups
 */

import { dataClient } from './client';

const { fetchJsonOptional } = dataClient;

/** How many distinct arts a card needs before ranking it is worth the trouble. */
export const MIN_ARTS_TO_RANK = 3;

/**
 * How many arts a card needs to appear in the picker before anything is typed.
 *
 * Two thresholds because browsing and searching want different things. A user
 * who has typed "rare" knows what they are after and should find Rare Candy
 * whether it has three arts or twenty. A user who has typed nothing is looking
 * for something worth ranking, and the three-art tail is 233 cards deep —
 * mostly a promo, a reprint and a staff stamp, which is a list of three, not a
 * tier list. Five is where a card starts having enough arts to rank; it puts
 * 97 cards in the default scroll where the old head-of-list cap showed eight.
 */
export const MIN_ARTS_TO_BROWSE = 5;

interface ArtGroupsPayload {
  version: number;
  cards: Record<string, { arts: string[][]; unmatched: string[] }>;
}

/** One printing, as the picker and the board show it. */
export interface CardArt {
  /** `SET::NUMBER`, the art group's earliest printing and its representative. */
  ref: string;
  set: string;
  number: string;
}

/** A card worth building a tier list over. */
export interface ArtCard {
  name: string;
  /** One entry per distinct illustration, in release order. */
  arts: CardArt[];
}

function toArt(ref: string): CardArt | null {
  const [set, number] = ref.split('::');
  return set && number ? { ref, set, number } : null;
}

/**
 * Every card with at least {@link MIN_ARTS_TO_RANK} distinct arts, richest
 * first, so the picker's default suggestions are the cards actually worth
 * ranking. Returns `[]` when the artifact is missing.
 */
export async function fetchArtCards(): Promise<ArtCard[]> {
  const payload = await fetchJsonOptional<ArtGroupsPayload>('/assets/card-art-groups.json');
  if (!payload?.cards) {
    return [];
  }
  const cards: ArtCard[] = [];
  for (const [name, entry] of Object.entries(payload.cards)) {
    // The first member of each group is that art's earliest printing — the
    // producer writes groups in the order Limitless lists prints.
    const arts = entry.arts.map(group => toArt(group[0] ?? '')).filter((a): a is CardArt => a !== null);
    if (arts.length >= MIN_ARTS_TO_RANK) {
      cards.push({ name, arts });
    }
  }
  return cards.sort((a, b) => b.arts.length - a.arts.length || a.name.localeCompare(b.name));
}

/**
 * The cards the picker offers with an empty query. A subset of what stays
 * searchable, never a different order — {@link fetchArtCards} has already put
 * the richest first, which is the order to browse in.
 */
export function browsableArtCards(cards: readonly ArtCard[]): ArtCard[] {
  return cards.filter(card => card.arts.length >= MIN_ARTS_TO_BROWSE);
}
