/**
 * Warming hit art before a rip lands it.
 *
 * A tile pops in the moment a rip lands, and art that is still downloading
 * pops in as an empty frame — worst on a chase, which springs twice. Every hit
 * a set can produce is known up front, so the opener fetches their art once it
 * scrolls into view and each tile paints from cache. Bulk is left cold: it
 * sits in a closed drawer and nobody is watching it arrive.
 * @module src/pages/packEv/warm
 */

import { preloadImage } from '../../components/cardImage/loading';
import { buildAttempts } from '../../components/cardImage/sources';
import type { PossibleHit } from '../../../shared/packEv/simulate';
import { artNumber, productImage } from './model';

/** Parallel fetches: enough to finish quickly without crowding out the page's own requests. */
const CONCURRENCY = 4;

/** Art already warmed or in flight this session, by the URL the tile requests. */
const warmed = new Set<string>();

/** The same URL a hit tile requests: TCGplayer's photo for a reprint, else hotlinked `sm` art. */
function artUrl(set: string, hit: PossibleHit): string | undefined {
  return hit.card.reprint
    ? productImage(hit.card.id)
    : buildAttempts(set, artNumber(hit.card.number), 'sm', 'hotlink')[0];
}

/**
 * Warm `hits`, in order, a few at a time.
 * @returns Stops the queue; fetches already in flight still finish.
 */
export function warmHits(set: string, hits: PossibleHit[]): () => void {
  let stopped = false;
  const saveData =
    typeof window === 'undefined' ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const queue = saveData ? [] : hits.map(hit => artUrl(set, hit));
  let next = 0;
  const pump = (): Promise<void> => {
    if (stopped) {
      return Promise.resolve();
    }
    while (next < queue.length) {
      const url = queue[next++];
      if (url && !warmed.has(url)) {
        warmed.add(url);
        return preloadImage(url).then(pump);
      }
    }
    return Promise.resolve();
  };
  for (let worker = 0; worker < CONCURRENCY; worker += 1) {
    void pump();
  }
  return () => {
    stopped = true;
  };
}

/**
 * Run `callback` once `element` scrolls into view. No margin: the opener sits
 * about a screen and a half down, so any lead would warm on load for readers
 * who stop at the EV table, and 60 hits warm in about half a second on a good
 * connection.
 */
export function whenShown(element: Element, callback: () => void): () => void {
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      callback();
    }
  });
  observer.observe(element);
  return () => observer.disconnect();
}
