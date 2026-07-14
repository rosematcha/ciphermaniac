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
import type { SynonymDatabase } from './cardIdentity';

export type { SynonymDatabase };

export interface PrintVariation {
  set: string;
  number: string;
  price_usd?: number | null;
}

interface SetEntry {
  code: string;
  name: string;
  /** Tournament-legality date (ISO). Absent = never standard-legal in the dataset era. */
  legalFrom?: string;
  /** Rotation date that removed the set (exclusive). Null/absent with legalFrom = still legal. */
  legalUntil?: string | null;
}

export const SET_CATALOG: SetEntry[] = CATALOG.sets;
export const STANDARD_LEGAL_SETS = new Set<string>(CATALOG.standardLegalSets);
export const PROMO_SETS = new Set<string>(CATALOG.promoSets);
export const BASIC_ENERGY_NAMES = new Set<string>(CATALOG.basicEnergyNames);

// sets is ordered newest-first, so a larger index means an older set.
const SET_RELEASE_INDEX = new Map<string, number>(SET_CATALOG.map((entry, index) => [entry.code, index]));

const SET_BY_CODE = new Map<string, SetEntry>(SET_CATALOG.map(entry => [entry.code, entry]));

// Unknown sets are treated as newest: they are either brand-new sets missing
// from the catalog or oddball products, and neither should win "oldest".
const UNKNOWN_SET_INDEX = -1;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Was the set standard-legal on the given ISO date? Window is [legalFrom, legalUntil). */
export function isSetLegalAt(setCode: string | null | undefined, asOfDate: string): boolean {
  const entry = setCode ? SET_BY_CODE.get(setCode.toUpperCase()) : undefined;
  if (!entry?.legalFrom || entry.legalFrom > asOfDate) {
    return false;
  }
  return entry.legalUntil == null || asOfDate < entry.legalUntil;
}

// A print "existed" on a date unless its set is dated and became legal only
// later. Undated sets are pre-era products that certainly existed already.
function printExistedAt(setCode: string | null | undefined, asOfDate: string): boolean {
  const entry = setCode ? SET_BY_CODE.get(setCode.toUpperCase()) : undefined;
  return !entry?.legalFrom || entry.legalFrom <= asOfDate;
}

export function getReleaseIndex(setCode: string | null | undefined): number {
  if (!setCode) {
    return UNKNOWN_SET_INDEX;
  }
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
  if (!match) {
    return [Number.MAX_SAFE_INTEGER, String(number ?? '')];
  }
  return [parseInt(match[1], 10), match[2].toUpperCase()];
}

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) {
      return -1;
    }
    if (a[i] > b[i]) {
      return 1;
    }
  }
  return 0;
}

export interface ChooseCanonicalPrintOptions {
  /**
   * ISO date (YYYY-MM-DD) to evaluate standard legality against — the rolling
   * canonical for a historical event uses that event's start date, so the
   * canonical is the oldest print that was legal and reasonably priced *then*
   * (prices are still today's scrape; we keep the accessibility rule as an
   * approximation). Prints from sets not yet legal on the date are treated as
   * nonexistent. Omitted = current standardLegalSets behavior.
   */
  asOfDate?: string | null;
}

/**
 * Pick the canonical print from a cluster of print variations.
 */
export function chooseCanonicalPrint(
  variations: PrintVariation[] | null | undefined,
  cardName: string,
  options?: ChooseCanonicalPrintOptions
): PrintVariation | null {
  if (!variations || !variations.length) {
    return null;
  }

  const asOfDate = options?.asOfDate ?? null;
  if (asOfDate !== null && !ISO_DATE.test(asOfDate)) {
    throw new Error(`chooseCanonicalPrint: invalid asOfDate "${asOfDate}" (expected YYYY-MM-DD)`);
  }

  // 1. Standard legality, on the event date when one is given. If nothing is
  //    legal (a fully rotated card in historical data), fall back to every
  //    print that existed on the date.
  let pool: PrintVariation[];
  if (asOfDate !== null) {
    const legal = variations.filter(v => isSetLegalAt(v.set, asOfDate));
    if (legal.length) {
      pool = legal;
    } else {
      const existing = variations.filter(v => printExistedAt(v.set, asOfDate));
      pool = existing.length ? existing : [...variations];
    }
  } else {
    const legal = variations.filter(v => STANDARD_LEGAL_SETS.has((v.set || '').toUpperCase()));
    pool = legal.length ? legal : [...variations];
  }

  // 2. Accessibility. Strike collector-priced prints, and prints with no
  //    price at all when priced alternatives exist.
  const prices = pool.map(v => normalizePrice(v.price_usd)).filter((p): p is number => p !== null);
  if (prices.length) {
    const cap = accessiblePriceCap(Math.min(...prices));
    const affordable = pool.filter(v => {
      const price = normalizePrice(v.price_usd);
      return price !== null && price <= cap;
    });
    if (affordable.length) {
      pool = affordable;
    }
  }

  // 3. Prefer non-promo prints; promos stay only for promo-only cards.
  const nonPromo = pool.filter(v => !PROMO_SETS.has((v.set || '').toUpperCase()));
  if (nonPromo.length) {
    pool = nonPromo;
  }

  // 4. Basic energies take the newest remaining print, everything else the
  //    oldest. Ties break by lower price, then lower collector number.
  const wantNewest = BASIC_ENERGY_NAMES.has(cardName);
  const sortKey = (v: PrintVariation): SortKey => {
    const index = getReleaseIndex(v.set);
    const price = normalizePrice(v.price_usd);
    return [wantNewest ? index : -index, price === null ? Number.POSITIVE_INFINITY : price, ...numberSortKey(v.number)];
  };

  return pool.reduce((best, v) => (compareKeys(sortKey(v), sortKey(best)) < 0 ? v : best));
}

/**
 * Rolling (per-event) canonical resolution over the synonym DB.
 *
 * The synonym DB's flat `synonyms` map defines cluster membership: every
 * variant maps to the cluster's current global canonical, so inverting the map
 * recovers the full cluster. The global canonical stays the stable cross-event
 * identity (any per-event canonical is itself a variant that resolves back to
 * it), while the rolling canonical is re-chosen from the cluster with the
 * event date. `prints` carries the scraped price per variant UID so the
 * accessibility rule still applies.
 */

export type ClusterIndex = Map<string, string[]>;

/** Invert the synonyms map: global canonical UID -> all member UIDs (canonical included). */
export function buildClusterIndex(db: SynonymDatabase): ClusterIndex {
  const index: ClusterIndex = new Map();
  for (const [variant, canonical] of Object.entries(db.synonyms)) {
    let members = index.get(canonical);
    if (!members) {
      members = [canonical];
      index.set(canonical, members);
    }
    members.push(variant);
  }
  return index;
}

// UID format is `Name::SET::NUMBER`; names never contain `::`, but split from
// the right anyway so a malformed name cannot shift the set/number fields.
function parseUid(uid: string): { name: string; set: string; number: string } | null {
  const parts = uid.split('::');
  if (parts.length < 3) {
    return null;
  }
  const number = parts[parts.length - 1];
  const set = parts[parts.length - 2];
  const name = parts.slice(0, -2).join('::');
  if (!name || !set || !number) {
    return null;
  }
  return { name, set, number };
}

/**
 * Resolve a card UID to its canonical print as of an event date.
 *
 * Follows the same lookup rules as `resolve_canonical_uid` /
 * `getCanonicalCardFromData` to find the cluster, then re-chooses the
 * canonical member for the date. Falls back to the global canonical when the
 * cluster cannot be re-evaluated (unparseable UIDs, empty cluster).
 */
export function resolveCanonicalUidAt(
  uid: string,
  db: SynonymDatabase,
  clusterIndex: ClusterIndex,
  asOfDate: string
): string {
  if (!uid) {
    return uid;
  }
  const global = uid.includes('::') ? (db.synonyms[uid] ?? uid) : (db.canonicals[uid] ?? db.synonyms[uid] ?? uid);

  const members = clusterIndex.get(global) ?? [global];
  const parsed = parseUid(global);
  if (!parsed) {
    return global;
  }

  const variations: PrintVariation[] = [];
  for (const member of members) {
    const memberParsed = parseUid(member);
    if (!memberParsed) {
      continue;
    }
    // eslint-disable-next-line camelcase -- price_usd mirrors the scraped print-table shape
    variations.push({ set: memberParsed.set, number: memberParsed.number, price_usd: db.prints?.[member] ?? null });
  }
  const chosen = chooseCanonicalPrint(variations, parsed.name, { asOfDate });
  return chosen ? `${parsed.name}::${chosen.set}::${chosen.number}` : global;
}

/**
 * Build a memoized UID resolver bound to one event date, for injection into
 * the report builders (which stay isomorphic and must not import the set
 * catalog themselves). `priceOverrides` carries event-date prices from the
 * TCGCSV archive backfill (`assets/print-prices/{date}.json`); prints the
 * overrides miss fall back to the DB's current scrape.
 */
export function makeRollingResolver(
  db: SynonymDatabase,
  asOfDate: string,
  priceOverrides?: Record<string, number | null> | null
): (uid: string) => string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error(`makeRollingResolver: invalid asOfDate "${asOfDate}" (expected YYYY-MM-DD)`);
  }
  const effectiveDb: SynonymDatabase = priceOverrides ? { ...db, prints: { ...db.prints, ...priceOverrides } } : db;
  const clusterIndex = buildClusterIndex(effectiveDb);
  const cache = new Map<string, string>();
  return (uid: string): string => {
    const hit = cache.get(uid);
    if (hit !== undefined) {
      return hit;
    }
    const resolved = resolveCanonicalUidAt(uid, effectiveDb, clusterIndex, asOfDate);
    cache.set(uid, resolved);
    return resolved;
  };
}
