/** How many suggestions a typeahead offers at once. */
export const SUGGESTION_LIMIT = 8;

/**
 * Ranks a list against a query: a prefix match outranks a match anywhere else,
 * and within each group the heavier entry comes first. That is what makes "r"
 * offer Rare Candy (14 arts) before Riolu (3) — the card you actually meant.
 */
export function rankByQuery<T>(
  list: readonly T[],
  query: string,
  name: (item: T) => string,
  options: { weight?: (item: T) => number; limit?: number } = {}
): T[] {
  const { weight = () => 0, limit = SUGGESTION_LIMIT } = options;
  const q = query.trim().toLowerCase();
  if (!q) {
    return list.slice(0, limit);
  }
  return list
    .map(item => ({ item, at: name(item).toLowerCase().indexOf(q) }))
    .filter(hit => hit.at >= 0)
    .sort(
      (a, b) =>
        (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) ||
        weight(b.item) - weight(a.item) ||
        name(a.item).localeCompare(name(b.item))
    )
    .slice(0, limit)
    .map(hit => hit.item);
}
