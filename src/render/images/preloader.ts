import { buildThumbCandidates } from '../../thumbs.js';
import { normalizeCardNumber } from '../../card/routing.js';
import { parallelImageLoader } from '../../utils/parallelImageLoader.js';
import { perf } from '../../utils/performance.js';
import type { CardItem } from '../../types/index.js';
import { getGridElement } from '../grid/elements.js';

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
        buildThumbCandidates(cardData.name, true, overrides, {
          set: cardData.set,
          number: cardData.number
        }),
        buildThumbCandidates(cardData.name, false, overrides, {
          set: cardData.set,
          number: cardData.number
        })
      );
    }
  });

  if (candidatesList.length > 0) {
    parallelImageLoader.preloadImages(candidatesList, 6);
  }
}

export function setupImagePreloading(
  items: CardItem[],
  overrides: Record<string, string> = {},
  useSm = false
): void {
  perf.start('preloadImages');
  if (!items || !items.length) {
    return;
  }

  const candidatesList: string[][] = [];
  items.forEach(item => {
    const variant = item.set && item.number ? { set: item.set, number: item.number } : undefined;
    candidatesList.push(buildThumbCandidates(item.name, useSm, overrides, variant));
  });

  const maxParallel = Math.min(6, items.length);
  parallelImageLoader.preloadImages(candidatesList, maxParallel);
  perf.end('preloadImages');
}
