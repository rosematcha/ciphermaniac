const ONLINE_ROOT = 'reports/Online - Last 14 Days';

interface JsonReader {
  read<T>(key: string): Promise<T | null>;
}

function validShard(path: string): boolean {
  return path === 'decks/other.json' || /^archetypes\/[^/]+\/decks\.json$/.test(path);
}

/** Read the partitioned online deck corpus, with a one-release legacy fallback. */
export async function loadOnlineDecks<T>(reader: JsonReader, root = ONLINE_ROOT): Promise<T[]> {
  const index = await reader.read<unknown>(`${root}/decks/index.json`);
  if (index === null) {
    return (await reader.read<T[]>(`${root}/decks.json`)) ?? [];
  }
  if (!Array.isArray(index) || index.some(path => typeof path !== 'string' || !validShard(path))) {
    throw new Error('Invalid online deck shard index');
  }
  const shards = await Promise.all(index.map(path => reader.read<T[]>(`${root}/${path}`)));
  const missing = shards.findIndex(shard => !Array.isArray(shard));
  if (missing !== -1) {
    throw new Error(`Missing online deck shard: ${index[missing]}`);
  }
  return shards.flatMap(shard => shard ?? []);
}
