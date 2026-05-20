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

export function averageCopies(item: { dist?: CardDistributionEntry[] }): string {
  const { dist } = item;
  if (!dist || dist.length === 0) {
    return '—';
  }
  const players = dist.reduce((acc, d) => acc + (d.players ?? 0), 0);
  if (!players) {
    return '—';
  }
  const copies = dist.reduce((acc, d) => acc + (d.copies ?? 0) * (d.players ?? 0), 0);
  return (copies / players).toFixed(2);
}
