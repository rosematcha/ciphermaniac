/**
 * Deck-order sorting for a report's card list.
 *
 * Usage-descending is the right default for "what's played" questions, but it
 * scatters a deck's structure: Torchic lands twenty rows below the Blaziken ex
 * it feeds, and supporters interleave with items and energy. Deck order sorts
 * the way a player writes a list — Pokémon first, grouped into evolution lines,
 * then trainers by subtype, then energy — with usage still ranking within each
 * group.
 *
 * Pure module: it takes the facet map as an argument rather than fetching it,
 * and degrades to report-supplied categories when facets are unavailable.
 * @module src/lib/cardOrder
 */

import type { CardFacetMap } from './data/cardFacets';
import { cardSupercategory } from './cardStats';

/** A card as this module needs to see it — a structural subset of `CardItem`. */
export interface OrderableCard {
  name: string;
  pct?: number;
  set?: string;
  number?: string | number;
  category?: string;
  supertype?: string;
}

/**
 * Deck-list sections, in the order they appear. Trainers whose subtype is
 * unknown (a report built before the card was scraped, with no facet to
 * correct it) sort after every known trainer subtype rather than being guessed
 * into one. Basic energy goes last, the way a written list ends.
 */
export const DECK_SECTIONS = [
  'pokemon',
  'supporter',
  'item',
  'tool',
  'stadium',
  'trainerOther',
  'energySpecial',
  'energyBasic'
] as const;

export type DeckSection = (typeof DECK_SECTIONS)[number];

/**
 * Fallback stage ranking, used when a card's pre-evolution isn't in the list so
 * its depth can't be derived from the chain. VSTAR and VMAX both evolve from a
 * V, which is itself a Basic, so they rank alongside Stage 1.
 */
const STAGE_RANK: Record<string, number> = {
  basic: 0,
  stage1: 1,
  vstar: 1,
  vmax: 1,
  levelup: 1,
  stage2: 2
};

/** Guard against a malformed evolution chain looping forever. */
const MAX_CHAIN_DEPTH = 8;

/**
 * Normalize a Pokémon name for chain matching: the facet map stores lowercase
 * names with straight apostrophes, while report names can carry a typographic
 * one ("Lillie's Clefairy ex").
 * @param name - A card or pre-evolution name
 * @returns The comparison key
 */
function nameKey(name: string): string {
  return String(name ?? '')
    .replace(/['’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The `SET::NUMBER` key the slim artifacts are keyed by. */
function facetKey(card: OrderableCard): string | null {
  if (!card.set || card.number === undefined || card.number === null || card.number === '') {
    return null;
  }
  return `${card.set}::${card.number}`;
}

/**
 * Resolve a card's category path, preferring the facet map over the report.
 *
 * Reports freeze the category they were built with, so a card scraped after the
 * report was generated keeps a bare `"trainer"` there forever; the facet map is
 * rebuilt daily and is the fresher of the two. The report still wins when the
 * facet has no category at all.
 * @param card - The card to classify
 * @param facets - The slim facet map, or null when unavailable
 * @returns A category path such as `"trainer/item"`, or null when unknown
 */
export function resolveCategory(card: OrderableCard, facets: CardFacetMap | null): string | null {
  const key = facetKey(card);
  const facet = key && facets ? facets.get(key) : undefined;
  return facet?.category ?? card.category ?? null;
}

/**
 * Bucket a card into its deck-list section.
 * @param card - The card to place
 * @param facets - The slim facet map, or null when unavailable
 * @returns The section the card belongs to
 */
export function deckSection(card: OrderableCard, facets: CardFacetMap | null): DeckSection {
  const category = (resolveCategory(card, facets) ?? '').toLowerCase();
  if (category.startsWith('trainer')) {
    const sub = category.split('/')[1] ?? '';
    if (sub === 'supporter') {
      return 'supporter';
    }
    if (sub === 'item') {
      return 'item';
    }
    if (sub === 'tool') {
      return 'tool';
    }
    if (sub === 'stadium') {
      return 'stadium';
    }
    return 'trainerOther';
  }
  if (category.startsWith('energy')) {
    return category.split('/')[1] === 'special' ? 'energySpecial' : 'energyBasic';
  }
  if (category.startsWith('pokemon')) {
    return 'pokemon';
  }
  // No category anywhere: fall back to the supertype-based split the filters,
  // PTCGL export, and social graphics all share.
  const superCat = cardSupercategory(card);
  if (superCat === 'trainer') {
    return 'trainerOther';
  }
  return superCat === 'energy' ? 'energyBasic' : 'pokemon';
}

/** Where a card sits in its evolution line, once the line has been resolved. */
interface LinePosition {
  /** Normalized name of the line's lowest member present in the list. */
  root: string;
  /** Steps from that root; 0 for the root itself. */
  depth: number;
  /** The root card itself, so its printed stage can anchor the whole line. */
  rootCard: OrderableCard;
}

/**
 * Resolve each Pokémon's evolution line among the cards actually in the list.
 *
 * Depth is measured against the list, not against the National Dex: if an
 * archetype plays Blaziken ex without Combusken, Blaziken ex is its own root
 * and sorts on its own usage. That keeps the grouping honest about what the
 * deck contains instead of implying stages it never plays.
 * @param cards - The Pokémon-section cards
 * @param facets - The slim facet map, or null when unavailable
 * @returns Line position per card, in the order the cards were given
 */
function resolveLines(cards: OrderableCard[], facets: CardFacetMap | null): LinePosition[] {
  const present = new Set(cards.map(card => nameKey(card.name)));

  const parentOf = (card: OrderableCard): string | null => {
    const key = facetKey(card);
    const parent = key && facets ? facets.get(key)?.evolvesFrom : null;
    if (!parent) {
      return null;
    }
    const normalized = nameKey(parent);
    return present.has(normalized) ? normalized : null;
  };

  // Multiple printings of one Pokémon share a name and therefore a chain, so
  // one representative per name is enough to walk upward.
  const byName = new Map<string, OrderableCard>();
  for (const card of cards) {
    const key = nameKey(card.name);
    if (!byName.has(key)) {
      byName.set(key, card);
    }
  }

  return cards.map(card => {
    let current = card;
    let depth = 0;
    const seen = new Set<string>([nameKey(card.name)]);
    while (depth < MAX_CHAIN_DEPTH) {
      const parent = parentOf(current);
      if (!parent || seen.has(parent)) {
        break;
      }
      const next = byName.get(parent);
      if (!next) {
        break;
      }
      seen.add(parent);
      current = next;
      depth += 1;
    }
    return { root: nameKey(current.name), depth, rootCard: current };
  });
}

/**
 * A card's printed evolution stage as a depth, used to anchor a line whose
 * lower stages aren't in the list. Shieldon is a Stage 1 (it evolves from a
 * fossil item, which never lands in the Pokémon section), so without this its
 * Bastiodon would tie with it at depth 0 and sort above it on usage.
 */
function stageDepth(card: OrderableCard, facets: CardFacetMap | null): number {
  const key = facetKey(card);
  const stage = key && facets ? facets.get(key)?.stage : null;
  return stage ? (STAGE_RANK[stage.toLowerCase()] ?? 0) : 0;
}

const byPctThenName = (a: OrderableCard, b: OrderableCard): number =>
  (b.pct ?? 0) - (a.pct ?? 0) || a.name.localeCompare(b.name);

/**
 * Sort a report's cards into deck-list order.
 *
 * Sections come first (Pokémon → supporters → items → tools → stadiums →
 * energy). Within the Pokémon section, cards are grouped into evolution lines
 * ranked by their most-played member, and each line reads bottom-up
 * (Torchic → Combusken → Blaziken ex). Everywhere else, and between printings
 * of the same Pokémon, usage still decides.
 *
 * Stable and non-mutating: the input array is untouched.
 * @param cards - The report's cards
 * @param facets - The slim facet map, or null to sort on report categories alone
 * @returns A new array in deck order
 */
export function sortByDeckOrder<T extends OrderableCard>(cards: readonly T[], facets: CardFacetMap | null): T[] {
  const buckets = new Map<DeckSection, T[]>();
  for (const card of cards) {
    const section = deckSection(card, facets);
    const bucket = buckets.get(section);
    if (bucket) {
      bucket.push(card);
    } else {
      buckets.set(section, [card]);
    }
  }

  const out: T[] = [];
  for (const section of DECK_SECTIONS) {
    const bucket = buckets.get(section);
    if (!bucket?.length) {
      continue;
    }
    out.push(...(section === 'pokemon' ? sortPokemon(bucket, facets) : [...bucket].sort(byPctThenName)));
  }
  return out;
}

/**
 * Order the Pokémon section: evolution lines ranked by their best member, each
 * line read from its lowest stage upward.
 * @param cards - The Pokémon-section cards
 * @param facets - The slim facet map, or null when unavailable
 * @returns A new array in line order
 */
function sortPokemon<T extends OrderableCard>(cards: T[], facets: CardFacetMap | null): T[] {
  const lines = resolveLines(cards, facets);
  // Depth is the line root's printed stage plus the steps walked up from it, so
  // a line that starts mid-chain still reads in stage order internally.
  const rootStage = new Map<string, number>();
  const entries = cards.map((card, index) => {
    const { root, depth, rootCard } = lines[index];
    let base = rootStage.get(root);
    if (base === undefined) {
      base = stageDepth(rootCard, facets);
      rootStage.set(root, base);
    }
    return { card, root, depth: base + depth };
  });

  // A line ranks on its most-played card, so a two-of Torchic can't drag its
  // Blaziken ex to the bottom of the section.
  const lineScore = new Map<string, number>();
  for (const entry of entries) {
    const best = lineScore.get(entry.root);
    const pct = entry.card.pct ?? 0;
    if (best === undefined || pct > best) {
      lineScore.set(entry.root, pct);
    }
  }

  return entries
    .slice()
    .sort(
      (a, b) =>
        (lineScore.get(b.root) ?? 0) - (lineScore.get(a.root) ?? 0) ||
        a.root.localeCompare(b.root) ||
        a.depth - b.depth ||
        byPctThenName(a.card, b.card)
    )
    .map(entry => entry.card);
}
