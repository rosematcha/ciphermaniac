/**
 * Enhanced configuration with validation and centralized constants
 * @module Config
 */

import { assert, validateType } from './utils/errorHandler.js';

interface LayoutConfig {
  GAP: number;
  BASE_CARD_WIDTH: number;
  MIN_BASE_CARD_WIDTH: number;
  MOBILE_MIN_CARD_WIDTH: number;
  MOBILE_GAP: number;
  MOBILE_PADDING: number;
  BIG_ROWS_COUNT: number;
  MIN_SCALE: number;
}

interface ApiConfig {
  REPORTS_BASE: string;
  LIMITLESS_BASE: string;
  LIMITLESS_DEFAULT_GAME: string;
  LIMITLESS_DEFAULT_LIMIT: number;
  R2_BASE: string;
  SYNONYMS_URL: string;
  TIMEOUT_MS: number;
  RETRY_ATTEMPTS: number;
  RETRY_DELAY_MS: number;
  JSON_CACHE_TTL_MS: number;
}

interface CacheConfig {
  TTL_MS: number;
  MAX_ENTRIES: number;
  CLEANUP_THRESHOLD: number;
}

interface UiConfig {
  DEBOUNCE_MS: number;
  ANIMATION_DURATION_MS: number;
  PAGINATION_LIMIT: number;
  SEARCH_MIN_LENGTH: number;
  CHART_TIME_LIMIT: number;
  INITIAL_VISIBLE_ROWS: number;
  ROWS_PER_LOAD: number;
}

interface DevConfig {
  ENABLE_LOGGING: boolean;
  ENABLE_PERF_MONITORING: boolean;
  MOCK_NETWORK_DELAY: boolean;
}

interface Config {
  LAYOUT: LayoutConfig;
  API: ApiConfig;
  CACHE: CacheConfig;
  UI: UiConfig;
  ARCHETYPES: readonly string[];
  DEV: DevConfig;
}

/**
 * Application configuration with validation
 */
export const CONFIG: Config = Object.freeze({
  // Layout constants - keep in sync with CSS variables
  LAYOUT: {
    GAP: 12,
    BASE_CARD_WIDTH: 200,
    MIN_BASE_CARD_WIDTH: 140,
    MOBILE_MIN_CARD_WIDTH: 105, // Optimized for 3 cards per row on mobile
    MOBILE_GAP: 8, // Reduced gap on mobile for more space
    MOBILE_PADDING: 12, // Reduced horizontal padding on mobile
    BIG_ROWS_COUNT: 2,
    MIN_SCALE: 0.5
  },

  // API configuration
  API: {
    REPORTS_BASE: '/reports',
    LIMITLESS_BASE: '/api/limitless',
    LIMITLESS_DEFAULT_GAME: 'PTCG',
    LIMITLESS_DEFAULT_LIMIT: 50,
    R2_BASE: 'https://r2.ciphermaniac.com',
    SYNONYMS_URL: 'https://r2.ciphermaniac.com/assets/card-synonyms.json',
    TIMEOUT_MS: 10000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_MS: 1000,
    JSON_CACHE_TTL_MS: 1000 * 60 * 5 // 5 minutes
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
    CHART_TIME_LIMIT: 6,
    // Pagination for card grid
    INITIAL_VISIBLE_ROWS: 6,
    ROWS_PER_LOAD: 8
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
    // Enable performance monitoring only on localhost
    ENABLE_PERF_MONITORING:
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.') ||
        window.location.hostname.endsWith('.local')),
    MOCK_NETWORK_DELAY: false
  }
});

/**
 * Validate configuration object structure
 * @param config
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config: Config): void {
  validateType(config, 'object', 'CONFIG');

  // Validate layout constants
  assert(config.LAYOUT, 'CONFIG.LAYOUT is required');
  assert(typeof config.LAYOUT.GAP === 'number' && config.LAYOUT.GAP > 0, 'GAP must be positive number');
  assert(
    typeof config.LAYOUT.BASE_CARD_WIDTH === 'number' && config.LAYOUT.BASE_CARD_WIDTH > 0,
    'BASE_CARD_WIDTH must be positive number'
  );
  assert(
    typeof config.LAYOUT.BIG_ROWS_COUNT === 'number' && config.LAYOUT.BIG_ROWS_COUNT > 0,
    'BIG_ROWS_COUNT must be positive number'
  );

  // Validate API config
  assert(config.API, 'CONFIG.API is required');
  assert(typeof config.API.REPORTS_BASE === 'string', 'REPORTS_BASE must be string');
  assert(typeof config.API.LIMITLESS_BASE === 'string', 'LIMITLESS_BASE must be string');
  assert(typeof config.API.LIMITLESS_DEFAULT_GAME === 'string', 'LIMITLESS_DEFAULT_GAME must be string');
  assert(
    Number.isInteger(config.API.LIMITLESS_DEFAULT_LIMIT) && config.API.LIMITLESS_DEFAULT_LIMIT > 0,
    'LIMITLESS_DEFAULT_LIMIT must be a positive integer'
  );
  if ('R2_BASE' in config.API && config.API.R2_BASE !== undefined && config.API.R2_BASE !== null) {
    assert(typeof config.API.R2_BASE === 'string', 'R2_BASE must be string');
  }
  assert(typeof config.API.TIMEOUT_MS === 'number' && config.API.TIMEOUT_MS > 0, 'TIMEOUT_MS must be positive number');
  assert(
    typeof config.API.JSON_CACHE_TTL_MS === 'number' && config.API.JSON_CACHE_TTL_MS > 0,
    'JSON_CACHE_TTL_MS must be positive number'
  );

  // Validate archetypes
  assert(Array.isArray(config.ARCHETYPES), 'ARCHETYPES must be array');
  assert(config.ARCHETYPES.length > 0, 'ARCHETYPES cannot be empty');
}

// Validate configuration on load
validateConfig(CONFIG);

// Legacy exports for backwards compatibility
export const { REPORTS_BASE } = CONFIG.API;
export const { ARCHETYPES } = CONFIG;

// Layout constants for backwards compatibility
export const { GAP } = CONFIG.LAYOUT;
export const BASE = CONFIG.LAYOUT.BASE_CARD_WIDTH;
export const MIN_BASE = CONFIG.LAYOUT.MIN_BASE_CARD_WIDTH;
export const BIG_ROWS = CONFIG.LAYOUT.BIG_ROWS_COUNT;
export const { MIN_SCALE } = CONFIG.LAYOUT;
