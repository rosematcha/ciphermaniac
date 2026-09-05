/**
 * Printings strip logic — pure helpers behind the card page's Printings
 * section. Builds the list of a card's printings (its synonym cluster) with
 * per-print prices from the synonym DB's `prints` map, in release order. Kept
 * free of Solid so it unit-tests under plain node:test.
 * @module utils/printings
 */

import {
  cardNumberIndexKey,
  cardUid,
  getClusterMembers,
  parseCardUid,
  type SynonymDatabase
} from '../../shared/data/cardIdentity.js';

export interface PrintingRow {
  /** Full print UID (Name::SET::NUMBER, number zero-padded). */
  uid: string;
  set: string;
  number: string;
  /** Scraped USD market price, or null when the scrape had none. */
  price: number | null;
  /** The print whose stats this page shows (URL/hero print). */
  isPage: boolean;
}

/**
 * Build the printings rows for a card page, in release order.
 *
 * Release order comes from the `prints` map's key order: the synonym producer
 * writes it straight from Limitless's prints table, which lists promos first
 * and expansions oldest-to-newest. Prints missing from the map keep their
 * cluster position at the end. Returns [] when the card has fewer than two
 * printings or the DB has no price map — the section simply doesn't render.
 * @param database - Synonym database (with `prints`), or null before load
 * @param pageUid - UID of the print the page is showing
 * @returns Annotated rows in release order, or []
 */
export function buildPrintingRows(database: SynonymDatabase | null, pageUid: string): PrintingRow[] {
  if (!database?.prints || !pageUid.includes('::')) {
    return [];
  }
  // Normalize the page UID to the DB's canonical form (uppercase set,
  // zero-padded number) so loose URLs still land in their cluster.
  const page = parseCardUid(pageUid);
  const normalizedUid = (page && cardUid(page.name, page.set, page.number)) || pageUid;
  const members = getClusterMembers(database, normalizedUid);
  if (members.length < 2) {
    return [];
  }

  const pageSet = page?.set.toUpperCase() ?? null;
  const pageNum = page ? cardNumberIndexKey(page.number) : null;

  const rows: PrintingRow[] = [];
  for (const uid of members) {
    const parsed = parseCardUid(uid);
    if (!parsed) {
      continue;
    }
    const price = database.prints[uid];
    rows.push({
      uid,
      set: parsed.set,
      number: parsed.number,
      price: typeof price === 'number' ? price : null,
      // Match by set + zero-stripped number so a non-padded page UID still hits.
      isPage: uid === pageUid || (parsed.set.toUpperCase() === pageSet && cardNumberIndexKey(parsed.number) === pageNum)
    });
  }
  if (rows.length < 2) {
    return [];
  }

  const releaseIndex = new Map(Object.keys(database.prints).map((uid, i) => [uid, i]));
  return rows.sort(
    (a, b) =>
      (releaseIndex.get(a.uid) ?? Number.POSITIVE_INFINITY) - (releaseIndex.get(b.uid) ?? Number.POSITIVE_INFINITY)
  );
}

/** Whole-cents dollar format for the strip; em dash when the scrape had no price. */
export function formatPrintPrice(price: number | null): string {
  return price === null ? '—' : `$${price.toFixed(2)}`;
}
