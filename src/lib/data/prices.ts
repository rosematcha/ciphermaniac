/**
 * Card pricing: today's market prices, the rolling per-set history, and the
 * daily movers list.
 *
 * All three are optional artifacts — the pipeline may not have produced them
 * yet for a given set or day — so every reader here degrades to an empty result
 * rather than erroring. A card page without a sparkline is fine; a card page
 * that throws is not.
 * @module src/lib/data/prices
 */

import { dataClient } from './client';

const { fetchJsonOptional } = dataClient;

export interface PricingEntry {
  price?: number;
  tcgPlayerId?: string;
}
interface PricingPayload {
  /** Map of `Name::SET::NUMBER` → entry */
  cardPrices: Record<string, PricingEntry>;
}

/**
 * Returns a flat map of `Name::SET::NUMBER` → { price, tcgPlayerId }.
 */
export async function fetchPrices(): Promise<Record<string, PricingEntry>> {
  const payload = await fetchJsonOptional<PricingPayload>('/reports/prices.json');
  return payload?.cardPrices ?? {};
}

/** One dated price observation from the rolling history. */
export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  /** Market price in USD on that date. */
  price: number;
}

/**
 * Rolling price history keyed by `Name::SET::NUMBER`. Written daily by
 * `.github/scripts/update-prices.py`, bounded to a 90-day window, with flat
 * runs collapsed to a single point (so a card whose price never moved carries
 * one point and callers degrade it to nothing). Stored compactly as `{d, p}`;
 * expanded here to `{date, price}`. Absent (null → {}) until the pipeline has
 * run at least once.
 */
interface PriceHistoryPayload {
  history: Record<string, { d: string; p: number }[]>;
}

/**
 * Rolling price history for a single set, sharded by the set code as it appears
 * in the UID (`Name::SET::NUMBER`). A card page only needs its own set, so this
 * downloads a few KB instead of the whole site's history.
 *
 * Returns {} when the shard is absent (unknown set, or the pipeline has not run
 * for it yet) so callers degrade to no sparkline rather than erroring.
 */
export async function fetchPriceHistoryForSet(setCode: string): Promise<Record<string, PricePoint[]>> {
  const payload = await fetchJsonOptional<PriceHistoryPayload>(
    `/reports/price-history/${encodeURIComponent(setCode)}.json`
  );
  const raw = payload?.history;
  if (!raw) {
    return {};
  }
  const out: Record<string, PricePoint[]> = {};
  for (const [uid, points] of Object.entries(raw)) {
    out[uid] = points.map(pt => ({ date: pt.d, price: pt.p }));
  }
  return out;
}

/** One row of a pre-computed price-movers list. */
export interface PriceMoverRow {
  /** `Name::SET::NUMBER` */
  uid: string;
  name: string;
  set: string;
  number: string;
  /** Market price entering the window, in USD. */
  start: number;
  /** Latest market price, in USD. */
  current: number;
  /** `current - start`, in USD. */
  delta: number;
  /** Percent change over the window (28.7 = +28.7%). */
  pct: number;
}

/** Rising/falling lists, ranked one way. */
export interface PriceMoverList {
  rising: PriceMoverRow[];
  falling: PriceMoverRow[];
}

/** How the movers lists are ranked. */
export type PriceMoverMetric = 'pct' | 'value';

/**
 * One printings scope, ranked both ways. Same rows in each — every row carries
 * both `pct` and `delta` — so the metric toggle only swaps which pre-sorted
 * list renders.
 */
export type PriceMoverScope = Record<PriceMoverMetric, PriceMoverList>;

/**
 * Pre-computed price movers, written daily by the pipeline. All of the window,
 * thresholds, sorting and standard-printing logic lives in Python — rows arrive
 * already sorted (steepest first) and already capped, so the client renders
 * them verbatim.
 */
export interface PriceMoversPayload {
  /** Lookback used for the lists, in calendar days. */
  windowDays: number;
  /** Calendar days the rolling history covers; gate price UIs on this. */
  spanDays: number;
  scopes: {
    /** Every tracked printing. */
    all: PriceMoverScope;
    /** Collector printings dropped — playable prints only. */
    standard: PriceMoverScope;
  };
}

/**
 * Fetch the pre-computed movers artifact. Null until the pipeline has written
 * it at least once, which callers should treat as "render nothing".
 */
export function fetchPriceMovers(): Promise<PriceMoversPayload | null> {
  return fetchJsonOptional<PriceMoversPayload>('/reports/price-movers.json');
}

/**
 * Minimum calendar span the rolling price history must cover before any
 * price-trend UI is surfaced. The artifact accumulates one day at a time from
 * the daily pipeline (no backfill), so trends are withheld until enough has
 * been collected to be meaningful.
 */
export const PRICE_HISTORY_MIN_DAYS = 30;

/**
 * Days spanned by the whole rolling history (latest observation − earliest,
 * across every card). Flat runs collapse to a single point, so the earliest
 * date across volatile cards is the best proxy for when accumulation began.
 * Gate price UIs on this being ≥ {@link PRICE_HISTORY_MIN_DAYS}.
 */
export function priceHistorySpanDays(history: Record<string, PricePoint[]>): number {
  let min = Infinity;
  let max = -Infinity;
  for (const points of Object.values(history)) {
    for (const pt of points) {
      const t = Date.parse(pt.date);
      if (Number.isNaN(t)) {
        continue;
      }
      if (t < min) {
        min = t;
      }
      if (t > max) {
        max = t;
      }
    }
  }
  if (min === Infinity) {
    return 0;
  }
  return Math.round((max - min) / 86_400_000);
}
