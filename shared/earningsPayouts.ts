/**
 * Restating historical finishes at today's prize money.
 *
 * Pokemon's payouts have risen several times over, so raw career totals flatter
 * whoever competed most recently. Re-paying every finish from the current
 * published tables makes a 2013 win and a 2026 win comparable.
 *
 * Pure functions only — `scripts/build-earnings.ts` does the IO.
 * @module shared/earningsPayouts
 */

import type { DividedResult, EarningsDivision, EarningsSeason, EarningsTier, EarningsTotals } from './earningsTypes.js';

/**
 * TCG payouts for the 2027 Championship Series, as published at
 * championships.pokemon.com. Bands are inclusive upper bounds: `{ through: 4 }`
 * pays places 3-4, the bands above it having already claimed 1 and 2.
 *
 * Pokemon publishes one column for Masters and one shared by Juniors and
 * Seniors, which pays far less — a Senior Regional win is $2,500 against a
 * Masters $10,000. Worlds is the exception: it pays the same in every division.
 */
export const PAYOUTS: Record<EarningsTier, Record<EarningsDivision, Array<{ through: number; amount: number }>>> = {
  regional: {
    masters: [
      { through: 1, amount: 10_000 },
      { through: 2, amount: 7_000 },
      { through: 4, amount: 5_000 },
      { through: 8, amount: 3_000 },
      { through: 16, amount: 2_000 },
      { through: 32, amount: 1_000 }
    ],
    'junior-senior': [
      { through: 1, amount: 2_500 },
      { through: 2, amount: 2_000 },
      { through: 4, amount: 1_000 },
      { through: 8, amount: 750 }
    ]
  },
  international: {
    masters: [
      { through: 1, amount: 25_000 },
      { through: 2, amount: 15_000 },
      { through: 4, amount: 10_000 },
      { through: 8, amount: 7_000 },
      { through: 16, amount: 5_000 },
      { through: 32, amount: 3_000 },
      { through: 64, amount: 2_000 }
    ],
    'junior-senior': [
      { through: 1, amount: 7_000 },
      { through: 2, amount: 5_000 },
      { through: 4, amount: 3_000 },
      { through: 8, amount: 2_000 },
      { through: 16, amount: 1_000 },
      { through: 32, amount: 750 }
    ]
  },
  worlds: {
    masters: [
      { through: 1, amount: 50_000 },
      { through: 2, amount: 30_000 },
      { through: 4, amount: 20_000 },
      { through: 8, amount: 15_000 },
      { through: 16, amount: 10_000 },
      { through: 32, amount: 5_000 }
    ],
    // Worlds publishes a single prize column for every division.
    'junior-senior': [
      { through: 1, amount: 50_000 },
      { through: 2, amount: 30_000 },
      { through: 4, amount: 20_000 },
      { through: 8, amount: 15_000 },
      { through: 16, amount: 10_000 },
      { through: 32, amount: 5_000 }
    ]
  }
};

/**
 * Limitless event type to the table it restates from.
 *
 * Only three tiers still publish a payout table. Nationals were the pre-2017
 * flagship — often bigger than a modern Regional — so they pay at
 * International rates; Special Championships run the Regional structure.
 * Champions League, online events, Players Cup and invitationals have no
 * modern equivalent and restate to $0.
 */
export const TIER_OF_TYPE: Record<string, EarningsTier> = {
  regional: 'regional',
  special: 'regional',
  international: 'international',
  national: 'international',
  worlds: 'worlds'
};

/** What a finish pays under the current table for its tier and division. */
export function payoutFor(tier: EarningsTier, place: number | null, division: EarningsDivision): number {
  if (place == null) {
    return 0;
  }
  for (const band of PAYOUTS[tier][division]) {
    if (place <= band.through) {
      return band.amount;
    }
  }
  return 0;
}

/** Career total is derived from the season map, never accumulated alongside it. */
function totalsOf(seasons: Record<string, number>): EarningsTotals {
  return { total: Object.values(seasons).reduce((sum, amount) => sum + amount, 0), seasons };
}

/**
 * Fold one player's results into actual and adjusted season maps.
 *
 * `typeOf` resolves a tournament id to its Limitless event type; an unknown id
 * contributes real cash but no adjusted money, since there is no table to pay
 * it from.
 */
export function totalsFor(
  results: DividedResult[],
  typeOf: (tournamentId: string) => string | undefined
): { actual: EarningsTotals; adjusted: EarningsTotals } {
  const actual: Record<string, number> = {};
  const adjusted: Record<string, number> = {};
  for (const row of results) {
    if (row.cash > 0) {
      actual[row.season] = (actual[row.season] ?? 0) + row.cash;
    }
    const tier = TIER_OF_TYPE[typeOf(row.tournamentId) ?? ''];
    const paid = tier ? payoutFor(tier, row.place, row.division) : 0;
    if (paid > 0) {
      adjusted[row.season] = (adjusted[row.season] ?? 0) + paid;
    }
  }
  return { actual: totalsOf(actual), adjusted: totalsOf(adjusted) };
}

/** `1920` renders as `2019-2020`. Keys are two 2-digit years; 90+ means 19xx. */
export function seasonLabel(key: string): string {
  const century = (year: number) => (year >= 90 ? 1900 + year : 2000 + year);
  return `${century(Number(key.slice(0, 2)))}–${century(Number(key.slice(2)))}`;
}

/** Every season present in the data, newest first. */
export function seasonList(seasonKeys: Iterable<string>): EarningsSeason[] {
  return [...new Set(seasonKeys)].sort((a, b) => b.localeCompare(a)).map(key => ({ key, label: seasonLabel(key) }));
}
