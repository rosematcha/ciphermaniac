/**
 * Name folding for live seats. Its own module because the seat key, the alias
 * table and the pairings search all have to fold identically — a seat keyed one
 * way and looked up another loses its follows and its deck reports.
 * @module shared/live/fold
 */

/** Combining marks, written as escapes: the literal characters are invisible in source. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Folds are memoised. A round is nine hundred tables and a fold is an NFKD
 * normalize plus two regexes, so the search, the seat key, the follow filter
 * and the deck tally between them used to redo thousands of them per keystroke
 * and again on every sixty-second poll. An event's field is about a thousand
 * distinct names; the cap is there so a long session cannot grow the map
 * without bound, and dropping it whole costs one round of refolding.
 */
const FOLDED = new Map<string, string>();
const FOLDED_MAX = 4000;

/**
 * Lower-cased and stripped of diacritics, the way the players search folds names.
 * @param value - Raw name, or a search query to match one
 * @returns The folded form
 */
export function foldName(value: string): string {
  const held = FOLDED.get(value);
  if (held !== undefined) {
    return held;
  }
  const folded = value.toLowerCase().normalize('NFKD').replace(COMBINING_MARKS, '').replace(/\s+/g, ' ').trim();
  if (FOLDED.size >= FOLDED_MAX) {
    FOLDED.clear();
  }
  FOLDED.set(value, folded);
  return folded;
}
