interface CategorizedCard {
  category?: string;
  count?: number;
}

export interface DeckGroup<T extends CategorizedCard> {
  label: string;
  total: number;
  cards: T[];
}

const ORDER = ['pokemon', 'trainer', 'energy', 'other'];

export function groupDeckByCategory<T extends CategorizedCard>(cards: T[] | undefined): DeckGroup<T>[] {
  if (!cards || cards.length === 0) {
    return [];
  }
  const buckets = new Map<string, T[]>();
  for (const c of cards) {
    const key = (c.category ?? '').split('/')[0] || 'other';
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key)!.push(c);
  }
  return ORDER.filter(k => buckets.has(k)).map(k => ({
    label: k,
    total: buckets.get(k)!.reduce((acc, c) => acc + (c.count ?? 0), 0),
    cards: buckets.get(k)!
  }));
}
