/**
 * Tournament report parsing and validation
 * @module Parse
 */

import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, validateType } from './utils/errorHandler.js';

/**
 * @typedef {Object} CardItem
 * @property {number} [rank] - Card rank in usage
 * @property {string} name - Card name
 * @property {number} found - Number of decks containing this card
 * @property {number} total - Total number of decks
 * @property {number} pct - Usage percentage
 * @property {number[]} [dist] - Distribution array
 */

/**
 * @typedef {Object} ParsedReport
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
    throw new AppError('Report data is null or undefined', ErrorTypes.PARSE);
  }
  
  validateType(data, 'object', 'report data');
  
  if (!Array.isArray(data.items)) {
    throw new AppError('Report data must contain an items array', ErrorTypes.PARSE, { data });
  }
  
  const deckTotal = data.deckTotal;
  if (typeof deckTotal !== 'number' || deckTotal < 0) {
    logger.warn('Invalid or missing deckTotal, using items length as fallback', { deckTotal });
  }
  
  // Validate and clean items
  const validItems = data.items
    .map((item, index) => validateAndCleanItem(item, index))
    .filter(item => item !== null);
  
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
  
  const { name, found, total, pct, rank, dist } = item;
  
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
  
  // Optional fields
  if (typeof rank === 'number') {
    cleanItem.rank = rank;
  }
  
  if (Array.isArray(dist)) {
    cleanItem.dist = dist.filter(d => typeof d === 'number');
  }
  
  return cleanItem;
}
