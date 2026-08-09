/**
 * Meta Binder classification.
 *
 * Given the archetypes you selected and their card reports, works out which
 * cards you'd physically need and sorts them into binder pages — staples first,
 * archetype-specific Pokémon grouped under their deck, tech cards off to the
 * side.
 *
 * Thresholds are carried over verbatim from the pre-rewrite tool
 * (`src/tools/metaBinderData.ts`, dropped in 586a898). They were tuned against
 * real binders and there's nothing to be gained by re-deriving them.
 *
 * What did change: the original read raw decklists and guessed at card types
 * from a hardcoded keyword list, because 2024-era reports carried no type data.
 * Modern `CardItem` has `category`, `trainerType` and `energyType` off the
 * card-types database, so this works from archetype reports alone — ~23KB per
 * archetype instead of a 23MB decks.json per event.
 *
 * Ace Specs get their own page, as in the original. `CardItem.aceSpec` comes off
 * the card-types database, which scripts/build-card-types.mjs populates from
 * Limitless's `is:ace` search — the card pages themselves carry no marker. The
 * flag covers special-energy Ace Specs too (Legacy Energy), so the check has to
 * come before the trainer/energy routing rather than inside it.
 *
 * Pure module: no fetching, no DOM. The page hands it data and renders the result.
 */

import type { CardItem } from '../types';
import { averageCopiesValue, cardSupercategory, roundedCopies } from './cardStats';

/** A card is "core" to an archetype at 60% inclusion. */
const HIGH_USAGE_RATIO = 0.6;
/** Below 35% a card reads as a tech choice rather than part of the list. */
const MODERATE_USAGE_RATIO = 0.35;
/** A staple has to show up in at least this many archetypes. */
const STAPLE_POKEMON_MIN_ARCHETYPES = 3;
/** A Pokémon needs this much inclusion somewhere to earn an archetype page. */
const ARCHETYPE_CORE_RATIO = 0.35;
const SUPPORTER_FREQUENT_GLOBAL_RATE = 0.25;
const SUPPORTER_HIGH_USAGE_ARCH_MIN = 2;
const ITEM_FREQUENT_GLOBAL_RATE = 0.2;
const ITEM_MOD_USAGE_ARCH_MIN = 2;
/** Staples must also be broadly played across the whole selection. */
const CROSS_ARCH_MIN_DECK_SHARE = 0.22;
/** Ignore cards that never reach a real deck count in any one archetype. */
const MIN_DECKS_PER_ARCHETYPE = 4;

/** One selected archetype and the card report backing it. */
export interface BinderArchetypeInput {
  /** Base name (URL/path key), e.g. `Dragapult`. */
  base: string;
  /** Display label, e.g. `Dragapult Dusknoir`. */
  label: string;
  /** Decks of this archetype in the selection. Drives deck-share weighting. */
  deckCount: number;
  items: CardItem[];
}

export interface BinderArchetypeUsage {
  base: string;
  label: string;
  /** Inclusion within that archetype, 0..1. */
  ratio: number;
  /** Decks of that archetype playing the card. */
  decks: number;
}

export interface BinderCard {
  /** Canonical `Name::SET::NUMBER`, also the prices.json key. */
  uid: string;
  name: string;
  set?: string;
  number?: string | number;
  /** Copies to own — the rounded weighted-mean of the copy histogram. */
  copies: number;
  /** Share of every deck in the selection playing it, 0..1. */
  deckShare: number;
  usageByArchetype: BinderArchetypeUsage[];
  highUsageArchetypes: number;
  moderateUsageArchetypes: number;
}

export type BinderSectionKey =
  | 'staplePokemon'
  | 'frequentSupporters'
  | 'nicheSupporters'
  | 'frequentItems'
  | 'nicheItems'
  | 'tools'
  | 'stadiums'
  | 'specialEnergy'
  | 'aceSpecs';

export interface BinderSection {
  key: BinderSectionKey;
  title: string;
  cards: BinderCard[];
}

/** Archetype-specific Pokémon, grouped under the deck that plays them. */
export interface BinderArchetypeGroup {
  base: string;
  label: string;
  deckCount: number;
  cards: BinderCard[];
}

export interface BinderResult {
  sections: BinderSection[];
  archetypeGroups: BinderArchetypeGroup[];
  totalDecks: number;
  /** Distinct cards across every section and group. */
  cardCount: number;
  /** Sum of `copies` across every card. */
  copyCount: number;
}

const SECTION_TITLES: Record<BinderSectionKey, string> = {
  staplePokemon: 'Staple Pokémon',
  frequentSupporters: 'Frequent Supporters',
  nicheSupporters: 'Niche Supporters',
  frequentItems: 'Frequent Items',
  nicheItems: 'Niche / Tech Items',
  tools: 'Tools',
  stadiums: 'Stadiums',
  specialEnergy: 'Special Energy',
  aceSpecs: 'Ace Specs'
};

const SECTION_ORDER: BinderSectionKey[] = [
  'staplePokemon',
  'frequentSupporters',
  'nicheSupporters',
  'frequentItems',
  'nicheItems',
  'tools',
  'stadiums',
  'specialEnergy',
  'aceSpecs'
];

/** Basic energy is excluded outright — nobody needs a binder page for it. */
function isBasicEnergy(item: CardItem): boolean {
  return cardSupercategory(item) === 'energy' && item.energyType !== 'special';
}

function uidFor(item: CardItem): string {
  if (item.uid) {
    return item.uid;
  }
  // Reports predating canonical uids: rebuild the same Name::SET::NUMBER shape
  // so pricing lookups still line up.
  return `${item.name}::${item.set ?? ''}::${item.number ?? ''}`;
}

/**
 * A staple is played broadly AND deeply: above the deck-share floor across the
 * whole selection, and core to at least three archetypes.
 *
 * The original also required `usageByArchetype[1].ratio >= 0.35 || qualifying
 * >= 4`. That clause can never change the answer: the list is sorted by ratio
 * descending, so three entries at ≥0.6 already put index 1 at ≥0.6. It's
 * dropped here rather than ported as decoration — don't restore it from the
 * old file.
 */
function isCrossArchetypeStaple(card: BinderCard): boolean {
  if (card.deckShare < CROSS_ARCH_MIN_DECK_SHARE) {
    return false;
  }
  const qualifying = card.usageByArchetype.filter(u => u.ratio >= HIGH_USAGE_RATIO);
  return qualifying.length >= STAPLE_POKEMON_MIN_ARCHETYPES;
}

/** Most-played first; ties broken by name so the order is stable across runs. */
function byPriority(a: BinderCard, b: BinderCard): number {
  if (b.deckShare !== a.deckShare) {
    return b.deckShare - a.deckShare;
  }
  return a.name.localeCompare(b.name);
}

interface Accumulator {
  item: CardItem;
  usage: BinderArchetypeUsage[];
  /** Σ(decks playing it), for the deck-share numerator. */
  decksWith: number;
  /** Weighted-mean copies, weighted by decks so a big archetype dominates. */
  copiesWeightSum: number;
  copiesDeckSum: number;
}

/**
 * Build the binder from the selected archetypes' reports.
 *
 * `deckShare` is Σ(archetype decks playing the card) / Σ(all selected decks).
 * The original computed this by counting raw decklists; weighting each
 * archetype's inclusion by its deck count is the same number without needing
 * the decklists.
 */
export function buildBinder(archetypes: BinderArchetypeInput[]): BinderResult {
  const totalDecks = archetypes.reduce((sum, a) => sum + Math.max(0, a.deckCount), 0);
  const empty: BinderResult = {
    sections: SECTION_ORDER.map(key => ({ key, title: SECTION_TITLES[key], cards: [] })),
    archetypeGroups: [],
    totalDecks,
    cardCount: 0,
    copyCount: 0
  };
  if (!archetypes.length || totalDecks <= 0) {
    return empty;
  }

  const acc = new Map<string, Accumulator>();
  for (const archetype of archetypes) {
    const decks = Math.max(0, archetype.deckCount);
    for (const item of archetype.items) {
      if (isBasicEnergy(item)) {
        continue;
      }
      const ratio = (item.pct ?? 0) / 100;
      if (ratio <= 0) {
        continue;
      }
      const uid = uidFor(item);
      const decksWith = decks * ratio;
      let entry = acc.get(uid);
      if (!entry) {
        entry = { item, usage: [], decksWith: 0, copiesWeightSum: 0, copiesDeckSum: 0 };
        acc.set(uid, entry);
      }
      entry.usage.push({ base: archetype.base, label: archetype.label, ratio, decks: decksWith });
      entry.decksWith += decksWith;
      const avg = averageCopiesValue(item);
      if (avg !== null && decksWith > 0) {
        entry.copiesWeightSum += avg * decksWith;
        entry.copiesDeckSum += decksWith;
      }
    }
  }

  const cards: BinderCard[] = [];
  for (const [uid, entry] of acc) {
    // The original's MIN_DECKS_PER_EVENT floor: a card has to actually show up
    // in a few decks somewhere. Without it, a 1-of in a 3-deck archetype reads
    // as 33% inclusion and lands in the binder as if it mattered.
    if (!entry.usage.some(u => u.decks >= MIN_DECKS_PER_ARCHETYPE)) {
      continue;
    }
    const usage = [...entry.usage].sort((a, b) => b.ratio - a.ratio);
    const avg = entry.copiesDeckSum > 0 ? entry.copiesWeightSum / entry.copiesDeckSum : 1;
    cards.push({
      uid,
      name: entry.item.name,
      set: entry.item.set,
      number: entry.item.number,
      copies: roundedCopies(entry.item, avg),
      deckShare: entry.decksWith / totalDecks,
      usageByArchetype: usage,
      highUsageArchetypes: usage.filter(u => u.ratio >= HIGH_USAGE_RATIO).length,
      moderateUsageArchetypes: usage.filter(u => u.ratio >= MODERATE_USAGE_RATIO).length
    });
  }

  const buckets = new Map<BinderSectionKey, BinderCard[]>(SECTION_ORDER.map(key => [key, []]));
  const archetypePokemon = new Map<string, BinderCard[]>();
  const itemByUid = new Map(cards.map(c => [c.uid, acc.get(c.uid)!.item]));

  // Every card lands in exactly one place. The order below is the original's,
  // and the early `continue` after each placement is what guarantees it.
  for (const card of cards) {
    const item = itemByUid.get(card.uid)!;

    const section = cardSupercategory(item);

    // Ace Specs first: you can only play one, so they're worth a page of their
    // own regardless of whether the card is an item, a tool or a special energy.
    if (item.aceSpec) {
      buckets.get('aceSpecs')!.push(card);
      continue;
    }

    if (section === 'pokemon') {
      if (isCrossArchetypeStaple(card)) {
        buckets.get('staplePokemon')!.push(card);
        continue;
      }
      // Otherwise it belongs to one archetype: its strongest, and only if it's
      // actually part of that list rather than a one-off tech pick.
      const primary = card.usageByArchetype.find(u => u.ratio >= ARCHETYPE_CORE_RATIO);
      if (primary) {
        const list = archetypePokemon.get(primary.base) ?? [];
        list.push(card);
        archetypePokemon.set(primary.base, list);
      }
      // No primary archetype → deliberately dropped. A Pokémon nobody plays at
      // 35% anywhere is not something you need in a binder.
      continue;
    }

    if (section === 'trainer') {
      if (item.trainerType === 'supporter') {
        const frequent =
          card.deckShare >= SUPPORTER_FREQUENT_GLOBAL_RATE || card.highUsageArchetypes >= SUPPORTER_HIGH_USAGE_ARCH_MIN;
        buckets.get(frequent ? 'frequentSupporters' : 'nicheSupporters')!.push(card);
        continue;
      }
      if (item.trainerType === 'stadium') {
        buckets.get('stadiums')!.push(card);
        continue;
      }
      if (item.trainerType === 'tool') {
        buckets.get('tools')!.push(card);
        continue;
      }
      // Items, and any trainer whose subtype the database doesn't carry — the
      // item buckets are the sane default for an unlabelled trainer.
      const frequent =
        card.deckShare >= ITEM_FREQUENT_GLOBAL_RATE || card.moderateUsageArchetypes >= ITEM_MOD_USAGE_ARCH_MIN;
      buckets.get(frequent ? 'frequentItems' : 'nicheItems')!.push(card);
      continue;
    }

    // Basic energy was filtered out above, so anything left here is special.
    buckets.get('specialEnergy')!.push(card);
  }

  const sections = SECTION_ORDER.map(key => ({
    key,
    title: SECTION_TITLES[key],
    cards: buckets.get(key)!.sort(byPriority)
  }));

  const labelByBase = new Map(archetypes.map(a => [a.base, a.label]));
  const decksByBase = new Map(archetypes.map(a => [a.base, a.deckCount]));
  const archetypeGroups: BinderArchetypeGroup[] = [...archetypePokemon.entries()]
    .map(([base, list]) => ({
      base,
      label: labelByBase.get(base) ?? base,
      deckCount: decksByBase.get(base) ?? 0,
      cards: list.sort(byPriority)
    }))
    .filter(group => group.cards.length > 0)
    // Biggest archetype first, so the binder opens on the decks you'll see most.
    .sort((a, b) => b.deckCount - a.deckCount || a.label.localeCompare(b.label));

  const placed = [...sections.flatMap(s => s.cards), ...archetypeGroups.flatMap(g => g.cards)];
  return {
    sections,
    archetypeGroups,
    totalDecks,
    cardCount: placed.length,
    copyCount: placed.reduce((sum, c) => sum + c.copies, 0)
  };
}

/** Plain-text checklist, for the clipboard and the print view. */
export function binderChecklist(result: BinderResult): string {
  const lines: string[] = [];
  const block = (title: string, cards: BinderCard[]) => {
    if (!cards.length) {
      return;
    }
    lines.push(
      title.toUpperCase(),
      ...cards.map(c => `  ${c.copies}x ${c.name} (${c.set ?? '?'} ${c.number ?? '?'})`),
      ''
    );
  };
  for (const section of result.sections) {
    block(section.title, section.cards);
  }
  for (const group of result.archetypeGroups) {
    block(group.label, group.cards);
  }
  return lines.join('\n').trimEnd();
}
