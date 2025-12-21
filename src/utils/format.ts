/**
 * Formatting helpers
 */

/**
 * Convert a tournament folder key like 'YYYY-MM-DD, Name' to display name 'Name'.
 * Leaves other strings unchanged.
 * @param key
 * @returns
 */
export function prettyTournamentName(key: string): string {
  if (!key || typeof key !== 'string') {
    return key;
  }
  const match = key.match(/^\d{4}-\d{2}-\d{2},\s*(.+)$/);
  return match ? match[1] : key;
}

/**
 * Normalizes archetype name for comparison
 * - Replaces underscores with spaces
 * - Converts to lowercase
 * - Trims whitespace
 * - Collapses multiple spaces
 */
export function normalizeArchetypeName(name: string | undefined): string {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned.replace(/\s+/g, ' ').toLowerCase();
}
