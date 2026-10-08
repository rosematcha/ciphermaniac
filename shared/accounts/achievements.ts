/**
 * Achievements: the badges a public profile shows. Counted ones come from
 * what the account did on the site and are read fresh with its History, so
 * an event deleted or wiped takes its count with it. Granted ones are rows in
 * `account_badges`, set by hand: the developer, contributors, and the first
 * accounts, frozen as they were granted.
 */

/** Badges counted from the account's events, in the order a profile lists them. */
export const COUNTED = ['played', 'won', 'organized', 'staffed', 'traveler', 'bug', 'developer'] as const;

/** Badges an account holds or not, with no count. */
export const SPECIAL = ['creator', 'beta', 'early'] as const;

export type CountedKey = (typeof COUNTED)[number];
export type SpecialKey = (typeof SPECIAL)[number];

/** The count each tier starts at: the first tier is the badge itself. */
export const TIERS: Record<CountedKey, readonly number[]> = {
  played: [1, 5, 25, 100],
  won: [1, 5, 25],
  organized: [1, 10, 50],
  staffed: [1, 10, 50],
  // One city is home; travel starts at the second.
  traveler: [2, 5, 10],
  bug: [1, 5, 25],
  developer: [1, 5, 25]
};

export type Badge = { key: SpecialKey } | { key: CountedKey; count: number; tier: number };

/** The tier `count` reaches, from 1; 0 when it reaches none. */
export function tierOf(key: CountedKey, count: number): number {
  return TIERS[key].filter(start => count >= start).length;
}

/**
 * The badges an account has earned, specials first, each list in catalog
 * order. `counts` holds every counted badge, granted ones included; a special
 * is earned when it is in `specials`.
 */
export function badgesOf(counts: Partial<Record<CountedKey, number>>, specials: ReadonlySet<string>): Badge[] {
  const special = SPECIAL.filter(key => specials.has(key)).map(key => ({ key }));
  const counted = COUNTED.flatMap(key => {
    const count = counts[key] ?? 0;
    const tier = tierOf(key, count);
    return tier > 0 ? [{ key, count, tier }] : [];
  });
  return [...special, ...counted];
}

/** Whether a granted row's badge is one that counts, its count being how many were accepted. */
export const isCountedGrant = (key: string): key is CountedKey => key === 'bug' || key === 'developer';
