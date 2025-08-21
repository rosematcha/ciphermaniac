/**
 * Enhanced configuration with validation and centralized constants
 * @module Config
 */

import { validateType, assert } from './utils/errorHandler.js';

/**
 * Application configuration with validation
 */
export const CONFIG = Object.freeze({
  // Layout constants - keep in sync with CSS variables
  LAYOUT: {
    GAP: 12,
    BASE_CARD_WIDTH: 200,
    MIN_BASE_CARD_WIDTH: 140,
    BIG_ROWS_COUNT: 2,
    MIN_SCALE: 0.5
  },

  // API configuration
  API: {
    REPORTS_BASE: 'reports',
    TIMEOUT_MS: 10000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_MS: 1000
  },

  // Cache configuration
  CACHE: {
    TTL_MS: 1000 * 60 * 60 * 12, // 12 hours
    MAX_ENTRIES: 50,
    CLEANUP_THRESHOLD: 100
  },

  // UI constants
  UI: {
    DEBOUNCE_MS: 300,
    ANIMATION_DURATION_MS: 150,
    PAGINATION_LIMIT: 50,
    SEARCH_MIN_LENGTH: 2,
    CHART_TIME_LIMIT: 6
  },

  // Known archetype base names
  ARCHETYPES: [
    'Blissey',
    'Charizard_Dragapult',
    'Charizard_Dusknoir',
    'Charizard_Pidgeot',
    'Dragapult_Dusknoir',
    'Dragapult',
    'Flareon_Noctowl',
    'Gardevoir',
    'Gholdengo_Joltik_Box',
    'Gholdengo',
    'Grimmsnarl_Froslass',
    'Ho-Oh_Armarouge',
    'Joltik_Box',
    'Milotic_Farigiraf',
    'Ns_Zoroark',
    'Raging_Bolt_Ogerpon',
    'Tera_Box'
  ],

  // Development flags
  DEV: {
    ENABLE_LOGGING: true,
    ENABLE_PERF_MONITORING: false,
    MOCK_NETWORK_DELAY: false
  }
});

/**
 * Validate configuration object structure
 * @param {Object} config 
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config) {
  validateType(config, 'object', 'CONFIG');
  
  // Validate layout constants
  assert(config.LAYOUT, 'CONFIG.LAYOUT is required');
  assert(typeof config.LAYOUT.GAP === 'number' && config.LAYOUT.GAP > 0, 'GAP must be positive number');
  assert(typeof config.LAYOUT.BASE_CARD_WIDTH === 'number' && config.LAYOUT.BASE_CARD_WIDTH > 0, 'BASE_CARD_WIDTH must be positive number');
  assert(typeof config.LAYOUT.BIG_ROWS_COUNT === 'number' && config.LAYOUT.BIG_ROWS_COUNT > 0, 'BIG_ROWS_COUNT must be positive number');
  
  // Validate API config
  assert(config.API, 'CONFIG.API is required');
  assert(typeof config.API.REPORTS_BASE === 'string', 'REPORTS_BASE must be string');
  assert(typeof config.API.TIMEOUT_MS === 'number' && config.API.TIMEOUT_MS > 0, 'TIMEOUT_MS must be positive number');
  
  // Validate archetypes
  assert(Array.isArray(config.ARCHETYPES), 'ARCHETYPES must be array');
  assert(config.ARCHETYPES.length > 0, 'ARCHETYPES cannot be empty');
}

// Validate configuration on load
validateConfig(CONFIG);

// Legacy exports for backwards compatibility
export const REPORTS_BASE = CONFIG.API.REPORTS_BASE;
export const ARCHETYPES = CONFIG.ARCHETYPES;

// Layout constants for backwards compatibility
export const GAP = CONFIG.LAYOUT.GAP;
export const BASE = CONFIG.LAYOUT.BASE_CARD_WIDTH;
export const MIN_BASE = CONFIG.LAYOUT.MIN_BASE_CARD_WIDTH;
export const BIG_ROWS = CONFIG.LAYOUT.BIG_ROWS_COUNT;
export const MIN_SCALE = CONFIG.LAYOUT.MIN_SCALE;
