/**
 * Card identity policy — the single home for card number/set/UID normalization,
 * synonym resolution, and per-deck canonical aggregation.
 *
 * Consolidated from `shared/cardUtils.ts`, `shared/data/cardIdentity.ts`, and
 * `shared/canonicalDeckCards.ts` (DB-MASTER-PLAN Phase 2, slice 1). Those
 * modules now re-export from here so existing callers keep working unchanged.
 *
 * Invariants preserved from the plan:
 * - Two printings of one canonical card in a single deck count once
 *   ({@link aggregateCanonicalCardsPerDeck} sums copies per canonical UID).
 * - `found <= deckTotal`: presence is incremented exactly once per deck because
 *   downstream counters iterate the aggregated per-deck map, not raw card rows.
 *
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add any environment-specific dependencies here.
 * @module shared/data/cardIdentity
 */

// ============================================================================
// Card number / set / UID normalization (from shared/cardUtils.ts)
// ============================================================================

/**
 * Normalizes a card number to 3-digit format with optional uppercase suffix.
 * @example
 * normalizeCardNumber("5")     // "005"
 * normalizeCardNumber("18a")   // "018A"
 * normalizeCardNumber("118")   // "118"
 * normalizeCardNumber("GG05")  // "GG05" (non-numeric prefix preserved, uppercased)
 * @param value - The card number to normalize
 * @returns Normalized card number, or empty string if invalid
 */
export function normalizeCardNumber(value: string | number | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    // Non-numeric prefix (like "GG05") - just uppercase it
    return raw.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
}

/**
 * Normalizes a card number for zero-stripped `SET::NUMBER` index keys: the
 * digit prefix loses leading zeros and any letter suffix is uppercased, so
 * `018a`, `18A`, and `18a` all collapse to `18A`. This is the complement of
 * {@link normalizeCardNumber} (which zero-PADS) — both the index producers and
 * the SPA readers must use this one helper so keys can't drift.
 * @example
 * cardNumberIndexKey("045a") // "45A"
 * cardNumberIndexKey("098")  // "98"
 * cardNumberIndexKey("GG05") // "GG05"
 * @param value - The card number to normalize
 * @returns Zero-stripped, suffix-uppercased card number
 */
export function cardNumberIndexKey(value: string | number): string {
  const raw = String(value).trim();
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return raw.toUpperCase();
  }
  const digits = match[1].replace(/^0+/, '') || '0';
  const suffix = match[2] ? match[2].toUpperCase() : '';
  return `${digits}${suffix}`;
}

// ============================================================================
// Card identity forms
// ============================================================================

/**
 * The three string forms of card identity in this codebase. They are all
 * strings, they all look alike, and confusing two of them is how
 * `/cards/TWM/130` and `/cards/PRE/073` came to 301 at each other (D19). The
 * branded types below exist so the compiler can tell them apart.
 *
 * | Form | Shape | Number | Built by |
 * |---|---|---|---|
 * | {@link CardUid} | `Name::SET::NUMBER` | zero-PADDED (`073`) | {@link cardUid} |
 * | `CardRouteKey` | `SET::NUMBER` | zero-STRIPPED (`73`) | `cardRouteKey` in canonicalCardRoute |
 * | `CardMatchId` | `SET~NUMBER` | zero-PADDED | {@link buildCardId} |
 *
 * The padded/stripped split is not cosmetic. The synonym database keys UIDs
 * padded — 547 of its 2,295 entries have a leading zero — so a UID built
 * without padding misses roughly a quarter of all reprint mappings, silently.
 */
declare const CARD_UID_BRAND: unique symbol;

/**
 * A canonicalized card UID: `Name::SET::NUMBER` with the set uppercased and the
 * number zero-padded. This is the key form of the synonym database, price maps,
 * report items, and every cross-artifact card join.
 *
 * Branded so it cannot be built by hand — {@link cardUid} is the only
 * constructor, and it always normalizes. Deck cards carry RAW printings
 * (`TWM/95`) while reports, prices, and synonyms carry padded ones
 * (`TWM/095`), so "just interpolate the fields" produces a key that matches on
 * some inputs and silently misses on others.
 */
export type CardUid = string & { readonly [CARD_UID_BRAND]: 'CardUid' };

/**
 * Build a canonical card UID from a card's parts.
 *
 * The ONE constructor for this form. Normalizes the set (uppercase) and the
 * number (zero-padded), so a deck-shaped card and a report-shaped card for the
 * same printing produce the same UID.
 * @param name - Card name, used verbatim (names are the identity, not a slug)
 * @param setCode - Set code, any casing
 * @param number - Card number, padded or not
 * @returns The UID, or null when set or number is missing or unusable
 */
export function cardUid(
  name: string | null | undefined,
  setCode: string | null | undefined,
  number: string | number | null | undefined
): CardUid | null {
  if (!name) {
    return null;
  }
  const [set, normalized] = canonicalizeVariant(setCode, number);
  if (!set || !normalized) {
    return null;
  }
  return `${name}::${set}::${normalized}` as CardUid;
}

/**
 * {@link cardUid}, falling back to the bare card name when set or number is
 * absent.
 *
 * Several producers key un-setted cards (basic energy, malformed rows) by name
 * alone, and the synonym database's name-only `canonicals` map is keyed that
 * way too. The result is NOT a `CardUid` — it may be a bare name — so it is
 * typed as a plain string on purpose.
 * @param name - Card name
 * @param setCode - Set code, possibly absent
 * @param number - Card number, possibly absent
 * @returns The UID, or the bare name when the printing is unidentified
 */
export function cardUidOrName(
  name: string,
  setCode: string | null | undefined,
  number: string | number | null | undefined
): string {
  return cardUid(name, setCode, number) ?? name;
}

export function maybeItemUid(item: {
  uid?: string;
  name?: string;
  set?: string | null;
  number?: string | number | null;
}): string | null {
  return item.uid || (item.name ? cardUidOrName(item.name, item.set, item.number) : null);
}

export function itemUid(item: {
  uid?: string;
  name: string;
  set?: string | null;
  number?: string | number | null;
}): string {
  return maybeItemUid(item) as string;
}

/**
 * Assert that an existing string is already a canonical card UID.
 *
 * For values that came OUT of a trusted producer (a report item's `uid`, a
 * synonym-database key) rather than being assembled locally. Use {@link cardUid}
 * for anything you are building; this is the "I read this, I did not make it"
 * escape hatch, and it is deliberately noisy to type.
 * @param uid - A UID from an artifact
 * @returns The same string, typed
 */
export function asCardUid(uid: string): CardUid {
  return uid as CardUid;
}

/**
 * Canonicalizes a card variant by normalizing set code and number.
 * @param setCode - The set code (e.g., "SVI", "paldea")
 * @param number - The card number
 * @returns Tuple of [uppercased setCode, normalized number]
 */
export function canonicalizeVariant(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): [string | null, string | null] {
  const sc = (setCode || '').toString().toUpperCase().trim();
  if (!sc) {
    return [null, null];
  }
  const normalizedNumber = normalizeCardNumber(number);
  if (!normalizedNumber) {
    return [sc, null];
  }
  return [sc, normalizedNumber];
}

/**
 * Builds a card identifier string in the format "SET~NUMBER".
 * @param setCode - The set code
 * @param number - The card number
 * @returns Identifier like "SVI~118", or null if invalid
 */
export function buildCardId(setCode: string, number: string | number | null | undefined): string {
  const set = setCode.trim().toUpperCase();
  return `${set}~${normalizeCardNumber(number)}`;
}

// ============================================================================
// Synonym resolution (from shared/data/cardIdentity.ts)
// ============================================================================

/**
 * Synonym database structure
 */
export interface SynonymDatabase {
  /** Maps variant UIDs to their canonical UID */
  synonyms: Record<string, string>;
  /** Maps card names to their preferred canonical UID */
  canonicals: Record<string, string>;
  /**
   * Scraped USD price per print UID (canonical prints included). Optional:
   * only producers need it, to re-choose a cluster's canonical for a
   * historical event date (rolling canonicals, `resolveCanonicalUidAt` in
   * canonicalPrint.ts) without re-scraping Limitless.
   */
  prints?: Record<string, number | null>;
}

/**
 * Empty database for fallback scenarios
 */
export const EMPTY_DATABASE: SynonymDatabase = {
  synonyms: {},
  canonicals: {}
};

/**
 * Get the canonical UID for a given card identifier (pure function)
 *
 * Resolution rules:
 * 1. For UIDs (contains '::'): Check synonyms mapping only. Cards with same name
 * but different abilities must NOT be merged unless explicitly in synonyms.
 * 2. For name-only inputs: Check canonicals, then synonyms as fallback.
 * @param database - Synonym database (or null for no-op)
 * @param cardIdentifier - Card UID (Name::SET::NUMBER) or card name
 * @returns Canonical UID or original identifier if no mapping exists
 */
export function getCanonicalCardFromData(database: SynonymDatabase | null, cardIdentifier: string): string {
  if (!cardIdentifier) {
    return cardIdentifier;
  }

  if (!database) {
    return cardIdentifier;
  }

  // If this looks like a UID (Name::SET::NUMBER), check explicit synonym mapping first.
  // Cards with the same name but different abilities (e.g., Ralts PAF 027 vs Ralts MEG 058)
  // must not be merged - only cards explicitly listed in synonyms should be canonicalized.
  if (cardIdentifier.includes('::')) {
    if (database.synonyms && database.synonyms[cardIdentifier]) {
      return database.synonyms[cardIdentifier];
    }
    // UID not in synonyms means it's its own canonical - return as-is
    return cardIdentifier;
  }

  // For name-only inputs, return configured canonical if present
  if (database.canonicals && database.canonicals[cardIdentifier]) {
    return database.canonicals[cardIdentifier];
  }

  // Fall back to direct synonym mapping if someone passed a name mapped in synonyms
  if (database.synonyms && database.synonyms[cardIdentifier]) {
    return database.synonyms[cardIdentifier];
  }

  return cardIdentifier;
}

// UID format is `Name::SET::NUMBER`; names never contain `::`, but split from
// the right anyway so a malformed name cannot shift the set/number fields.
export function parseCardUid(uid: string): { name: string; set: string; number: string } | null {
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
 * A print is "accessible" when it costs no more than twice the cheapest print
 * in its reprint cluster, with $0.50 of absolute slack so penny-priced cards do
 * not strike prints over noise. Anything above the cap is a collector version
 * (alt art, special illustration rare, gold energy).
 *
 * Lives here rather than in canonicalPrint.ts so the browser can apply the same
 * rule without pulling the set catalog into the bundle.
 * @param minPrice - Cheapest USD price across the cluster
 */
export function accessiblePriceCap(minPrice: number): number {
  return Math.max(minPrice * 2, minPrice + 0.5);
}

/**
 * All printings in a card's reprint cluster: the canonical UID first, then
 * every variant that resolves to it, in the synonyms map's iteration order.
 *
 * The flat `synonyms` map defines cluster membership (variant → canonical), so
 * a single scan recovers the full cluster. A UID with no synonym entries is
 * its own one-member cluster. Unlike `buildClusterIndex` in canonicalPrint.ts
 * this is browser-safe — no set-catalog import — and sized for one card page
 * (O(synonyms) per call), not a producer-side full inversion.
 * @param database - Synonym database (or null for no-op)
 * @param cardIdentifier - Card UID (Name::SET::NUMBER) or card name
 * @returns Member UIDs, canonical first
 */
export function getClusterMembers(database: SynonymDatabase | null, cardIdentifier: string): string[] {
  const canonical = getCanonicalCardFromData(database, cardIdentifier);
  const members = [canonical];
  if (database?.synonyms) {
    for (const [variant, canon] of Object.entries(database.synonyms)) {
      if (canon === canonical) {
        members.push(variant);
      }
    }
  }
  return members;
}

/**
 * Collapse the synonym graph so every variant maps DIRECTLY to one terminal
 * canonical per reprint component — removing cycles (`A→B`, `B→A`) and multi-hop
 * chains (`A→B→C`) that accumulate from the generator's incremental merge when a
 * cluster's chosen canonical flips between runs and a stale reverse edge lingers.
 *
 * {@link getCanonicalCardFromData} resolves a SINGLE hop, so a cycle yields an
 * inconsistent, non-terminal canonical (and the edge redirect 301-loops). After
 * this pass each component has one canonical (the node the most variants point at;
 * ties broken by smallest UID), every other member maps straight to it, and the
 * canonical is not itself a key — so a single hop is always terminal.
 * `canonicals` (name→UID) is re-pointed to the new terminal.
 * @param database - The database to normalize
 * @returns A new database with a flat, acyclic synonyms map
 */
export function normalizeSynonymDatabase(database: SynonymDatabase): SynonymDatabase {
  const synonyms = database.synonyms ?? {};

  // Union-find over every node that appears as a key or value.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while ((parent.get(root) ?? root) !== root) {
      root = parent.get(root) ?? root;
    }
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  };
  for (const [variant, canonical] of Object.entries(synonyms)) {
    if (parent.get(variant) === undefined) {
      parent.set(variant, variant);
    }
    if (parent.get(canonical) === undefined) {
      parent.set(canonical, canonical);
    }
    union(variant, canonical);
  }

  // A "sink" never appears as a variant key — in a clean chain it is the true
  // terminal canonical. In-degree (how many edges point AT a node) is the
  // fallback signal for pure cycles, where no sink exists.
  const keySet = new Set(Object.keys(synonyms));
  const inDegree = new Map<string, number>();
  for (const canonical of Object.values(synonyms)) {
    inDegree.set(canonical, (inDegree.get(canonical) ?? 0) + 1);
  }

  const members = new Map<string, string[]>();
  for (const node of parent.keys()) {
    const root = find(node);
    const group = members.get(root);
    if (group) {
      group.push(node);
    } else {
      members.set(root, [node]);
    }
  }

  // Choose one canonical per component: prefer a sink (terminal of a chain),
  // then the node the most variants point at, then the smallest UID.
  const canonicalOf = new Map<string, string>();
  for (const group of members.values()) {
    const canonical = group.reduce((best, node) => {
      const nSink = keySet.has(node) ? 0 : 1;
      const bSink = keySet.has(best) ? 0 : 1;
      if (nSink !== bSink) {
        return nSink > bSink ? node : best;
      }
      const nd = inDegree.get(node) ?? 0;
      const bd = inDegree.get(best) ?? 0;
      if (nd !== bd) {
        return nd > bd ? node : best;
      }
      return node < best ? node : best;
    });
    for (const node of group) {
      canonicalOf.set(node, canonical);
    }
  }

  // Flat synonyms: every non-canonical member -> its component canonical.
  const flatSynonyms: Record<string, string> = {};
  for (const node of parent.keys()) {
    const canonical = canonicalOf.get(node)!;
    if (node !== canonical) {
      flatSynonyms[node] = canonical;
    }
  }

  // Re-point name canonicals to the terminal UID.
  const flatCanonicals: Record<string, string> = {};
  for (const [name, uid] of Object.entries(database.canonicals ?? {})) {
    flatCanonicals[name] = canonicalOf.get(uid) ?? uid;
  }

  return { ...database, synonyms: flatSynonyms, canonicals: flatCanonicals };
}

// ============================================================================
// Per-deck canonical aggregation (from shared/canonicalDeckCards.ts)
// ============================================================================

export interface RawDeckCard {
  name?: string;
  set?: string | null;
  number?: string | number | null;
  count?: number | string | null;
}

export interface CanonicalDeckCard {
  /** Canonical UID (Name::SET::NUMBER) or bare name when set/number are absent. */
  uid: string;
  /** Display name derived from the canonical UID when possible. */
  name: string;
  /** Set code derived from the canonical UID, or null. */
  set: string | null;
  /** Card number derived from the canonical UID, or null. */
  number: string | null;
  /** Total copies of this canonical card across all matching rows in the deck. */
  copies: number;
}

/**
 * Aggregate a single deck's cards by canonical UID.
 *
 * When two printings of the same card appear in a single deck (e.g. an old and
 * a reprinted variant that a synonym mapping collapses to one canonical UID),
 * counting per row instead of per deck inflates presence counts — yielding
 * `found > deckTotal` and `pct > 100`. This helper resolves every card in a
 * deck to its canonical UID and sums copies per canonical UID, so downstream
 * counters can increment presence exactly once per deck.
 *
 * The returned meta (`name`/`set`/`number`) is parsed from the canonical UID so
 * that it stays mutually consistent with the UID even when a synonym mapping
 * rewrote the variant (avoids emitting e.g. `uid: X::NEW::001` with the
 * first-seen variant's `set: OLD`, `number: 002`).
 * @param cards - Raw deck card rows
 * @param synonymDb - Synonym database (or null for no canonicalization)
 * @returns Map keyed by canonical UID → aggregated canonical card
 */
export function aggregateCanonicalCardsPerDeck(
  cards: RawDeckCard[] | null | undefined,
  synonymDb: SynonymDatabase | null
): Map<string, CanonicalDeckCard> {
  const result = new Map<string, CanonicalDeckCard>();
  const rows = Array.isArray(cards) ? cards : [];

  for (const card of rows) {
    const copies = Number(card?.count) || 0;
    if (!copies) {
      continue;
    }

    const name = card?.name || 'Unknown Card';
    const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);
    const baseUid = cardUidOrName(name, canonSet, canonNumber);
    const uid = synonymDb ? getCanonicalCardFromData(synonymDb, baseUid) : baseUid;

    const existing = result.get(uid);
    if (existing) {
      existing.copies += copies;
      continue;
    }

    // Derive meta from the canonical UID so it stays consistent with the UID.
    let metaName = name;
    let metaSet: string | null = canonSet;
    let metaNumber: string | null = canonNumber;
    const parsed = parseCardUid(uid);
    if (parsed) {
      metaName = parsed.name;
      metaSet = parsed.set;
      metaNumber = parsed.number;
    }

    result.set(uid, {
      uid,
      name: metaName,
      set: metaSet,
      number: metaNumber,
      copies
    });
  }

  return result;
}
