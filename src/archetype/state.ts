import type {
  CardItemData,
  CardLookupEntry,
  FilterResult,
  FilterRow,
  FilterRowCardsCache,
  SkeletonExportEntry
} from './types.js';

export interface AppState {
  archetypeBase: string;
  archetypeLabel: string;
  tournament: string;
  tournamentDeckTotal: number;
  archetypeDeckTotal: number;
  overrides: Record<string, string>;
  items: CardItemData[];
  allCards: CardItemData[];
  thresholdPercent: number | null;
  successFilter: string;
  defaultItems: CardItemData[];
  defaultDeckTotal: number;
  cardLookup: Map<string, CardLookupEntry>;
  filterCache: Map<string, Promise<FilterResult>>;
  filterRows: FilterRow[];
  nextFilterId: number;
  skeleton: {
    totalCards: number;
    exportEntries: SkeletonExportEntry[];
    plainWarnings: string[];
    displayWarnings: string[];
    lastExportText: string;
  };
}

const state: AppState = {
  archetypeBase: '',
  archetypeLabel: '',
  tournament: '',
  tournamentDeckTotal: 0,
  archetypeDeckTotal: 0,
  overrides: {},
  items: [],
  allCards: [],
  thresholdPercent: null,
  successFilter: 'all',
  defaultItems: [],
  defaultDeckTotal: 0,
  cardLookup: new Map(),
  filterCache: new Map(),
  filterRows: [],
  nextFilterId: 1,
  skeleton: {
    totalCards: 0,
    exportEntries: [],
    plainWarnings: [],
    displayWarnings: [],
    lastExportText: ''
  }
};

/**
 * Cache for sorted items to avoid re-sorting on every render.
 * Uses WeakMap to automatically clean up when source arrays are GC'd.
 */
export const sortedItemsCache = new WeakMap<CardItemData[], CardItemData[]>();

/**
 * Cache for filter row card sorting and duplicate counts.
 * Invalidated when allCards changes.
 */
export const filterRowCardsCache: FilterRowCardsCache = {
  sourceArray: null,
  deckTotal: 0,
  sortedCards: [],
  duplicateCounts: new Map()
};

export function getState(): AppState {
  return state;
}

export function setState(partial: Partial<AppState>): void {
  Object.assign(state, partial);
}
