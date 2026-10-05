/**
 * Which age divisions play in which pod, as the Play! Pokémon Tournament
 * Rules Handbook sets it out (§5.2.1, Age-Combined Play, rev. September 1,
 * 2026): a division of fewer than six competitors is combined with another
 * for the Swiss rounds, and keeps its own standings and top cut.
 *
 * "The software will first look at Juniors, and if there are less than six
 * competitors, they will be combined with Seniors. If there are still less
 * than six, both Juniors and Seniors will be combined with Masters. If there
 * are at least six Juniors but less than six Seniors, the Seniors will be
 * combined with Masters. If only the Masters division has less than six
 * competitors, the Masters will be combined with Seniors."
 *
 * The handbook stops there. Where its steps still leave Masters in a pod
 * under six (Seniors and Masters together, or Masters with no Seniors to
 * join), that pod joins the Juniors: a pod under six is what the handbook
 * combines to avoid, and the Juniors' is the only one left.
 */

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

/** Divisions grouped into pods as they merge; each group is one pod. */
class Groups {
  private readonly groups: Division[][];

  constructor(private readonly counts: Readonly<Record<Division, number>>) {
    this.groups = DIVISIONS.filter(division => counts[division] > 0).map(division => [division]);
  }

  private of(division: Division): Division[] | undefined {
    return this.groups.find(group => group.includes(division));
  }

  /** Whether the division plays, in a pod of fewer than the minimum. */
  small(division: Division): boolean {
    const group = this.of(division);
    return group !== undefined && group.reduce((sum, d) => sum + this.counts[d], 0) < MIN_POD_SIZE;
  }

  /** Puts the division's pod together with another's; false when either division has nobody in it. */
  merge(division: Division, into: Division): boolean {
    const from = this.of(division);
    const to = this.of(into);
    if (!from || !to || from === to) {
      return false;
    }
    to.push(...from);
    this.groups.splice(this.groups.indexOf(from), 1);
    return true;
  }

  categories(): Map<Division, PodCategory> {
    return new Map(this.groups.flatMap(group => group.map(division => [division, categoryFor(group)] as const)));
  }
}

/**
 * The pod each division plays in, given how many competitors each has. A
 * division with nobody in it has no pod.
 */
export function poddingFor(counts: Readonly<Record<Division, number>>): Map<Division, PodCategory> {
  const groups = new Groups(counts);
  if (groups.small('junior')) {
    groups.merge('junior', 'senior');
    if (groups.small('junior')) {
      groups.merge('junior', 'masters');
    }
  } else if (groups.small('senior')) {
    groups.merge('senior', 'masters');
  }
  if (groups.small('masters') && !groups.merge('masters', 'senior')) {
    groups.merge('masters', 'junior');
  }
  return groups.categories();
}
