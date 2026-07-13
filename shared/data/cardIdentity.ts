/**
 * Card identity policy — the single home for card number/set/UID normalization,
 * synonym resolution, and per-deck canonical aggregation.
 *
 * Consolidated from `shared/cardUtils.ts`, `shared/synonyms.ts`, and
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
export function buildCardIdentifier(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): string | null {
  const sc = (setCode || '').toString().toUpperCase().trim();
  if (!sc) {
    return null;
  }
  const normalized = normalizeCardNumber(number);
  if (!normalized) {
    return null;
  }
  return `${sc}~${normalized}`;
}

// ============================================================================
// Synonym resolution (from shared/synonyms.ts)
// ============================================================================

/**
 * Synonym database structure
 */
export interface SynonymDatabase {
  /** Maps variant UIDs to their canonical UID */
  synonyms: Record<string, string>;
  /** Maps card names to their preferred canonical UID */
  canonicals: Record<string, string>;
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
    const baseUid = canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;
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
    if (uid.includes('::')) {
      const parts = uid.split('::');
      metaName = parts[0] || name;
      metaSet = parts[1] || null;
      metaNumber = parts[2] || null;
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
