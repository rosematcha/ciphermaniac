/**
 * Client-side filtering for archetype analysis
 *
 * When a filter combination isn't pre-generated on the server, this module
 * can generate the filtered report client-side using the raw deck data.
 */

import { normalizeCardNumber } from '../card/routing.js';
import { logger } from './logger.js';

const DECK_FETCH_TIMEOUT_MS = 30000;
const SUCCESS_TAG_HIERARCHY = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'];
const PLACEMENT_TAG_RULES = [
  { tag: 'winner', maxPlacing: 1, minPlayers: 2 },
  { tag: 'top2', maxPlacing: 2, minPlayers: 4 },
  { tag: 'top4', maxPlacing: 4, minPlayers: 8 },
  { tag: 'top8', maxPlacing: 8, minPlayers: 16 },
  { tag: 'top16', maxPlacing: 16, minPlayers: 32 }
];
const PERCENT_TAG_RULES = [
  { tag: 'top10', fraction: 0.1, minPlayers: 20 },
  { tag: 'top25', fraction: 0.25, minPlayers: 12 },
  { tag: 'top50', fraction: 0.5, minPlayers: 8 }
];
const OPERATOR_COMPARATORS = {
  '=': (count, expected) => count === expected,
  '<': (count, expected) => count < expected,
  '<=': (count, expected) => count <= expected,
  '>': (count, expected) => count > expected,
  '>=': (count, expected) => count >= expected
};

/**
 * Builds a card identifier from set and number
 * Matches the offline include/exclude generator in .github/scripts/run-online-meta.mjs
 * @param {string} set
 * @param {string|number} number
 * @returns {string}
 */
function buildCardId(set, number) {
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

function normalizeArchetypeName(value) {
  return (value || '').toLowerCase().replace(/_/g, ' ').trim();
}

function deckMatchesArchetype(deck, archetypeBase) {
  return normalizeArchetypeName(deck?.archetype) === normalizeArchetypeName(archetypeBase);
}

function getDeckCards(deck) {
  if (Array.isArray(deck?.cards)) {
    return deck.cards;
  }
  if (Array.isArray(deck?.deck)) {
    return deck.deck;
  }
  return [];
}

function deriveDeckId(deck, fallbackIndex) {
  return (
    deck?.id ||
    deck?.deckId ||
    deck?.deckHash ||
    (typeof deck?.slug === 'string' && deck.slug) ||
    `client-deck-${fallbackIndex}`
  );
}

function buildCardKeyFromCard(card) {
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

function buildDeckCardCounts(deck) {
  const counts = new Map();
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

function normalizeFilters(filters) {
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

function matchesQuantity(count, operator, expected) {
  // Special case: 'any' means any count > 0
  if (operator === 'any') {
    return count > 0;
  }

  // Special case: '' (None) means count must be 0
  if (!operator || operator === '') {
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

function deckMatchesFilters(deck, filters) {
  if (!filters.length) {
    return true;
  }
  const counts = buildDeckCardCounts(deck);
  return filters.every(filter => {
    const count = counts.get(filter.cardId) || 0;
    return matchesQuantity(count, filter.operator, filter.count);
  });
}

/**
 *
 * @param decks
 */
function aggregateDecks(decks) {
  const cardUsage = new Map();

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

      const usage = cardUsage.get(cardId);
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
  const items = Array.from(cardUsage.values())
    .map(usage => {
      const dist = Array.from(usage.histogram.entries())
        .map(([copies, players]) => ({
          copies,
          players,
          percent: usage.found ? Math.round(((players / usage.found) * 100 + Number.EPSILON) * 100) / 100 : 0
        }))
        .sort((left, right) => {
          if (right.percent !== left.percent) {
            return right.percent - left.percent;
          }
          return right.copies - left.copies;
        });

      const pct = deckTotal ? Math.round(((usage.found / deckTotal) * 100 + Number.EPSILON) * 100) / 100 : 0;

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
    })
    .sort((left, right) => {
      if (right.pct !== left.pct) {
        return right.pct - left.pct;
      }
      if (right.found !== left.found) {
        return right.found - left.found;
      }
      return (left.name || '').localeCompare(right.name || '');
    });

  const rankedItems = items.map((item, index) => ({
    ...item,
    rank: index + 1
  }));

  return { deckTotal, items: rankedItems };
}

function deriveSuccessTags(deck, sizes = null, counts = null) {
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
      players = fallback;
    }
  }
  if ((!Number.isFinite(players) || players <= 1) && counts && deck?.tournamentId) {
    const countGuess = counts.get(deck.tournamentId);
    if (Number.isFinite(countGuess)) {
      players = countGuess;
    }
  }

  if (!Number.isFinite(placing) || placing <= 0 || !Number.isFinite(players) || players <= 1) {
    return [];
  }

  const tags = [];
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
 * @param {Array} decks
 * @param {string} tag
 * @returns {Array}
 */
export function filterDecksBySuccess(decks, tag) {
  if (!tag || tag === 'all') {
    return decks;
  }
  const normalized = String(tag).toLowerCase();
  if (!SUCCESS_TAG_HIERARCHY.includes(normalized)) {
    return decks;
  }

  // Build tournament size fallbacks so success tags can be derived even if the ingest didn't persist players.
  const sizeByTournament = new Map();
  const countByTournament = new Map();
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

function summarizeFilters(filters) {
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

export { aggregateDecks };

/**
 * Generate filtered report for multiple filters.
 * @param {Array} decks - Array of deck objects to filter
 * @param {string} archetypeBase - Base archetype name
 * @param {Array} filters - Array of filter objects with cardId, operator, expectedCount
 * @returns {object} Filtered report with cards array
 */
export function generateReportForFilters(decks, archetypeBase, filters) {
  const normalizedFilters = normalizeFilters(filters);
  const archetypeDecks = decks.filter(deck => deckMatchesArchetype(deck, archetypeBase));
  const matchingDecks = normalizedFilters.length
    ? archetypeDecks.filter(deck => deckMatchesFilters(deck, normalizedFilters))
    : archetypeDecks;

  logger.info('Generated client-side report for filters', {
    archetypeBase,
    totalDecks: decks.length,
    archetypeDeckCount: archetypeDecks.length,
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

/**
 * Backward-compatible single-filter interface.
 * @param {Array} decks - Array of deck objects
 * @param {string} archetypeBase - Base archetype name
 * @param {string} includeId - Card ID to include
 * @param {string} excludeId - Card ID to exclude
 * @param {string} includeOperator - Operator for include filter
 * @param {number} includeCount - Expected count for include filter
 * @returns {object} Filtered report
 */
export function generateFilteredReport(
  decks,
  archetypeBase,
  includeId,
  excludeId,
  includeOperator = null,
  includeCount = null
) {
  const filters = [];
  if (includeId) {
    filters.push({
      cardId: includeId,
      operator: includeOperator,
      count: includeCount
    });
  }
  if (excludeId) {
    filters.push({ cardId: excludeId, operator: '=', count: 0 });
  }

  const report = generateReportForFilters(decks, archetypeBase, filters);
  return {
    ...report,
    generatedClientSide: true
  };
}

/**
 * Fetch all decks for a tournament.
 * @param {string} tournament - Tournament identifier
 * @returns {Promise<Array>} Array of deck objects
 */
export async function fetchAllDecks(tournament) {
  const tournamentEncoded = encodeURIComponent(tournament);
  const url = `https://r2.ciphermaniac.com/reports/${tournamentEncoded}/decks.json`;

  logger.debug('Fetching all decks data', { url });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DECK_FETCH_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();

    logger.info('Fetched all decks', {
      url,
      deckCount: data?.length || 0
    });

    return data || [];
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('Fetch timeout: Could not fetch decks for client-side filtering', {
        url,
        error: `Request timed out after ${DECK_FETCH_TIMEOUT_MS}ms`
      });
      throw new Error('Request timed out while fetching deck data');
    }

    logger.warn('Could not fetch decks for client-side filtering', {
      url,
      error: error.message
    });
    throw error;
  }
}
