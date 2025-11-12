/**
 * Client-side filtering for archetype analysis
 * 
 * When a filter combination isn't pre-generated on the server, this module
 * can generate the filtered report client-side using the raw deck data.
 */

import { logger } from './logger.js';

/**
 * Builds a card identifier from set and number
 * @param {string} set
 * @param {string|number} number
 * @returns {string}
 */
function buildCardId(set, number) {
  const normalized = String(number).padStart(3, '0');
  return `${set}~${normalized}`;
}

/**
 * Check if a deck matches the archetype
 * @param {object} deck - Deck object
 * @param {string} archetypeBase - Base archetype name to match
 * @returns {boolean}
 */
function deckMatchesArchetype(deck, archetypeBase) {
  const deckArchetype = deck.archetype || '';
  
  // Normalize both for comparison: lowercase, replace underscores with spaces, trim
  const normalizedDeck = deckArchetype.toLowerCase().replace(/_/g, ' ').trim();
  const normalizedArchetype = archetypeBase.toLowerCase().replace(/_/g, ' ').trim();
  
  return normalizedDeck === normalizedArchetype;
}

/**
 * Check if a deck matches the include/exclude filter
 * @param {object} deck - Deck object with cards array
 * @param {string|null} includeId - Card that must be present
 * @param {string|null} excludeId - Card that must be absent
 * @returns {boolean}
 */
function deckMatchesFilter(deck, includeId, excludeId) {
  const cards = deck.cards || [];
  const cardIds = new Set();
  
  for (const card of cards) {
    const cardId = buildCardId(card.set, card.number);
    cardIds.add(cardId);
  }
  
  // Check include requirement
  if (includeId && !cardIds.has(includeId)) {
    return false;
  }
  
  // Check exclude requirement
  if (excludeId && cardIds.has(excludeId)) {
    return false;
  }
  
  return true;
}

/**
 * Generate a filtered report from raw deck data
 * @param {Array<object>} decks - Array of deck objects
 * @param {string} archetypeBase - Base archetype name to filter by
 * @param {string|null} includeId - Card to include
 * @param {string|null} excludeId - Card to exclude
 * @returns {object} Report data with items array and deckTotal
 */
export function generateFilteredReport(decks, archetypeBase, includeId, excludeId) {
  logger.info('Generating client-side filtered report', {
    totalDecks: decks.length,
    archetypeBase,
    includeId,
    excludeId,
    sampleDeck: decks[0] ? {
      archetype: decks[0].archetype,
      cardCount: decks[0].cards?.length
    } : null
  });

  // First filter: only decks matching the archetype
  const archetypeDecks = decks.filter(deck => 
    deckMatchesArchetype(deck, archetypeBase)
  );

  // Get unique archetype names for debugging
  const uniqueArchetypes = [...new Set(decks.slice(0, 20).map(d => d.archetype))];

  logger.info(`Archetype filtering: ${archetypeDecks.length} of ${decks.length} decks match archetype`, {
    archetypeBase,
    normalizedArchetype: archetypeBase.toLowerCase().replace(/_/g, ' ').trim(),
    sampleArchetypes: uniqueArchetypes.slice(0, 10)
  });

  // Second filter: only decks matching include/exclude criteria
  const filteredDecks = archetypeDecks.filter(deck => 
    deckMatchesFilter(deck, includeId, excludeId)
  );

  logger.info(`Client-side filtering: ${filteredDecks.length} of ${archetypeDecks.length} archetype decks match`, {
    archetypeBase,
    includeId,
    excludeId
  });

  if (filteredDecks.length === 0) {
    return {
      items: [],
      deckTotal: 0
    };
  }

  // Aggregate card statistics
  const cardStats = new Map(); // cardId -> { found, counts: Map<count, occurrences> }

  for (const deck of filteredDecks) {
    const seenInDeck = new Map(); // cardId -> total count in this deck
    
    for (const card of deck.cards || []) {
      const cardId = buildCardId(card.set, card.number);
      const count = Number(card.count) || 0;
      seenInDeck.set(cardId, (seenInDeck.get(cardId) || 0) + count);
    }

    // Update global card stats
    for (const [cardId, totalCount] of seenInDeck.entries()) {
      if (!cardStats.has(cardId)) {
        cardStats.set(cardId, {
          cardId,
          found: 0,
          counts: new Map(),
          // Store first instance info
          name: null,
          set: null,
          number: null,
          supertype: null
        });
      }

      const stats = cardStats.get(cardId);
      stats.found += 1;
      stats.counts.set(totalCount, (stats.counts.get(totalCount) || 0) + 1);

      // Capture card details from first deck
      if (!stats.name) {
        for (const card of deck.cards || []) {
          const cid = buildCardId(card.set, card.number);
          if (cid === cardId) {
            stats.name = card.name;
            stats.set = card.set;
            stats.number = card.number;
            stats.supertype = card.supertype;
            break;
          }
        }
      }
    }
  }

  // Build items array
  const items = [];
  const deckTotal = filteredDecks.length;

  for (const stats of cardStats.values()) {
    const pct = (stats.found / deckTotal) * 100;
    
    // Build distribution array
    const dist = [];
    for (const [copies, players] of stats.counts.entries()) {
      const percent = (players / stats.found) * 100;
      dist.push({
        copies,
        players,
        percent: Math.round(percent * 100) / 100
      });
    }
    // Sort by copies descending
    dist.sort((a, b) => b.copies - a.copies);

    items.push({
      uid: stats.cardId,
      name: stats.name || stats.cardId,
      set: stats.set,
      number: stats.number,
      supertype: stats.supertype,
      found: stats.found,
      total: deckTotal,
      pct: Math.round(pct * 100) / 100,
      alwaysIncluded: stats.found === deckTotal,
      dist
    });
  }

  // Sort items by percentage descending, then by name
  items.sort((a, b) => {
    if (b.pct !== a.pct) {
      return b.pct - a.pct;
    }
    return (a.name || '').localeCompare(b.name || '');
  });

  return {
    items,
    deckTotal,
    generatedClientSide: true
  };
}

/**
 * Fetch all decks for the tournament
 * @param {string} tournament
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllDecks(tournament) {
  const tournamentEncoded = encodeURIComponent(tournament);
  
  // Fetch the centralized decks.json file
  const url = `https://r2.ciphermaniac.com/reports/${tournamentEncoded}/decks.json`;
  
  logger.debug('Fetching all decks data', { url });

  try {
    const response = await fetch(url);
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
    logger.warn('Could not fetch decks for client-side filtering', {
      url,
      error: error.message
    });
    throw error;
  }
}
