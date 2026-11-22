/**
 * Start a cold load's route data at boot. Pages create their fetches only once their lazy chunk
 * has downloaded and the scope list has loaded, so on a phone the data used to start 1.6-2.1 s
 * after navigation. These are the same readers with the same arguments the page calls, and the
 * data client shares one request per URL, so the page picks up the requests already in flight.
 * A wrong guess costs one download, never a wrong render.
 * @module src/lib/bootPreload
 */

import { ONLINE_META_NAME } from './constants';
import { fetchCardUsage } from './data/cards';
import { fetchArchetype, fetchArchetypes } from './data/archetypes';
import { fetchPriceHistoryForSet, fetchPrices, fetchPricesFor, fetchPrintPrices } from './data/prices';
import { fetchPlayerIndexSlim, fetchPlayerTop } from './data/players';
import { fetchMaster } from './data/reports';
import { fetchOnlineTrendReport } from './data/trends';
import { getSynonymDatabase } from '../utils/cardSynonyms';

/**
 * The scope the page will open on, when it is known before the scope list loads: the online meta,
 * unless the URL names a scope (`scope`, or the legacy `tour`) or the visitor last picked another.
 * A guess at the wrong scope could 404, and a 404 on release data spends the tab's one recovery
 * reload.
 */
function knownScope(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.has('scope') || params.has('tour')) {
    return null;
  }
  try {
    const stored = localStorage.getItem('cm:tournament');
    return !stored || stored === ONLINE_META_NAME ? ONLINE_META_NAME : null;
  } catch {
    return ONLINE_META_NAME;
  }
}

function cardPage(set: string, scope: string | null): Array<Promise<unknown>> {
  const shared = [getSynonymDatabase(), fetchPrices(), fetchPrintPrices(), fetchPriceHistoryForSet(set.toUpperCase())];
  return scope ? [...shared, fetchMaster(scope), fetchArchetypes(scope), fetchCardUsage(scope)] : shared;
}

function archetypePage(slug: string, scope: string | null): Array<Promise<unknown>> {
  if (!scope) {
    return [getSynonymDatabase()];
  }
  // The page asks the price cut for its own cards; the file is the same whatever it asks for.
  return [
    getSynonymDatabase(),
    fetchArchetype(scope, slug),
    fetchArchetypes(scope),
    fetchOnlineTrendReport(),
    fetchPricesFor(scope, [])
  ];
}

function routeFetches(pathname: string, search: string): Array<Promise<unknown>> {
  const scope = knownScope(search);
  const [, section, first, second, extra] = pathname.split('/').map(decodeURIComponent);
  if (section === 'cards' && first && second && extra === undefined) {
    return cardPage(first, scope);
  }
  if (section === 'players' && first === undefined) {
    return [fetchPlayerTop(), fetchPlayerIndexSlim()];
  }
  return section === 'archetypes' && first && second === undefined ? archetypePage(first, scope) : [];
}

/** The fetches a cold load of `pathname` will make first, started now. */
export function preloadRoute(pathname: string, search: string): void {
  let started: Array<Promise<unknown>> = [];
  try {
    started = routeFetches(pathname, search);
  } catch {
    // A malformed path is the page's to report; it must never stop the app from booting.
  }
  // The page reports its own failures when it reads the same requests.
  for (const promise of started) {
    promise.catch(() => {});
  }
}
