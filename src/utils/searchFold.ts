/**
 * Search-term folding: lowercase and strip diacritics so "Pokegear" matches
 * "Pokégear". Fold BOTH the query and the candidate with this before
 * comparing.
 * @module utils/searchFold
 */

/** Lowercased, diacritic-free form of a string for search comparison. */
export function foldSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}
