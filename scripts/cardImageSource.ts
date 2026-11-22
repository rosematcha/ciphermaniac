/**
 * Where the R2 mirror (convert-card-images.ts) gets each tier of a card's art.
 * Split out so the choice is testable without running the mirror.
 */
import { ptcgioScanUrls } from '../src/utils/ptcgio';
import { isRecord } from '../shared/data/validate';
import { parseCardUid } from '../shared/data/cardIdentity';

const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';

export type Tier = 'XS' | 'SM' | 'LG';

/** Pixel width of each Limitless tier; vintage scans are resized to match. */
const TIER_WIDTHS: Record<Tier, number> = { XS: 136, SM: 274, LG: 460 };

export interface TierSource {
  /** Candidates in order; the next is tried only when one is genuinely absent. */
  urls: string[];
  /** Target width for a source that is not already cut to the tier. */
  width: number | null;
}

/**
 * Limitless publishes each tier pre-sized. The vintage sets it lacks have one
 * hi-res scan per card on pokemontcg.io (plain scan as fallback), resized so
 * the mirror's output matches the Limitless tiers under the same key.
 * @param set - Upper-case Limitless set code
 * @param number - Three-digit padded card number (e.g. "094")
 * @param tier - Target tier
 */
export function tierSource(set: string, number: string, tier: Tier): TierSource {
  const vintage = ptcgioScanUrls(set, number);
  if (vintage.length > 0) {
    return { urls: vintage, width: TIER_WIDTHS[tier] };
  }
  return { urls: [`${LIMITLESS_CDN}/${set}/${set}_${number}_R_EN_${tier}.png`], width: null };
}

/**
 * The staged printings list: what the next release captures, and what the image stage's
 * fingerprint (the staged synonym database) already covers.
 */
export const PRINTS_KEY = 'assets/card-prints.json';

/** The staged synonym database: its aliases are printings the strip shows that may carry no price. */
export const SYNONYMS_KEY = 'assets/card-synonyms.json';

/**
 * Every printing the synonym graph names, aliases and their targets, as a set and number. The
 * strip shows each of them, and some (the basic energy aliases) have no entry in the printings list.
 * Null when the payload is not a synonym database, so an unreadable graph never reads as an empty one.
 * @param payload - Parsed `card-synonyms.json`
 */
export function graphRefs(payload: unknown): Array<{ set: string; number: string }> | null {
  if (!isRecord(payload) || !isRecord(payload.synonyms)) {
    return null;
  }
  const uids = Object.entries(payload.synonyms).flatMap(([alias, target]) =>
    typeof target === 'string' ? [alias, target] : [alias]
  );
  return uids.flatMap(uid => {
    const parsed = parseCardUid(uid);
    return parsed ? [{ set: parsed.set, number: parsed.number }] : [];
  });
}

/**
 * Every printing in `card-prints.json` (keyed by `Name::SET::NUMBER`) as a set and number, or
 * null when the payload is not a printings list, so the mirror never claims coverage it lacks.
 * @param payload - Parsed `card-prints.json`
 */
export function printRefs(payload: unknown): Array<{ set: string; number: string }> | null {
  if (!isRecord(payload) || !isRecord(payload.prints)) {
    return null;
  }
  // Parsed from the right, as every other reader does, so a name holding `::` cannot shift the fields.
  return Object.keys(payload.prints).flatMap(uid => {
    const parsed = parseCardUid(uid);
    return parsed ? [{ set: parsed.set, number: parsed.number }] : [];
  });
}

/** Whether the mirror converts this card: a set code and a collector number Limitless files art under. */
export function mirrorable(set: string, number: string): boolean {
  const stripped = number.replace(/^0+/, '') || '0';
  // Digits with an optional prefix and suffix (`061`, `TG24`, `182a`), or a bare letter code (`P`).
  return /^[A-Za-z0-9-]{2,8}$/.test(set) && /^(?:[A-Za-z]{0,3}\d+[A-Za-z]?|[A-Za-z]{1,3})$/.test(stripped);
}

/**
 * The printings the strip can show, and the same list as coverage only when both inventories were
 * read: a printing only the graph names would otherwise drop out of the expected set and be pruned.
 * @param prints - Parsed `card-prints.json`
 * @param graph - Parsed `card-synonyms.json`
 */
export function stripInventory(
  prints: unknown,
  graph: unknown
): { strip: Array<{ set: string; number: string }>; covered: Array<{ set: string; number: string }> | null } {
  const listed = printRefs(prints);
  const graphed = graphRefs(graph);
  const strip = [...(listed ?? []), ...(graphed ?? [])];
  return { strip, covered: listed && graphed ? strip : null };
}

/**
 * What `card-images/_ready` says: how many cards were mirrored, whether every printing is (only when
 * the printings list was read), and which cards no source had, so a page skips R2 for those.
 * @param cards - Cards discovered
 * @param prints - The printings list as {@link printRefs} read it, or null when it could not be
 * @param unmirrored - `SET_NUM` image keys of cards with a tier no source had
 */
export function readyMarker(
  cards: number,
  prints: readonly unknown[] | null,
  unmirrored: Iterable<string>
): { cards: number; prints: boolean; unmirrored: string[] } {
  return { cards, prints: prints !== null, unmirrored: [...unmirrored].sort() };
}

/**
 * Whether a run may delete art no longer expected: only when nothing failed and the printings list
 * was read. Without that list the expected set lacks every printing-only card, and their art would
 * read as stale.
 * @param failed - Objects that failed after retries
 * @param prints - The printings list as {@link printRefs} read it, or null
 */
export function mayPrune(failed: number, prints: readonly unknown[] | null): boolean {
  return failed === 0 && prints !== null;
}

/**
 * The printings the mirror will not convert, which the strip still shows: listed as not on R2 so
 * the strip never asks for art that was never written.
 * @param prints - The printings list as {@link printRefs} read it
 * @param keyOf - The image key the browser asks for (`SET_NUM`)
 */
export function unconvertedPrints(
  prints: ReadonlyArray<{ set: string; number: string }>,
  keyOf: (set: string, number: string) => string
): string[] {
  return prints.filter(ref => !mirrorable(ref.set, ref.number)).map(ref => keyOf(ref.set, ref.number));
}
