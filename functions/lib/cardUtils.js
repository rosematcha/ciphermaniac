/**
 * Shared Card Utility Functions
 *
 * This module contains reusable functions for card identifier normalization,
 * sanitization, and path generation used across the server-side codebase.
 */

const INVALID_PATH_CHARS = /[<>:"/\\|?*]/g;

/**
 * Normalizes a card number to 3-digit format with optional uppercase suffix.
 * Examples:
 * - "5" -> "005"
 * - "18a" -> "018A"
 * - "118" -> "118"
 * - "GG05" -> "GG05" (non-numeric prefix preserved as-is, uppercased)
 * @param {unknown} value - The card number to normalize
 * @returns {string} Normalized card number, or empty string if invalid
 */
export function normalizeCardNumber(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = /^(\d+)([A-Za-z]*)$/.exec(raw);
  if (!match) {
    return raw.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
}

/**
 * Canonicalizes a card variant by normalizing set code and number.
 * @param {string} setCode - The set code (e.g., "SVI", "paldea")
 * @param {string|number} number - The card number
 * @returns {[string|null, string|null]} Tuple of [uppercased setCode, normalized number]
 */
export function canonicalizeVariant(setCode, number) {
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
 * @param {string} setCode - The set code
 * @param {string|number} number - The card number
 * @returns {string|null} Identifier like "SVI~118", or null if invalid
 */
export function buildCardIdentifier(setCode, number) {
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
 * @param {unknown} text - The text to sanitize
 * @returns {string} Sanitized path-safe string
 */
export function sanitizeForPath(text) {
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
 * @param {unknown} text - The text to sanitize
 * @returns {string} Sanitized filename-safe string
 */
export function sanitizeForFilename(text) {
  return sanitizeForPath((text || '').toString().replace(/ /g, '_'));
}
