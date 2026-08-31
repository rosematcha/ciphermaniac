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
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../../lib/constants';
import type { Day2CardStat } from '../../lib/data/events';
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
  /** Rising mode only: percentage-point delta vs comparison. */
  delta?: number;
  /** Converting mode only: Day 1 to Day 2 conversion (0..100). */
  conversion?: number;
  /** Converting mode only: count of Day 2 decks playing this card. */
  day2Count?: number;
  /** Converting mode only: count of all Day 1 decks playing this card. */
  day1Count?: number;
  /** Fraudulent mode only: share of Day 1 decks playing the card (0..100). */
  playRate?: number;
}

/** Modes whose numbers come from the event's Day 1 to Day 2 cut. */
export function needsDay2Stats(mode: Mode): boolean {
  return mode === 'converting' || mode === 'fraudulent';
}

/**
 * Overcollect this many extra candidates before evolution collapsing, so the
 * list can still reach the requested size after a few pre-evos are dropped.
 */
const POOL_SLACK = 8;

/**
 * How many of the event's most-played cards the fraudulent mode considers.
 *
 * "Fraudulent" means popular AND bad at converting, so the low-conversion
 * ranking is taken over a fixed slice of the most-played cards rather than the
 * whole field — otherwise it just surfaces fringe cards that four people
 * played and none of them made Day 2.
 */
export const FRAUD_PLAYRATE_POOL = 50;

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
  /** Converting and fraudulent modes: the event's day-2 stats. */
  day2Stats?: Day2CardStat[] | null;
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
    day2Count: stat.day2Count,
    playRate: master?.pct
  };
}

/** Day-2 rows with enough of a sample to mean anything, joined to master. */
function day2Candidates(
  stats: Day2CardStat[],
  master: CardItem[],
  minDecks: number
): { row: RenderItem; playRate: number }[] {
  const byUid = indexByUid(master);
  return stats
    .filter(s => s.day1Count >= minDecks && s.set !== 'SVE')
    .map(s => ({ row: fromDay2Stat(s, byUid.get(s.uid)), playRate: byUid.get(s.uid)?.pct ?? 0 }));
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
      b.row.pct !== a.row.pct ? b.row.pct - a.row.pct : b.row.total - a.row.total
    )
    .slice(0, pool)
    .map(c => c.row);
}

/**
 * Popular cards that converted worst: lowest conversion among the event's most
 * played cards.
 *
 * The play-rate slice is what separates this from "worst converters" — a card
 * nobody played converting at 0% is noise, while a staple in a third of the
 * field converting below the pack is the story.
 */
function fraudulentCandidates(input: RenderModelInput, master: CardItem[], pool: number): RenderItem[] {
  const stats = input.day2Stats;
  if (!stats) {
    return [];
  }
  return day2Candidates(stats, master, input.minDecks)
    .filter(c => c.playRate > 0)
    .sort((a, b) => b.playRate - a.playRate)
    .slice(0, FRAUD_PLAYRATE_POOL)
    .sort((a, b) =>
      // Tie-break toward the more played card — the same conversion hurts more
      // when more of the field was holding it.
      a.row.pct !== b.row.pct ? a.row.pct - b.row.pct : b.playRate - a.playRate
    )
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
