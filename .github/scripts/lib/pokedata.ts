/**
 * Client for Pokedata's events API (https://pokedata.ovh/events/apiv2/help).
 *
 * The API's date, state, city, and radius filters do not work: most answer a
 * PHP fatal error with HTTP 200 and an HTML body, and the radius filter returns
 * nothing for any input. Event type and paging do work, so this pulls every
 * page of Cups, Challenges, and Prereleases and leaves filtering to the
 * locator's own build step.
 *
 * Every page is checked for being JSON of the expected shape, because a
 * broken query still answers 200, and the whole pull is checked for being
 * complete before anything downstream may publish it.
 * @module .github/scripts/lib/pokedata
 */

import { setTimeout as sleepFor } from 'node:timers/promises';

export const POKEDATA_API = 'https://pokedata.ovh/events/apiv2/';
export const POKEDATA_TABLE_API = 'https://www.pokedata.ovh/events/tableapi/index_table.php';
/** Pokedata's own locator, which the site credits as the source. */
export const POKEDATA_SITE = 'https://pokedata.ovh/events/';
const QUERY = '_tcg/cups/challenges/pre';

/**
 * Pages whose count moved while we paged (events added or removed upstream)
 * shift records across page boundaries. Anything short of this share of the
 * advertised total means pages failed, not that the listing moved.
 */
export const MIN_COMPLETE_SHARE = 0.95;

// Same shape as the Limitless proxy's: a plain library UA is what bot
// protection blocks first.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Ciphermaniac/1.0; +https://ciphermaniac.com)',
  Accept: 'application/json'
};

export interface PokedataPage {
  totalItems: number;
  totalPages: number;
  currentPage: number;
  events: unknown[];
}

export interface PokedataPull {
  events: unknown[];
  totalItems: number;
  totalPages: number;
}

export interface PokedataOptions {
  fetch?: typeof globalThis.fetch;
  /** Pause between page requests, to be a polite client. */
  delayMs?: number;
  /** Attempts per page, including the first. */
  attempts?: number;
  sleep?: (ms: number) => Promise<unknown>;
  log?: (message: string) => void;
  /** Clock for the locals horizon. */
  now?: () => Date;
  /** How far ahead locals are pulled, in days. See {@link LOCALS_HORIZON_DAYS}. */
  horizonDays?: number;
}

/**
 * Pokedata lists locals about three months out, a thousand a day, and every
 * page takes the server a few seconds. Locals are weekly, so three weeks is
 * enough to see a store's pattern (two dates a fortnight apart included) and
 * is a tenth of the feed. The table is sorted by date, so the pull stops at
 * the first page past the horizon.
 */
export const LOCALS_HORIZON_DAYS = 21;
export const LOCAL_PAGE_SIZE = 100;
/** Safety net only; the horizon is what ends a pull. */
const LOCAL_PAGE_LIMIT = 600;
const LOCAL_QUERY = {
  past: '',
  country: '',
  city: '',
  shop: '',
  league: '',
  states: '[]',
  postcode: '',
  cups: '',
  challenges: '',
  vcups: '',
  vchallenges: '',
  prereleases: '',
  premier: '',
  go: '',
  gocup: '',
  mss: '',
  ftcg: '1',
  fvg: '',
  fgo: '',
  latitude: '',
  longitude: '',
  radius: '',
  unit: 'km',
  width: 1200
};

async function fetchLocalPageOnce(page: number, fetchImpl: typeof globalThis.fetch): Promise<unknown[]> {
  const response = await fetchImpl(POKEDATA_TABLE_API, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...LOCAL_QUERY, page })
  });
  if (!response.ok) {
    throw new Error(`local page ${page}: HTTP ${response.status}`);
  }
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    /* described below */
  }
  throw new Error(`local page ${page}: unexpected response shape`);
}

const dateOf = (event: unknown) => {
  const date = (event as { date?: unknown })?.date;
  return typeof date === 'string' ? date : null;
};

/** The page's records inside the horizon, and whether the page reaches past it. */
function trimToHorizon(page: unknown[], cutoff: string): { kept: unknown[]; done: boolean } {
  const last = dateOf(page.at(-1));
  return {
    kept: page.filter(event => (dateOf(event) ?? '') <= cutoff),
    done: page.length < LOCAL_PAGE_SIZE || (last !== null && last > cutoff)
  };
}

/**
 * Stopping at the horizon is only right while the table stays sorted by
 * date, which the query cannot ask for. A page that starts before the last
 * one ended is a re-ordered feed, and the pull fails rather than publishing
 * a fraction of the stores.
 */
function assertSorted(page: unknown[], previousLast: string | null, pageNumber: number): string | null {
  const first = dateOf(page[0]);
  if (first !== null && previousLast !== null && first < previousLast) {
    throw new Error(
      `Pokedata locals are not sorted by date: page ${pageNumber} starts ${first}, after ${previousLast}`
    );
  }
  return dateOf(page.at(-1)) ?? previousLast;
}

/** `YYYY-MM-DD` of the last day inside the horizon, in UTC. */
export function localsCutoff(now: Date, horizonDays: number): string {
  return new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Every local dated within the horizon.
 *
 * The table is sorted by date, so a page whose last record is past the
 * horizon is the last page needed; anything on it past the horizon is dropped.
 * @throws {Error} When a page fails, or the feed outruns the safety limit
 */
export async function fetchLocalEvents(options: PokedataOptions = {}): Promise<unknown[]> {
  const { fetch: fetchImpl = globalThis.fetch, delayMs = 250, sleep = sleepFor, log = () => undefined } = options;
  const cutoff = localsCutoff((options.now ?? (() => new Date()))(), options.horizonDays ?? LOCALS_HORIZON_DAYS);
  const events: unknown[] = [];
  let previousLast: string | null = null;
  for (let page = 0; page < LOCAL_PAGE_LIMIT; page++) {
    if (page > 0) {
      await sleep(delayMs);
    }
    const rows = await withAttempts(`local page ${page}`, () => fetchLocalPageOnce(page, fetchImpl), options);
    previousLast = assertSorted(rows, previousLast, page);
    const { kept, done } = trimToHorizon(rows, cutoff);
    events.push(...kept);
    if (done) {
      log(`fetched ${page + 1} local pages through ${cutoff}`);
      return events;
    }
    if ((page + 1) % 20 === 0) {
      log(`fetched ${page + 1} local pages`);
    }
  }
  throw new Error(`Pokedata locals exceeded the ${LOCAL_PAGE_LIMIT}-page safety limit`);
}

export function pageUrl(page: number): string {
  return `${POKEDATA_API}${QUERY}/_page/${page}`;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Parse one page body, rejecting anything that is not the documented shape.
 * @throws {Error} On non-JSON (the PHP error page) or a missing field
 */
export function parsePage(body: string): PokedataPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`not JSON: ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  const root = parsed as { metadata?: Record<string, unknown>; events?: unknown };
  const meta = root?.metadata;
  if (!meta || !isCount(meta.total_items) || !isCount(meta.total_pages) || !Array.isArray(root.events)) {
    throw new Error('unexpected response shape');
  }
  return {
    totalItems: meta.total_items,
    totalPages: meta.total_pages,
    currentPage: isCount(meta.current_page) ? meta.current_page : 0,
    events: root.events
  };
}

/** One request for one page, validated. Throws on anything but the page asked for. */
async function fetchOnce(page: number, fetchImpl: typeof globalThis.fetch): Promise<PokedataPage> {
  const response = await fetchImpl(pageUrl(page), { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed = parsePage(await response.text());
  // A broken query can answer every page with page 1.
  if (parsed.currentPage !== page) {
    throw new Error(`asked for page ${page}, got page ${parsed.currentPage}`);
  }
  return parsed;
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Retried with backoff on network failures, 429, 5xx, and bad bodies. */
async function withAttempts<T>(what: string, once: () => Promise<T>, options: PokedataOptions): Promise<T> {
  const { attempts = 4, sleep = sleepFor, log = () => undefined } = options;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await once();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        log(`${what} attempt ${attempt} failed: ${describeError(error)}`);
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`Pokedata ${what} failed after ${attempts} attempts: ${describeError(lastError)}`);
}

/** One page, retried. */
export async function fetchPage(page: number, options: PokedataOptions = {}): Promise<PokedataPage> {
  const { fetch: fetchImpl = globalThis.fetch } = options;
  return withAttempts(`page ${page}`, () => fetchOnce(page, fetchImpl), options);
}

/**
 * Every Cup, Challenge, and Prerelease Pokedata lists.
 * @throws {Error} When a page fails for good, or the pull comes back incomplete
 */
export async function fetchAllEvents(options: PokedataOptions = {}): Promise<PokedataPull> {
  const { delayMs = 250, sleep = sleepFor, log = () => undefined } = options;
  const first = await fetchPage(1, options);
  const events = [...first.events];
  for (let page = 2; page <= first.totalPages; page++) {
    await sleep(delayMs);
    const next = await fetchPage(page, options);
    if (next.totalPages !== first.totalPages) {
      throw new Error(`Pokedata's page count moved from ${first.totalPages} to ${next.totalPages} mid-pull`);
    }
    events.push(...next.events);
    if (page % 20 === 0) {
      log(`fetched ${page}/${first.totalPages} pages`);
    }
  }
  // Distinct IDs, not records: repeated pages must not count toward completeness.
  const distinct = new Set(events.map(event => (event as { Display_id?: unknown })?.Display_id)).size;
  if (distinct < first.totalItems * MIN_COMPLETE_SHARE) {
    throw new Error(`Pokedata returned ${distinct} distinct of the ${first.totalItems} events it advertised`);
  }
  return { events, totalItems: first.totalItems, totalPages: first.totalPages };
}
