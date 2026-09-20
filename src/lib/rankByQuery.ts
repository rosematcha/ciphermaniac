/** How many suggestions a typeahead offers at once. */
export const SUGGESTION_LIMIT = 8;

/**
 * Ranks a list against a query: a prefix match outranks a match anywhere else,
 * and within each group the heavier entry comes first. That is what makes "r"
 * offer Rare Candy (14 arts) before Riolu (3) — the card you actually meant.
 *
 * A `tier` outranks both, so a caller can keep a whole class of entry above
 * another however well the query fits it: the decks a format is playing come
 * before the ones nobody has sleeved in a year, which is worth more than an
 * exact match on a dead archetype. Nothing is filtered out by it.
 */
export function rankByQuery<T>(
  list: readonly T[],
  query: string,
  name: (item: T) => string,
  options: { weight?: (item: T) => number; tier?: (item: T) => number; limit?: number } = {}
): T[] {
  const { weight = () => 0, tier = () => 0, limit = SUGGESTION_LIMIT } = options;
  const q = query.trim().toLowerCase();
  if (!q) {
    return list.slice(0, limit);
  }
  return list
    .map(item => ({ item, at: name(item).toLowerCase().indexOf(q) }))
    .filter(hit => hit.at >= 0)
    .sort(
      (a, b) =>
        tier(a.item) - tier(b.item) ||
        (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) ||
        weight(b.item) - weight(a.item) ||
        name(a.item).localeCompare(name(b.item))
    )
    .slice(0, limit)
    .map(hit => hit.item);
}
