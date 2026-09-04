/**
 * MatchupsPanel's presentation logic.
 *
 * The matchup MATH already lives in `src/lib/matchups` and is tested there —
 * row normalization, key-matchup selection, the shrunk win rate, the lens
 * tallies. What was left in the component was the layer on top: how a win rate
 * is worded, how nulls sort, and which cards earn a tech chip. Small, but it is
 * the layer a reader sees, and none of it had a test.
 * @module src/components/matchupsPanel/model
 */

import { buildCanonicalCardId, buildCardId } from '../../../shared/deckCardId';
import { bucketWinRate } from '../../lib/matchups';
import type { SynonymDatabase } from '../../../shared/data/cardIdentity';
import type { CardItem } from '../../types';

/** How the rest-of-field list is ordered. */
export type SortBy = 'winRate' | 'prevalence';

/** Win rate as a whole percent; an em dash when there is nothing to show. */
export function formatWinRate(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : `${Math.round(n)}%`;
}

/** Field share to one decimal, e.g. "12.7%". Empty string when unknown. */
export function formatShare(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '' : `${n.toFixed(1)}%`;
}

/** Signed win-rate delta in whole percentage points, for the lens rows. */
export function formatDeltaPp(n: number | null): string {
  if (n === null || !Number.isFinite(n)) {
    return '—';
  }
  return `${n > 0 ? '+' : ''}${Math.round(n)}pp`;
}

/**
 * Per-row tone, keyed off the exact 50% center rather than the overview's
 * 48-52 band: above 50 reads favored, below reads unfavored, 50 is neutral.
 *
 * This is the redundant, non-colour encoding of the gauge fill's hue — the
 * class is what a screen reader and a colourblind reader get, so it must not
 * silently disagree with the bar.
 * @param wr - Win rate percentage, or null
 * @returns The tone class
 */
export function toneClass(wr: number | null): string {
  if (wr === null || !Number.isFinite(wr) || Math.abs(wr - 50) < 0.5) {
    return 'mu-flat';
  }
  return wr > 50 ? 'mu-pos' : 'mu-neg';
}

/**
 * Sort rows descending, nulls last.
 *
 * In prevalence mode field share leads and the quality metric breaks ties;
 * otherwise quality alone orders the list. Nulls sort last in both, so a
 * matchup with no data never displaces one with data.
 * @param rows - The rows to order
 * @param mode - Which metric leads
 * @param quality - Extracts the quality metric (win rate, or lens delta)
 * @param prevalence - Extracts the field share
 * @returns A new sorted array
 */
export function sortByMode<T>(
  rows: readonly T[],
  mode: SortBy,
  quality: (t: T) => number | null,
  prevalence: (t: T) => number | null
): T[] {
  const cmp = (a: number | null, b: number | null): number => {
    if (a === null && b === null) {
      return 0;
    }
    if (a === null) {
      return 1;
    }
    if (b === null) {
      return -1;
    }
    return b - a;
  };
  return [...rows].sort((a, b) => {
    if (mode === 'prevalence') {
      const p = cmp(prevalence(a), prevalence(b));
      if (p !== 0) {
        return p;
      }
    }
    return cmp(quality(a), quality(b));
  });
}

/** Tally of the key matchups by outcome bucket, plus the field share they cover. */
export interface KeyMatchupStats {
  favored: number;
  even: number;
  unfavored: number;
  shareSum: number;
}

/**
 * Summarize the key matchups: how many fall in each bucket, and what share of
 * the field they account for.
 *
 * Key rows are pre-filtered to those that earned a win-rate readout, so
 * `winRate` is always present here — matching `MatchupRowCore`.
 * @param rows - The selected key rows
 * @returns The tally
 */
export function summarizeKeyMatchups(
  rows: readonly { winRate: number; prevalence?: number | null }[]
): KeyMatchupStats {
  const stats: KeyMatchupStats = { favored: 0, even: 0, unfavored: 0, shareSum: 0 };
  for (const r of rows) {
    const bucket = bucketWinRate(r.winRate);
    if (bucket === 'fav') {
      stats.favored += 1;
    } else if (bucket === 'even') {
      stats.even += 1;
    } else {
      stats.unfavored += 1;
    }
    stats.shareSum += r.prevalence ?? 0;
  }
  return stats;
}

/** Inclusion band that makes a card a tech choice rather than a core one. */
export const TECH_MIN_PCT = 30;
export const TECH_MAX_PCT = 90;

/** A suggested tech card, as a lens chip. */
export interface TechSuggestion {
  cardId: string;
  name: string;
  label: string;
}

/**
 * Cards worth offering as lens chips: those in the tech inclusion band,
 * most-played first.
 *
 * Below the band a card is fringe (too few decks to compare with or without);
 * at or above it the card is core, and splitting on it compares the archetype
 * against a handful of stragglers. cardIds resolve to the CLUSTER canonical
 * because lens decks are canonicalized to the global print, while a rebaked
 * report's items carry a rolling one.
 * @param items - The archetype report's items
 * @param db - Synonym database, or null
 * @param limit - How many chips to offer
 * @returns Suggestions, most-played first
 */
export function suggestTechCards(items: readonly CardItem[], db: SynonymDatabase | null, limit = 4): TechSuggestion[] {
  return items
    .filter(
      i =>
        i.set &&
        i.number !== undefined &&
        i.number !== null &&
        (i.pct ?? 0) >= TECH_MIN_PCT &&
        (i.pct ?? 0) < TECH_MAX_PCT
    )
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
    .slice(0, limit)
    .map(i => ({
      cardId: buildCanonicalCardId(i, db) ?? buildCardId(i.set!, i.number!),
      name: i.name,
      label: `${i.name} ${i.set} ${i.number}`
    }));
}
