/**
 * The AdvancedPanel's calculations, as pure functions.
 *
 * Everything expensive the panel does — canonicalizing a deck collection,
 * indexing report items, computing the archetype baseline, applying filters,
 * reconciling the displayed list — lives here, taking data in and returning
 * data out. None of it touches Solid, the DOM, or the router.
 *
 * Kept separate so it can be measured by tests/perf/advanced-panel.bench.ts.
 */

import { buildCooccurrence, type CooccurrenceContext } from '../../../shared/cardCooccurrence';
import { buildCanonicalCardId, buildCardId, canonicalizeDeckCard } from '../../../shared/deckCardId';
import { filterDecks, filterDecksBySuccess } from '../../../shared/clientSideFiltering';
import type { SynonymDatabase } from '../../../shared/data/cardIdentity';
import { foldSearch } from '../../utils/searchFold';
import type { CardItem, Deck, DeckCard } from '../../types';
import type { PersistedRule, Rule } from '../../utils/buildState';

/** A card-quantity filter in the shape `clientSideFiltering` consumes. */
export interface ActiveFilter {
  cardId: string;
  operator: '>=' | '=' | '<=' | '';
  count: number | null;
}

/**
 * Rewrite every deck card to its canonical printing.
 *
 * The data layer canonicalizes `cards.json` at read time (Dragapult ex is
 * reported under PRE/073 even though most decks list TWM/130), and the filter
 * aggregator keys counts by raw `SET~NUMBER` — so without canonicalizing the
 * deck side too, a rule built from the canonical printing matches zero decks.
 *
 * This is the panel's single most expensive transform: it clones every deck and
 * every card. Callers must run it once per (decks, db) pair, not per keystroke.
 * @param decks - Raw decks as fetched
 * @param db - Synonym database
 * @returns A new array of new deck objects with canonicalized cards
 */
export function canonicalizeDecks(decks: readonly Deck[], db: SynonymDatabase): Deck[] {
  return decks.map(deck => ({
    ...deck,
    cards: (deck.cards ?? []).map(card => canonicalizeDeckCard(card as DeckCard, db))
  })) as Deck[];
}

/**
 * Index report items by the `SET~NUMBER` id that rules and decks use.
 *
 * Report items can be rolling-canonical prints on a rebaked event while decks
 * (and therefore rule cardIds) key by the GLOBAL canonical, so each item is
 * resolved to its cluster canonical before keying. Skipping that leaves a
 * persisted rule unable to rehydrate and a search pick unable to match a deck.
 * @param items - The archetype report's items
 * @param db - Synonym database, or null when unavailable
 * @returns cardId → item
 */
export function indexItemsByCardId(items: readonly CardItem[], db: SynonymDatabase | null): Map<string, CardItem> {
  const map = new Map<string, CardItem>();
  for (const item of items) {
    if (item.set && item.number !== undefined && item.number !== null) {
      const id = buildCanonicalCardId(item, db);
      if (id) {
        map.set(id, item);
      }
    }
  }
  return map;
}

/**
 * Archetype-wide inclusion rate per card, as a fraction of all decks.
 *
 * Derived from a co-occurrence over ALL canonicalized decks, built the same way
 * the filtered context is so the cardIds line up exactly. Deriving it from the
 * report instead mis-keys energy and reprints, and the niche math then fails
 * silently.
 * @param decks - Canonicalized decks
 * @param items - The archetype report's items, for card metadata
 * @returns cardId → inclusion fraction (0..1)
 */
export function buildBaselinePct(decks: readonly Deck[], items: readonly CardItem[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!decks.length) {
    return map;
  }
  const full = buildCooccurrence(decks as Deck[], items as CardItem[]);
  if (!full.totalDecks) {
    return map;
  }
  for (const [cardId, entry] of full.presence) {
    map.set(cardId, entry.count / full.totalDecks);
  }
  return map;
}

/**
 * Project rules to the filter shape the aggregator consumes.
 *
 * Rules whose count is mid-edit (NaN) are dropped: comparing against NaN
 * matches zero decks, so the list would blank out while the user types.
 * @param rules - The applied rules
 * @returns Filters for `filterDecks`
 */
export function rulesToFilters(rules: readonly Rule[]): ActiveFilter[] {
  return rules
    .filter(r => r.mode === 'exclude' || Number.isFinite(r.count))
    .map(r => ({
      cardId: r.cardId,
      operator: r.mode === 'exclude' ? ('' as const) : (r.countOp as '>=' | '=' | '<='),
      count: r.mode === 'exclude' ? null : r.count
    }));
}

/**
 * Narrow a deck collection to the current success bracket and rules.
 * @param decks - Canonicalized decks
 * @param slug - Archetype base slug
 * @param successFilter - Bracket key, or 'all'
 * @param filters - From {@link rulesToFilters}
 * @returns The matching decks
 */
export function applyFilters(
  decks: readonly Deck[],
  slug: string,
  successFilter: string,
  filters: readonly ActiveFilter[]
): Deck[] {
  const scoped = successFilter === 'all' ? (decks as Deck[]) : filterDecksBySuccess(decks as Deck[], successFilter);
  return filterDecks(scoped, slug, filters as ActiveFilter[]);
}

/**
 * Rehydrate persisted rules against this archetype's report.
 *
 * cardIds absent from the archetype (a rotated list, a shared build from
 * another deck) are dropped rather than rendered as ghost rules.
 * @param persisted - Rules decoded from the URL
 * @param itemByCardId - From {@link indexItemsByCardId}
 * @param nextId - Supplies the local rule id
 * @returns Rules with display fields filled in
 */
export function rulesFromPersisted(
  persisted: readonly PersistedRule[],
  itemByCardId: ReadonlyMap<string, CardItem>,
  nextId: () => number
): Rule[] {
  const out: Rule[] = [];
  for (const p of persisted) {
    const item = itemByCardId.get(p.cardId);
    if (!item) {
      continue;
    }
    out.push({
      id: nextId(),
      cardId: p.cardId,
      name: item.name,
      set: item.set,
      number: item.number,
      mode: p.mode,
      countOp: p.countOp,
      count: p.count
    });
  }
  return out;
}

/**
 * Autocomplete matches for the rule search box.
 * @param items - The archetype report's items
 * @param query - Raw search text
 * @param takenCardIds - cardIds already used by a rule
 * @param db - Synonym database, or null
 * @param limit - Maximum results
 * @returns Matching items, capped
 */
export function searchCandidates(
  items: readonly CardItem[],
  query: string,
  takenCardIds: ReadonlySet<string>,
  db: SynonymDatabase | null,
  limit = 8
): CardItem[] {
  const q = foldSearch(query.trim());
  if (!q) {
    return [];
  }
  const out: CardItem[] = [];
  for (const item of items) {
    if (out.length >= limit) {
      break;
    }
    if (!item.set || item.number === undefined) {
      continue;
    }
    const cardId = buildCanonicalCardId(item, db);
    if (cardId && takenCardIds.has(cardId)) {
      continue;
    }
    if (foldSearch(item.name).includes(q)) {
      out.push(item);
    }
  }
  return out;
}

/** The subset of an item's fields that the displayed list re-renders on. */
export interface ReconcilableItem {
  pct?: number;
  found?: number;
  total?: number;
  rank?: number;
  set?: string;
  number?: string | number;
  dist?: Array<{ copies?: number; players?: number; percent?: number }>;
}

/**
 * Cheap deep-enough equality for {@link reconcileDisplayedItems}.
 *
 * Both candidates are report items for the SAME cardId, so identity fields
 * cannot differ — only the aggregated stats can. Comparing those directly is
 * far cheaper than the JSON round-trip this replaced, which showed up hot when
 * the threshold slider re-ran the reconciliation.
 * @param a - Previous item
 * @param b - Candidate item
 * @returns Whether the rendered content is unchanged
 */
export function sameRenderedContent(a: ReconcilableItem, b: ReconcilableItem): boolean {
  if (a.pct !== b.pct || a.found !== b.found || a.total !== b.total || a.rank !== b.rank) {
    return false;
  }
  const distA = a.dist ?? [];
  const distB = b.dist ?? [];
  if (distA.length !== distB.length) {
    return false;
  }
  for (let i = 0; i < distA.length; i++) {
    if (
      distA[i].copies !== distB[i].copies ||
      distA[i].players !== distB[i].players ||
      distA[i].percent !== distB[i].percent
    ) {
      return false;
    }
  }
  return true;
}

/** Result of a reconciliation pass: the list to render, and the map to carry forward. */
export interface ReconcileResult<T> {
  items: T[];
  byCardId: Map<string, T>;
}

/**
 * Filter a report to the threshold and reuse unchanged item objects.
 *
 * The report is rebuilt from scratch on every apply, so a reference-keyed
 * `<For>` would tear down and remount every tile — including its image — even
 * when a card's numbers did not move. Returning the previous object whenever
 * the rendered content is identical keeps those tiles mounted.
 * @param items - Fresh report items
 * @param threshold - Minimum pct to display
 * @param previousByCardId - The map returned by the previous call
 * @returns The reconciled list and the map for next time
 */
export function reconcileDisplayedItems<T extends ReconcilableItem>(
  items: readonly T[],
  threshold: number,
  previousByCardId: ReadonlyMap<string, T>
): ReconcileResult<T> {
  const byCardId = new Map<string, T>();
  const out: T[] = [];
  for (const item of items) {
    if ((item.pct ?? 0) < threshold) {
      continue;
    }
    const cardId = item.set && item.number !== undefined ? buildCardId(item.set, item.number) : undefined;
    if (!cardId) {
      out.push(item);
      continue;
    }
    const prev = previousByCardId.get(cardId);
    if (prev && sameRenderedContent(prev, item)) {
      byCardId.set(cardId, prev);
      out.push(prev);
      continue;
    }
    byCardId.set(cardId, item);
    out.push(item);
  }
  return { items: out, byCardId };
}

/** Inclusion share of a card within a co-occurrence context, as a percent string. */
export function inclusionPct(ctx: CooccurrenceContext | null, cardId: string): string {
  const entry = ctx?.presence.get(cardId);
  if (!ctx || !entry || !ctx.totalDecks) {
    return '0';
  }
  return ((entry.count / ctx.totalDecks) * 100).toFixed(0);
}
