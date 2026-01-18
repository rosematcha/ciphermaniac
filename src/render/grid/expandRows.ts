import { computeLayout } from '../../layoutHelper.js';
import { CONFIG } from '../../config.js';
import { MOBILE_MAX_WIDTH, NUM_LARGE_ROWS, NUM_MEDIUM_ROWS } from '../constants.js';
import { getGridElement } from './elements.js';
import type { CardItem } from '../../types/index.js';
import type { RenderOptions } from '../types.js';
import { makeCardElement } from '../cards/gridCards.js';
import { renderSummary } from '../summary/summary.js';

/**
 * Expand the grid with additional rows.
 * @param items - Card items to render.
 * @param overrides - Image override map.
 * @param targetTotalRows - Target total row count.
 * @param options - Rendering options.
 */
export function expandGridRows(
  items: CardItem[],
  overrides: Record<string, string>,
  targetTotalRows: number,
  options: RenderOptions = {}
): void {
  const grid = getGridElement();
  if (!grid || !Array.isArray(items)) {
    return;
  }

  const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;
  const previousOptions = grid._renderOptions ?? {};
  const fallbackMode = previousOptions.layoutMode === 'compact' ? 'compact' : 'standard';
  const requestedLayout = options?.layoutMode === 'compact' ? 'compact' : fallbackMode;
  const layoutMode = requestedLayout;
  const showPrice = Boolean(options?.showPrice ?? previousOptions.showPrice);
  const forceCompact = prefersCompact || layoutMode === 'compact';
  grid._renderOptions = {
    layoutMode,
    showPrice
  };
  grid._autoCompact = prefersCompact;

  const previousCardIds = new Set<string>();
  const existingCardEls = grid.querySelectorAll('.card');
  existingCardEls.forEach((card: Element) => {
    const htmlCard = card as HTMLElement;
    const { uid } = htmlCard.dataset;
    const { cardId } = htmlCard.dataset;
    const { name } = htmlCard.dataset;
    if (uid) {
      previousCardIds.add(uid);
    }
    if (cardId) {
      previousCardIds.add(cardId);
    }
    if (name) {
      previousCardIds.add(name);
    }
  });

  const { scrollY } = window;

  const moreWrap = grid.querySelector('.more-rows');
  if (moreWrap) {
    moreWrap.remove();
  }

  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  const layout = computeLayout(containerWidth);
  const { base, perRowBig, bigRowContentWidth, targetMedium, mediumScale, targetSmall, smallScale } = layout;

  const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);

  const largeRowsLimit = forceCompact ? 0 : NUM_LARGE_ROWS;
  const mediumRowsLimit = forceCompact ? 0 : NUM_MEDIUM_ROWS;

  const existingCards = grid.querySelectorAll('.card').length;
  const existingRows = grid.querySelectorAll('.row').length;

  let cardIndex = existingCards;
  let rowIndex = existingRows;
  const frag = document.createDocumentFragment();

  while (cardIndex < items.length && rowIndex < targetTotalRows) {
    const row = document.createElement('div');
    row.className = 'row';
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

    const count = Math.min(maxCount, items.length - cardIndex);
    for (let j = 0; j < count && cardIndex < items.length; j++, cardIndex++) {
      const item = items[cardIndex];
      const useSm = isLarge || isMedium || !isSmall;
      const cardEl = makeCardElement(item, useSm, overrides, { showPrice }, previousCardIds);
      cardEl.dataset.row = String(rowIndex);
      cardEl.dataset.col = String(j);
      row.appendChild(cardEl);
    }
    frag.appendChild(row);
    rowIndex++;
  }

  grid.appendChild(frag);

  grid._visibleRows = targetTotalRows;
  const totalAvailableRows = grid._totalRows || 0;
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

  const currentRowCount = grid.querySelectorAll('.row').length;
  const remainingRows = totalAvailableRows - currentRowCount;

  const summaryEl = document.getElementById('summary');
  if (summaryEl && grid._totalCards) {
    const currentText = summaryEl.textContent || '';
    const deckMatch = currentText.match(/(\d+)\s+decklists/);
    const deckTotal = deckMatch ? Number(deckMatch[1]) : 0;
    renderSummary(summaryEl, deckTotal, grid._totalCards, currentRowCount, totalAvailableRows);
  }

  if (remainingRows > 0) {
    const newMoreWrap = document.createElement('div');
    newMoreWrap.className = 'more-rows';
    const newMoreBtn = document.createElement('button');
    newMoreBtn.className = 'btn';
    newMoreBtn.type = 'button';

    const nextBatchSize = Math.min(CONFIG.UI.ROWS_PER_LOAD, remainingRows);
    newMoreBtn.textContent =
      remainingRows <= CONFIG.UI.ROWS_PER_LOAD
        ? `Load ${remainingRows} more row${remainingRows === 1 ? '' : 's'}...`
        : `Load more (${nextBatchSize} of ${remainingRows} rows)...`;
    newMoreBtn.setAttribute('aria-label', `Load ${nextBatchSize} more rows. ${remainingRows} rows remaining.`);

    newMoreBtn.addEventListener('click', () => {
      const targetRows = Math.min(currentRowCount + CONFIG.UI.ROWS_PER_LOAD, totalAvailableRows);

      const originalText = newMoreBtn.textContent;
      newMoreBtn.textContent = 'Loading...';
      newMoreBtn.disabled = true;
      newMoreBtn.style.opacity = '0.6';

      requestAnimationFrame(() => {
        expandGridRows(items, overrides, targetRows, { layoutMode, showPrice });

        requestAnimationFrame(() => {
          if (newMoreBtn.isConnected) {
            newMoreBtn.textContent = originalText;
            newMoreBtn.disabled = false;
            newMoreBtn.style.opacity = '';
          }
        });
      });
    });

    newMoreWrap.appendChild(newMoreBtn);
    grid.appendChild(newMoreWrap);
    grid._moreWrapRef = newMoreWrap;
  } else {
    grid._moreWrapRef = null;
  }

  requestAnimationFrame(() => {
    if (window.scrollY !== scrollY) {
      window.scrollTo(0, scrollY);
    }
  });
}
