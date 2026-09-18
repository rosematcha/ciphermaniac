/** Stable, small routing shards keep immutable player bodies reusable across releases. */
export function playerRouteShard(path: string): string {
  let hash = 0;
  for (const character of path) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  return (hash % 256).toString(16).padStart(2, '0');
}

export function playerObjectPath(path: string): boolean {
  return /^[^/]+\/(?:profile|decks)\.json$/.test(path);
}
