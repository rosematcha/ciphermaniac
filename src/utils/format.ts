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
