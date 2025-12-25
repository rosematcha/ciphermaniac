/**
 * Shared Card Utility Functions - Re-exports
 *
 * This module re-exports card utility functions from the shared module
 * for use across the server-side codebase.
 * @module functions/lib/cardUtils
 */

export {
  normalizeCardNumber,
  canonicalizeVariant,
  buildCardIdentifier,
  sanitizeForPath,
  sanitizeForFilename,
  normalizeArchetypeName
} from '../../shared/cardUtils.js';
