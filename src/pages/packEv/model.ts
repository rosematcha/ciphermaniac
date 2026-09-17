/**
 * Derivations and wording for /tools/pack-ev.
 *
 * The page's job is to put two numbers next to each other — what a pack holds
 * and what a pack costs — so everything here is about making that comparison
 * readable: money to the cent, and the return or loss as a whole-number
 * percentage of what you paid.
 * @module src/pages/packEv/model
 */

import type { Pull } from '../../../shared/packEv/simulate';

/** Dollars, always to the cent — these are prices, not estimates. */
export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * A buylist rate, which is quoted in tenths of a cent.
 *
 * `money` would round the common rate of $0.035 to four cents — a 14% error on
 * the number the whole bulk line rests on, printed next to its own source.
 */
export function rate(value: number): string {
  return `$${value.toFixed(3).replace(/0$/, '')}`;
}

/** What you get back per dollar spent, as a whole-number percentage. */
export function returnPercent(value: number, cost: number | null): number | null {
  if (cost === null || cost <= 0) {
    return null;
  }
  return Math.round((value / cost) * 100);
}

/** The share of the price a pack loses opened; negative when opening wins. Null when unpriced. */
export function lossPercent(value: number, cost: number | null): number | null {
  const percent = returnPercent(value, cost);
  return percent === null ? null : 100 - percent;
}

/** `2026-09-16` → `16 Sep 2026`, for the "prices from" line. */
export function priceDate(generatedAt: string): string {
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Identical prints from every pack opened so far, counted once. */
export interface PullStack {
  key: string;
  pull: Pull;
  count: number;
  /** Which rip opened the first copy, so a tile can tell a new stack from another copy. */
  first: number;
  /** Which rip last added a copy; the newest-first sort reads it. */
  last: number;
}

export type StackSort = 'newest' | 'value' | 'count';

/** A print is its product and its printing; flat outcomes (basic energy) stack by name. */
function stackKey(pull: Pull): string {
  return pull.card ? `${pull.card.id}:${pull.printing}` : `flat:${pull.outcome}`;
}

/**
 * Fold a rip's pulls into the running stacks.
 *
 * Stacks rather than raw pulls because a case is 2,376 cards: a grid of every
 * copy would be unreadable and unbounded, while distinct prints top out at the
 * size of the set.
 */
export function mergePulls(stacks: PullStack[], pulls: Pull[], rip: number): PullStack[] {
  const byKey = new Map(stacks.map(entry => [entry.key, entry]));
  for (const pull of pulls) {
    const key = stackKey(pull);
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing ? { ...existing, count: existing.count + 1, last: rip } : { key, pull, count: 1, first: rip, last: rip }
    );
  }
  return [...byKey.values()];
}

const SORT_KEYS: Record<StackSort, (stack: PullStack) => number> = {
  value: stack => stack.pull.value,
  newest: stack => stack.last,
  // Bulk is all worth the same few cents, so value would only group it by class;
  // a pile reads biggest stack first.
  count: stack => stack.count
};

/** Most valuable, most recent, or most copies first; ties go to the bigger, then pricier, stack. */
export function sortStacks(stacks: PullStack[], by: StackSort): PullStack[] {
  const primary = SORT_KEYS[by];
  return [...stacks].sort((a, b) => primary(b) - primary(a) || b.count - a.count || b.pull.value - a.pull.value);
}

/** Rarities that open like an edition in Balatro: a second, bigger spring and a sheen. */
const CHASE_RARITY = /special illustration|hyper|secret/iu;
/** A price that earns the same call-out whatever its rarity says. */
const CHASE_VALUE = 50;

export function isChase(pull: Pull): boolean {
  return pull.value >= CHASE_VALUE || CHASE_RARITY.test(pull.card?.rarity ?? '');
}

/** The collector number without its set total: `188/167` is `188`, the form card art is keyed by. */
export function artNumber(number: string): string {
  return number.split('/')[0];
}

/**
 * TCGplayer's own product photo, for a reprint: Limitless files those under
 * their original sets, if at all, so this is the one image source that has them.
 */
export function productImage(id: number): string {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`;
}
