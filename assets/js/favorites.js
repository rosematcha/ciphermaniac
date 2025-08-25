/**
 * Favorites (bookmarks) management for cards
 * Supports both localStorage and Firebase sync
 * @module Favorites
 */

import { storage } from './utils/storage.js';
import { logger } from './utils/logger.js';
import { getUser } from './auth.js';
import {
  syncLocalToFirestore,
  loadFavoritesFromFirestore,
  addFavoriteToFirestore,
  removeFavoriteFromFirestore
} from './firestore-favorites.js';

/**
 * @typedef {(favorites: Set<string>) => void} FavoritesListener
 */

/** @type {Set<string>} */
let favoritesSet = new Set();

/** @type {Set<FavoritesListener>} */
const listeners = new Set();

/**
 * Load favorites from localStorage
 * @private
 */
function loadLocalFavorites() {
  const favoritesList = storage.get('favorites');
  favoritesSet = new Set(Array.isArray(favoritesList) ? favoritesList : []);
  logger.debug(`Loaded ${favoritesSet.size} favorites from localStorage`);
}

/**
 * Load and merge favorites from both localStorage and Firestore
 * @private
 */
async function loadFavorites() {
  // Always load from localStorage first
  loadLocalFavorites();

  const user = getUser();
  if (user) {
    try {
      // Load from Firestore and merge
      const firestoreFavorites = await loadFavoritesFromFirestore();
      const originalSize = favoritesSet.size;

      // Merge Firestore favorites into local set
      firestoreFavorites.forEach(card => favoritesSet.add(card));

      // Save merged favorites to localStorage
      if (favoritesSet.size > originalSize) {
        saveFavorites();
        notifyListeners();
        logger.info(`Merged ${favoritesSet.size - originalSize} favorites from Firestore`);
      }
    } catch (error) {
      logger.warn('Failed to load favorites from Firestore:', error);
      // Continue with localStorage favorites only
    }
  }
}

/**
 * Save favorites to localStorage
 * @private
 */
function saveFavorites() {
  const success = storage.set('favorites', Array.from(favoritesSet));
  if (success) {
    logger.debug(`Saved ${favoritesSet.size} favorites to localStorage`);
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

    // Sync to Firestore if user is authenticated
    if (getUser()) {
      removeFavoriteFromFirestore(cardName).catch(error =>
        logger.warn('Failed to remove from Firestore:', error)
      );
    }
  } else {
    favoritesSet.add(cardName);
    logger.debug(`Added ${cardName} to favorites`);

    // Sync to Firestore if user is authenticated
    if (getUser()) {
      addFavoriteToFirestore(cardName).catch(error =>
        logger.warn('Failed to add to Firestore:', error)
      );
    }
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

    // Sync to Firestore if user is authenticated
    if (getUser()) {
      const firestoreAction = enabled ? addFavoriteToFirestore : removeFavoriteFromFirestore;
      firestoreAction(cardName).catch(error =>
        logger.warn('Failed to sync to Firestore:', error)
      );
    }

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

/**
 * Sync local favorites to Firestore on user login
 * @param {firebase.User} user
 */
export async function syncFavoritesOnLogin(user) {
  if (!user) {return;}

  try {
    await syncLocalToFirestore(favoritesSet);
    await loadFavorites(); // Reload to get any cloud favorites
  } catch (error) {
    logger.error('Failed to sync favorites on login:', error);
  }
}

// Initialize favorites on module load (localStorage only initially)
loadLocalFavorites();
