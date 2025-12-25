/* eslint-disable id-length */
/**
 * Tournament report parsing and validation
 * @module Parse
 */

import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, validateType } from './utils/errorHandler.js';
import type { CardDistributionEntry, CardItem, ParsedReport } from './types/index.js';

export type { CardDistributionEntry, CardItem, ParsedReport };

/**
 * Parse and validate tournament report data
 * @param data - Raw report data
 * @returns ParsedReport
 * @throws AppError
 */
export function parseReport(data: unknown): ParsedReport {
  if (!data) {
    throw new AppError(ErrorTypes.PARSE, 'Report data is null or undefined');
  }

  validateType(data, 'object', 'report data');

  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.items)) {
    throw new AppError(ErrorTypes.PARSE, 'Report data must contain an items array', null, { data });
  }

  const { deckTotal } = record;
  if (typeof deckTotal !== 'number' || deckTotal < 0) {
    logger.warn('Invalid or missing deckTotal, using items length as fallback', { deckTotal });
  }

  // Validate and clean items
  const validItems = record.items
    .map((item: unknown, index: number) => validateAndCleanItem(item, index))
    .filter((item: CardItem | null): item is CardItem => item !== null);

  logger.info(`Parsed report with ${validItems.length} valid items out of ${record.items.length} total`);

  return {
    deckTotal: typeof deckTotal === 'number' && deckTotal >= 0 ? deckTotal : validItems.length,
    items: validItems
  };
}

/**
 * Validate and clean a single card item
 * @param item - Raw item data
 * @param index - Item index for error reporting
 * @returns Cleaned item or null if invalid
 */
function validateAndCleanItem(item: unknown, index: number): CardItem | null {
  if (!item || typeof item !== 'object') {
    logger.warn(`Item at index ${index} is not an object, skipping`, item);
    return null;
  }

  const record = item as Record<string, unknown>;
  const { name, found, total, pct, rank, dist, category } = record;

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

  const cleanItem: CardItem = {
    name: (name as string).trim(),
    found: cleanFound,
    total: cleanTotal,
    pct: Math.round(cleanPct * 100) / 100 // Round to 2 decimal places
  };
  // Preserve optional variant metadata if present
  if (typeof record.uid === 'string' && record.uid) {
    cleanItem.uid = record.uid;
  }
  if (typeof record.set === 'string' && record.set) {
    cleanItem.set = record.set;
  }
  if (typeof record.number === 'string' || typeof record.number === 'number') {
    cleanItem.number = record.number;
  }
  if (typeof category === 'string' && (category as string).trim()) {
    cleanItem.category = (category as string).trim().toLowerCase();
  }
  const trainerType = typeof record.trainerType === 'string' ? record.trainerType.trim().toLowerCase() : '';
  if (trainerType) {
    cleanItem.trainerType = trainerType;
  }
  const energyType = typeof record.energyType === 'string' ? record.energyType.trim().toLowerCase() : '';
  if (energyType) {
    cleanItem.energyType = energyType;
  }

  // Optional fields
  if (typeof rank === 'number') {
    cleanItem.rank = rank;
  }

  if (record.aceSpec === true) {
    cleanItem.aceSpec = true;
  }

  if (Array.isArray(dist)) {
    // Keep v2 schema objects { copies, players, percent } if present; otherwise accept numeric array fallback
    cleanItem.dist = dist
      .map((distItem: unknown): CardDistributionEntry | null => {
        if (typeof distItem === 'number') {
          return { copies: distItem, players: undefined, percent: undefined };
        }
        if (distItem && typeof distItem === 'object') {
          const distRecord = distItem as Record<string, unknown>;
          return {
            copies: Number.isFinite(distRecord.copies) ? (distRecord.copies as number) : undefined,
            players: Number.isFinite(distRecord.players) ? (distRecord.players as number) : undefined,
            percent: Number.isFinite(distRecord.percent) ? (distRecord.percent as number) : undefined
          };
        }
        return null;
      })
      .filter((d): d is CardDistributionEntry => Boolean(d));
  }

  return cleanItem;
}
