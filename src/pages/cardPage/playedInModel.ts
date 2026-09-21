/**
 * Pure compute for the card page's "Played in" block: the archetypes that play
 * the card, each carrying its usage figures and the actual lists behind them,
 * best finish first. Kept free of Solid + DOM so it is unit-testable; the
 * component layers state and rendering on top.
 */
import type { ArchetypeUsageRow } from './model';
import type { ListRecord } from '../../lib/data/lists';
import { normalizeArchetypeName } from '../../../shared/cardUtils.js';
import type { CardDistributionEntry } from '../../types';

/** The finish tiers the block offers; every tag is one the producers emit. */
export const FINISH_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'top50', label: 'Top 50%' },
  { value: 'top25', label: 'Top 25%' },
  { value: 'top8', label: 'Top 8' },
  { value: 'winner', label: 'Winners' }
];

/** Archetype rows shown before the block folds. */
export const VISIBLE_GROUPS = 6;
/** The fold only happens when it hides at least this many, so seven rows never fold away one. */
export const MIN_HIDDEN_GROUPS = 5;
/** Lists shown per archetype before its own "Show more". */
export const LISTS_PER_GROUP = 3;
export const LISTS_PER_GROUP_MORE = 10;

/** A list that plays the card, with the copies it runs. */
export interface CardList {
  record: ListRecord;
  copies: number;
}

/** One archetype's row in the block. */
export interface PlayedInGroup {
  usage: ArchetypeUsageRow;
  /** Copy-count buckets with at least one deck, as the usage index reports them. */
  dist: CardDistributionEntry[];
  modal: CardDistributionEntry | null;
  /** Lists in the current finish tier, best finish first. Empty without an index. */
  lists: CardList[];
}

/** Every list running the card, with its copy count. */
export function listsForCard(records: readonly ListRecord[], uid: string | null): CardList[] {
  if (!uid) {
    return [];
  }
  const out: CardList[] = [];
  for (const record of records) {
    if (!record.uids.has(uid)) {
      continue;
    }
    const copies = record.cards.reduce((sum, card) => (card.uid === uid ? sum + card.count : sum), 0);
    out.push({ record, copies });
  }
  return out;
}

export function inFinish(record: ListRecord, finish: string): boolean {
  return finish === 'all' || record.tags.has(finish);
}

/** Best finish first: known placements ascend, bigger fields break ties, unknown placements last. */
export function compareFinish(a: ListRecord, b: ListRecord): number {
  const placementGap = (a.placement || Number.MAX_SAFE_INTEGER) - (b.placement || Number.MAX_SAFE_INTEGER);
  return placementGap || fieldSize(b) - fieldSize(a) || eventDate(b).localeCompare(eventDate(a));
}

const fieldSize = (record: ListRecord): number => record.event?.players ?? 0;
const eventDate = (record: ListRecord): string => record.event?.date ?? '';

function distOf(row: ArchetypeUsageRow): { dist: CardDistributionEntry[]; modal: CardDistributionEntry | null } {
  const dist = (row.item.dist ?? []).filter(d => d.copies !== undefined && (d.players ?? 0) > 0);
  const modal = dist.reduce<CardDistributionEntry | null>(
    (m, d) => (m === null || (d.players ?? 0) > (m.players ?? 0) ? d : m),
    null
  );
  return { dist, modal };
}

/**
 * Join usage rows to their lists and rank them. With an index, archetypes rank
 * by how many of their lists sit in the finish tier; without one (a snapshot,
 * an event built before `lists.json`), by how many decks run the card, so a
 * large deck's high count outweighs a tiny deck's high rate.
 * @param rows - Usage rows for the card (from cardUsage.json)
 * @param lists - Every list running the card, or null when there is no index
 * @param finish - A {@link FINISH_OPTIONS} value
 */
export function buildPlayedInGroups(
  rows: readonly ArchetypeUsageRow[],
  lists: readonly CardList[] | null,
  finish: string
): PlayedInGroup[] {
  const byArchetype = new Map<string, CardList[]>();
  for (const list of lists ?? []) {
    if (!inFinish(list.record, finish)) {
      continue;
    }
    const key = normalizeArchetypeName(list.record.archetype);
    const bucket = byArchetype.get(key);
    if (bucket) {
      bucket.push(list);
    } else {
      byArchetype.set(key, [list]);
    }
  }
  const groups = rows.map(usage => {
    const mine = byArchetype.get(normalizeArchetypeName(usage.entry.name)) ?? [];
    mine.sort((a, b) => compareFinish(a.record, b.record));
    return { usage, ...distOf(usage), lists: mine };
  });
  const found = (g: PlayedInGroup) => g.usage.item.found ?? 0;
  const pct = (g: PlayedInGroup) => g.usage.item.pct ?? 0;
  if (lists) {
    return groups
      .filter(g => g.lists.length > 0)
      .sort((a, b) => b.lists.length - a.lists.length || found(b) - found(a));
  }
  return groups.sort((a, b) => found(b) - found(a) || pct(b) - pct(a));
}

/** How many groups to show when folded: all of them unless the fold hides enough to be worth it. */
export function foldedCount(total: number): number {
  return total < VISIBLE_GROUPS + MIN_HIDDEN_GROUPS ? total : VISIBLE_GROUPS;
}

/**
 * True when the whole report is one event, so naming it per row says nothing.
 * Judged on every list in the report, not the card's: a niche card played
 * twice at one weekly still needs its rows to say where.
 */
export function singleEvent(records: readonly ListRecord[]): boolean {
  const ids = new Set(records.map(r => r.event?.id ?? ''));
  return ids.size <= 1;
}
