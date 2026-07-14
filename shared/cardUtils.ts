/**
 * Shared Card Utility Functions
 *
 * Path/filename sanitization and archetype-name normalization used across both
 * frontend and backend. Card *identity* policy (number/set/UID normalization)
 * moved to {@link module:shared/data/cardIdentity} in DB-MASTER-PLAN Phase 2;
 * this module re-exports those functions so existing callers keep working.
 *
 * IMPORTANT: This module is isomorphic - it works in both browser and Node.js/Workers.
 * Do not add any environment-specific dependencies here.
 * @module shared/cardUtils
 */

// Re-export card identity policy from its consolidated home. Callers may keep
// importing these from 'shared/cardUtils' unchanged.
export {
  normalizeCardNumber,
  cardNumberIndexKey,
  canonicalizeVariant,
  buildCardIdentifier
} from './data/cardIdentity';

const INVALID_PATH_CHARS = /[<>:"/\\|?*]/g;

/**
 * Sanitizes text for use in file paths by removing invalid characters.
 * Removes null bytes, path traversal sequences, and invalid path characters.
 * @param text - The text to sanitize
 * @returns Sanitized path-safe string
 */
export function sanitizeForPath(text: unknown): string {
  const value = typeof text === 'string' ? text : String(text || '');
  // Remove null bytes first
  let sanitized = value.replace(/\0/g, '');
  // Remove path traversal sequences
  sanitized = sanitized.replace(/\.\./g, '');
  // Remove invalid path characters including path separators
  sanitized = sanitized.replace(INVALID_PATH_CHARS, '').trim();
  return sanitized;
}

/**
 * Sanitizes a DISPLAY name (card name, etc.) — not a path component. Preserves
 * legitimate punctuation such as colons and apostrophes (so "Technical Machine:
 * Evolution" keeps its colon, matching the source data) while still stripping
 * genuinely dangerous sequences: null/control characters, `..` traversal, and
 * path separators. Path safety for keys/filenames belongs to {@link
 * sanitizeForPath}/{@link sanitizeForFilename}; a display name must not be
 * flattened into a path component.
 * @param text - The text to sanitize
 * @returns The display string with punctuation preserved and injection removed
 */
export function sanitizeDisplayName(text: unknown): string {
  const value = typeof text === 'string' ? text : String(text || '');
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '')
    .trim();
}

/**
 * Sanitizes text for use as a filename by replacing spaces with underscores
 * and removing invalid characters.
 * @param text - The text to sanitize
 * @returns Sanitized filename-safe string
 */
export function sanitizeForFilename(text: unknown): string {
  return sanitizeForPath((text || '').toString().replace(/ /g, '_'));
}

/**
 * Normalizes an archetype name for consistent comparison and display.
 * Replaces underscores with spaces, trims whitespace, and lowercases.
 * @example
 * normalizeArchetypeName("Charizard_Pidgeot")  // "charizard pidgeot"
 * normalizeArchetypeName("  Gholdengo  ")      // "gholdengo"
 * normalizeArchetypeName("")                    // "unknown"
 * @param name - The archetype name to normalize
 * @returns Normalized archetype name, or "unknown" if empty
 */
export function normalizeArchetypeName(name: string | null | undefined): string {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned.replace(/\s+/g, ' ').toLowerCase();
}
