import { buildThumbCandidates } from '../../thumbs.js';
import { normalizeCardNumber } from '../../../shared/cardUtils';
import { parallelImageLoader } from '../../utils/parallelImageLoader.js';
import type { CardItem } from '../../types/index.js';
import { getGridElement } from '../grid/elements.js';
import { MOBILE_MAX_WIDTH } from '../constants.js';

export const MOBILE_EAGER_PRELOAD_COUNT = 4;
export const DESKTOP_EAGER_PRELOAD_COUNT = 8;

export function getEagerPreloadLimitForViewport(width: number): number {
  return width <= MOBILE_MAX_WIDTH ? MOBILE_EAGER_PRELOAD_COUNT : DESKTOP_EAGER_PRELOAD_COUNT;
}

export function shouldUseSmPreloadVariantForViewport(width: number): boolean {
  return width > MOBILE_MAX_WIDTH;
}

function scheduleIdlePreload(task: () => void): void {
  if (typeof window === 'undefined') {
    task();
    return;
  }

  const winWithIdle = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  };

  if (typeof winWithIdle.requestIdleCallback === 'function') {
    winWithIdle.requestIdleCallback(() => task(), { timeout: 400 });
    return;
  }

  setTimeout(task, 120);
}

/**
 * Preload visible card images in parallel.
 * @param items - Card items to preload.
 * @param overrides - Image override map.
 */
export function preloadVisibleImagesParallel(items: CardItem[], overrides: Record<string, string> = {}): void {
  const grid = getGridElement();
  if (!grid || !Array.isArray(items)) {
    return;
  }

  const itemsByUid = new Map<string, CardItem>();
  const itemsBySetNumber = new Map<string, CardItem>();
  const itemsByName = new Map<string, CardItem>();

  for (const item of items) {
    if (item.uid) {
      itemsByUid.set(String(item.uid).toLowerCase(), item);
    }
    if (item.set && item.number) {
      const key = `${String(item.set).toUpperCase()}~${normalizeCardNumber(item.number)}`;
      itemsBySetNumber.set(key, item);
    }
    if (item.name) {
      itemsByName.set(String(item.name).toLowerCase(), item);
    }
  }

  const visibleCards = Array.from(grid.querySelectorAll('.card'));
  const candidatesList: string[][] = [];
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : MOBILE_MAX_WIDTH + 1;
  const eagerLimit = getEagerPreloadLimitForViewport(viewportWidth);
  const useSm = shouldUseSmPreloadVariantForViewport(viewportWidth);

  visibleCards.forEach((cardEl: Element) => {
    const htmlCard = cardEl as HTMLElement;
    const { uid, cardId } = htmlCard.dataset;
    let cardData: CardItem | null = null;

    if (uid) {
      cardData = itemsByUid.get(uid.toLowerCase()) ?? null;
    }

    if (!cardData && cardId) {
      cardData = itemsBySetNumber.get(cardId) ?? null;
    }

    if (!cardData) {
      const baseNameSpan = htmlCard.querySelector('.name span');
      const baseName = baseNameSpan?.textContent || '';
      if (baseName) {
        cardData = itemsByName.get(baseName.toLowerCase()) ?? null;
      }
    }

    if (cardData) {
      candidatesList.push(
        buildThumbCandidates(cardData.name, useSm, overrides, {
          set: cardData.set,
          number: cardData.number
        })
      );
    }
  });

  if (candidatesList.length > 0) {
    const batchId = parallelImageLoader.startPreloadBatch();
    const eagerCandidates = candidatesList.slice(0, eagerLimit);
    const deferredCandidates = candidatesList.slice(eagerLimit);
    const eagerConcurrency = Math.min(4, Math.max(1, eagerCandidates.length));

    parallelImageLoader.preloadImages(eagerCandidates, eagerConcurrency, batchId);

    if (deferredCandidates.length > 0) {
      scheduleIdlePreload(() => {
        parallelImageLoader.preloadImages(deferredCandidates, 4, batchId);
      });
    }
  }
}
