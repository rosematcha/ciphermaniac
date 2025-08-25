/**
 * Firestore favorites synchronization
 * @module FirestoreFavorites
 */

import { getFirestore } from './config/firebase.js';
import { getUser } from './auth.js';
import { logger } from './utils/logger.js';

/**
 * Sync local favorites to Firestore
 * @param {Set<string>} localFavorites
 * @returns {Promise<void>}
 */
export async function syncLocalToFirestore(localFavorites) {
  const user = getUser();
  if (!user) {
    logger.warn('Cannot sync favorites: user not authenticated');
    return;
  }

  const db = getFirestore();
  const userFavoritesRef = db.collection('users').doc(user.uid).collection('favorites');

  try {
    // Get current Firestore favorites
    const snapshot = await userFavoritesRef.get();
    const firestoreFavorites = new Set(snapshot.docs.map(doc => doc.id));

    // Add new favorites to Firestore
    const toAdd = [...localFavorites].filter(card => !firestoreFavorites.has(card));
    const addPromises = toAdd.map(cardName =>
      userFavoritesRef.doc(cardName).set({
        cardName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      })
    );

    // Remove favorites not in local storage
    const toRemove = [...firestoreFavorites].filter(card => !localFavorites.has(card));
    const removePromises = toRemove.map(cardName =>
      userFavoritesRef.doc(cardName).delete()
    );

    await Promise.all([...addPromises, ...removePromises]);

    if (toAdd.length > 0 || toRemove.length > 0) {
      logger.info(`Synced favorites: +${toAdd.length}, -${toRemove.length}`);
    }
  } catch (error) {
    logger.error('Failed to sync favorites to Firestore:', error);
    throw error;
  }
}

/**
 * Load favorites from Firestore
 * @returns {Promise<Set<string>>}
 */
export async function loadFavoritesFromFirestore() {
  const user = getUser();
  if (!user) {
    logger.warn('Cannot load favorites: user not authenticated');
    return new Set();
  }

  const db = getFirestore();
  const userFavoritesRef = db.collection('users').doc(user.uid).collection('favorites');

  try {
    const snapshot = await userFavoritesRef.get();
    const favorites = new Set(snapshot.docs.map(doc => doc.id));
    logger.info(`Loaded ${favorites.size} favorites from Firestore`);
    return favorites;
  } catch (error) {
    logger.error('Failed to load favorites from Firestore:', error);
    throw error;
  }
}

/**
 * Add favorite to Firestore
 * @param {string} cardName
 * @returns {Promise<void>}
 */
export async function addFavoriteToFirestore(cardName) {
  const user = getUser();
  if (!user) {return;}

  const db = getFirestore();
  const favRef = db.collection('users').doc(user.uid).collection('favorites').doc(cardName);

  try {
    await favRef.set({
      cardName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logger.debug(`Added ${cardName} to Firestore favorites`);
  } catch (error) {
    logger.error('Failed to add favorite to Firestore:', error);
    throw error;
  }
}

/**
 * Remove favorite from Firestore
 * @param {string} cardName
 * @returns {Promise<void>}
 */
export async function removeFavoriteFromFirestore(cardName) {
  const user = getUser();
  if (!user) {return;}

  const db = getFirestore();
  const favRef = db.collection('users').doc(user.uid).collection('favorites').doc(cardName);

  try {
    await favRef.delete();
    logger.debug(`Removed ${cardName} from Firestore favorites`);
  } catch (error) {
    logger.error('Failed to remove favorite from Firestore:', error);
    throw error;
  }
}

/**
 * Create user profile if it doesn't exist
 * @param {firebase.User} user
 * @returns {Promise<void>}
 */
export async function ensureUserProfile(user) {
  const db = getFirestore();
  const userRef = db.collection('users').doc(user.uid);

  try {
    const doc = await userRef.get();
    if (!doc.exists) {
      await userRef.set({
        email: user.email,
        name: user.displayName,
        avatarUrl: user.photoURL,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      logger.info('Created user profile in Firestore');
    } else {
      // Update last login
      await userRef.update({
        lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    logger.error('Failed to ensure user profile:', error);
    throw error;
  }
}
