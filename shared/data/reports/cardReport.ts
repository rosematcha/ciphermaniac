import {
  canonicalizeVariant,
  cardUidOrName,
  getCanonicalCardFromData,
  parseCardUid,
  type SynonymDatabase
} from '../cardIdentity';
import { sanitizeDisplayName } from '../../cardUtils';
import {
  calculatePercentage,
  composeCategoryPath,
  createDistributionFromCounts,
  type DistributionEntry,
  sortReportItems
} from '../../reportUtils';

export interface CardEntry {
  name?: string;
  count?: number;
  set?: string;
  number?: string | number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}

export interface DeckEntry {
  cards?: CardEntry[];
}

export interface ReportItem {
  rank: number;
  name: string;
  found: number;
  total: number;
  pct: number;
  dist: DistributionEntry[];
  set?: string;
  number?: string | number;
  uid?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
  category?: string;
}

export interface LegacyCardReport {
  deckTotal: number;
  items: ReportItem[];
  canonicalizedAt?: string;
}

export interface CanonicalizeOptions {
  resolveUid?: (uid: string) => string;
}

interface CardMeta {
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}

interface ReportState {
  counts: Map<string, number[]>;
  names: Map<string, string>;
  metadata: Map<string, CardMeta>;
}

interface ScanContext {
  state: ReportState;
  synonymDb: SynonymDatabase | null;
  options: CanonicalizeOptions;
}

export function listedDeckCount(deckList: readonly { cards?: unknown }[]): number {
  const decks = Array.isArray(deckList) ? (deckList as readonly { cards?: unknown }[]) : [];
  let count = 0;
  for (const deck of decks) {
    const { cards } = deck;
    if (Array.isArray(cards) && cards.length > 0) {
      count += 1;
    }
  }
  return count;
}

function resolveUid(card: CardEntry, synonymDb: SynonymDatabase | null, options: CanonicalizeOptions): string {
  const [set, number] = canonicalizeVariant(card.set, card.number);
  const uid = cardUidOrName(card.name || 'Unknown Card', set, number);
  return options.resolveUid?.(uid) ?? getCanonicalCardFromData(synonymDb, uid);
}

function metadataOf(card: CardEntry): CardMeta {
  return {
    category: card.category || undefined,
    trainerType: card.trainerType || undefined,
    energyType: card.energyType || undefined,
    aceSpec: card.aceSpec || undefined,
    regulationMark: card.regulationMark || undefined
  };
}

function hasMetadata(metadata: CardMeta): boolean {
  return Boolean(
    metadata.category || metadata.trainerType || metadata.energyType || metadata.aceSpec || metadata.regulationMark
  );
}

function scanCard(card: CardEntry, deckCounts: Map<string, number>, context: ScanContext): void {
  const { state, synonymDb, options } = context;
  const count = Number(card.count) || 0;
  if (!count) {
    return;
  }
  const uid = resolveUid(card, synonymDb, options);
  deckCounts.set(uid, (deckCounts.get(uid) ?? 0) + count);
  if (!state.names.has(uid)) {
    state.names.set(uid, card.name || 'Unknown Card');
  }
  const metadata = metadataOf(card);
  const existingMetadata = state.metadata.get(uid);
  if (!existingMetadata || (!hasMetadata(existingMetadata) && hasMetadata(metadata))) {
    state.metadata.set(uid, metadata);
  }
}

function scanDeck(
  deck: DeckEntry,
  state: ReportState,
  synonymDb: SynonymDatabase | null,
  options: CanonicalizeOptions
): void {
  const deckCounts = new Map<string, number>();
  const context = { state, synonymDb, options };
  for (const card of deck.cards ?? []) {
    scanCard(card, deckCounts, context);
  }
  for (const [uid, count] of deckCounts) {
    state.counts.set(uid, [...(state.counts.get(uid) ?? []), count]);
  }
}

function addIdentity(item: ReportItem, uid: string): void {
  const parsed = parseCardUid(uid);
  if (!parsed) {
    return;
  }
  item.set = parsed.set;
  item.number = parsed.number;
  item.uid = uid;
}

function addMetadata(item: ReportItem, metadata: CardMeta | undefined): void {
  if (!metadata) {
    return;
  }
  if (metadata.trainerType) {
    item.trainerType = metadata.trainerType;
  }
  if (metadata.energyType) {
    item.energyType = metadata.energyType;
  }
  if (metadata.aceSpec) {
    item.aceSpec = true;
  }
  if (metadata.regulationMark) {
    item.regulationMark = metadata.regulationMark;
  }
  const category = composeCategoryPath(metadata.category, metadata.trainerType, metadata.energyType, {
    aceSpec: Boolean(metadata.aceSpec)
  });
  if (category || metadata.category) {
    item.category = category || metadata.category;
  }
}

function buildItem(uid: string, state: ReportState, deckTotal: number): ReportItem {
  const counts = state.counts.get(uid) ?? [];
  const found = counts.length;
  const item: ReportItem = {
    rank: 0,
    name: sanitizeDisplayName(state.names.get(uid) ?? uid),
    found,
    total: deckTotal,
    pct: calculatePercentage(found, deckTotal),
    dist: createDistributionFromCounts(counts, found)
  };
  addIdentity(item, uid);
  addMetadata(item, state.metadata.get(uid));
  return item;
}

export function generateReportFromDecks(
  deckList: DeckEntry[],
  deckTotal: number,
  synonymDb: SynonymDatabase | null,
  options: CanonicalizeOptions = {}
): LegacyCardReport {
  const state: ReportState = { counts: new Map(), names: new Map(), metadata: new Map() };
  for (const deck of Array.isArray(deckList) ? deckList : []) {
    scanDeck(deck, state, synonymDb, options);
  }
  const items = sortReportItems([...state.counts.keys()].map(uid => buildItem(uid, state, deckTotal)));
  items.forEach((item, index) => {
    item.rank = index + 1;
  });
  return { deckTotal, items };
}
