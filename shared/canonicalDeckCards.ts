/**
 * Per-deck canonical card aggregation.
 *
 * The implementation moved to {@link module:shared/data/cardIdentity} in
 * DB-MASTER-PLAN Phase 2. This module is a thin compatibility re-export so
 * existing consumers keep importing from 'shared/canonicalDeckCards' unchanged.
 *
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add environment-specific dependencies here.
 * @module shared/canonicalDeckCards
 */

// Only the function is re-exported: no caller imports the RawDeckCard /
// CanonicalDeckCard types from this path (they live in shared/data/cardIdentity
// now, and consumers get them via inference from this function's signature).
export { aggregateCanonicalCardsPerDeck } from './data/cardIdentity';
