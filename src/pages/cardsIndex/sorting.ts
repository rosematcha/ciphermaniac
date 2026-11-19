import type { PricingEntry } from '../../lib/data';
import { cardUid } from '../../../shared/data/cardIdentity';
import type { CardItem } from '../../types';
import { averageCopiesValue } from '../../lib/cardStats';
import { createPersistentSignal } from '../../lib/persistentSignal';

export type SortKey = 'rank' | 'name' | 'price' | 'inclusion' | 'avgCopies';
export type SortDir = 'asc' | 'desc';

// Default sort direction when switching to a column, so each metric opens in
// the order people expect (best-first) rather than a blanket ascending.
function defaultDir(key: SortKey): SortDir {
  return key === 'rank' || key === 'name' ? 'asc' : 'desc';
}

export function createCardSortState() {
  const [sortKey, setSortKey] = createPersistentSignal<SortKey>(
    'cm:cardsSort',
    'rank',
    v => (v === 'rank' || v === 'name' || v === 'price' || v === 'inclusion' || v === 'avgCopies' ? v : null),
    sessionStorage
  );
  const [sortDir, setSortDir] = createPersistentSignal<SortDir>(
    'cm:cardsSortDir',
    'asc',
    v => (v === 'asc' || v === 'desc' ? v : null),
    sessionStorage
  );

  // Header clicks toggle direction on the active column and reset to the
  // metric's natural direction when moving to a new one.
  function changeSort(key: SortKey) {
    if (sortKey() === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(defaultDir(key));
    }
  }

  function setSort(key: SortKey) {
    setSortKey(key);
    setSortDir(defaultDir(key));
  }

  return { sortKey, setSortKey, sortDir, changeSort, setSort };
}

/** The key a card's price is looked up by. */
export const priceUid = (item: CardItem) => cardUid(item.name, item.set, item.number);

/** A card's market price from the price map, or null when it has none. */
export function priceOf(map: Record<string, PricingEntry> | undefined, item: CardItem): number | null {
  if (!map) {
    return null;
  }
  const key = priceUid(item);
  if (!key) {
    return null;
  }
  const entry: PricingEntry | undefined = map[key];
  const p = entry?.price;
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

function sortByPrice(items: CardItem[], mul: number, priceFor: (item: CardItem) => number | null): CardItem[] {
  // Decorate once: `priceFor` builds a key + map lookup, so compute per item
  // rather than twice per comparison. Missing prices always sort last.
  const decorated = items.map(item => ({ item, price: priceFor(item), rank: item.rank ?? 9e9 }));
  decorated.sort((a, b) => {
    if (a.price === null && b.price === null) {
      return a.rank - b.rank;
    }
    if (a.price === null) {
      return 1;
    }
    if (b.price === null) {
      return -1;
    }
    return mul * (a.price - b.price);
  });
  return decorated.map(d => d.item);
}

function valueOf(item: CardItem, key: Exclude<SortKey, 'name' | 'price'>): number {
  switch (key) {
    case 'inclusion':
      return item.pct ?? 0;
    case 'avgCopies':
      return averageCopiesValue(item) ?? 0;
    case 'rank':
    default:
      return item.rank ?? 9e9;
  }
}

export function sortCards(
  items: CardItem[],
  key: SortKey,
  dir: SortDir,
  priceFor: (item: CardItem) => number | null
): CardItem[] {
  const mul = dir === 'asc' ? 1 : -1;

  if (key === 'name') {
    return [...items].sort((a, b) => mul * a.name.localeCompare(b.name));
  }

  if (key === 'price') {
    return sortByPrice(items, mul, priceFor);
  }

  // Remaining keys are plain numeric — precompute each item's sort value once
  // (avgCopies is two reduces per item) instead of recomputing per comparison.
  const decorated = items.map(item => ({ item, v: valueOf(item, key) }));
  decorated.sort((a, b) => mul * (a.v - b.v));
  return decorated.map(d => d.item);
}
