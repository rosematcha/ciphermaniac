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
