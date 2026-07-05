/**
 * Client-side filtering for archetype analysis
 *
 * When a filter combination isn't pre-generated on the server, this module
 * can generate the filtered report client-side using the raw deck data.
 */

import { normalizeArchetypeName, normalizeCardNumber } from '../../shared/cardUtils.js';
import { logger } from './logger.js';
import {
  assignRanks,
  calculatePercentage,
  createDistFromHistogram,
  sortReportItems
} from '../../shared/reportUtils.js';
import type { Deck, DeckCard, Filter, Operator, PercentRule, PlacementRule } from '../types/index.js';

export type { Deck, DeckCard, Filter, Operator };

const SUCCESS_TAG_HIERARCHY = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'];

const PLACEMENT_TAG_RULES: PlacementRule[] = [
  { tag: 'winner', maxPlacing: 1, minPlayers: 2 },
  { tag: 'top2', maxPlacing: 2, minPlayers: 4 },
  { tag: 'top4', maxPlacing: 4, minPlayers: 8 },
  { tag: 'top8', maxPlacing: 8, minPlayers: 16 },
  { tag: 'top16', maxPlacing: 16, minPlayers: 32 }
];

const PERCENT_TAG_RULES: PercentRule[] = [
  { tag: 'top10', fraction: 0.1, minPlayers: 20 },
  { tag: 'top25', fraction: 0.25, minPlayers: 12 },
  { tag: 'top50', fraction: 0.5, minPlayers: 8 }
];

const OPERATOR_COMPARATORS: Record<string, (count: number, expected: number) => boolean> = {
  '=': (count, expected) => count === expected,
  '<': (count, expected) => count < expected,
  '<=': (count, expected) => count <= expected,
  '>': (count, expected) => count > expected,
  '>=': (count, expected) => count >= expected
};

// Local type alias for Card since we use DeckCard from types
type Card = DeckCard;

interface CardUsage {
  cardId: string;
  name: string;
  set?: string;
  number?: string | number;
  normalizedNumber?: string | null;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec: boolean;
  supertype?: string;
  uid?: string;
  found: number;
  deckInstances: Array<{ deckId: string; count: number; archetype?: string }>;
  histogram: Map<number, number>;
}

interface Distribution {
  copies: number;
  players: number;
  percent: number;
}

interface ReportItem {
  name: string;
  set?: string;
  number?: string | number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec: boolean;
  supertype?: string;
  uid?: string;
  cardId: string;
  found: number;
  total: number;
  pct: number;
  dist: Distribution[];
  deckInstances: Array<{ deckId: string; count: number; archetype?: string }>;
  rank: number;
}

export interface FilteredReport {
  deckTotal: number;
  items: ReportItem[];
  generatedClientSide?: boolean;
  raw?: {
    generatedClientSide: true;
    filterCount: number;
  };
}

/**
 * Builds a card identifier from set and number
 * Matches the offline include/exclude generator in .github/scripts/run-online-meta.mjs
 * @param set
 * @param number
 * @returns
 */
export function buildCardId(set: string, number: string | number | null | undefined): string {
  if (number === undefined || number === null) {
    return `${set}~`;
  }

  const raw = String(number).trim();
  if (!raw) {
    return `${set}~`;
  }

  // Extract digits and optional suffix (e.g., "118" or "118A")
  const match = /^(\d+)([A-Za-z]*)$/.exec(raw);
  if (!match) {
    // Non-standard format, use as-is but uppercase
    return `${set}~${raw.toUpperCase()}`;
  }

  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  const fullNumber = suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
  return `${set}~${fullNumber}`;
}

function deckMatchesArchetype(deck: Deck, archetypeBase: string): boolean {
  return normalizeArchetypeName(deck?.archetype) === normalizeArchetypeName(archetypeBase);
}

function getDeckCards(deck: Deck): Card[] {
  if (Array.isArray(deck?.cards)) {
    return deck.cards;
  }
  if (Array.isArray(deck?.deck)) {
    return deck.deck;
  }
  return [];
}

function deriveDeckId(deck: Deck, fallbackIndex: number): string {
  return (
    deck?.id ||
    deck?.deckId ||
    deck?.deckHash ||
    (typeof deck?.slug === 'string' && deck.slug) ||
    `client-deck-${fallbackIndex}`
  );
}

function buildCardKeyFromCard(card: Card): string | null {
  const setCode = typeof card?.set === 'string' ? card.set.trim().toUpperCase() : '';
  if (!setCode) {
    return null;
  }
  const normalizedNumber = normalizeCardNumber(card?.number);
  if (!normalizedNumber) {
    return null;
  }
  return buildCardId(setCode, normalizedNumber);
}

function buildDeckCardCounts(deck: Deck): Map<string, number> {
  const counts = new Map<string, number>();
  getDeckCards(deck).forEach(card => {
    const key = buildCardKeyFromCard(card);
    if (!key) {
      return;
    }
    const count = Number(card?.count ?? card?.copies ?? 0);
    counts.set(key, (counts.get(key) || 0) + count);
  });
  return counts;
}

// WeakMap cache to memoize deck card counts per deck object
const deckCardCountsCache = new WeakMap<Deck, Map<string, number>>();

/**
 * Get deck card counts with memoization to avoid recomputation during filtering
 */
function getDeckCardCounts(deck: Deck): Map<string, number> {
  const cached = deckCardCountsCache.get(deck);
  if (cached) {
    return cached;
  }
  const counts = buildDeckCardCounts(deck);
  deckCardCountsCache.set(deck, counts);
  return counts;
}

function normalizeFilters(filters: any[]): Filter[] {
  return (Array.isArray(filters) ? filters : [])
    .filter(filter => filter && typeof filter.cardId === 'string' && filter.cardId)
    .map(filter => {
      const numericCount = Number(filter.count);
      const hasCount = filter.count !== null && filter.count !== undefined && Number.isFinite(numericCount);
      return {
        cardId: filter.cardId,
        operator: filter.operator || null,
        count: hasCount ? numericCount : null
      };
    });
}

function matchesQuantity(
  count: number,
  operator: Operator | null | undefined,
  expected: number | null | undefined
): boolean {
  // Special case: 'any' means any count > 0
  if (operator === 'any') {
    return count > 0;
  }

  // Special case: '' (None) means count must be 0
  if (!operator) {
    return count === 0;
  }

  // For quantity operators, we need an expected value
  if (expected === null || expected === undefined) {
    return count > 0;
  }

  const comparator = OPERATOR_COMPARATORS[operator];
  if (!comparator) {
    return count > 0;
  }
  return comparator(count, expected);
}

function deckMatchesFilters(deck: Deck, filters: Filter[]): boolean {
  if (!filters.length) {
    return true;
  }
  const counts = getDeckCardCounts(deck);
  return filters.every(filter => {
    const count = counts.get(filter.cardId) || 0;
    return matchesQuantity(count, filter.operator, filter.count);
  });
}

/**
 *
 * @param decks
 */
function aggregateDecks(decks: Deck[]): FilteredReport {
  const cardUsage = new Map<string, CardUsage>();

  decks.forEach((deck, deckIndex) => {
    const cards = getDeckCards(deck);
    if (!cards.length) {
      return;
    }
    const deckId = deriveDeckId(deck, deckIndex);

    cards.forEach(card => {
      const cardId = buildCardKeyFromCard(card);
      if (!cardId) {
        return;
      }

      if (!cardUsage.has(cardId)) {
        const normalizedNumber = normalizeCardNumber(card?.number);
        cardUsage.set(cardId, {
          cardId,
          name: card?.name || 'Unknown Card',
          set: card?.set,
          number: card?.number || normalizedNumber,
          normalizedNumber,
          category: card?.category,
          trainerType: card?.trainerType,
          energyType: card?.energyType,
          aceSpec: Boolean(card?.aceSpec),
          supertype: card?.supertype,
          uid:
            card?.uid ||
            (card?.name && card?.set && normalizedNumber
              ? `${card.name}::${card.set}::${normalizedNumber}`
              : undefined),
          found: 0,
          deckInstances: [],
          histogram: new Map()
        });
      }

      const usage = cardUsage.get(cardId)!;
      const cardCount = Number(card?.count ?? card?.copies ?? 0);
      usage.found += 1;
      usage.deckInstances.push({
        deckId,
        count: cardCount,
        archetype: deck?.archetype
      });
      usage.histogram.set(cardCount, (usage.histogram.get(cardCount) || 0) + 1);
    });
  });

  const deckTotal = decks.length;
  const items = Array.from(cardUsage.values()).map(usage => {
    // Use shared distribution calculation - note: we sort by percent desc here (different from backend)
    const distEntries = createDistFromHistogram(usage.histogram, usage.found);
    const dist: Distribution[] = distEntries.sort((left, right) => {
      if (right.percent !== left.percent) {
        return right.percent - left.percent;
      }
      return right.copies - left.copies;
    });

    const pct = calculatePercentage(usage.found, deckTotal);

    return {
      name: usage.name,
      set: usage.set,
      number: usage.number,
      category: usage.category,
      trainerType: usage.trainerType,
      energyType: usage.energyType,
      aceSpec: Boolean(usage.aceSpec),
      supertype: usage.supertype,
      uid: usage.uid,
      cardId: usage.cardId,
      found: usage.found,
      total: deckTotal,
      pct,
      dist,
      deckInstances: usage.deckInstances.slice(),
      rank: 0
    };
  });

  // Use shared sorting and ranking
  const sortedItems = sortReportItems(items);
  const rankedItems = assignRanks(sortedItems);

  return { deckTotal, items: rankedItems };
}

function deriveSuccessTags(
  deck: Deck,
  sizes: Map<string, number> | null = null,
  counts: Map<string, number> | null = null
): string[] {
  const explicit = Array.isArray(deck?.successTags)
    ? deck.successTags.map(value => String(value).toLowerCase()).filter(Boolean)
    : [];
  if (explicit.length > 0) {
    return explicit;
  }

  const placing = Number.isFinite(deck?.placement) ? Number(deck.placement) : Number(deck?.placing);
  let players =
    Number.isFinite(deck?.tournamentPlayers) && deck.tournamentPlayers !== null
      ? Number(deck.tournamentPlayers)
      : Number(deck?.players);

  if ((!Number.isFinite(players) || players <= 1) && sizes && deck?.tournamentId) {
    const fallback = sizes.get(deck.tournamentId);
    if (Number.isFinite(fallback)) {
      players = fallback!;
    }
  }
  if ((!Number.isFinite(players) || players <= 1) && counts && deck?.tournamentId) {
    const countGuess = counts.get(deck.tournamentId);
    if (Number.isFinite(countGuess)) {
      players = countGuess!;
    }
  }

  if (!Number.isFinite(placing) || placing <= 0 || !Number.isFinite(players) || players <= 1) {
    return [];
  }

  const tags: string[] = [];
  PLACEMENT_TAG_RULES.forEach(rule => {
    if (players >= rule.minPlayers && placing <= rule.maxPlacing) {
      tags.push(rule.tag);
    }
  });

  PERCENT_TAG_RULES.forEach(rule => {
    if (players < rule.minPlayers) {
      return;
    }
    const cutoff = Math.max(1, Math.ceil(players * rule.fraction));
    if (placing <= cutoff) {
      tags.push(rule.tag);
    }
  });

  return tags;
}

/**
 * Filter decks down to a success bucket (winner/top2/top4/top8/top16/top10/top25/top50).
 * Uses the tags emitted by the ingest job; higher finishes already carry broader tags,
 * so a direct inclusion check is enough.
 * @param decks
 * @param tag
 * @returns
 */
export function filterDecksBySuccess(decks: Deck[], tag: string): Deck[] {
  if (!tag || tag === 'all') {
    return decks;
  }
  const normalized = String(tag).toLowerCase();
  if (!SUCCESS_TAG_HIERARCHY.includes(normalized)) {
    return decks;
  }

  // Build tournament size fallbacks so success tags can be derived even if the ingest didn't persist players.
  const sizeByTournament = new Map<string, number>();
  const countByTournament = new Map<string, number>();
  (Array.isArray(decks) ? decks : []).forEach(deck => {
    if (!deck) {
      return;
    }
    const tid = deck.tournamentId || deck.tournamentName || null;
    if (!tid) {
      return;
    }
    const players =
      Number.isFinite(deck.tournamentPlayers) && deck.tournamentPlayers !== null
        ? Number(deck.tournamentPlayers)
        : Number(deck.players);
    if (Number.isFinite(players) && players > 1) {
      sizeByTournament.set(tid, Math.max(sizeByTournament.get(tid) || 0, players));
    }
    const placing = Number.isFinite(deck?.placement) ? Number(deck.placement) : Number(deck?.placing);
    if (Number.isFinite(placing) && placing > 0) {
      const current = sizeByTournament.get(tid) || 0;
      sizeByTournament.set(tid, Math.max(current, placing));
    }
    countByTournament.set(tid, (countByTournament.get(tid) || 0) + 1);
  });

  return (Array.isArray(decks) ? decks : []).filter(deck => {
    const tags = deriveSuccessTags(deck, sizeByTournament, countByTournament);
    return tags.includes(normalized);
  });
}

function summarizeFilters(filters: Filter[]): string {
  if (!filters.length) {
    return 'no filters';
  }
  return filters
    .map(filter => {
      if (filter.operator && filter.count !== null && filter.count !== undefined) {
        return `${filter.cardId} ${filter.operator} ${filter.count}`;
      }
      return filter.cardId;
    })
    .join(', ');
}

/**
 * Generate filtered report for multiple filters.
 * @param decks - Array of deck objects to filter
 * @param archetypeBase - Base archetype name
 * @param filters - Array of filter objects with cardId, operator, expectedCount
 * @returns Filtered report with cards array
 */
/**
 * Return the decks matching an archetype + filter set, without aggregating into
 * a report. Shares the exact matching logic `generateReportForFilters` uses, so
 * callers that need the matching deck subset (e.g. co-occurrence analysis) see
 * the same decks the report was built from.
 * @param decks - Array of deck objects to filter
 * @param archetypeBase - Base archetype name
 * @param filters - Array of filter objects with cardId, operator, count
 * @returns The matching decks
 */
export function filterDecks(decks: Deck[], archetypeBase: string, filters: any[]): Deck[] {
  const normalizedFilters = normalizeFilters(filters);
  const archetypeDecks = decks.filter(deck => deckMatchesArchetype(deck, archetypeBase));
  return normalizedFilters.length
    ? archetypeDecks.filter(deck => deckMatchesFilters(deck, normalizedFilters))
    : archetypeDecks;
}

export function generateReportForFilters(decks: Deck[], archetypeBase: string, filters: any[]): FilteredReport {
  const normalizedFilters = normalizeFilters(filters);
  const matchingDecks = filterDecks(decks, archetypeBase, filters);

  logger.info('Generated client-side report for filters', {
    archetypeBase,
    totalDecks: decks.length,
    matchingDeckCount: matchingDecks.length,
    filters: summarizeFilters(normalizedFilters)
  });

  const report = aggregateDecks(matchingDecks);
  return {
    ...report,
    raw: {
      generatedClientSide: true,
      filterCount: normalizedFilters.length
    }
  };
}
