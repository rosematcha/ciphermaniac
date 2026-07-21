/**
 * Price-mover math for the Trends page, extracted so the window boundary and
 * carry-forward rules are unit-testable.
 *
 * The rolling history artifact keeps 90 days and collapses flat runs to a
 * single point, so a card's price on a given day is the last observation at or
 * before it — not necessarily a point inside the window.
 */

import type { PricePoint } from './data';
import { DAY_MS } from './trendWindow';
import { accessiblePriceCap, type SynonymDatabase } from '../../shared/synonyms.js';

export interface PriceMover {
  uid: string;
  name: string;
  set: string;
  number: string;
  start: number;
  current: number;
  delta: number;
}

/** Lookback for the movers lists, in calendar days. */
export const PRICE_MOVER_WINDOW_DAYS = 7;

/** Minimum current price to list — filters out penny cards whose swings are noise. */
const PRICE_MOVER_MIN = 1;
/** Minimum absolute dollar swing to count as a mover. */
const PRICE_MOVER_MIN_DELTA = 0.25;

/** How many cards each list shows. */
const PRICE_MOVER_LIMIT = 12;

function parseDay(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/** Latest observation date across the whole history, in ms (NaN if empty). */
export function historyAnchorMs(history: Record<string, PricePoint[]>): number {
  let max = NaN;
  for (const points of Object.values(history)) {
    const last = points[points.length - 1];
    if (!last) {
      continue;
    }
    const t = parseDay(last.date);
    if (Number.isFinite(t) && !(t <= max)) {
      max = t;
    }
  }
  return max;
}

/**
 * Price entering the window: the last observation at or before `cutoffMs`,
 * carried forward. Falls back to the earliest point when the card's history
 * starts inside the window.
 */
function baselinePrice(points: PricePoint[], cutoffMs: number): number | null {
  let baseline: number | null = null;
  for (const pt of points) {
    const t = parseDay(pt.date);
    if (!Number.isFinite(t)) {
      continue;
    }
    if (t <= cutoffMs) {
      baseline = pt.price;
    } else {
      break;
    }
  }
  return baseline ?? points[0]?.price ?? null;
}

/**
 * Predicate for "standard printing": within its reprint cluster, a print whose
 * price is at or under {@link accessiblePriceCap}.
 *
 * Cluster membership comes from the synonym map, but its canonical UID is NOT
 * the answer on its own — the map picks a cluster representative, which for
 * cards like Umbreon ex PRE/161 is the $1,500 special illustration rare. Only
 * price relative to the cheapest sibling separates a playable print from a
 * collector one, so we compare prices directly.
 *
 * Prices come from the spot map first (fresh, but only covers played cards) and
 * fall back to the synonym artifact's scraped `prints` (broader, staler) so
 * unplayed siblings still set the cluster minimum. A print we can't price at
 * all is kept — silently dropping cards would read as "no movement".
 */
export function createStandardPrintFilter(
  db: SynonymDatabase | null,
  spotPrices: Record<string, { price?: number }>
): (uid: string) => boolean {
  const synonyms = db?.synonyms ?? {};
  const scraped = db?.prints ?? {};

  // One inversion up front: getClusterMembers is O(synonyms) per call, which
  // would be a full re-scan for every card in the history.
  const clusters = new Map<string, string[]>();
  for (const [variant, canonical] of Object.entries(synonyms)) {
    const members = clusters.get(canonical);
    if (members) {
      members.push(variant);
    } else {
      clusters.set(canonical, [canonical, variant]);
    }
  }

  const priceOf = (uid: string): number | null => {
    const spot = spotPrices[uid]?.price;
    if (typeof spot === 'number' && Number.isFinite(spot)) {
      return spot;
    }
    const fallback = scraped[uid];
    return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
  };

  return (uid: string) => {
    const own = priceOf(uid);
    if (own === null) {
      return true;
    }
    const canonical = synonyms[uid] ?? uid;
    const members = clusters.get(canonical);
    if (!members) {
      return true;
    }
    let min = own;
    for (const member of members) {
      const price = priceOf(member);
      if (price !== null && price < min) {
        min = price;
      }
    }
    return own <= accessiblePriceCap(min);
  };
}

/**
 * Biggest gainers and drops over the trailing {@link PRICE_MOVER_WINDOW_DAYS}
 * days, measured against the anchor day of the history itself (never wall-clock
 * time, which drifts past the data when the cron lags).
 *
 * `isIncluded` gates which UIDs are eligible — the page passes a
 * canonical-print predicate when the user narrows away collector printings.
 */
export function computePriceMovers(
  history: Record<string, PricePoint[]>,
  isIncluded?: (uid: string) => boolean
): { rising: PriceMover[]; falling: PriceMover[] } {
  const anchor = historyAnchorMs(history);
  if (!Number.isFinite(anchor)) {
    return { rising: [], falling: [] };
  }
  const cutoff = anchor - PRICE_MOVER_WINDOW_DAYS * DAY_MS;

  const all: PriceMover[] = [];
  for (const [uid, points] of Object.entries(history)) {
    if (points.length < 2 || (isIncluded && !isIncluded(uid))) {
      continue;
    }
    const start = baselinePrice(points, cutoff);
    const current = points[points.length - 1].price;
    if (start === null) {
      continue;
    }
    const delta = current - start;
    if (current < PRICE_MOVER_MIN || Math.abs(delta) < PRICE_MOVER_MIN_DELTA) {
      continue;
    }
    const parts = uid.split('::');
    if (parts.length < 3) {
      continue;
    }
    all.push({ uid, name: parts[0], set: parts[1], number: parts[2], start, current, delta });
  }

  return {
    rising: all
      .filter(m => m.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, PRICE_MOVER_LIMIT),
    falling: all
      .filter(m => m.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, PRICE_MOVER_LIMIT)
  };
}
