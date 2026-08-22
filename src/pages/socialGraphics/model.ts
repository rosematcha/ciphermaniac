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

export type Mode = 'standard' | 'rising' | 'converting';
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
}

/**
 * Overcollect this many extra candidates before evolution collapsing, so the
 * list can still reach the requested size after a few pre-evos are dropped.
 */
const POOL_SLACK = 8;

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
  /** `SET::NUMBER` to the name it evolves from. */
  evolutionMap?: Map<string, string>;
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
  const filtered = items.filter(i => !isBasicEnergy(i));
  const pool = size + POOL_SLACK;

  let candidates: RenderItem[];

  if (mode === 'converting') {
    const stats = input.day2Stats;
    if (!stats) {
      return [];
    }
    const catByUid = new Map<string, CatKind>();
    for (const it of filtered) {
      if (it.uid) {
        catByUid.set(it.uid, classify(it));
      }
    }
    const ranked = stats
      .filter(s => s.day1Count >= input.minDecks && s.set !== 'SVE')
      .sort((a, b) =>
        // Tie-break on sample size so a higher-confidence row wins.
        b.conversion !== a.conversion ? b.conversion - a.conversion : b.day1Count - a.day1Count
      );
    candidates = ranked.slice(0, pool).map(s => ({
      rank: 0,
      name: s.name,
      set: s.set,
      number: s.number,
      found: s.day2Count,
      total: s.day1Count,
      pct: s.conversion,
      cat: catByUid.get(s.uid) ?? 'pokemon',
      conversion: s.conversion,
      day1Count: s.day1Count,
      day2Count: s.day2Count
    }));
  } else if (mode === 'rising') {
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
    candidates = filtered
      .filter(it => it.uid && cmpPct.has(it.uid))
      .map(it => ({ item: it, delta: it.pct - (cmpPct.get(it.uid as string) ?? 0) }))
      .filter(x => x.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, pool)
      .map(x => ({
        rank: 0,
        name: x.item.name,
        set: x.item.set ?? '',
        number: String(x.item.number ?? ''),
        found: x.item.found,
        total: x.item.total,
        pct: x.item.pct,
        cat: classify(x.item),
        delta: x.delta
      }));
  } else {
    candidates = filtered.slice(0, pool).map(it => ({
      rank: 0,
      name: it.name,
      set: it.set ?? '',
      number: String(it.number ?? ''),
      found: it.found,
      total: it.total,
      pct: it.pct,
      cat: classify(it)
    }));
  }

  return collapseEvolutions(candidates, input.evolutionMap, mode)
    .slice(0, size)
    .map((c, idx) => ({ ...c, rank: idx + 1 }));
}
