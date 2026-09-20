export interface InventoryGroup {
  prefix: string;
  objects: number;
  bytes: number;
}

/** Trees whose children are separate artifacts; every other tree is one artifact. */
const NESTED_TREES: Record<string, number> = { reports: 2, events: 2, build: 2, assets: 2, releases: 3 };

/** Name the tree an object belongs to, e.g. `releases/v1/players/` or `card-images/`. */
export function inventoryPrefix(key: string): string {
  const folders = key.split('/').slice(0, -1);
  if (folders.length === 0) {
    return '(root)';
  }
  return `${folders.slice(0, NESTED_TREES[folders[0]] ?? 1).join('/')}/`;
}

/** Total objects and bytes per tree, largest first. */
export function summarizeInventory(objects: Iterable<{ key: string; size: number }>): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>();
  for (const object of objects) {
    const prefix = inventoryPrefix(object.key);
    const group = groups.get(prefix) ?? { prefix, objects: 0, bytes: 0 };
    group.objects += 1;
    group.bytes += object.size;
    groups.set(prefix, group);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes || a.prefix.localeCompare(b.prefix));
}
