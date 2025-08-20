/**
 * Layout configuration - DEPRECATED
 * Use CONFIG.LAYOUT from config.js instead
 * @deprecated
 */

import { CONFIG } from './config.js';

// Re-export for backwards compatibility
export const GAP = CONFIG.LAYOUT.GAP;
export const BASE = CONFIG.LAYOUT.BASE_CARD_WIDTH;
export const MIN_BASE = CONFIG.LAYOUT.MIN_BASE_CARD_WIDTH;
export const BIG_ROWS = CONFIG.LAYOUT.BIG_ROWS_COUNT;
export const MIN_SCALE = CONFIG.LAYOUT.MIN_SCALE;
