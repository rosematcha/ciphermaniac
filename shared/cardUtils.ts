/** Dependency-free card utilities shared by browser, Node, and Workers. */

const INVALID_PATH_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeForPath(text: unknown): string {
  const value = typeof text === 'string' ? text : String(text || '');
  let sanitized = value.replace(/\0/g, '');
  sanitized = sanitized.replace(/\.\./g, '');
  sanitized = sanitized.replace(INVALID_PATH_CHARS, '').trim();
  return sanitized;
}

/**
 * Removes controls, traversal, and separators while preserving display
 * punctuation such as colons and apostrophes.
 */
export function sanitizeDisplayName(text: unknown): string {
  const value = typeof text === 'string' ? text : String(text || '');
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\.\./g, '')
      .replace(/[/\\]/g, '')
      .trim()
  );
}

export function sanitizeForFilename(text: unknown): string {
  return sanitizeForPath((text || '').toString().replace(/ /g, '_'));
}

export function normalizeArchetypeName(name: string | null | undefined): string {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned.replace(/\s+/g, ' ').toLowerCase();
}
