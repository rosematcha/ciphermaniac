import type { CardItem } from '../types';
import { cardSupercategory } from './cardStats';

export type PriceBand = 'lt1' | '1to5' | '5to15' | 'gte15';

/**
 * Bucket a USD market price into the coarse band the card filters expose. An
 * unknown price (null) has no band, so a specific band filter excludes it
 * rather than silently treating "no data" as cheap.
 */
export function cardPriceBand(price: number | null): PriceBand | null {
  if (price === null || !Number.isFinite(price)) {
    return null;
  }
  if (price < 1) {
    return 'lt1';
  }
  if (price < 5) {
    return '1to5';
  }
  if (price < 15) {
    return '5to15';
  }
  return 'gte15';
}

/**
 * Metadata filter state shared between the desktop filter bar and the mobile
 * refine sheet. `'all'` is the inert value for each single-select facet;
 * `aceSpec` is a plain boolean toggle.
 */
export interface CardFilters {
  type: 'all' | 'pokemon' | 'trainer' | 'energy';
  /** Contextual subtype: a trainer or energy subtype value, or `'all'`. */
  subtype: string;
  /** Regulation mark (e.g. `'G'`) or `'all'`. */
  reg: string;
  aceSpec: boolean;
  priceBand: 'all' | PriceBand;
}

/**
 * Pure predicate that decides whether a card survives the metadata filters.
 * The name-search term is applied separately (it's debounced on its own), and
 * `price` is passed in because pricing lives in a distinct resource. Cards
 * missing a facet (e.g. no `regulationMark`) simply fail a filter on that facet
 * instead of throwing.
 */
export function matchesCardFilters(item: CardItem, filters: CardFilters, price: number | null): boolean {
  if (filters.type !== 'all' && cardSupercategory(item) !== filters.type) {
    return false;
  }
  if (filters.subtype !== 'all') {
    if (filters.type === 'trainer' && item.trainerType !== filters.subtype) {
      return false;
    }
    if (filters.type === 'energy' && item.energyType !== filters.subtype) {
      return false;
    }
  }
  if (filters.reg !== 'all' && item.regulationMark !== filters.reg) {
    return false;
  }
  if (filters.aceSpec && item.aceSpec !== true) {
    return false;
  }
  if (filters.priceBand !== 'all' && cardPriceBand(price) !== filters.priceBand) {
    return false;
  }
  return true;
}

/** Number of active (non-inert) metadata facets — drives the trigger count and
 * the closed-state summary chips. Sort/view/search are deliberately excluded. */
export function countActiveCardFilters(filters: CardFilters): number {
  let n = 0;
  if (filters.type !== 'all') {
    n += 1;
  }
  if (filters.subtype !== 'all') {
    n += 1;
  }
  if (filters.reg !== 'all') {
    n += 1;
  }
  if (filters.aceSpec) {
    n += 1;
  }
  if (filters.priceBand !== 'all') {
    n += 1;
  }
  return n;
}
