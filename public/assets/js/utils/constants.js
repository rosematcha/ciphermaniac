/**
 * Shared constants for the application
 * @module Constants
 */
/**
 * DOM Selectors used throughout the application
 * Centralized to avoid magic strings and enable easier refactoring
 */
export const SELECTORS = {
    // Main grid and UI elements
    GRID: '#grid',
    CARD_TEMPLATE: '#card-template',
    SEARCH: '#search',
    SORT: '#sort',
    TOURNAMENT: '#tournament',
    ARCHETYPE: '#archetype',
    SUMMARY: '#summary',
    FILTERS_TOGGLE: '#filtersToggle',
    FILTERS: '#filters',
    // Card page elements
    CARD_SEARCH: '#card-search',
    CARD_SUGGESTIONS: '#card-suggestions',
    CARD_TITLE: '#card-title',
    CARD_META: '#card-meta',
    CARD_ANALYSIS: '#card-analysis',
    ANALYSIS_EVENT: '#analysis-event',
    // Template elements
    CARDS_LANDING: '#cards-landing',
    SUGGESTIONS_ROOT: '#suggestions-root'
};
/**
 * CSS Classes used throughout the application
 */
export const CSS_CLASSES = {
    // State classes
    IS_ACTIVE: 'is-active',
    IS_OPEN: 'is-open',
    HIDDEN: 'hidden',
    // Component classes
    CARD: 'card',
    EMPTY_STATE: 'empty-state',
    GRAPH_TOOLTIP: 'graph-tooltip',
    SUGGESTIONS: 'suggestions',
    SUGGESTION_ITEM: 'item',
    // Layout classes
    ROW: 'row',
    GRID: 'grid',
    TOOLBAR: 'toolbar',
    CONTROLS: 'controls'
};
/**
 * Event types and custom event names
 */
export const EVENTS = {
    // Standard DOM events
    CLICK: 'click',
    INPUT: 'input',
    CHANGE: 'change',
    RESIZE: 'resize',
    LOAD: 'load',
    ERROR: 'error',
    HASHCHANGE: 'hashchange',
    POPSTATE: 'popstate',
    BEFOREUNLOAD: 'beforeunload',
    // Custom application events
    CARD_SELECTED: 'cardSelected',
    TOURNAMENT_CHANGED: 'tournamentChanged'
};
/**
 * Local Storage Keys
 */
export const STORAGE_KEYS = {
    GRID_CACHE: 'gridCache',
    USER_PREFERENCES: 'userPreferences'
};
/**
 * URL Parameter names
 */
export const URL_PARAMS = {
    QUERY: 'q',
    SORT: 'sort',
    ARCHETYPE: 'archetype',
    TOURNAMENT: 'tour',
    DEBUG: 'debug'
};
/**
 * Default values used throughout the application
 */
export const DEFAULTS = {
    ARCHETYPE_ALL: '__all__',
    SORT_PERCENT_DESC: 'percent-desc',
    DEBOUNCE_DELAY: 300,
    ANIMATION_DURATION: 150
};
/**
 * File extensions and MIME types
 */
export const FILE_TYPES = {
    JSON: 'application/json',
    PNG: 'image/png',
    JPG: 'image/jpeg'
};
