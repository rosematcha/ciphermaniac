import { computeLayout, syncControlsWidth } from '../../layoutHelper.js';
import { CONFIG } from '../../config.js';
import { perf } from '../../utils/performance.js';
import { normalizeCardNumber } from '../../card/routing.js';
import type { CardItem } from '../../types/index.js';
import type { RenderOptions } from '../types.js';
import { MOBILE_MAX_WIDTH, NUM_LARGE_ROWS, NUM_MEDIUM_ROWS } from '../constants.js';
import { getGridElement } from './elements.js';
import {
  createCardHistogram,
  makeCardElement,
  populateCardContent,
  setupCardAttributes,
  setupCardCounts
} from '../cards/gridCards.js';
import { preloadVisibleImagesParallel } from '../images/preloader.js';
import { attachGridKeyboardNavigation } from '../navigation/keyboard.js';
import { expandGridRows } from './expandRows.js';

export function render(items: CardItem[], overrides: Record<string, string> = {}, options: RenderOptions = {}): void {
  perf.start('render');
  perf.start('render:setup');
  const grid = getGridElement();
  if (!grid) {
    perf.end('render:setup');
    perf.end('render');
    return;
  }

  const previousCardIds = new Set<string>();
  const existingCardsMap = new Map<string, HTMLElement>();
  const existingCards = grid.querySelectorAll('.card');
  existingCards.forEach((card: Element) => {
    const htmlCard = card as HTMLElement;
    const { uid, cardId, name } = htmlCard.dataset;
    if (uid) {
      previousCardIds.add(uid);
    }
    if (cardId) {
      previousCardIds.add(cardId);
    }
    if (name) {
      previousCardIds.add(name);
    }
    const key = uid || cardId || name;
    if (key) {
      existingCardsMap.set(key, htmlCard);
    }
  });

  const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;
  const requestedLayout = options?.layoutMode === 'compact' ? 'compact' : 'standard';
  const layoutMode = requestedLayout;
  const showPrice = Boolean(options?.showPrice);
  const settings: RenderOptions = {
    layoutMode,
    showPrice
  };
  const forceCompact = prefersCompact || settings.layoutMode === 'compact';
  grid._renderOptions = settings;
  grid._autoCompact = prefersCompact;

  perf.end('render:setup');

  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<h2>Dead draw.</h2><p>No results for this search, try another!</p>`;
    grid.replaceChildren(empty);
    perf.end('render');
    return;
  }

  const prevEmpty = grid.querySelector('.empty-state');
  if (prevEmpty) {
    prevEmpty.remove();
  }

  perf.start('render:layout');
  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  const layout = computeLayout(containerWidth);
  const { base, perRowBig, bigRowContentWidth, targetMedium, mediumScale, targetSmall, smallScale } = layout;
  syncControlsWidth(bigRowContentWidth);
  perf.end('render:layout');

  const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);

  const largeRowsLimit = forceCompact ? 0 : NUM_LARGE_ROWS;
  const mediumRowsLimit = forceCompact ? 0 : NUM_MEDIUM_ROWS;

  const makeCard = (it: CardItem, useSm: boolean): HTMLElement => {
    const { uid } = it;
    const setCode = it.set ? String(it.set).toUpperCase() : '';
    const number = it.number ? normalizeCardNumber(it.number) : '';
    const cardId = setCode && number ? `${setCode}~${number}` : null;
    const name = it.name ? it.name.toLowerCase() : null;
    const key = uid || cardId || name;

    let cardEl: HTMLElement;
    if (key && existingCardsMap.has(key)) {
      cardEl = existingCardsMap.get(key)!;
      populateCardContent(cardEl, it, { showPrice });
      setupCardCounts(cardEl, it);
      createCardHistogram(cardEl, it);
      setupCardAttributes(cardEl, it);
      cardEl.classList.remove('card-entering');
      cardEl.dataset.reused = 'true';
    } else {
      cardEl = makeCardElement(it, useSm, overrides, { showPrice }, previousCardIds);
      cardEl.dataset.reused = 'false';
    }

    return cardEl;
  };

  const existingRows = Array.from(grid.querySelectorAll('.row')) as HTMLElement[];
  const existingMoreWrap = grid.querySelector('.more-rows') as HTMLElement | null;

  let i = 0;
  let rowIndex = 0;
  if (!Number.isInteger(grid._visibleRows)) {
    grid._visibleRows = CONFIG.UI.INITIAL_VISIBLE_ROWS;
  }
  const visibleRowsLimit = grid._visibleRows || CONFIG.UI.INITIAL_VISIBLE_ROWS;

  const rowsToKeep: HTMLElement[] = [];

  perf.start('render:create-cards');
  while (i < items.length && rowIndex < visibleRowsLimit) {
    let row: HTMLElement;
    const isExistingRow = rowIndex < existingRows.length;
    if (isExistingRow) {
      row = existingRows[rowIndex];
    } else {
      row = document.createElement('div');
      row.className = 'row';
    }
    row.dataset.rowIndex = String(rowIndex);

    const isLarge = !forceCompact && rowIndex < largeRowsLimit;
    const isMedium = !forceCompact && !isLarge && rowIndex < largeRowsLimit + mediumRowsLimit;
    const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);

    let scale;
    let maxCount;
    if (forceCompact) {
      scale = smallScale;
      maxCount = targetSmall;
    } else if (isLarge) {
      scale = 1;
      maxCount = perRowBig;
    } else if (isMedium) {
      scale = mediumScale;
      maxCount = targetMedium;
    } else if (isSmall) {
      scale = smallScale;
      maxCount = targetSmall;
    } else {
      scale = mediumScale;
      maxCount = targetMedium;
    }

    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', `${base}px`);
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';

    const existingRowCards = isExistingRow ? (Array.from(row.querySelectorAll('.card')) as HTMLElement[]) : [];
    const count = Math.min(maxCount, items.length - i);

    const cardsForRow: HTMLElement[] = [];
    const tempI = i;
    for (let j = 0; j < count && tempI + j < items.length; j++) {
      const useSm = isLarge || isMedium || !isSmall;
      const cardEl = makeCard(items[tempI + j], useSm);
      cardEl.dataset.row = String(rowIndex);
      cardEl.dataset.col = String(j);
      cardsForRow.push(cardEl);
    }

    const canUpdateInPlace =
      cardsForRow.length === existingRowCards.length &&
      cardsForRow.every((card, idx) => existingRowCards[idx] === card);

    if (!canUpdateInPlace) {
      row.replaceChildren(...cardsForRow);
    }

    i += count;

    if (!isExistingRow) {
      if (existingMoreWrap && existingMoreWrap.parentNode === grid) {
        grid.insertBefore(row, existingMoreWrap);
      } else {
        grid.appendChild(row);
      }
    }

    rowsToKeep.push(row);
    rowIndex++;
  }
  perf.end('render:create-cards');

  perf.start('render:cleanup');
  for (let r = rowIndex; r < existingRows.length; r++) {
    existingRows[r].remove();
  }
  perf.end('render:cleanup');

  perf.start('render:preload-images');
  if (items.length > 0) {
    requestAnimationFrame(() => {
      preloadVisibleImagesParallel(items, overrides);
    });
  }
  perf.end('render:preload-images');

  const estimateTotalRows = (() => {
    let cnt = 0;
    let idx = 0;
    while (idx < items.length) {
      const rowIdx = cnt;
      const isLargeLocal = !forceCompact && rowIdx < largeRowsLimit;
      const isMediumLocal = !forceCompact && !isLargeLocal && rowIdx < largeRowsLimit + mediumRowsLimit;
      const isSmallLocal = forceCompact || (!isLargeLocal && !isMediumLocal && useSmallRows);

      let maxCount;
      if (forceCompact) {
        maxCount = targetSmall;
      } else if (isLargeLocal) {
        maxCount = perRowBig;
      } else if (isMediumLocal) {
        maxCount = targetMedium;
      } else if (isSmallLocal) {
        maxCount = targetSmall;
      } else {
        maxCount = targetMedium;
      }

      idx += maxCount;
      cnt++;
    }
    return cnt;
  })();

  grid._totalRows = estimateTotalRows;
  grid._totalCards = items.length;
  grid._layoutMetrics = {
    base,
    perRowBig,
    bigRowContentWidth,
    targetMedium,
    mediumScale,
    targetSmall,
    smallScale,
    bigRows: largeRowsLimit,
    mediumRows: mediumRowsLimit,
    useSmallRows,
    forceCompact
  };

  if (rowIndex < estimateTotalRows) {
    const moreWrap = document.createElement('div');
    moreWrap.className = 'more-rows';
    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn';
    moreBtn.type = 'button';

    const remainingRows = estimateTotalRows - rowIndex;
    const nextBatchSize = Math.min(CONFIG.UI.ROWS_PER_LOAD, remainingRows);

    moreBtn.textContent =
      remainingRows <= CONFIG.UI.ROWS_PER_LOAD
        ? `Load ${remainingRows} more row${remainingRows === 1 ? '' : 's'}...`
        : `Load more (${nextBatchSize} of ${remainingRows} rows)...`;
    moreBtn.setAttribute('aria-label', `Load ${nextBatchSize} more rows. ${remainingRows} rows remaining.`);

    moreBtn.addEventListener('click', () => {
      const targetRows = Math.min(rowIndex + CONFIG.UI.ROWS_PER_LOAD, estimateTotalRows);

      const originalText = moreBtn.textContent;
      moreBtn.textContent = 'Loading...';
      moreBtn.disabled = true;
      moreBtn.style.opacity = '0.6';

      requestAnimationFrame(() => {
        expandGridRows(items, overrides, targetRows, settings);

        requestAnimationFrame(() => {
          if (moreBtn.isConnected) {
            moreBtn.textContent = originalText;
            moreBtn.disabled = false;
            moreBtn.style.opacity = '';
          }
        });
      });
    });
    moreWrap.appendChild(moreBtn);

    if (existingMoreWrap) {
      existingMoreWrap.replaceWith(moreWrap);
    } else {
      grid.appendChild(moreWrap);
    }
    grid._moreWrapRef = moreWrap;
  } else {
    if (existingMoreWrap) {
      existingMoreWrap.remove();
    }
    grid._moreWrapRef = null;
  }

  attachGridKeyboardNavigation(grid);
  perf.end('render');
}
