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
 * The archetype producers write each `cards.json` in this order (see
 * {@link deckOrderedItems}), so the archetype page never loads card data to
 * sort; the page itself only groups with {@link deckSection}.
 *
 * Pure module: it takes the facet map as an argument rather than loading it,
 * and degrades to report-supplied categories when facets are unavailable.
 * @module shared/data/cardOrder
 */

import { decodeHtmlEntities } from '../api/upcomingParser';
import { canonicalizeVariant } from './cardIdentity';
import type { CardTypesDatabase } from './cardTypesDatabase';

/** One card's facets: category path, evolution stage, and pre-evolution name. */
export interface CardFacet {
  category: string | null;
  stage: string | null;
  evolvesFrom: string | null;
  /**
   * A Stage 1 whose card-types text records an empty "Evolves from": a fossil
   * Pokémon, which evolves from an Item and so starts its own line.
   */
  fossil?: boolean;
}

/** `"SET::NUMBER"` → that card's facets. */
export type CardFacetMap = Map<string, CardFacet>;

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
 * one ("Lillie's Clefairy ex"). The card-types database also spaces some
 * hyphens ("Jangmo - o", "Venusaur - EX") and drops accents ("Flabebe") that
 * card names keep.
 * @param name - A card or pre-evolution name
 * @returns The comparison key
 */
function nameKey(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, "'")
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The `SET::NUMBER` key the slim artifacts are keyed by. */
function facetKey(card: OrderableCard): string | null {
  const [set, number] = canonicalizeVariant(card.set, card.number);
  return set && number ? `${set}::${number}` : null;
}

/**
 * Resolve a card's category path, preferring the facet map over the report
 * unless the report's is the more specific of the two: a bare `"trainer"`
 * facet never hides `"trainer/supporter"`, and an ACE SPEC keeps its suffix.
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
  const facetCategory = categoryPath(key && facets ? facets.get(key)?.category : null);
  const own = categoryPath(card.category);
  if (!facetCategory || own?.startsWith(`${facetCategory}/`)) {
    return own ?? facetCategory ?? null;
  }
  return own?.endsWith('/acespec') ? `${facetCategory}/acespec` : facetCategory;
}

const TRAINER_SECTIONS = new Map<string, DeckSection>([
  ['supporter', 'supporter'],
  ['item', 'item'],
  ['tool', 'tool'],
  ['stadium', 'stadium']
]);

/** The section a category path names, or null when it names none. */
function categorySection(category: string): DeckSection | null {
  const [main, sub = ''] = category.toLowerCase().split('/');
  if (main === 'trainer') {
    return TRAINER_SECTIONS.get(sub) ?? 'trainerOther';
  }
  if (main === 'energy') {
    return sub === 'special' ? 'energySpecial' : 'energyBasic';
  }
  return main === 'pokemon' ? 'pokemon' : null;
}

/** The section for a card with no usable category, from its supertype. */
function supertypeSection(supertype: string | undefined): DeckSection {
  const value = (supertype ?? '').toLowerCase();
  if (value === 'trainer') {
    return 'trainerOther';
  }
  return value === 'energy' ? 'energyBasic' : 'pokemon';
}

/**
 * Bucket a card into its deck-list section.
 * @param card - The card to place
 * @param facets - The slim facet map, or null when unavailable
 * @returns The section the card belongs to
 */
export function deckSection(card: OrderableCard, facets: CardFacetMap | null): DeckSection {
  return categorySection(resolveCategory(card, facets) ?? '') ?? supertypeSection(card.supertype);
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

/**
 * Facets for every card in the card-types database, keyed `SET::NUMBER`.
 * Only string fields are read, and an entry with no usable category, stage or
 * parent is left out, so a malformed entry counts as a missing card instead of
 * breaking the sort or passing for a complete one.
 * @param database - The full card-types database, or null when it couldn't be read
 * @returns The facet map, or null when the database is missing or empty
 */
export function cardFacetsFromTypes(database: CardTypesDatabase | null): CardFacetMap | null {
  if (!database || Object.keys(database).length === 0) {
    return null;
  }
  const facets: CardFacetMap = new Map();
  for (const [key, entry] of Object.entries(database)) {
    const facet = facetOf(entry);
    if (facet) {
      facets.set(key, facet);
    }
  }
  return facets;
}

/** A trimmed string field, or null when it is missing, not a string, or blank. */
function text(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

/** A category path, trimmed and lower-cased, or null when blank. */
function categoryPath(value: string | null | undefined): string | null {
  return text(value)?.toLowerCase() ?? null;
}

/** One database entry's facet, or null when it carries nothing usable. */
function facetOf(entry: unknown): CardFacet | null {
  const fields = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
  const cardType = text(fields.cardType);
  const evolutionInfo = text(fields.evolutionInfo) ?? '';
  const parent = /Evolves from\s+(.+?)\s*$/i.exec(evolutionInfo)?.[1];
  const stage = text(fields.stage);
  const facet: CardFacet = {
    category: categoryPath(cardType ? [cardType, text(fields.subType)].filter(Boolean).join('/') : null),
    stage,
    evolvesFrom: parent ? decodeHtmlEntities(parent).trim().toLowerCase() : null,
    ...(isFossil(stage, evolutionInfo) ? { fossil: true } : {})
  };
  return facet.category || facet.stage || facet.evolvesFrom ? facet : null;
}

/** A Stage 1 recorded as evolving from nothing: "Stage 1 - Evolves from". */
function isFossil(stage: string | null, evolutionInfo: string): boolean {
  return stage?.toLowerCase() === 'stage1' && /Evolves from$/i.test(evolutionInfo);
}

/**
 * A report's items in deck order for the producers that write archetype
 * `cards.json`, each carrying the category it was sorted under so the page
 * groups it in the same section. With facets the order is complete and marked
 * `itemOrder: 'deck'`, which lets the browser keep it through its read-time
 * canonicalization. Without them, or when any Pokémon lacks a facet (a print
 * newer than the database), the evolution lines can't all be placed: it stays
 * unmarked so the page treats it as an older report, and `warn` names the
 * missing cards.
 * @param items - The report's items
 * @param facets - Facets from {@link cardFacetsFromTypes}, or null when the card-types database is missing
 * @param warn - The producer's logger
 * @returns The fields to merge into the report
 */
export function deckOrderedItems<T extends OrderableCard>(
  items: readonly T[],
  facets: CardFacetMap | null,
  warn: (message: string) => void
): { items: T[]; itemOrder?: 'deck' } {
  const sorted = sortByDeckOrder(
    items.map(item => withCategory(item, resolveCategory(item, facets))),
    facets
  );
  if (!facets) {
    return { items: sorted };
  }
  const missing = missingPokemonFacets(sorted, facets);
  if (missing.length > 0) {
    warn(`Card types lack ${missing.length} Pokémon (${missing.slice(0, 10).join(', ')}): left without itemOrder`);
    return { items: sorted };
  }
  return { items: sorted, itemOrder: 'deck' };
}

/** Stages that evolve from nothing, so they need no parent to place. */
const STANDALONE_STAGES = new Set(['basic']);

/**
 * Pokémon whose evolution can't be placed, by `SET::NUMBER` (or name with no
 * printing): no facet, or one with neither a standalone stage (a Basic, or a
 * fossil Stage 1) nor a parent name. Their lines may be wrong, so the order
 * isn't complete.
 */
function missingPokemonFacets(items: readonly OrderableCard[], facets: CardFacetMap): string[] {
  return items
    .filter(item => deckSection(item, facets) === 'pokemon')
    .map(item => [facetKey(item), item.name] as const)
    .filter(([key]) => !placesEvolution(key ? facets.get(key) : undefined))
    .map(([key, name]) => key ?? name);
}

function placesEvolution(facet: CardFacet | undefined): boolean {
  return Boolean(facet?.evolvesFrom || facet?.fossil || STANDALONE_STAGES.has(facet?.stage?.toLowerCase() ?? ''));
}

function withCategory<T extends OrderableCard>(item: T, category: string | null): T {
  return category && category !== item.category ? { ...item, category } : item;
}

/**
 * Facets for a producer, with a warning when the card-types database is
 * missing and archetype cards will ship unmarked in category order.
 * @param database - The card-types database, or null when it couldn't be read
 * @param warn - The producer's logger
 * @returns The facet map, or null
 */
export function producerFacets(
  database: CardTypesDatabase | null,
  warn: (message: string) => void
): CardFacetMap | null {
  const facets = cardFacetsFromTypes(database);
  if (!facets) {
    warn('No card-types database: archetype cards ship in category order, without evolution lines or itemOrder');
  }
  return facets;
}
