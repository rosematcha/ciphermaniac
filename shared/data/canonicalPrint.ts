/**
 * Canonical print selection policy.
 *
 * The goal is the print a player would actually buy for a standard deck:
 * the oldest standard-legal print that is still cheap, skipping high-rarity
 * reprints (secret rares, gold energies) and hard-to-find promos. Basic
 * energies invert the age rule: they are worthless, so we take the newest
 * cheap print instead.
 *
 * TypeScript port of `.github/scripts/lib/canonical-print.mjs`, preserving its
 * behavior exactly (DB-MASTER-PLAN Phase 2, slice 1). The `.mjs` remains the
 * runtime implementation for the ESM `.mjs` producer (`update-card-synonyms.mjs`)
 * until that producer migrates; a parity test asserts the two agree on a fixture
 * corpus. Mirror of `choose_canonical_print` in `download-tournament.py` — keep
 * all three implementations in sync until the Python one retires after parity.
 *
 * The set catalog is imported from the same JSON the `.mjs` and Python read, so
 * there is a single source of truth for set ordering, legality, promos, and
 * basic-energy names.
 * @module shared/data/canonicalPrint
 */

// Sibling of cardIdentity.ts but intentionally NOT imported by it: this module
// pulls in the (~10 KB) set catalog and is a producer-only policy. Keeping it
// out of the card-identity graph keeps the catalog out of the browser bundle.
import CATALOG from '../../.github/scripts/data/set-catalog.json';

export interface PrintVariation {
  set: string;
  number: string;
  price_usd?: number | null;
}

interface SetEntry {
  code: string;
  name: string;
}

export const SET_CATALOG: SetEntry[] = CATALOG.sets;
export const STANDARD_LEGAL_SETS = new Set<string>(CATALOG.standardLegalSets);
export const PROMO_SETS = new Set<string>(CATALOG.promoSets);
export const BASIC_ENERGY_NAMES = new Set<string>(CATALOG.basicEnergyNames);

// sets is ordered newest-first, so a larger index means an older set.
const SET_RELEASE_INDEX = new Map<string, number>(SET_CATALOG.map((entry, index) => [entry.code, index]));

// Unknown sets are treated as newest: they are either brand-new sets missing
// from the catalog or oddball products, and neither should win "oldest".
const UNKNOWN_SET_INDEX = -1;

export function getReleaseIndex(setCode: string | null | undefined): number {
  if (!setCode) return UNKNOWN_SET_INDEX;
  const upper = setCode.toUpperCase();
  return SET_RELEASE_INDEX.has(upper) ? (SET_RELEASE_INDEX.get(upper) as number) : UNKNOWN_SET_INDEX;
}

function normalizePrice(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// A print is "accessible" when it costs no more than twice the cheapest
// print, with $0.50 of absolute slack so penny-priced cards do not strike
// prints over noise. Anything above the cap is a collector version.
function accessiblePriceCap(minPrice: number): number {
  return Math.max(minPrice * 2, minPrice + 0.5);
}

type SortKey = ReadonlyArray<number | string>;

function numberSortKey(number: string | null | undefined): [number, string] {
  const match = /^(\d+)([A-Za-z]*)$/.exec(String(number ?? ''));
  if (!match) return [Number.MAX_SAFE_INTEGER, String(number ?? '')];
  return [parseInt(match[1], 10), match[2].toUpperCase()];
}

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * Pick the canonical print from a cluster of print variations.
 */
export function chooseCanonicalPrint(
  variations: PrintVariation[] | null | undefined,
  cardName: string
): PrintVariation | null {
  if (!variations || !variations.length) return null;

  // 1. Standard legality. If nothing is legal (a fully rotated card in
  //    historical data), fall back to every print.
  const legal = variations.filter(v => STANDARD_LEGAL_SETS.has((v.set || '').toUpperCase()));
  let pool = legal.length ? legal : [...variations];

  // 2. Accessibility. Strike collector-priced prints, and prints with no
  //    price at all when priced alternatives exist.
  const prices = pool.map(v => normalizePrice(v.price_usd)).filter((p): p is number => p !== null);
  if (prices.length) {
    const cap = accessiblePriceCap(Math.min(...prices));
    const affordable = pool.filter(v => {
      const price = normalizePrice(v.price_usd);
      return price !== null && price <= cap;
    });
    if (affordable.length) pool = affordable;
  }

  // 3. Prefer non-promo prints; promos stay only for promo-only cards.
  const nonPromo = pool.filter(v => !PROMO_SETS.has((v.set || '').toUpperCase()));
  if (nonPromo.length) pool = nonPromo;

  // 4. Basic energies take the newest remaining print, everything else the
  //    oldest. Ties break by lower price, then lower collector number.
  const wantNewest = BASIC_ENERGY_NAMES.has(cardName);
  const sortKey = (v: PrintVariation): SortKey => {
    const index = getReleaseIndex(v.set);
    const price = normalizePrice(v.price_usd);
    return [
      wantNewest ? index : -index,
      price === null ? Number.POSITIVE_INFINITY : price,
      ...numberSortKey(v.number)
    ];
  };

  return pool.reduce((best, v) => (compareKeys(sortKey(v), sortKey(best)) < 0 ? v : best));
}
