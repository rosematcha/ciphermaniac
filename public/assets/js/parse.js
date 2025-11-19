/**
 * Tournament report parsing and validation
 * @module Parse
 */

import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, validateType } from './utils/errorHandler.js';

/**
 * @typedef {object} CardDistributionEntry
 * @property {number} [copies]
 * @property {number} [players]
 * @property {number} [percent]
 */

/**
 * @typedef {object} CardItem
 * @property {number} [rank] - Card rank in usage
 * @property {string} name - Card name
 * @property {string} [uid] - Optional per-variant unique id (e.g., "Name::SET::NNN")
 * @property {string} [set] - Optional set code for Pokémon variants
 * @property {string|number} [number] - Optional card number for Pokémon variants
 * @property {string} [category] - Card classification slug (e.g., 'pokemon', 'trainer/supporter')
 * @property {string} [trainerType] - Trainer subtype when category is trainer (e.g., 'supporter')
 * @property {string} [energyType] - Energy subtype when category is energy (e.g., 'basic')
 * @property {boolean} [aceSpec] - Whether the card is an ACE SPEC
 * @property {number} found - Number of decks containing this card
 * @property {number} total - Total number of decks
 * @property {number} pct - Usage percentage
 * @property {CardDistributionEntry[]} [dist] - Distribution data across deck counts
 */

/**
 * @typedef {object} ParsedReport
 * @property {number} deckTotal - Total number of decks
 * @property {CardItem[]} items - Array of card usage items
 */

/**
 * Parse and validate tournament report data
 * @param {any} data - Raw report data
 * @returns {ParsedReport}
 * @throws {AppError}
 */
export function parseReport(data) {
  if (!data) {
    throw new AppError(ErrorTypes.PARSE, 'Report data is null or undefined');
  }

  validateType(data, 'object', 'report data');

  if (!Array.isArray(data.items)) {
    throw new AppError(ErrorTypes.PARSE, 'Report data must contain an items array', null, { data });
  }

  const { deckTotal } = data;
  if (typeof deckTotal !== 'number' || deckTotal < 0) {
    logger.warn('Invalid or missing deckTotal, using items length as fallback', { deckTotal });
  }

  // Validate and clean items
  const validItems = data.items.map((item, index) => validateAndCleanItem(item, index)).filter(item => item !== null);

  logger.info(`Parsed report with ${validItems.length} valid items out of ${data.items.length} total`);

  return {
    deckTotal: typeof deckTotal === 'number' && deckTotal >= 0 ? deckTotal : validItems.length,
    items: validItems
  };
}

/**
 * Validate and clean a single card item
 * @param {any} item - Raw item data
 * @param {number} index - Item index for error reporting
 * @returns {CardItem|null} - Cleaned item or null if invalid
 */
function validateAndCleanItem(item, index) {
  if (!item || typeof item !== 'object') {
    logger.warn(`Item at index ${index} is not an object, skipping`, item);
    return null;
  }

  const { name, found, total, pct, rank, dist, category } = item;

  // Name is required
  if (typeof name !== 'string' || name.trim() === '') {
    logger.warn(`Item at index ${index} has invalid name, skipping`, { name });
    return null;
  }

  // Found and total should be numbers
  const cleanFound = typeof found === 'number' ? found : 0;
  const cleanTotal = typeof total === 'number' ? total : 0;

  // Calculate percentage if missing or invalid
  let cleanPct = typeof pct === 'number' ? pct : 0;
  if (cleanTotal > 0 && (cleanPct === 0 || isNaN(cleanPct))) {
    cleanPct = (cleanFound / cleanTotal) * 100;
  }

  const cleanItem = {
    name: name.trim(),
    found: cleanFound,
    total: cleanTotal,
    pct: Math.round(cleanPct * 100) / 100 // Round to 2 decimal places
  };
  // Preserve optional variant metadata if present
  if (typeof item.uid === 'string' && item.uid) {
    cleanItem.uid = item.uid;
  }
  if (typeof item.set === 'string' && item.set) {
    cleanItem.set = item.set;
  }
  if (typeof item.number === 'string' || typeof item.number === 'number') {
    cleanItem.number = item.number;
  }
  if (typeof category === 'string' && category.trim()) {
    cleanItem.category = category.trim().toLowerCase();
  }
  const trainerType = typeof item.trainerType === 'string' ? item.trainerType.trim().toLowerCase() : '';
  if (trainerType) {
    cleanItem.trainerType = trainerType;
  }
  const energyType = typeof item.energyType === 'string' ? item.energyType.trim().toLowerCase() : '';
  if (energyType) {
    cleanItem.energyType = energyType;
  }

  // Optional fields
  if (typeof rank === 'number') {
    cleanItem.rank = rank;
  }

  if (item.aceSpec === true) {
    cleanItem.aceSpec = true;
  }

  if (Array.isArray(dist)) {
    // Keep v2 schema objects { copies, players, percent } if present; otherwise accept numeric array fallback
    cleanItem.dist = dist
      .map(distItem => {
        if (typeof distItem === 'number') {
          return { copies: distItem, players: undefined, percent: undefined };
        }
        if (distItem && typeof distItem === 'object') {
          return {
            copies: Number.isFinite(distItem.copies) ? distItem.copies : undefined,
            players: Number.isFinite(distItem.players) ? distItem.players : undefined,
            percent: Number.isFinite(distItem.percent) ? distItem.percent : undefined
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  return cleanItem;
}
