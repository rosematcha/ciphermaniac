export interface DeckShard<T> {
  path: string;
  decks: T[];
}

/** Partition one deck corpus into disjoint serving shards. */
export function partitionDecks<T extends object>(
  all: T[],
  groups: Array<{ base: string; decks: T[] }>
): DeckShard<T>[] {
  const corpus = new Set(all);
  const assigned = new Set<T>();
  const shards: DeckShard<T>[] = [];
  for (const group of groups) {
    for (const deck of group.decks) {
      if (!corpus.has(deck) || assigned.has(deck)) {
        throw new Error(`Deck shard ${group.base} is not a disjoint subset of the corpus`);
      }
      assigned.add(deck);
    }
    if (group.decks.length > 0) {
      shards.push({ path: `archetypes/${group.base}/decks.json`, decks: group.decks });
    }
  }
  const other = all.filter(deck => !assigned.has(deck));
  if (other.length > 0) {
    shards.push({ path: 'decks/other.json', decks: other });
  }
  const count = shards.reduce((total, shard) => total + shard.decks.length, 0);
  if (count !== all.length) {
    throw new Error(`Deck shard partition lost data: ${count}/${all.length}`);
  }
  return shards;
}
