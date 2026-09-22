/**
 * Pure compute for the archetype page's Lists tab: which cards in a list are
 * unusual for the archetype, which lists are the same 60, and which cards the
 * tech filter offers. Kept free of Solid and the DOM so it is unit-testable.
 */
import { compareFinish, inFinish } from '../cardPage/playedInModel';
import type { ListCard, ListRecord } from '../../lib/data/lists';

/** Where a list was played. Online lists come from the rolling window; live ones from majors. */
export type Venue = 'online' | 'live';

/** One published list of the archetype, tagged with its source. */
export interface ArchetypeList {
  /** Unique across every source merged into the tab. */
  key: string;
  record: ListRecord;
  venue: Venue;
}

/**
 * Share of slots marked. A slot (a card at a count) is marked when fewer of the
 * archetype's lists run it than this percentile of all its slots, so a tight
 * archetype and a loose one both mark about a quarter of what varies.
 */
export const MARK_PERCENTILE = 25;
const MIN_BAR = 5;
const MAX_BAR = 60;

/** Tech filter candidates: cards in this band of the archetype's lists. */
const TECH_MIN_SHARE = 3;
const TECH_MAX_SHARE = 90;
const TECH_CAP = 18;

const BASIC_ENERGY = /^(Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/;

/** Basic energy counts swing with the rest of the deck, so they are never marked or offered as techs. */
export function isBasicEnergy(name: string): boolean {
  return BASIC_ENERGY.test(name);
}

const pairKey = (name: string, count: number): string => `${name}|${count}`;

/**
 * The list's cards with printings of the same card folded together: 2 PAL Iono
 * and 2 PAF Iono are one 4-of Iono. The first printing stands in for the art.
 */
export function mergedCards(record: ListRecord): ListCard[] {
  const byName = new Map<string, ListCard>();
  for (const card of record.cards) {
    const seen = byName.get(card.name);
    byName.set(card.name, seen ? { ...seen, count: seen.count + card.count } : card);
  }
  return [...byName.values()];
}

/** How common each card, and each card at each count, is across an archetype's lists. */
export interface SlotStats {
  /** Percent of lists running the card at exactly this count. */
  pairShare: (name: string, count: number) => number;
  /** Percent of lists running the card at all. */
  nameShare: (name: string) => number;
  /** Slots under this percent are marked. */
  bar: number;
}

function countBy(lists: readonly ArchetypeList[]): { names: Map<string, number>; pairs: Map<string, number> } {
  const names = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const { record } of lists) {
    for (const card of mergedCards(record)) {
      names.set(card.name, (names.get(card.name) ?? 0) + 1);
      const key = pairKey(card.name, card.count);
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  return { names, pairs };
}

function percentileBar(shares: number[], percentile: number): number {
  if (shares.length === 0) {
    return MAX_BAR;
  }
  shares.sort((a, b) => a - b);
  const at = shares[Math.min(shares.length - 1, Math.floor((percentile / 100) * shares.length))];
  return Math.max(MIN_BAR, Math.min(MAX_BAR, Math.round(at)));
}

/**
 * Slot statistics over every list of the archetype. The bar is taken over all
 * slots (not distinct ones), so the cards everyone plays pull it up and the
 * marks land on what genuinely varies.
 * @param lists - Every list of the archetype, before any filter
 * @param percentile - Share of slots to mark
 */
export function slotStats(lists: readonly ArchetypeList[], percentile = MARK_PERCENTILE): SlotStats {
  const total = lists.length || 1;
  const { names, pairs } = countBy(lists);
  const pairShare = (name: string, count: number) => (100 * (pairs.get(pairKey(name, count)) ?? 0)) / total;
  const nameShare = (name: string) => (100 * (names.get(name) ?? 0)) / total;
  const shares: number[] = [];
  for (const { record } of lists) {
    for (const card of mergedCards(record)) {
      if (!isBasicEnergy(card.name)) {
        shares.push(pairShare(card.name, card.count));
      }
    }
  }
  return { pairShare, nameShare, bar: percentileBar(shares, percentile) };
}

/** A marked slot: the card as the list runs it and how many lists share that exact slot. */
export interface OddSlot {
  card: ListCard;
  share: number;
}

/** The list's marked slots, rarest first. A common card at an unusual count is marked too. */
export function oddSlots(record: ListRecord, stats: SlotStats): OddSlot[] {
  return mergedCards(record)
    .filter(card => !isBasicEnergy(card.name))
    .map(card => ({ card, share: stats.pairShare(card.name, card.count) }))
    .filter(slot => slot.share < stats.bar)
    .sort((a, b) => a.share - b.share);
}

/** Lists that are the same 60, card for card and count for count. */
export interface Same60Group {
  /** The best finish among them. */
  face: ArchetypeList;
  /** Everyone else who ran it, best finish first. */
  others: ArchetypeList[];
}

function signature(record: ListRecord): string {
  return mergedCards(record)
    .map(card => pairKey(card.name, card.count))
    .sort()
    .join(';');
}

const byFinish = (a: ArchetypeList, b: ArchetypeList): number => compareFinish(a.record, b.record);

/** Collapse identical 60s into one group each, best face first. */
export function collapseSame60(lists: readonly ArchetypeList[]): Same60Group[] {
  const bySignature = new Map<string, ArchetypeList[]>();
  for (const list of lists) {
    const key = signature(list.record);
    const bucket = bySignature.get(key);
    if (bucket) {
      bucket.push(list);
    } else {
      bySignature.set(key, [list]);
    }
  }
  return [...bySignature.values()]
    .map(group => {
      const [face, ...others] = group.sort(byFinish);
      return { face, others };
    })
    .sort((a, b) => byFinish(a.face, b.face));
}

/** A card the tech filter offers, with a printing to show and its share of lists. */
export interface TechCandidate {
  name: string;
  card: ListCard;
  share: number;
}

/** Cards that vary across the lists (in 3–90% of them), most played first. */
export function techCandidates(lists: readonly ArchetypeList[]): TechCandidate[] {
  const seen = new Map<string, { card: ListCard; lists: number }>();
  for (const { record } of lists) {
    for (const name of new Set(record.cards.map(card => card.name))) {
      const entry = seen.get(name);
      if (entry) {
        entry.lists += 1;
      } else {
        seen.set(name, { card: record.cards.find(card => card.name === name)!, lists: 1 });
      }
    }
  }
  const total = lists.length || 1;
  return [...seen]
    .map(([name, { card, lists: count }]) => ({ name, card, share: (100 * count) / total }))
    .filter(t => t.share >= TECH_MIN_SHARE && t.share < TECH_MAX_SHARE && !isBasicEnergy(t.name) && t.card.set)
    .sort((a, b) => b.share - a.share)
    .slice(0, TECH_CAP);
}

/** The tab's filters. */
export interface ListFilters {
  /** A finish tier from the card page's FINISH_OPTIONS. */
  finish: string;
  venue: Venue | 'all';
  /** Card names every shown list must run. */
  techs: ReadonlySet<string>;
}

export function inVenue(list: ArchetypeList, venue: ListFilters['venue']): boolean {
  return venue === 'all' || list.venue === venue;
}

function runsAll(record: ListRecord, names: ReadonlySet<string>): boolean {
  for (const name of names) {
    if (!record.cards.some(card => card.name === name)) {
      return false;
    }
  }
  return true;
}

/** Lists in the finish tier and venue, before the tech filter (the filmstrip is drawn from these). */
export function tierLists(lists: readonly ArchetypeList[], filters: ListFilters): ArchetypeList[] {
  return lists.filter(list => inFinish(list.record, filters.finish) && inVenue(list, filters.venue));
}

/** Lists passing every filter. */
export function filterLists(lists: readonly ArchetypeList[], filters: ListFilters): ArchetypeList[] {
  return tierLists(lists, filters).filter(list => runsAll(list.record, filters.techs));
}
