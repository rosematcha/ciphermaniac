/**
 * Japanese City League results, read off Limitless's HTML pages.
 *
 * Limitless has no API for City Leagues, so this reads `/tournaments/jp` for
 * the window's events, each event's page for its top 16, and each placing's
 * decklist. Event pages and decklists never change once posted, so both are
 * cached in R2 under `sources/city-leagues/` and never fetched twice; a daily
 * run fetches the listing and whatever is new.
 *
 * Window: Limitless posts results as the official ones appear, days late, so
 * the newest days are always under-filled. The window ends `settleDays` before
 * `now` and reaches `windowDays` back from there.
 * @module .github/scripts/lib/cityLeagues
 */
import type { CardTypesDatabase } from '../../../../shared/data/cardTypesDatabase.js';
import { runWithConcurrency } from '../../../../shared/onlineMeta/tournamentFetcher';
import type { GatheredDeck, OnlineTournamentSummary } from '../../../../shared/onlineMeta/types';
import { buildDeck, toTournamentSummary } from './decks';
import { parseDecklistPage, parseEventPage, parseListingPage } from './parse';
import { EVENT_PREFIX, LIST_PREFIX, PRINT_MAP_KEY } from './keys';
import { emptyPrintMap, LIMITLESS_ORIGIN, refreshPrintMap } from './prints';
import type { CityLeagueEvent, CityLeagueList, CityLeagueStore, JpPrintMap, ListingRow, PrintRef } from './types';

export type { CityLeagueStore } from './types';
export { createPoliteFetcher } from './fetch';

const DAY_MS = 86_400_000;
const LISTING_PAGE_SIZE = 100;
const MAX_LISTING_PAGES = 20;
const READ_CONCURRENCY = 8;
const FAILURE_RATIO = 0.25;
const FAILURE_ALLOWANCE = 2;

export interface GatherCityLeaguesOptions {
  store: CityLeagueStore;
  /** GET a page and return its body. Use `createPoliteFetcher().fetchText` outside tests. */
  fetchText(url: string): Promise<string>;
  now: Date;
  /** Days in the window. Default 14. */
  windowDays?: number;
  /** Newest days left out while Limitless catches up. Default 7. */
  settleDays?: number;
  /** Optional card types, as the online producer uses them. */
  cardTypesDb?: CardTypesDatabase | null;
  /** Days before an unreleased Japanese print's card page is read again. Default 7. */
  printRecheckDays?: number;
}

export interface CityLeagueWindow {
  /** First day in the window, `YYYY-MM-DD`. */
  start: string;
  /** First day after the window, `YYYY-MM-DD`. */
  end: string;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The days a run covers.
 * @param now - Run time
 * @param windowDays - Days in the window
 * @param settleDays - Newest days skipped
 * @returns Start (inclusive) and end (exclusive) days
 */
export function cityLeagueWindow(now: Date, windowDays: number, settleDays: number): CityLeagueWindow {
  const today = Date.parse(isoDay(now.getTime()));
  const end = today - settleDays * DAY_MS;
  return { start: isoDay(end - windowDays * DAY_MS), end: isoDay(end) };
}

type FetchText = (url: string) => Promise<string>;

/** The listing is newest first, so it is read until a page reaches past the window's start. */
async function listEventsInWindow(fetchText: FetchText, window: CityLeagueWindow): Promise<ListingRow[]> {
  const rows = new Map<string, ListingRow>();
  for (let page = 1; page <= MAX_LISTING_PAGES; page += 1) {
    const parsed = parseListingPage(
      await fetchText(`${LIMITLESS_ORIGIN}/tournaments/jp?show=${LISTING_PAGE_SIZE}&page=${page}`)
    );
    for (const row of parsed.rows) {
      if (row.date >= window.start && row.date < window.end) {
        rows.set(row.id, row);
      }
    }
    const oldest = parsed.rows.at(-1)?.date;
    if (!oldest || oldest < window.start || page >= parsed.maxPage) {
      break;
    }
  }
  return [...rows.values()];
}

async function fetchEvent(row: ListingRow, fetchText: FetchText): Promise<CityLeagueEvent> {
  const page = parseEventPage(await fetchText(`${LIMITLESS_ORIGIN}/tournaments/jp/${row.id}`));
  return { ...row, ...page };
}

async function fetchList(id: string, fetchText: FetchText): Promise<CityLeagueList> {
  return parseDecklistPage(await fetchText(`${LIMITLESS_ORIGIN}/decks/list/jp/${id}`), id);
}

interface LoadStats {
  cached: number;
  fetched: number;
  failed: string[];
}

/**
 * Read every id from the cache, then fetch the misses one at a time and cache
 * the ones worth keeping. Reads run in parallel; fetches never do.
 */
async function loadCached<I, T>(
  items: I[],
  options: {
    store: CityLeagueStore;
    prefix: string;
    idOf: (item: I) => string;
    fetch: (item: I) => Promise<T>;
    keep: (value: T) => boolean;
  }
): Promise<{ values: Map<string, T>; stats: LoadStats }> {
  const { store, prefix, idOf } = options;
  const values = new Map<string, T>();
  const stats: LoadStats = { cached: 0, fetched: 0, failed: [] };
  const cached = await runWithConcurrency(items, READ_CONCURRENCY, item =>
    store.read<T>(`${prefix}${idOf(item)}.json`)
  );
  const misses = items.filter((item, index) => {
    const value = cached[index];
    if (value) {
      values.set(idOf(item), value);
    }
    return !value;
  });
  stats.cached = values.size;
  for (const item of misses) {
    const id = idOf(item);
    try {
      const value = await options.fetch(item);
      values.set(id, value);
      stats.fetched += 1;
      if (options.keep(value)) {
        await store.write(`${prefix}${id}.json`, value);
      }
    } catch (error) {
      console.warn(`[city-leagues] ${prefix}${id}: ${String(error)}`);
      stats.failed.push(id);
    }
  }
  return { values, stats };
}

function listIdsOf(events: CityLeagueEvent[]): string[] {
  const ids = events.flatMap(event => event.placings.map(placing => placing.listId));
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function jpPrintsOf(lists: Iterable<CityLeagueList>): PrintRef[] {
  return [...lists].flatMap(list => list.cards.filter(card => card.jp).map(({ set, number }) => ({ set, number })));
}

/** An event is published whole or not at all: one missing list would skew its share of the window. */
function isComplete(event: CityLeagueEvent, lists: Map<string, CityLeagueList>): boolean {
  return event.placings.length > 0 && event.placings.every(placing => !placing.listId || lists.has(placing.listId));
}

/** Abort rather than publish a window built from an arbitrary subset of its events. */
function enforceFailureBudget(failed: number, attempted: number): void {
  const budget = Math.max(FAILURE_ALLOWANCE, Math.ceil(attempted * FAILURE_RATIO));
  if (failed > budget) {
    throw new Error(`City League fetch failed for ${failed}/${attempted} events (budget ${budget}); not publishing.`);
  }
}

async function decksOf(
  events: CityLeagueEvent[],
  lists: Map<string, CityLeagueList>,
  printMap: JpPrintMap,
  cardTypesDb: CardTypesDatabase | null
): Promise<GatheredDeck[]> {
  const decks = events.flatMap(event =>
    event.placings.map(placing =>
      buildDeck({
        event,
        placing,
        list: placing.listId ? (lists.get(placing.listId) ?? null) : null,
        printMap,
        cardTypesDb
      })
    )
  );
  return Promise.all(decks);
}

async function loadPrintMap(store: CityLeagueStore): Promise<JpPrintMap> {
  const stored = await store.read<JpPrintMap>(PRINT_MAP_KEY);
  return stored?.schemaVersion === 1 ? stored : emptyPrintMap();
}

/**
 * Gather the window's City League events and decks.
 * @param options - Store, fetcher, clock and window
 * @returns Tournaments newest first, and their decks in finishing order
 */
export async function gatherCityLeagues(
  options: GatherCityLeaguesOptions
): Promise<{ tournaments: OnlineTournamentSummary[]; decks: GatheredDeck[] }> {
  const { store, fetchText } = options;
  const window = cityLeagueWindow(options.now, options.windowDays ?? 14, options.settleDays ?? 7);
  const rows = await listEventsInWindow(fetchText, window);

  const loadedEvents = await loadCached(rows, {
    store,
    prefix: EVENT_PREFIX,
    idOf: row => row.id,
    fetch: row => fetchEvent(row, fetchText),
    keep: event => event.placings.length > 0
  });
  const events = [...loadedEvents.values.values()];
  const loadedLists = await loadCached(listIdsOf(events), {
    store,
    prefix: LIST_PREFIX,
    idOf: id => id,
    fetch: id => fetchList(id, fetchText),
    keep: list => list.cards.length > 0
  });

  const printMap = await loadPrintMap(store);
  const prints = await refreshPrintMap({
    map: printMap,
    prints: jpPrintsOf(loadedLists.values.values()),
    fetchText,
    today: isoDay(options.now.getTime()),
    recheckDays: options.printRecheckDays ?? 7
  });
  if (prints.checked) {
    await store.write(PRINT_MAP_KEY, printMap);
  }

  const complete = events
    .filter(event => isComplete(event, loadedLists.values))
    .sort((first, second) => second.date.localeCompare(first.date) || Number(second.id) - Number(first.id));
  enforceFailureBudget(rows.length - complete.length, rows.length);

  console.log(
    `[city-leagues] ${window.start}..${window.end}: ${complete.length}/${rows.length} events ` +
      `(${loadedEvents.stats.fetched} fetched), ${loadedLists.stats.fetched} lists fetched, ` +
      `${prints.checked} prints checked, ${prints.flipped} with an English print`
  );
  return {
    tournaments: complete.map(toTournamentSummary),
    decks: await decksOf(complete, loadedLists.values, printMap, options.cardTypesDb ?? null)
  };
}
