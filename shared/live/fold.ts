/**
 * Name folding for live seats. Its own module because the seat key, the alias
 * table and the pairings search all have to fold identically — a seat keyed one
 * way and looked up another loses its follows and its deck reports.
 * @module shared/live/fold
 */

/** Combining marks, written as escapes: the literal characters are invisible in source. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Lower-cased and stripped of diacritics, the way the players search folds names. */
export function foldName(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(COMBINING_MARKS, '').replace(/\s+/g, ' ').trim();
}
