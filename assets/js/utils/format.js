/**
 * Formatting helpers
 */

/**
 * Convert a tournament folder key like 'YYYY-MM-DD, Name' to display name 'Name'.
 * Leaves other strings unchanged.
 * @param {string} key
 * @returns {string}
 */
export function prettyTournamentName(key) {
  if (!key || typeof key !== 'string') {return key;}
  const m = key.match(/^\d{4}-\d{2}-\d{2},\s*(.+)$/);
  return m ? m[1] : key;
}
