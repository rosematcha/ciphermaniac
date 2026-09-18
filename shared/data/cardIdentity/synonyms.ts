export interface SynonymDatabase {
  synonyms: Record<string, string>;
  canonicals: Record<string, string>;
  prints?: Record<string, number | null>;
}

export const EMPTY_DATABASE: SynonymDatabase = { synonyms: {}, canonicals: {} };

/**
 * The synonym database a pipeline job read, or a thrown error when it is
 * missing or empty. Jobs that merge printings must not fall back to raw
 * identities: every reprint would then read as a brand-new card.
 * @param data - The parsed asset, or null when the read found nothing
 * @param source - Where it was read from, for the error message
 * @returns The database
 */
export function requireSynonymDatabase(data: unknown, source: string): SynonymDatabase {
  const synonyms = (data as Partial<SynonymDatabase> | null)?.synonyms;
  if (!synonyms || typeof synonyms !== 'object' || Object.keys(synonyms).length === 0) {
    throw new Error(`Card synonyms missing or empty at ${source}`);
  }
  return data as SynonymDatabase;
}

export function getCanonicalCardFromData(database: SynonymDatabase | null, identifier: string): string {
  if (!database || !identifier) {
    return identifier;
  }
  if (identifier.includes('::')) {
    return database.synonyms[identifier] ?? identifier;
  }
  return database.canonicals[identifier] ?? database.synonyms[identifier] ?? identifier;
}

export function getClusterMembers(database: SynonymDatabase | null, identifier: string): string[] {
  const canonical = getCanonicalCardFromData(database, identifier);
  const variants = Object.entries(database?.synonyms ?? {})
    .filter(([, target]) => target === canonical)
    .map(([variant]) => variant);
  return [canonical, ...variants];
}

type ComponentIndex = { parent: Map<string, string>; find: (node: string) => string };

function createComponentIndex(synonyms: Record<string, string>): ComponentIndex {
  const parent = new Map<string, string>();
  function find(node: string): string {
    const next = parent.get(node) ?? node;
    if (next === node) {
      return node;
    }
    const root = find(next);
    parent.set(node, root);
    return root;
  }
  function add(node: string): void {
    if (!parent.has(node)) {
      parent.set(node, node);
    }
  }
  for (const [variant, canonical] of Object.entries(synonyms)) {
    add(variant);
    add(canonical);
    const variantRoot = find(variant);
    const canonicalRoot = find(canonical);
    if (variantRoot !== canonicalRoot) {
      parent.set(variantRoot, canonicalRoot);
    }
  }
  return { parent, find };
}

function groupComponents(index: ComponentIndex): string[][] {
  const groups = new Map<string, string[]>();
  for (const node of index.parent.keys()) {
    const root = index.find(node);
    groups.set(root, [...(groups.get(root) ?? []), node]);
  }
  return [...groups.values()];
}

function countIncoming(synonyms: Record<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const target of Object.values(synonyms)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

function compareCandidates(
  left: string,
  right: string,
  variants: ReadonlySet<string>,
  incoming: ReadonlyMap<string, number>
): number {
  const sinkDifference = Number(!variants.has(left)) - Number(!variants.has(right));
  if (sinkDifference) {
    return sinkDifference;
  }
  const incomingDifference = (incoming.get(left) ?? 0) - (incoming.get(right) ?? 0);
  return incomingDifference || (left < right ? 1 : -1);
}

function mapCanonicals(synonyms: Record<string, string>, groups: string[][]): Map<string, string> {
  const variants = new Set(Object.keys(synonyms));
  const incoming = countIncoming(synonyms);
  const result = new Map<string, string>();
  for (const group of groups) {
    const canonical = group.reduce((best, node) =>
      compareCandidates(node, best, variants, incoming) > 0 ? node : best
    );
    for (const node of group) {
      result.set(node, canonical);
    }
  }
  return result;
}

function flattenSynonyms(canonicals: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries([...canonicals].filter(([node, canonical]) => node !== canonical));
}

function repointNames(names: Record<string, string>, canonicals: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(names).map(([name, uid]) => [name, canonicals.get(uid) ?? uid]));
}

/** Flatten cycles and chains so every synonym resolves to a terminal UID in one lookup. */
export function normalizeSynonymDatabase(database: SynonymDatabase): SynonymDatabase {
  const synonyms = database.synonyms ?? {};
  const index = createComponentIndex(synonyms);
  const canonicals = mapCanonicals(synonyms, groupComponents(index));
  return {
    ...database,
    synonyms: flattenSynonyms(canonicals),
    canonicals: repointNames(database.canonicals ?? {}, canonicals)
  };
}
