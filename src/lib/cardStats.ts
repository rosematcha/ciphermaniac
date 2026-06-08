import type { CardDistributionEntry } from '../types';
import { capitalize } from './format';

export function categoryLabel(item: { category?: string }): string {
  if (!item.category) {
    return '—';
  }
  const [main, sub] = item.category.split('/');
  if (!sub) {
    return capitalize(main);
  }
  return `${capitalize(main)} · ${capitalize(sub)}`;
}

/**
 * Numeric weighted-mean copies from the distribution histogram, or null when
 * there's no usable distribution. `averageCopies` is the string-formatted
 * sibling used by the table; this one feeds the build-pool math.
 */
export function averageCopiesValue(item: { dist?: CardDistributionEntry[] }): number | null {
  const { dist } = item;
  if (!dist || dist.length === 0) {
    return null;
  }
  const players = dist.reduce((acc, d) => acc + (d.players ?? 0), 0);
  if (!players) {
    return null;
  }
  const copies = dist.reduce((acc, d) => acc + (d.copies ?? 0) * (d.players ?? 0), 0);
  return copies / players;
}

export function averageCopies(item: { dist?: CardDistributionEntry[] }): string {
  const value = averageCopiesValue(item);
  return value === null ? '—' : value.toFixed(2);
}

/**
 * Round an average copy count to the integer the card contributes to a build.
 * A card present in the pool counts at least once; non-basic cards cap at the
 * TCG rule of 4, while basic energy is uncapped.
 */
export function roundedCopies(item: { category?: string; supertype?: string }, avg: number): number {
  const cat = (item.category ?? '').toLowerCase();
  const supertype = (item.supertype ?? '').toLowerCase();
  const isEnergy = cat.startsWith('energy') || supertype === 'energy';
  const r = Math.round(avg);
  if (r < 1) {
    return 1;
  }
  if (!isEnergy && r > 4) {
    return 4;
  }
  return r;
}
