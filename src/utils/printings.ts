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
import { JOKE_SET, jokeArtNumber } from '../lib/jokeMode.js';

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
 * @param joke - Whether to append the card's September 10th art, if it has one
 * @returns Annotated rows in release order, or []
 */
export function buildPrintingRows(database: SynonymDatabase | null, pageUid: string, joke = false): PrintingRow[] {
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
  rows.sort(
    (a, b) =>
      (releaseIndex.get(a.uid) ?? Number.POSITIVE_INFINITY) - (releaseIndex.get(b.uid) ?? Number.POSITIVE_INFINITY)
  );
  // Newest printing of all, so it lands at the end of the strip. Appended
  // rather than merged into the cluster: nothing upstream knows it exists, and
  // nothing else on the site should start believing in it.
  const jokeNumber = joke && page ? jokeArtNumber(page.name) : null;
  const jokeUid = page && jokeNumber ? cardUid(page.name, JOKE_SET, jokeNumber) : null;
  if (jokeNumber && jokeUid) {
    rows.push({ uid: jokeUid, set: JOKE_SET, number: jokeNumber, price: null, isPage: false });
  }
  return rows;
}

/** Whole-cents dollar format for the strip; em dash when the scrape had no price. */
export function formatPrintPrice(price: number | null): string {
  return price === null ? '—' : `$${price.toFixed(2)}`;
}

/** Every clustered print in release order: aliases as written, each canonical at its `canonicalAt`. */
function releaseOrder(synonyms: Record<string, string>, canonicalAt: Record<string, number>): string[] {
  const clusters = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(synonyms)) {
    const aliases = clusters.get(canonical) ?? [];
    aliases.push(alias);
    clusters.set(canonical, aliases);
  }
  return [...clusters].flatMap(([canonical, aliases]) => {
    const at = Number.isInteger(canonicalAt[canonical]) ? canonicalAt[canonical] : 0;
    return [...aliases.slice(0, at), canonical, ...aliases.slice(at)];
  });
}

/**
 * The database the printings strip reads, with `prints` keyed in release order.
 * A slim database orders each cluster from its own synonyms and `canonicalAt`,
 * so the order is set before the prices load and holds when they do; `prices`
 * only fills in the values. A database without that order keeps its own map.
 * @param database - Synonym database, or null before load
 * @param prices - Per-print prices, once loaded
 * @returns The database with an ordered `prints` map, or null
 */
export function withPrintOrder(
  database: SynonymDatabase | null,
  prices: Record<string, number | null> | null | undefined
): SynonymDatabase | null {
  if (!database?.canonicalAt) {
    return database && { ...database, prints: prices ?? database.prints ?? {} };
  }
  const order = releaseOrder(database.synonyms, database.canonicalAt);
  return { ...database, prints: Object.fromEntries(order.map(uid => [uid, prices?.[uid] ?? null])) };
}
