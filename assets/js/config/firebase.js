/**
 * Firebase configuration and initialization
 * @module FirebaseConfig
 */

// Firebase configuration - update with your project's config
const firebaseConfig = {
  apiKey: 'your-api-key',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project-id',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '123456789',
  appId: 'your-app-id'
};

// Initialize Firebase (will be loaded from CDN)
let _app, auth, db;

/**
 * Initialize Firebase services
 * Call this after Firebase SDK is loaded
 */
export function initializeFirebase() {
  if (typeof firebase === 'undefined') {
    throw new Error('Firebase SDK not loaded');
  }

  _app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();

  // Configure auth persistence
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
}

/**
 * Get Firebase Auth instance
 * @returns {firebase.auth.Auth}
 */
export function getAuth() {
  if (!auth) {throw new Error('Firebase not initialized');}
  return auth;
}

/**
 * Get Firestore instance
 * @returns {firebase.firestore.Firestore}
 */
export function getFirestore() {
  if (!db) {throw new Error('Firebase not initialized');}
  return db;
}

/**
 * Get current user
 * @returns {firebase.User|null}
 */
export function getCurrentUser() {
  return auth?.currentUser || null;
}
