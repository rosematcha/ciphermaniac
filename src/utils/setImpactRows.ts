/**
 * Rows for the Set Impact table: each set's per-major average, its years in
 * Standard, and the lifetime the two multiply to, under one attribution and
 * one metric.
 * @module src/utils/setImpactRows
 */

import type {
  SetImpactAttribution,
  SetImpactCard,
  SetImpactMetric,
  SetImpactPayload
} from '../../shared/setImpactTypes';

export interface SetImpactRow {
  code: string;
  name: string;
  legalFrom: string;
  rotatesOn: string | null;
  rotationPredicted: boolean;
  majors: number;
  /** Distinct cards from the set in the average deck, averaged over its majors. */
  perMajor: number;
  years: number | null;
  /** perMajor × years; null when the rotation is unknown. */
  lifetime: number | null;
  /** Cards credited under the attribution, most played first. */
  cards: Array<SetImpactCard & { share: number }>;
}

export type SetImpactSortColumn = 'name' | 'legalFrom' | 'rotatesOn' | 'majors' | 'perMajor' | 'years' | 'lifetime';

export type SortDirection = 'ascending' | 'descending';

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function setImpactRows(
  payload: SetImpactPayload,
  attribution: SetImpactAttribution,
  metric: SetImpactMetric
): SetImpactRow[] {
  return payload.sets.map(set => {
    const perMajor = mean(set.series[attribution][metric]);
    return {
      code: set.code,
      name: set.name,
      legalFrom: set.legalFrom,
      rotatesOn: set.rotatesOn,
      rotationPredicted: set.rotationPredicted,
      majors: set.events.length,
      perMajor,
      years: set.legalYears,
      lifetime: set.legalYears === null ? null : perMajor * set.legalYears,
      cards: set.cards
        .filter(card => attribution === 'legal' || card.isNew)
        .map(card => ({ ...card, share: card[metric] }))
        .sort((a, b) => b.share - a.share)
    };
  });
}

const SORT_KEYS: Record<SetImpactSortColumn, (row: SetImpactRow) => string | number | null> = {
  name: row => row.name,
  legalFrom: row => row.legalFrom,
  rotatesOn: row => row.rotatesOn,
  majors: row => row.majors,
  perMajor: row => row.perMajor,
  years: row => row.years,
  lifetime: row => row.lifetime
};

/** The way a column sorts on its first click: names and dates up, figures down. */
export function defaultDirection(column: SetImpactSortColumn): SortDirection {
  return ['name', 'legalFrom', 'rotatesOn'].includes(column) ? 'ascending' : 'descending';
}

function compareKeys(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}

/** Sorted copy. Unknown values sort last in either direction. */
export function sortSetImpactRows(
  rows: SetImpactRow[],
  column: SetImpactSortColumn,
  direction: SortDirection
): SetImpactRow[] {
  const key = SORT_KEYS[column];
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) {
      return Number(ka === null) - Number(kb === null);
    }
    return compareKeys(ka, kb) * sign || a.legalFrom.localeCompare(b.legalFrom);
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
