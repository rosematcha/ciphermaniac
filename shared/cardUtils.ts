/**
 * Shared Card Utility Functions
 *
 * This module contains reusable functions for card identifier normalization,
 * sanitization, and path generation used across both frontend and backend.
 *
 * IMPORTANT: This module is isomorphic - it works in both browser and Node.js/Workers.
 * Do not add any environment-specific dependencies here.
 * @module shared/cardUtils
 */

const INVALID_PATH_CHARS = /[<>:"/\\|?*]/g;

/**
 * Normalizes a card number to 3-digit format with optional uppercase suffix.
 * @example
 * normalizeCardNumber("5")     // "005"
 * normalizeCardNumber("18a")   // "018A"
 * normalizeCardNumber("118")   // "118"
 * normalizeCardNumber("GG05")  // "GG05" (non-numeric prefix preserved, uppercased)
 * @param value - The card number to normalize
 * @returns Normalized card number, or empty string if invalid
 */
export function normalizeCardNumber(value: string | number | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    // Non-numeric prefix (like "GG05") - just uppercase it
    return raw.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
}

/**
 * Canonicalizes a card variant by normalizing set code and number.
 * @param setCode - The set code (e.g., "SVI", "paldea")
 * @param number - The card number
 * @returns Tuple of [uppercased setCode, normalized number]
 */
export function canonicalizeVariant(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): [string | null, string | null] {
  const sc = (setCode || '').toString().toUpperCase().trim();
  if (!sc) {
    return [null, null];
  }
  const normalizedNumber = normalizeCardNumber(number);
  if (!normalizedNumber) {
    return [sc, null];
  }
  return [sc, normalizedNumber];
}

/**
 * Builds a card identifier string in the format "SET~NUMBER".
 * @param setCode - The set code
 * @param number - The card number
 * @returns Identifier like "SVI~118", or null if invalid
 */
export function buildCardIdentifier(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): string | null {
  const sc = (setCode || '').toString().toUpperCase().trim();
  if (!sc) {
    return null;
  }
  const normalized = normalizeCardNumber(number);
  if (!normalized) {
    return null;
  }
  return `${sc}~${normalized}`;
}

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
