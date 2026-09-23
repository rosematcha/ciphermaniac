/**
 * Rows for the Set Impact table: each set's per-major average and the
 * lifetime its majors add up to, under one attribution.
 *
 * Lifetime is the set's per-major figure integrated over the time its majors
 * cover, so a set only earns for the seasons that were actually played, and a
 * set still in Standard shows what it has done so far. Sets seen at too few
 * majors keep their figures but sit unranked at the bottom.
 * @module src/utils/setImpactRows
 */

import type { SetImpactAttribution, SetImpactCard, SetImpactPayload } from '../../shared/setImpact/types';

export interface SetImpactRow {
  code: string;
  name: string;
  legalFrom: string;
  rotatesOn: string | null;
  rotationPredicted: boolean;
  majors: number;
  /** False when the set was seen at fewer than `MIN_MAJORS`; the row shows but doesn't rank. */
  ranked: boolean;
  /** Distinct cards from the set in the average deck, averaged over its majors. */
  perMajor: number;
  years: number | null;
  /** Per-major figure integrated over the years its majors cover. */
  lifetime: number;
  /** Cards credited under the attribution, most played first. */
  cards: SetImpactRowCard[];
  /** Per-major figure at each event the set was legal for, oldest first. */
  series: number[];
  /** Dates of the first and last majors seen while the set was legal. */
  seenFrom: string | null;
  seenUntil: string | null;
  /** Share of the set's legal years its majors cover; null when the rotation is unknown. */
  coverage: number | null;
  /** Part of perMajor that comes from staples. */
  staples: number;
}

export interface SetImpactRowCard extends SetImpactCard {
  staple: boolean;
  /** The card's part of perMajor: its share spread over every major of the set. */
  contribution: number;
}

/** A card in at least this share of decks is a staple. */
export const STAPLE_SHARE = 0.4;

/** A set seen at fewer majors than this is shown but not ranked. */
export const MIN_MAJORS = 8;

export type SetImpactSortColumn = 'name' | 'majors' | 'perMajor' | 'lifetime';

export type SortDirection = 'ascending' | 'descending';

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const mean = (values: number[]): number => (values.length ? sum(values) / values.length : 0);

export function setImpactRows(payload: SetImpactPayload, attribution: SetImpactAttribution): SetImpactRow[] {
  return payload.sets.map(set => {
    const series = set.series[attribution];
    const cards = set.cards
      .filter(card => attribution === 'legal' || card.isNew)
      .map(card => ({
        ...card,
        staple: card.share >= STAPLE_SHARE,
        contribution: (card.share * card.majors) / set.events.length
      }))
      .sort((a, b) => b.share - a.share);
    const covered = sum(set.weights);
    return {
      code: set.code,
      name: set.name,
      legalFrom: set.legalFrom,
      rotatesOn: set.rotatesOn,
      rotationPredicted: set.rotationPredicted,
      majors: set.events.length,
      ranked: set.events.length >= MIN_MAJORS,
      perMajor: mean(series),
      years: set.legalYears,
      lifetime: sum(series.map((value, i) => value * set.weights[i])),
      cards,
      series,
      seenFrom: payload.events[set.events[0]]?.date ?? null,
      seenUntil: payload.events[set.events[set.events.length - 1]]?.date ?? null,
      coverage: set.legalYears ? Math.min(1, covered / set.legalYears) : null,
      staples: sum(cards.filter(card => card.staple).map(card => card.contribution))
    };
  });
}

const SORT_KEYS: Record<SetImpactSortColumn, (row: SetImpactRow) => string | number> = {
  name: row => row.name,
  majors: row => row.majors,
  perMajor: row => row.perMajor,
  lifetime: row => row.lifetime
};

/** The way a column sorts on its first click: names up, figures down. */
export function defaultDirection(column: SetImpactSortColumn): SortDirection {
  return column === 'name' ? 'ascending' : 'descending';
}

function compareKeys(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}

/**
 * Sorted copy. Unranked sets sort last in either direction when a figure is
 * the key; ties fall back to the older set.
 */
export function sortSetImpactRows(
  rows: SetImpactRow[],
  column: SetImpactSortColumn,
  direction: SortDirection
): SetImpactRow[] {
  const key = SORT_KEYS[column];
  const sign = direction === 'ascending' ? 1 : -1;
  const figure = column !== 'name';
  return [...rows].sort((a, b) => {
    if (figure && a.ranked !== b.ranked) {
      return Number(b.ranked) - Number(a.ranked);
    }
    return compareKeys(key(a), key(b)) * sign || a.legalFrom.localeCompare(b.legalFrom);
  });
}

/** Whole percents, with anything under 1% shown as "<1%". */
export function formatShare(share: number): string {
  return share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
}

/** "Apr 2026". */
export function monthYear(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}
