/**
 * The synonym database's R2 objects, in write order.
 * @module .github/scripts/lib/synonymObjects
 */

import type { SynonymDatabase } from '../../../shared/data/cardIdentity';

/**
 * The browser's synonyms in printing release order (the `prints` map's key
 * order, missing prints last), with each cluster's canonical position where it
 * is not first, so the card page orders printings before their prices load.
 */
function slimDatabase(data: SynonymDatabase): Pick<SynonymDatabase, 'synonyms' | 'canonicals' | 'canonicalAt'> {
  const rank = new Map(Object.keys(data.prints ?? {}).map((uid, index) => [uid, index]));
  const at = (uid: string) => rank.get(uid) ?? Number.MAX_SAFE_INTEGER;
  const synonyms = Object.fromEntries(Object.entries(data.synonyms).sort(([a], [b]) => at(a) - at(b)));
  const canonicalAt: Record<string, number> = {};
  for (const [alias, canonical] of Object.entries(synonyms)) {
    if (at(alias) < at(canonical)) {
      canonicalAt[canonical] = (canonicalAt[canonical] ?? 0) + 1;
    }
  }
  return { synonyms, canonicals: data.canonicals, canonicalAt };
}

/**
 * Producers read the whole database. Browsers get it in two compact parts:
 * every page canonicalizes with the synonyms, and only the card page reads the
 * per-print prices, which are about half the bytes and change daily. The whole
 * file goes last: the next run compares against it, so a run that dies before
 * it retries the parts instead of leaving them stale.
 * @param data - The database this run publishes
 * @returns `[key, body]` pairs; a string body is written as is
 */
export function synonymObjects(data: SynonymDatabase): Array<[key: string, body: unknown]> {
  return [
    ['assets/card-synonyms-slim.json', JSON.stringify(slimDatabase(data))],
    ['assets/card-prints.json', JSON.stringify({ prints: data.prints })],
    ['assets/card-synonyms.json', data]
  ];
}
