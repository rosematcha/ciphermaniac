/**
 * Firebase Authentication module
 * @module Auth
 */

import { getAuth, getCurrentUser } from './config/firebase.js';
import { logger } from './utils/logger.js';

/** @type {Set<(user: firebase.User|null) => void>} */
const authListeners = new Set();

/** @type {firebase.User|null} */
let currentUser = null;

/**
 * Initialize authentication
 */
export function initAuth() {
  const auth = getAuth();

  // Listen for auth state changes
  auth.onAuthStateChanged((user) => {
    currentUser = user;
    logger.info(user ? `User signed in: ${user.email}` : 'User signed out');

    // Notify listeners
    authListeners.forEach(listener => {
      try {
        listener(user);
      } catch (error) {
        logger.warn('Auth listener error:', error);
      }
    });
  });
}

/**
 * Sign in with Google
 * @returns {Promise<firebase.User>}
 */
export async function signInWithGoogle() {
  const auth = getAuth();
  const provider = new firebase.auth.GoogleAuthProvider();

  // Request additional scopes if needed
  provider.addScope('email');
  provider.addScope('profile');

  try {
    const result = await auth.signInWithPopup(provider);
    logger.info('Google sign-in successful');
    return result.user;
  } catch (error) {
    logger.error('Google sign-in failed:', error);
    throw error;
  }
}

/**
 * Sign out current user
 * @returns {Promise<void>}
 */
export async function signOut() {
  const auth = getAuth();
  try {
    await auth.signOut();
    logger.info('User signed out');
  } catch (error) {
    logger.error('Sign out failed:', error);
    throw error;
  }
}

/**
 * Get current authenticated user
 * @returns {firebase.User|null}
 */
export function getUser() {
  return currentUser;
}

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
  return currentUser !== null;
}

/**
 * Subscribe to authentication state changes
 * @param {(user: firebase.User|null) => void} listener
 * @returns {() => void} Unsubscribe function
 */
export function subscribeAuth(listener) {
  authListeners.add(listener);

  // Call immediately with current state
  try {
    listener(currentUser);
  } catch (error) {
    logger.warn('Auth listener error on subscribe:', error);
  }

  return () => {
    authListeners.delete(listener);
  };
}
