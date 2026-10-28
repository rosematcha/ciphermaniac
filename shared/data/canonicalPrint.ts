/**
 * Canonical print selection policy.
 *
 * The goal is the print a player would actually buy for a standard deck:
 * the oldest standard-legal print that is still cheap, skipping high-rarity
 * reprints (secret rares, gold energies) and hard-to-find promos. Basic
 * energies invert the age rule: they are worthless, so we take the newest
 * cheap print instead.
 *
 * Mirror of `choose_canonical_print` in `download-tournament.py` —
 * keep the two implementations in sync until the Python one retires after
 * parity.
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
import { accessiblePriceCap, parseCardUid, type SynonymDatabase } from './cardIdentity';

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
export const ENERGY_SETS = new Set<string>(CATALOG.energySets);
export const BASIC_ENERGY_NAMES = new Set<string>(CATALOG.basicEnergyNames);
const CLASSIC_COLLECTION_SETS = new Set<string>(CATALOG.classicCollectionSets);

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

// Shrink a pool to the prints that pass, keeping it whole when none do.
function narrow(pool: PrintVariation[], keep: (variation: PrintVariation) => boolean): PrintVariation[] {
  const kept = pool.filter(keep);
  return kept.length ? kept : pool;
}

function setOf(variation: PrintVariation): string {
  return (variation.set || '').toUpperCase();
}

// Classic Collection reprints (CEL CC12, 30C CC9) never name a card while it
// has any other print.
function isClassicCollection(variation: PrintVariation): boolean {
  return CLASSIC_COLLECTION_SETS.has(setOf(variation)) && /^CC/i.test(String(variation.number ?? ''));
}

// Accessibility: strike collector-priced prints, and prints with no price at
// all when priced alternatives exist.
function affordable(pool: PrintVariation[]): PrintVariation[] {
  const prices = pool.map(v => normalizePrice(v.price_usd)).filter((p): p is number => p !== null);
  if (!prices.length) {
    return pool;
  }
  const cap = accessiblePriceCap(Math.min(...prices));
  return narrow(pool, v => {
    const price = normalizePrice(v.price_usd);
    return price !== null && price <= cap;
  });
}

// The oldest (or newest) print left. Ties break by lower collector number,
// then lower price: within a set the regular print carries the lower number,
// and a meta-spiked regular print must still beat a transiently cheaper
// collector version (the accessibility cap is the price gate; below it,
// number decides).
function pickByAge(pool: PrintVariation[], newest: boolean): PrintVariation {
  const sortKey = (v: PrintVariation): SortKey => {
    const index = getReleaseIndex(v.set);
    const price = normalizePrice(v.price_usd);
    return [newest ? index : -index, ...numberSortKey(v.number), price === null ? Number.POSITIVE_INFINITY : price];
  };
  return pool.reduce((best, v) => (compareKeys(sortKey(v), sortKey(best)) < 0 ? v : best));
}

// 1. Standard legality, on the event date when one is given. If nothing is
//    legal (a fully rotated card in historical data), fall back to every
//    print that existed on the date.
function standardPool(variations: PrintVariation[], asOfDate: string | null): PrintVariation[] {
  if (asOfDate === null) {
    return narrow(variations, v => STANDARD_LEGAL_SETS.has(setOf(v)));
  }
  const legal = variations.filter(v => isSetLegalAt(v.set, asOfDate));
  return legal.length ? legal : narrow(variations, v => printExistedAt(v.set, asOfDate));
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

  // 1. Standard legality (see standardPool), after striking Classic Collection
  //    reprints. 2. Accessibility.
  let pool = affordable(
    standardPool(
      narrow(variations, v => !isClassicCollection(v)),
      asOfDate
    )
  );

  // 3. Prefer non-promo prints; promos stay only for promo-only cards.
  pool = narrow(pool, v => !PROMO_SETS.has(setOf(v)));

  const wantNewest = BASIC_ENERGY_NAMES.has(cardName);

  // 3.5. Basic energies prefer the dedicated energy sets (SVE/MEE) outright:
  //      energy prints are rarely priced, so the accessibility cap cannot
  //      strike the collector reprints in main sets (e.g. OBF 230 gold Fire),
  //      and the newest-print rule would otherwise hand energies to whatever
  //      bling reprint shipped last.
  if (wantNewest) {
    pool = narrow(pool, v => ENERGY_SETS.has(setOf(v)));
  }

  // 4. Basic energies take the newest remaining print, everything else the
  //    oldest.
  return pickByAge(pool, wantNewest);
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

// UID parsing lives with the rest of the identity policy in cardIdentity.ts.
const parseUid = parseCardUid;

// The cluster's global canonical UID, by the same lookup rules as
// `resolve_canonical_uid` / `getCanonicalCardFromData`.
function globalCanonical(uid: string, db: SynonymDatabase): string {
  return uid.includes('::') ? (db.synonyms[uid] ?? uid) : (db.canonicals[uid] ?? db.synonyms[uid] ?? uid);
}

function clusterVariations(members: string[], db: SynonymDatabase): PrintVariation[] {
  const variations: PrintVariation[] = [];
  for (const member of members) {
    const parsed = parseUid(member);
    if (parsed) {
      variations.push({ set: parsed.set, number: parsed.number, price_usd: db.prints?.[member] ?? null });
    }
  }
  return variations;
}

/** Picks one print of a card from its cluster. */
type PrintChooser = (variations: PrintVariation[], cardName: string) => PrintVariation | null;

// Re-choose a UID's print from its whole cluster. Falls back to the global
// canonical when the cluster cannot be re-evaluated (unparseable UIDs, empty
// cluster).
function resolveInCluster(uid: string, db: SynonymDatabase, clusterIndex: ClusterIndex, choose: PrintChooser): string {
  if (!uid) {
    return uid;
  }
  const global = globalCanonical(uid, db);
  const parsed = parseUid(global);
  if (!parsed) {
    return global;
  }
  const chosen = choose(clusterVariations(clusterIndex.get(global) ?? [global], db), parsed.name);
  return chosen ? `${parsed.name}::${chosen.set}::${chosen.number}` : global;
}

function memoize(resolve: (uid: string) => string): (uid: string) => string {
  const cache = new Map<string, string>();
  return (uid: string): string => {
    const hit = cache.get(uid);
    if (hit !== undefined) {
      return hit;
    }
    const resolved = resolve(uid);
    cache.set(uid, resolved);
    return resolved;
  };
}

/**
 * Resolve a card UID to its canonical print as of an event date.
 */
export function resolveCanonicalUidAt(
  uid: string,
  db: SynonymDatabase,
  clusterIndex: ClusterIndex,
  asOfDate: string
): string {
  return resolveInCluster(uid, db, clusterIndex, (variations, name) =>
    chooseCanonicalPrint(variations, name, { asOfDate })
  );
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
  return memoize(uid => resolveCanonicalUidAt(uid, effectiveDb, clusterIndex, asOfDate));
}
