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

import { preloadCardImage, preloadImage } from '../../components/CardImage';
import type { PossibleHit } from '../../../shared/packEv/simulate';
import { artNumber, productImage } from './model';

/** Parallel fetches: enough to finish quickly without crowding out the page's own requests. */
const CONCURRENCY = 4;

/** Cards already warmed or in flight this session, by product id. */
const warmed = new Set<number>();

/** Whether the visitor has asked browsers to save data. */
function savingData(): boolean {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
  return connection?.saveData === true;
}

/** The same URL a hit tile requests: TCGplayer's photo for a reprint, else hotlinked `sm` art. */
function warmCard(set: string, hit: PossibleHit): Promise<void> {
  return hit.card.reprint
    ? preloadImage(productImage(hit.card.id))
    : preloadCardImage(set, artNumber(hit.card.number), 'sm', { hotlink: true });
}

/**
 * Warm `hits`, in order, a few at a time.
 * @returns Stops the queue; fetches already in flight still finish.
 */
export function warmHits(set: string, hits: PossibleHit[]): () => void {
  let stopped = false;
  const queue = savingData() ? [] : hits.filter(hit => !warmed.has(hit.card.id));
  const pump = (): Promise<void> => {
    const hit = queue.shift();
    if (stopped || !hit) {
      return Promise.resolve();
    }
    warmed.add(hit.card.id);
    return warmCard(set, hit).then(pump);
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
