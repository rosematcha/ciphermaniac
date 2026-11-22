/**
 * Card pricing: today's market prices and the daily movers list.
 *
 * These are optional artifacts — the pipeline may not have produced them
 * yet for a given set or day — so every reader here degrades to an empty result
 * rather than erroring.
 * @module src/lib/data/prices
 */

import { dataClient } from './client';
import { isRecord } from '../../../shared/data/validate';
import { ONLINE } from './paths';

const { fetchJsonOptional } = dataClient;

export interface PricingEntry {
  price?: number;
  tcgPlayerId?: string;
}

function pricesIn(payload: unknown): Record<string, PricingEntry> | null {
  return isRecord(payload) && isRecord(payload.cardPrices)
    ? (payload.cardPrices as Record<string, PricingEntry>)
    : null;
}

/** `cardPrices` (`Name::SET::NUMBER` → entry) from a price file, or null when it is absent. */
async function readPrices(path: string): Promise<Record<string, PricingEntry> | null> {
  return pricesIn(await fetchJsonOptional<unknown>(path));
}

type PriceUids = Iterable<string | null> | Promise<Iterable<string | null>>;

/**
 * The online meta's cut, or null unless it covers every UID in `uids`: priced,
 * or listed as unpriced. A UID outside it means the cut was built for other
 * cards, say before newer synonyms or a newer master, so only the whole file
 * can answer for it. The cut downloads while `uids` is still pending.
 */
async function readMetaPrices(uids: PriceUids): Promise<Record<string, PricingEntry> | null> {
  const [payload, shown] = await Promise.all([fetchJsonOptional<unknown>('/reports/prices-meta.json'), uids]);
  const prices = pricesIn(payload);
  if (!prices) {
    return null;
  }
  const unpriced = new Set(isRecord(payload) && Array.isArray(payload.unpriced) ? payload.unpriced : []);
  for (const uid of shown) {
    if (uid && !Object.hasOwn(prices, uid) && !unpriced.has(uid)) {
      return null;
    }
  }
  return prices;
}

/**
 * Returns a flat map of every priced `Name::SET::NUMBER` printing →
 * `{ price, tcgPlayerId }`.
 */
export async function fetchPrices(): Promise<Record<string, PricingEntry>> {
  return (await readPrices('/reports/prices.json')) ?? {};
}

/**
 * Prices for `uids`, the cards a tournament's page looks up. The online meta
 * reads the file cut to its own cards; other sources, releases from before that
 * file, a cut that doesn't cover every UID, and any failed read of it read
 * every price.
 */
export async function fetchPricesFor(tournament: string, uids: PriceUids): Promise<Record<string, PricingEntry>> {
  const meta = tournament === ONLINE ? await readMetaPrices(uids).catch(() => null) : null;
  return meta ?? fetchPrices();
}

/**
 * Limitless per-print prices for the card page's printings strip, in release
 * order, or null in releases where they still ride in the synonym database.
 */
export async function fetchPrintPrices(): Promise<Record<string, number | null> | null> {
  const payload = await fetchJsonOptional<unknown>('/assets/card-prints.json');
  return isRecord(payload) && isRecord(payload.prints) ? (payload.prints as Record<string, number | null>) : null;
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
