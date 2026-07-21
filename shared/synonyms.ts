/**
 * Core card synonym resolution logic - isomorphic (works in browser and Node/Workers)
 * @module shared/synonyms
 *
 * The implementation moved to {@link module:shared/data/cardIdentity} in
 * DB-MASTER-PLAN Phase 2. This module is a thin compatibility re-export so
 * existing consumers keep importing from 'shared/synonyms' unchanged:
 * - Frontend: src/utils/cardSynonyms.ts (fetch from URL)
 * - Backend: functions/lib/cardSynonyms.js (KV/R2)
 */

export {
  accessiblePriceCap,
  EMPTY_DATABASE,
  getCanonicalCardFromData,
  getClusterMembers,
  parseCardUid
} from './data/cardIdentity';
export type { SynonymDatabase } from './data/cardIdentity';
