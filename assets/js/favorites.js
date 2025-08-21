/**
 * Favorites (bookmarks) management for cards
 * @module Favorites
 */

import { storage } from './utils/storage.js';
import { logger } from './utils/logger.js';

/**
 * @typedef {(favorites: Set<string>) => void} FavoritesListener
 */

/** @type {Set<string>} */
let favoritesSet = new Set();

/** @type {Set<FavoritesListener>} */
const listeners = new Set();

/**
 * Load favorites from storage
 * @private
 */
function loadFavorites() {
  const favoritesList = storage.get('favorites');
  favoritesSet = new Set(Array.isArray(favoritesList) ? favoritesList : []);
  logger.debug(`Loaded ${favoritesSet.size} favorites from storage`);
}

/**
 * Save favorites to storage
 * @private
 */
function saveFavorites() {
  const success = storage.set('favorites', Array.from(favoritesSet));
  if (success) {
    logger.debug(`Saved ${favoritesSet.size} favorites to storage`);
  }
}

/**
 * Notify all listeners of favorites change
 * @private
 */
function notifyListeners() {
  const snapshot = new Set(favoritesSet);
  listeners.forEach(listener => {
    try {
      listener(snapshot);
    } catch (error) {
      logger.warn('Favorites listener threw error', error);
    }
  });
}

/**
 * Get current favorites as a Set
 * @returns {Set<string>}
 */
export function getFavoritesSet() {
  return new Set(favoritesSet);
}

/**
 * Check if a card is favorited
 * @param {string} cardName 
 * @returns {boolean}
 */
export function isFavorite(cardName) {
  return favoritesSet.has(cardName);
}

/**
 * Toggle favorite status of a card
 * @param {string} cardName 
 * @returns {boolean} New favorite status
 */
export function toggleFavorite(cardName) {
  if (!cardName) {
    logger.warn('toggleFavorite called with empty card name');
    return false;
  }
  
  const wasFavorite = favoritesSet.has(cardName);
  
  if (wasFavorite) {
    favoritesSet.delete(cardName);
    logger.debug(`Removed ${cardName} from favorites`);
  } else {
    favoritesSet.add(cardName);
    logger.debug(`Added ${cardName} to favorites`);
  }
  
  saveFavorites();
  notifyListeners();
  
  return !wasFavorite;
}

/**
 * Set favorite status of a card explicitly
 * @param {string} cardName 
 * @param {boolean} enabled 
 * @returns {boolean} New favorite status
 */
export function setFavorite(cardName, enabled) {
  if (!cardName) {
    logger.warn('setFavorite called with empty card name');
    return false;
  }
  
  const wasChanged = enabled ? !favoritesSet.has(cardName) : favoritesSet.has(cardName);
  
  if (enabled) {
    favoritesSet.add(cardName);
  } else {
    favoritesSet.delete(cardName);
  }
  
  if (wasChanged) {
    logger.debug(`Set ${cardName} favorite status to ${enabled}`);
    saveFavorites();
    notifyListeners();
  }
  
  return enabled;
}

/**
 * Subscribe to favorites changes
 * @param {FavoritesListener} listener 
 * @returns {() => void} Unsubscribe function
 */
export function subscribeFavorites(listener) {
  listeners.add(listener);
  logger.debug('Added favorites listener');
  
  return () => {
    listeners.delete(listener);
    logger.debug('Removed favorites listener');
  };
}

// Initialize favorites on module load
loadFavorites();
