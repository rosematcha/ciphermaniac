import type { PlayerIndexSlimEntry } from '../../shared/playerTypes.js';

/** Stable prefix/substring partitions preserve the pre-sorted ranking. */
export function filterSortedPlayers(
  sortedBase: PlayerIndexSlimEntry[],
  foldedNames: ReadonlyMap<PlayerIndexSlimEntry, string>,
  query: string
): PlayerIndexSlimEntry[] {
  if (!query) {
    return sortedBase;
  }
  const prefix: PlayerIndexSlimEntry[] = [];
  const substring: PlayerIndexSlimEntry[] = [];
  for (const player of sortedBase) {
    const name = foldedNames.get(player) ?? '';
    if (name.startsWith(query)) {
      prefix.push(player);
    } else if (name.includes(query)) {
      substring.push(player);
    }
  }
  return prefix.concat(substring);
}
