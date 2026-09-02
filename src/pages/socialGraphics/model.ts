/**
 * The social-graphics render model.
 *
 * Separated from the page so the "what goes in the graphic" decision is
 * testable without a canvas. The page owns configuration, preview, and the
 * rasterization mechanics (modern-screenshot); this owns which cards are
 * chosen, in what order, and how they are labeled.
 * @module src/pages/socialGraphics/model
 */

import { cardSupercategory } from '../../lib/cardStats';
import { itemUid } from '../../lib/data/compat';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../../lib/constants';
import type { Day2CardStat } from '../../lib/data/events';
import type { EventField } from './eventField';
import type { CardItem } from '../../types';

export type Mode = 'standard' | 'rising' | 'converting' | 'fraudulent';
export type CatKind = 'pokemon' | 'trainer' | 'energy-basic' | 'energy-special';

/** One row in the rendered graphic. */
export interface RenderItem {
  rank: number;
  name: string;
  set: string;
  number: string;
  found: number;
  total: number;
  pct: number;
  cat: CatKind;
  /**
   * Rising mode: percentage-point gain over the comparison event.
   * Fraudulent mode: the card's event play rate minus its online one, so a
   * fraud is always negative.
   */
  delta?: number;
  /** Converting mode only: Day 1 to Day 2 conversion (0..100). */
  conversion?: number;
  /** Converting mode only: count of Day 2 decks playing this card. */
  day2Count?: number;
  /** Converting mode only: count of all Day 1 decks playing this card. */
  day1Count?: number;
  /** Fraudulent mode only: share of the pooled events' decks playing it (0..100). */
  eventRate?: number;
}

/** Modes whose numbers come from the event's Day 1 to Day 2 cut. */
export function needsDay2Stats(mode: Mode): boolean {
  return mode === 'converting';
}

/**
 * Overcollect this many extra candidates before evolution collapsing, so the
 * list can still reach the requested size after a few pre-evos are dropped.
 */
const POOL_SLACK = 8;

/**
 * How unlikely a card's drop from its online play rate must be, in standard
 * deviations, before it counts as a fraud rather than a different weekend.
 *
 * Roughly a one-sided 98% confidence that the gap is real. It doubles as the
 * sample-size guard: against a 700-deck event, a card has to shed several
 * points of play rate before it clears this, and a card the events barely
 * sampled never does.
 */
export const FRAUD_MAX_Z = -2;

/**
 * How far a card's play rate at the events sits from its play rate online, in
 * standard deviations.
 *
 * The two-proportion test treats the online window as the null hypothesis — if
 * the card were as good as its ladder reputation, the events would be another
 * draw at that rate — so this measures how unlikely the gap is rather than how
 * wide it is. Both deck totals enter, which is the point: a 6-point drop across
 * a 700-deck event is damning, and the same drop across a 60-deck one is not.
 * @param onlineFound - Online decks playing the card
 * @param onlineTotal - Online decks in the window
 * @param eventFound - Event decks playing the card
 * @param eventTotal - Decks across the pooled events
 * @returns Standard deviations from the online rate; negative means below it
 */
export function playRateZScore(
  onlineFound: number,
  onlineTotal: number,
  eventFound: number,
  eventTotal: number
): number {
  if (onlineTotal <= 0 || eventTotal <= 0) {
    return 0;
  }
  const pooled = (onlineFound + eventFound) / (onlineTotal + eventTotal);
  if (pooled <= 0 || pooled >= 1) {
    return 0;
  }
  const sigma = Math.sqrt(pooled * (1 - pooled) * (1 / onlineTotal + 1 / eventTotal));
  return sigma === 0 ? 0 : (eventFound / eventTotal - onlineFound / onlineTotal) / sigma;
}

/** Basic energy is its own set code; it never belongs in a usage graphic. */
export function isBasicEnergy(item: Pick<CardItem, 'set'>): boolean {
  return item.set === 'SVE';
}

/** Which visual category a card renders as. */
export function classify(item: CardItem): CatKind {
  const section = cardSupercategory(item);
  if (section === 'trainer') {
    return 'trainer';
  }
  if (section === 'energy') {
    const cat = (item.category ?? '').toLowerCase();
    return cat.includes('basic') || item.energyType === 'basic' ? 'energy-basic' : 'energy-special';
  }
  return 'pokemon';
}

/** Same-origin thumbnail path; hotlinking the CDN taints the export canvas. */
export function thumbUrl(set: string, number: string | number): string {
  return `/thumbnails/lg/${String(set).toUpperCase()}/${String(number)}`;
}

/** Display name for a tournament key, without its date prefix. */
export function shortTournament(key: string): string {
  if (key === ONLINE_META_NAME) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(/^\d{4}-\d{2}-\d{2},\s*(.+)$/);
  return m ? m[1] : key;
}

/**
 * Whether a pre-evolution and its evolution occupy "the same slot".
 *
 * In rising mode the deltas are the headline; everywhere else it is `pct`
 * (which holds the conversion rate in converting mode).
 */
export function statsAreClose(preEvo: RenderItem, evo: RenderItem, mode: Mode): boolean {
  if (mode === 'rising' && preEvo.delta !== undefined && evo.delta !== undefined) {
    return Math.abs(preEvo.delta - evo.delta) <= 2;
  }
  return Math.abs(preEvo.pct - evo.pct) <= 5;
}

/**
 * Drop pre-evolutions whose evolved form ranks alongside them with comparable
 * stats.
 *
 * Rellor at 37% and Rabsca at 35% collapse to just Rabsca: the only reason a
 * deck plays Rellor is to evolve into Rabsca, so listing both spends two slots
 * on one card slot. Items with no sibling evolution in the list, or with stats
 * too far apart to count as the same slot, are kept.
 * @param items - Candidate rows, ranked
 * @param evoMap - `SET::NUMBER` to the lowercase name it evolves from
 * @param mode - Which statistic is the headline
 * @returns The surviving rows, order preserved
 */
export function collapseEvolutions(
  items: RenderItem[],
  evoMap: Map<string, string> | undefined,
  mode: Mode
): RenderItem[] {
  if (!evoMap?.size || !items.length) {
    return items;
  }
  // Index by lowercase name to find a pre-evo by parent-name lookup. Multiple
  // printings of one Pokemon dedupe to the first (highest-ranked) entry.
  const byName = new Map<string, RenderItem>();
  for (const it of items) {
    const key = it.name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, it);
    }
  }
  const drop = new Set<RenderItem>();
  for (const evo of items) {
    if (drop.has(evo)) {
      continue;
    }
    const parent = evoMap.get(`${evo.set}::${evo.number}`);
    if (!parent) {
      continue;
    }
    const preEvo = byName.get(parent);
    if (!preEvo || preEvo === evo || drop.has(preEvo)) {
      continue;
    }
    if (statsAreClose(preEvo, evo, mode)) {
      drop.add(preEvo);
    }
  }
  return items.filter(it => !drop.has(it));
}

/** Everything the render model needs, per mode. */
export interface RenderModelInput {
  mode: Mode;
  size: number;
  minDecks: number;
  /** The selected tournament's master report items. */
  items: CardItem[] | null;
  /** Rising mode: the comparison tournament's master items. */
  comparisonItems?: CardItem[] | null;
  /** Converting mode: the event's day-2 stats. */
  day2Stats?: Day2CardStat[] | null;
  /** Fraudulent mode: the majors of the online window, pooled into one field. */
  eventField?: EventField | null;
  /** Fraudulent mode: minimum share of online decks (0..100) a card must appear in. */
  playFloor?: number;
  /** `SET::NUMBER` to the name it evolves from. */
  evolutionMap?: Map<string, string>;
}

/** Master items indexed by uid, for joining day-2 stats back to card metadata. */
function indexByUid(items: CardItem[]): Map<string, CardItem> {
  const byUid = new Map<string, CardItem>();
  for (const it of items) {
    if (it.uid) {
      byUid.set(it.uid, it);
    }
  }
  return byUid;
}

/** A day-2 stat row as a render row, carrying its conversion as the headline. */
function fromDay2Stat(stat: Day2CardStat, master: CardItem | undefined): RenderItem {
  return {
    rank: 0,
    name: stat.name,
    set: stat.set,
    number: stat.number,
    found: stat.day2Count,
    total: stat.day1Count,
    pct: stat.conversion,
    cat: master ? classify(master) : 'pokemon',
    conversion: stat.conversion,
    day1Count: stat.day1Count,
    day2Count: stat.day2Count
  };
}

/** Day-2 rows with enough of a sample to mean anything, joined to master. */
function day2Candidates(stats: Day2CardStat[], master: CardItem[], minDecks: number): RenderItem[] {
  const byUid = indexByUid(master);
  return stats.filter(s => s.day1Count >= minDecks && s.set !== 'SVE').map(s => fromDay2Stat(s, byUid.get(s.uid)));
}

/** Highest Day 1 to Day 2 conversion first. */
function convertingCandidates(input: RenderModelInput, master: CardItem[], pool: number): RenderItem[] {
  const stats = input.day2Stats;
  if (!stats) {
    return [];
  }
  return day2Candidates(stats, master, input.minDecks)
    .sort((a, b) =>
      // Tie-break on sample size so a higher-confidence row wins.
      b.pct !== a.pct ? b.pct - a.pct : b.total - a.total
    )
    .slice(0, pool);
}

/**
 * Whether the card's set was even available at the events.
 *
 * A set that released inside the online window, or after the event the field
 * fell back to, puts its whole roster at the top of the list — heavily played
 * online, in none of the event's decks. If not one card from a set made those
 * decks, the format was not the same one.
 */
function playedAtEvents(item: CardItem, field: EventField): boolean {
  return !item.set || field.sets.has(item.set.toUpperCase());
}

/** One online row measured against the pooled event field. */
function fromOnlineItem(item: CardItem, field: EventField): { row: RenderItem; z: number } {
  // Same UID the field was pooled under, so a padded collector number on one
  // side cannot quietly read as "never played" on the other.
  const eventFound = field.found.get(itemUid(item)) ?? 0;
  const eventRate = (eventFound / field.deckTotal) * 100;
  return {
    row: {
      ...fromMasterItem(item),
      // The deck counts describe the events, since that is the claim being
      // made; `pct` stays the online rate the drop is measured from.
      found: eventFound,
      total: field.deckTotal,
      eventRate,
      delta: eventRate - item.pct
    },
    z: playRateZScore(item.found, item.total, eventFound, field.deckTotal)
  };
}

/**
 * Cards the ladder rates higher than the events do: a real online play rate
 * paired with a drop at the events too large to be a different weekend.
 *
 * The z-score is the gate rather than the sort. Both sides have fixed deck
 * totals, so significance tracks the size of the drop closely enough that
 * ranking by it would only scramble the order the graphic shows — the reader
 * sees percentage points, and those should descend. Basic energy is dropped:
 * its play rate tracks whichever archetypes happened to sleeve it.
 */
function fraudulentCandidates(input: RenderModelInput, master: CardItem[], pool: number): RenderItem[] {
  const field = input.eventField;
  if (!field || field.deckTotal <= 0) {
    return [];
  }
  const floor = input.playFloor ?? 0;
  return master
    .filter(it => it.pct >= floor && classify(it) !== 'energy-basic' && playedAtEvents(it, field))
    .map(it => fromOnlineItem(it, field))
    .filter(c => c.z <= FRAUD_MAX_Z)
    .sort((a, b) => (a.row.delta ?? 0) - (b.row.delta ?? 0))
    .slice(0, pool)
    .map(c => c.row);
}

/** Biggest gain in play rate against the comparison event. */
function risingCandidates(input: RenderModelInput, master: CardItem[], pool: number): RenderItem[] {
  const cmp = input.comparisonItems;
  if (!cmp) {
    return [];
  }
  const cmpPct = new Map<string, number>();
  for (const it of cmp) {
    if (it.uid) {
      cmpPct.set(it.uid, it.pct);
    }
  }
  return master
    .filter(it => it.uid && cmpPct.has(it.uid))
    .map(it => ({ item: it, delta: it.pct - (cmpPct.get(it.uid as string) ?? 0) }))
    .filter(x => x.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, pool)
    .map(x => ({ ...fromMasterItem(x.item), delta: x.delta }));
}

/** A master row as a render row, with play rate as the headline. */
function fromMasterItem(item: CardItem): RenderItem {
  return {
    rank: 0,
    name: item.name,
    set: item.set ?? '',
    number: String(item.number ?? ''),
    found: item.found,
    total: item.total,
    pct: item.pct,
    cat: classify(item)
  };
}

/** The candidate pool for a mode, before evolution collapsing. */
function candidatesFor(input: RenderModelInput, master: CardItem[], pool: number): RenderItem[] {
  if (input.mode === 'converting') {
    return convertingCandidates(input, master, pool);
  }
  if (input.mode === 'fraudulent') {
    return fraudulentCandidates(input, master, pool);
  }
  if (input.mode === 'rising') {
    return risingCandidates(input, master, pool);
  }
  return master.slice(0, pool).map(fromMasterItem);
}

/**
 * Choose and rank the cards the graphic renders.
 *
 * Returns an empty list — not a partial one — while the data a mode depends on
 * is still missing, so the preview never renders a graphic built from half its
 * inputs and the export gate has something unambiguous to check.
 * @param input - Mode, size, and the loaded source data
 * @returns Ranked rows, at most `size` of them
 */
export function buildRenderModel(input: RenderModelInput): RenderItem[] {
  const { mode, size, items } = input;
  if (!items) {
    return [];
  }
  const master = items.filter(i => !isBasicEnergy(i));
  const candidates = candidatesFor(input, master, size + POOL_SLACK);

  return collapseEvolutions(candidates, input.evolutionMap, mode)
    .slice(0, size)
    .map((c, idx) => ({ ...c, rank: idx + 1 }));
}
