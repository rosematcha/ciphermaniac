/** Age pods chosen by TOM 1.86, including its handling of empty divisions. */

import { type Division, DIVISIONS, type PodCategory } from './types.js';

/** The fewest competitors a division plays in a pod of its own (§5.2.1). */
export const MIN_POD_SIZE = 6;

/** The divisions a pod of this category plays. */
const PLAYS: Record<PodCategory, readonly Division[]> = {
  junior: ['junior'],
  senior: ['senior'],
  masters: ['masters'],
  'junior-senior': ['junior', 'senior'],
  'senior-masters': ['senior', 'masters'],
  mixed: DIVISIONS
};

export function divisionsOf(category: PodCategory): readonly Division[] {
  return PLAYS[category];
}

/** The category of a pod that plays these divisions. */
export function categoryFor(divisions: readonly Division[]): PodCategory {
  const has = new Set(divisions);
  if (has.size === 1) {
    return divisions[0] as Division;
  }
  if (has.size === 2 && !has.has('masters')) {
    return 'junior-senior';
  }
  return has.size === 2 && !has.has('junior') ? 'senior-masters' : 'mixed';
}

type Counts = Readonly<Record<Division, number>>;

/** TOM considers empty divisions when choosing a combined category. */
const POD_RULES: { test: (counts: Counts) => boolean; pods: readonly PodCategory[] }[] = [
  { test: c => DIVISIONS.every(d => c[d] >= MIN_POD_SIZE), pods: ['junior', 'senior', 'masters'] },
  {
    test: c => c.junior < MIN_POD_SIZE && c.masters >= MIN_POD_SIZE && c.junior + c.senior >= MIN_POD_SIZE,
    pods: ['junior-senior', 'masters']
  },
  { test: c => c.junior >= MIN_POD_SIZE && c.senior + c.masters >= MIN_POD_SIZE, pods: ['junior', 'senior-masters'] },
  { test: c => c.junior > 0 && c.senior === 0 && c.masters === 0, pods: ['junior'] },
  { test: c => c.junior === 0 && c.senior > 0 && c.masters === 0, pods: ['senior'] },
  { test: c => c.junior === 0 && c.senior === 0 && c.masters > 0, pods: ['masters'] }
];

/** TOM's pod for every participating division; an empty division has no entry. */
export function poddingFor(counts: Counts): Map<Division, PodCategory> {
  const categories: readonly PodCategory[] = POD_RULES.find(rule => rule.test(counts))?.pods ?? ['mixed'];
  return new Map(
    DIVISIONS.filter(d => counts[d] > 0).map(d => [d, categories.find(category => divisionsOf(category).includes(d))!])
  );
}
