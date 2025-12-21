/**
 * On-the-fly card type fetcher and cache updater
 * Fetches missing card types from Limitless TCG and updates the database
 * @module lib/cardTypeFetcher
 */

const RATE_LIMIT_DELAY_MS = 250;
const DEFAULT_FETCH_TIMEOUT_MS = 10000; // 10 seconds

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetch with timeout wrapper to prevent hanging requests
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function persistCardTypesDatabase(env, database) {
  if (!env?.REPORTS?.put || !database) {
    return;
  }

  await env.REPORTS.put('assets/data/card-types.json', JSON.stringify(database, null, 2), {
    httpMetadata: {
      contentType: 'application/json'
    }
  });

  if (env.CARD_TYPES_KV) {
    await env.CARD_TYPES_KV.delete('card-types-database');
  }
}

function buildNumberVariants(value) {
  if (value === undefined || value === null) {
    return [];
  }
  const raw = String(value).trim();
  if (!raw) {
    return [];
  }
  const normalized = raw.toUpperCase();
  const match = normalized.match(/^0*(\d+)([A-Z]*)$/);
  if (!match) {
    return [normalized];
  }
  const [, digits, suffix = ''] = match;
  const trimmedDigits = digits.replace(/^0+/, '') || '0';
  const withoutLeadingZeros = `${trimmedDigits}${suffix}`;
  const variants = [];
  variants.push(withoutLeadingZeros);
  if (withoutLeadingZeros !== normalized) {
    variants.push(normalized);
  }
  return variants;
}

/**
 * Fetch card type from Limitless TCG website
 * @param {string} setCode - Card set code
 * @param {string|number} number - Card number
 * @returns {Promise<Object|null>}
 */
async function fetchCardTypeFromLimitless(setCode, number) {
  const numberVariants = buildNumberVariants(number);
  if (numberVariants.length === 0) {
    return null;
  }

  for (const variant of numberVariants) {
    const result = await fetchCardTypeVariant(setCode, variant);
    if (result) {
      return result;
    }
  }

  return null;
}

async function fetchCardTypeVariant(setCode, numberVariant) {
  try {
    const url = `https://limitlesstcg.com/cards/${setCode}/${numberVariant}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Ciphermaniac/1.0 (Card Type Enrichment)'
      }
    });

    if (response.status === 404) {
      console.warn(`[CardTypeFetcher] ${setCode}::${numberVariant} not found on Limitless`);
      return null;
    }

    if (!response.ok) {
      console.warn(`[CardTypeFetcher] Failed to fetch ${setCode}::${numberVariant} from Limitless: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Parse the card-text-type div
    const typeMatch = html.match(/<div class="card-text-type"[^>]*>([\s\S]*?)<\/div>/i);
    if (!typeMatch) {
      console.warn(`[CardTypeFetcher] Could not find type div for ${setCode}::${numberVariant}`);
      return null;
    }

    const rawType = typeMatch[1].replace(/<[^>]+>/g, ' ');
    const fullType = rawType
      .replace(/\s+/g, ' ')
      .replace(/\s*–\s*/g, ' - ')
      .trim();
    const parts = fullType
      .split(/\s*-\s*/)
      .map(part => part.trim())
      .filter(Boolean);
    const normalize = value =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    const result = {
      fullType,
      lastUpdated: new Date().toISOString()
    };

    // Parse card type
    const mainType = normalize(parts[0]);
    if (mainType === 'pokemon') {
      result.cardType = 'pokemon';
      // Extract evolution info if present
      if (parts.length > 1) {
        result.evolutionInfo = parts.slice(1).join(' - ');
      }
    } else if (mainType === 'trainer') {
      result.cardType = 'trainer';
      const subtypeText = parts[1] ? normalize(parts[1]) : '';
      if (subtypeText.includes('tool')) {
        result.subType = 'tool';
      } else if (subtypeText.includes('supporter')) {
        result.subType = 'supporter';
      } else if (subtypeText.includes('stadium')) {
        result.subType = 'stadium';
      } else if (subtypeText) {
        result.subType = subtypeText.replace(/\s+/g, '-');
      }
      const hasAceSpec = parts.some(part => normalize(part).includes('ace spec'));
      if (hasAceSpec) {
        result.aceSpec = true;
        if (result.subType !== 'tool') {
          result.subType = 'tool';
        }
      }
    } else if (mainType === 'energy') {
      result.cardType = 'energy';
      if (parts[1]) {
        const energyType = normalize(parts[1]);
        if (energyType.includes('basic')) {
          result.subType = 'basic';
        } else if (energyType.includes('special')) {
          result.subType = 'special';
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`[CardTypeFetcher] Error fetching ${setCode}::${numberVariant}:`, error.message);
    return null;
  }
}

/**
 * Check if a card needs type enrichment
 * @param {Object} card - Card object
 * @returns {boolean}
 */
function needsTypeEnrichment(card) {
  // Card needs enrichment if it's missing category or subtype info
  if (!card.category) {
    return true;
  }

  if (card.category === 'trainer' && !card.trainerType) {
    return true;
  }

  if (card.category === 'energy' && !card.energyType) {
    return true;
  }

  return false;
}

/**
 * Fetch and cache missing card type, then update the database
 * @param {Object} card - Card object with set and number
 * @param {Object} database - Current card types database
 * @param {Object} env - Cloudflare Workers environment
 * @returns {Promise<Object>} - Enriched card with type info
 */
export async function fetchAndCacheCardType(card, database, env, options = {}) {
  if (!card || !card.set || !card.number) {
    return card;
  }

  const { persist = true, recordUpdates } = options;
  const key = `${card.set}::${card.number}`;

  // Check if already in database
  if (database[key] && !needsTypeEnrichment(card)) {
    return card;
  }

  console.log(`[CardTypeFetcher] Fetching type for ${key}...`);

  // Fetch from Limitless
  const typeInfo = await fetchCardTypeFromLimitless(card.set, card.number);

  if (!typeInfo) {
    // Failed to fetch, return card as-is
    return card;
  }

  // eslint-disable-next-line no-param-reassign
  database[key] = typeInfo;
  if (recordUpdates) {
    recordUpdates[key] = typeInfo;
  }

  if (persist) {
    await persistCardTypesDatabase(env, database);
    console.log(`[CardTypeFetcher] Updated database with ${key}`);
  }

  // Enrich the card object
  const enriched = { ...card };

  if (typeInfo.cardType) {
    enriched.category = typeInfo.cardType;
  }

  if (typeInfo.cardType === 'trainer' && typeInfo.subType) {
    enriched.trainerType = typeInfo.subType;
  }

  if (typeInfo.cardType === 'energy' && typeInfo.subType) {
    enriched.energyType = typeInfo.subType;
  }

  if (typeInfo.evolutionInfo) {
    enriched.evolutionInfo = typeInfo.evolutionInfo;
  }

  if (typeInfo.fullType) {
    enriched.fullType = typeInfo.fullType;
  }

  if (typeInfo.cardType === 'trainer' && typeInfo.aceSpec) {
    enriched.aceSpec = true;
  }

  return enriched;
}

/**
 * Batch fetch and cache missing card types
 * Rate-limited to avoid overwhelming Limitless TCG
 * @param {Array<Object>} cards - Array of card objects
 * @param {Object} database - Current card types database
 * @param {Object} env - Cloudflare Workers environment
 * @returns {Promise<Array<Object>>} - Array of enriched cards
 */
export async function batchFetchAndCacheCardTypes(cards, database, env) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return cards;
  }

  // Find cards that need fetching
  const cardsNeedingFetch = cards.filter(card => {
    const key = `${card.set}::${card.number}`;
    return !database[key] && needsTypeEnrichment(card);
  });

  if (cardsNeedingFetch.length === 0) {
    return cards;
  }

  console.log(`[CardTypeFetcher] Batch fetching ${cardsNeedingFetch.length} missing card types...`);

  const pendingUpdates = {};
  for (let index = 0; index < cardsNeedingFetch.length; index += 1) {
    const card = cardsNeedingFetch[index];
    await fetchAndCacheCardType(card, database, env, {
      persist: false,
      recordUpdates: pendingUpdates
    });

    if (index < cardsNeedingFetch.length - 1) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }

  const fetchedCount = Object.keys(pendingUpdates).length;
  if (fetchedCount > 0) {
    await persistCardTypesDatabase(env, database);
    console.log(`[CardTypeFetcher] Batch fetch complete. Persisted ${fetchedCount} card types.`);
  } else {
    console.log('[CardTypeFetcher] Batch fetch complete. No new card types required.');
  }

  return cards;
}

/**
 * Extract unique cards from decks
 * @param {Array<Object>} decks - Array of deck objects
 * @returns {Array<Object>} - Array of unique card objects
 */
function extractUniqueCards(decks) {
  const uniqueCardsMap = new Map();

  for (const deck of decks) {
    if (!deck.cards || !Array.isArray(deck.cards)) {
      continue;
    }

    for (const card of deck.cards) {
      if (!card.set || !card.number) {
        continue;
      }

      const key = `${card.set}::${card.number}`;
      if (!uniqueCardsMap.has(key)) {
        uniqueCardsMap.set(key, card);
      }
    }
  }

  return Array.from(uniqueCardsMap.values());
}

/**
 * Enrich decks with on-the-fly card type fetching
 * This is the main entry point for integrating into report generation
 * @param {Array<Object>} decks - Array of deck objects
 * @param {Object} database - Current card types database (will be mutated)
 * @param {Object} env - Cloudflare Workers environment
 * @returns {Promise<Array<Object>>} - Array of decks with enriched cards
 */
export async function enrichDecksWithOnTheFlyFetch(decks, database, env) {
  if (!Array.isArray(decks) || decks.length === 0 || !database || !env) {
    return decks;
  }

  // Extract all unique cards from decks
  const uniqueCards = extractUniqueCards(decks);

  // Batch fetch missing types
  await batchFetchAndCacheCardTypes(uniqueCards, database, env);

  // Database has been updated, no need to modify decks
  // The enrichment will happen in toCardEntries using the updated database
  return decks;
}
