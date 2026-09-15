/**
 * Event locator data: the index, the grid cells around a search, and the
 * place list behind instant search.
 *
 * These are live listings, not part of a data release. The locator gets its
 * own client with an identity path resolver: a release-aware build would
 * otherwise try to rewrite `/events/…` onto a release root and throw, since
 * no release carries event listings. Deduplication and the short cache are
 * the same as every other read.
 * @module src/lib/data/eventLocator
 */

import { createDataClient } from './client';
import { expandLocals } from '../../../shared/events/locals';
import {
  LOCALS_INDEX_KEY,
  type LocalsCell,
  localsCellPath,
  type LocalsIndex,
  LOCATOR_INDEX_KEY,
  type LocatorCell,
  locatorCellPath,
  type LocatorEvent,
  type LocatorIndex,
  type LocatorPlaces,
  locatorPlacesPath
} from '../../../shared/events/types';

const client = createDataClient({ resolvePath: path => path });

function assertVersion(payload: { version?: unknown } | null, what: string): void {
  if (!payload || payload.version !== 1) {
    throw new Error(`Unexpected ${what} format`);
  }
}

export async function fetchLocatorIndex(): Promise<LocatorIndex> {
  const index = await client.fetchJson<LocatorIndex>(`/${LOCATOR_INDEX_KEY}`);
  assertVersion(index, 'event index');
  return index;
}

export async function fetchLocatorPlaces(index: LocatorIndex): Promise<LocatorPlaces> {
  const places = await client.fetchJson<LocatorPlaces>(`/${locatorPlacesPath(index.generation)}`);
  assertVersion(places, 'place list');
  return places;
}

/**
 * Every listed event in the given cells. Cells the index does not list are
 * never requested. A listed cell that is missing is an error, not an empty
 * area: it means the index is stale, and the page offers a retry rather than
 * reporting that nothing is nearby.
 */
export async function fetchLocatorEvents(index: LocatorIndex, cells: readonly string[]): Promise<LocatorEvent[]> {
  const wanted = cells.filter(key => index.cells[key]);
  const loaded = await Promise.all(
    wanted.map(key => client.fetchJson<LocatorCell>(`/${locatorCellPath(index.generation, key)}`))
  );
  return loaded.flatMap(cell => (cell && cell.version === 1 ? cell.events : []));
}

/** The locals index, or null when none has been published. */
export async function fetchLocalsIndex(): Promise<LocalsIndex | null> {
  const index = await client.fetchJsonOptional<LocalsIndex>(`/${LOCALS_INDEX_KEY}`);
  if (index) {
    assertVersion(index, 'locals index');
  }
  return index;
}

/**
 * Every local in the given cells from today through the index's horizon,
 * expanded from the stores' weekly slots. Locals cells sit at stable paths
 * and are deleted when a cell empties, so a cell the index still lists but
 * that is gone is an empty area, not an error.
 */
export async function fetchLocalEvents(
  index: LocalsIndex,
  cells: readonly string[],
  today: string
): Promise<LocatorEvent[]> {
  const wanted = cells.filter(key => index.cells[key]);
  const loaded = await Promise.all(wanted.map(key => client.fetchJsonOptional<LocalsCell>(`/${localsCellPath(key)}`)));
  const present = loaded.filter((cell): cell is LocalsCell => Boolean(cell && cell.version === 1));
  return expandLocals(present, today, index.horizonDays);
}
