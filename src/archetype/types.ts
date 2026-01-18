export interface FilterRow {
  id: number;
  cardId: string | null;
  operator: string | null;
  count: number | null;
  elements: {
    cardSelect: HTMLSelectElement;
    operatorSelect: HTMLSelectElement;
    countInput: HTMLInputElement;
    removeButton: HTMLButtonElement;
    container: HTMLElement;
  };
  /** AbortController for cleaning up event listeners when row is removed */
  abortController?: AbortController;
}

export interface CardLookupEntry {
  id: string;
  name: string;
  set: string | null;
  number: string | null;
  found: number;
  total: number;
  pct: number;
  alwaysIncluded: boolean;
  category: string | null;
  energyType: string | null;
}

export interface CardItemData {
  rank?: number;
  name?: string;
  uid?: string;
  set?: string;
  number?: string | number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  found?: number;
  total?: number;
  pct?: number;
  dist?: Array<{ copies?: number; players?: number; percent?: number }>;
  price?: number | null;
}

export interface SkeletonExportEntry {
  name: string;
  copies: number;
  set: string;
  number: string;
  primaryCategory: string;
}

export interface FilterDescriptor {
  cardId: string;
  operator: string | null;
  count: number | null;
}

export interface FilterResult {
  deckTotal: number;
  items: CardItemData[];
  raw?: unknown;
}

export interface FilterRowCardsCache {
  sourceArray: CardItemData[] | null;
  deckTotal: number;
  sortedCards: CardItemData[];
  duplicateCounts: Map<string, number>;
}
