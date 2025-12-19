/**
 * Card types database utilities for server-side (Cloudflare Workers)
 * @module lib/cardTypesDatabase
 */

/**
 * Fetch and parse card types database from R2/KV
 * @param {object} env - Cloudflare Workers environment
 * @returns {Promise<Object>}
 */
export async function loadCardTypesDatabase(env) {
  try {
    // Try to get from KV first (faster)
    if (env.CARD_TYPES_KV) {
      const cached = await env.CARD_TYPES_KV.get('card-types-database', 'json');
      if (cached) {
        return cached;
      }
    }

    // Fall back to R2 bucket
    if (env.REPORTS) {
      const object = await env.REPORTS.get('assets/data/card-types.json');
      if (object) {
        const text = await object.text();
        const data = JSON.parse(text);

        // Cache in KV if available
        if (env.CARD_TYPES_KV) {
          await env.CARD_TYPES_KV.put('card-types-database', JSON.stringify(data), {
            expirationTtl: 86400 // Cache for 24 hours
          });
        }

        return data;
      }
    }

    console.warn('Card types database not found');
    return {};
  } catch (error) {
    console.error('Failed to load card types database:', error.message);
    return {};
  }
}

/**
 * Get card type information for a specific card
 * @param {Object} database - Card types database
 * @param {string} setCode - Card set code
 * @param {string|number} number - Card number
 * @returns {Object|null}
 */
export function getCardType(database, setCode, number) {
  if (!database || !setCode || !number) {
    return null;
  }

  const key = `${setCode}::${number}`;
  return database[key] || null;
}

/**
 * Enrich a card object with type information from the database
 * Preserves existing type information but adds missing fields
 * @param {Object} card - Card object with set and number
 * @param {Object} database - Card types database
 * @returns {Object} - Enriched card object
 */
export function enrichCardWithType(card, database) {
  if (!card || !card.set || !card.number || !database) {
    return card;
  }

  const typeInfo = getCardType(database, card.set, card.number);
  if (!typeInfo) {
    return card;
  }

  const enriched = { ...card };

  // Only set category if not already present
  if (!enriched.category && typeInfo.cardType) {
    enriched.category = typeInfo.cardType;
  }

  // Only set trainer subtype if not already present
  if (typeInfo.cardType === 'trainer' && typeInfo.subType && !enriched.trainerType) {
    enriched.trainerType = typeInfo.subType;
  }

  // Only set energy subtype if not already present
  if (typeInfo.cardType === 'energy' && typeInfo.subType && !enriched.energyType) {
    enriched.energyType = typeInfo.subType;
  }

  // Add evolution info if this is a Pokemon
  if (typeInfo.cardType === 'pokemon' && typeInfo.evolutionInfo && !enriched.evolutionInfo) {
    enriched.evolutionInfo = typeInfo.evolutionInfo;
  }

  // Add full type string for reference
  if (typeInfo.fullType && !enriched.fullType) {
    enriched.fullType = typeInfo.fullType;
  }

  if (typeInfo.cardType === 'trainer' && typeInfo.aceSpec) {
    enriched.aceSpec = true;
  }

  return enriched;
}

/**
 * Enrich all cards in a deck with type information
 * @param {Object} deck - Deck object with cards array
 * @param {Object} database - Card types database
 * @returns {Object} - Deck with enriched cards
 */
export function enrichDeckCards(deck, database) {
  if (!deck || !Array.isArray(deck.cards) || !database) {
    return deck;
  }

  return {
    ...deck,
    cards: deck.cards.map(card => enrichCardWithType(card, database))
  };
}

/**
 * Enrich all decks with type information
 * @param {Array<Object>} decks - Array of deck objects
 * @param {Object} database - Card types database
 * @returns {Array<Object>} - Array of enriched decks
 */
export function enrichAllDecks(decks, database) {
  if (!Array.isArray(decks) || !database) {
    return decks;
  }

  return decks.map(deck => enrichDeckCards(deck, database));
}
