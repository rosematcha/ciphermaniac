import { computeLayout, syncControlsWidth } from '../../layoutHelper.js';
import { CONFIG } from '../../config.js';
import { perf } from '../../utils/performance.js';
import { escapeHtml } from '../../utils/html.js';
import { saveGridScroll } from '../../utils/scrollRestore.js';
import type { CardItem } from '../../types/index.js';
import type { RenderOptions } from '../types.js';
import { hideGridTooltip, showGridTooltip } from '../cardElement.js';
import { MOBILE_MAX_WIDTH, NUM_LARGE_ROWS, NUM_MEDIUM_ROWS } from '../constants.js';
import { getCardIdentityKey, getRowScale, type RowScaleMetrics } from './utils.js';
import { getGridElement } from './elements.js';
import {
  buildCardRenderHash,
  createCardHistogram,
  makeCardElement,
  populateCardContent,
  setupCardAttributes,
  setupCardCounts
} from '../cards/gridCards.js';
import { preloadVisibleImagesParallel } from '../images/preloader.js';
import { attachGridKeyboardNavigation } from '../navigation/keyboard.js';
import { expandGridRows } from './expandRows.js';
import { observeLoadMore } from './autoLoad.js';

function setupCardNavigationDelegation(grid: HTMLElement & { _cardDelegationAttached?: boolean }): void {
  const hostGrid = grid;
  if (hostGrid._cardDelegationAttached) {
    return;
  }
  hostGrid._cardDelegationAttached = true;

  hostGrid.addEventListener('click', event => {
    const target = event.target as Element | null;
    const card = target?.closest('.card') as HTMLElement | null;
    if (!card || !hostGrid.contains(card)) {
      return;
    }
    const url = card.dataset.cardUrl;
    if (!url) {
      return;
    }
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
      window.open(url, '_blank');
      return;
    }
    saveGridScroll();
    location.assign(url);
  });

  hostGrid.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const target = event.target as Element | null;
    const card = target?.closest('.card') as HTMLElement | null;
    if (!card || !hostGrid.contains(card)) {
      return;
    }
    const url = card.dataset.cardUrl;
    if (!url) {
      return;
    }
    event.preventDefault();
    saveGridScroll();
    location.assign(url);
  });
}

/**
 * Render the grid for the provided card items.
 * @param items - Card items to render.
 * @param overrides - Image override map.
 * @param options - Rendering options.
 */
export function render(items: CardItem[], overrides: Record<string, string> = {}, options: RenderOptions = {}): void {
  perf.start('render');
  perf.start('render:setup');
  const grid = getGridElement();
  if (!grid) {
    perf.end('render:setup');
    perf.end('render');
    return;
  }

  if (!grid._cardRegistry) {
    grid._cardRegistry = new Map<string, HTMLElement>();
  }
  const existingCardsMap = grid._cardRegistry;
  const previousCardIds = new Set(existingCardsMap.keys());
  const activeCardKeys = new Set<string>();

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
    existingCardsMap.clear();
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

  const rowScaleMetrics: RowScaleMetrics = {
    largeRows: largeRowsLimit,
    mediumRows: mediumRowsLimit,
    useSmallRows,
    forceCompact,
    perRowBig,
    targetMedium,
    targetSmall,
    mediumScale,
    smallScale
  };

  const makeCard = (it: CardItem, useSm: boolean): HTMLElement => {
    const key = getCardIdentityKey(it);

    let cardEl: HTMLElement;
    const nextHash = buildCardRenderHash(it, { showPrice });
    if (key && existingCardsMap.has(key)) {
      cardEl = existingCardsMap.get(key)!;
      if (cardEl.dataset.renderHash !== nextHash) {
        populateCardContent(cardEl, it, { showPrice });
        setupCardCounts(cardEl, it);
        createCardHistogram(cardEl, it);
        cardEl.dataset.renderHash = nextHash;
      }
      setupCardAttributes(cardEl, it);
      cardEl.classList.remove('card-entering');
      cardEl.dataset.reused = 'true';
    } else {
      cardEl = makeCardElement(it, useSm, overrides, { showPrice }, previousCardIds);
      cardEl.dataset.reused = 'false';
      if (key) {
        existingCardsMap.set(key, cardEl);
      }
    }

    if (key) {
      activeCardKeys.add(key);
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

  perf.start('render:create-cards');
  const newRowsFragment = document.createDocumentFragment();
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

    const { scale, maxCount } = getRowScale(rowIndex, rowScaleMetrics);

    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', `${base}px`);
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';

    const existingRowCards = isExistingRow ? (Array.from(row.querySelectorAll('.card')) as HTMLElement[]) : [];
    const count = Math.min(maxCount, items.length - i);

    const cardsForRow: HTMLElement[] = [];
    const tempI = i;
    for (let j = 0; j < count && tempI + j < items.length; j++) {
      const useSm = scale !== smallScale;
      const cardEl = makeCard(items[tempI + j], useSm);
      cardEl.dataset.row = String(rowIndex);
      cardEl.dataset.col = String(j);
      // First row images are likely LCP — prioritize them
      if (rowIndex === 0) {
        const img = cardEl.querySelector('img');
        if (img) {
          img.fetchPriority = 'high';
        }
      }
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
      newRowsFragment.appendChild(row);
    }

    rowIndex++;
  }
  // Batch-insert all new rows in a single DOM operation
  if (newRowsFragment.childNodes.length > 0) {
    if (existingMoreWrap && existingMoreWrap.parentNode === grid) {
      grid.insertBefore(newRowsFragment, existingMoreWrap);
    } else {
      grid.appendChild(newRowsFragment);
    }
  }
  perf.end('render:create-cards');

  perf.start('render:cleanup');
  for (let r = rowIndex; r < existingRows.length; r++) {
    existingRows[r].remove();
  }
  for (const [key, element] of Array.from(existingCardsMap.entries())) {
    if (!activeCardKeys.has(key) || !element.isConnected) {
      existingCardsMap.delete(key);
    }
  }
  perf.end('render:cleanup');

  perf.start('render:preload-images');
  if (items.length > 0) {
    requestAnimationFrame(() => {
      preloadVisibleImagesParallel(items, overrides);
    });
  }
  perf.end('render:preload-images');

  // Closed-form row estimate: O(1) instead of O(n) item iteration
  const estimateTotalRows = (() => {
    if (items.length === 0) {
      return 0;
    }
    if (forceCompact) {
      return Math.ceil(items.length / targetSmall);
    }

    const bigCapacity = largeRowsLimit * perRowBig;
    const medCapacity = mediumRowsLimit * targetMedium;
    const tailTarget = useSmallRows ? targetSmall : targetMedium;

    if (items.length <= bigCapacity) {
      return Math.ceil(items.length / perRowBig);
    }
    if (items.length <= bigCapacity + medCapacity) {
      return largeRowsLimit + Math.ceil((items.length - bigCapacity) / targetMedium);
    }
    return largeRowsLimit + mediumRowsLimit + Math.ceil((items.length - bigCapacity - medCapacity) / tailTarget);
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
    observeLoadMore(moreWrap);
  } else {
    if (existingMoreWrap) {
      existingMoreWrap.remove();
    }
    grid._moreWrapRef = null;
    observeLoadMore(null);
  }

  setupCardNavigationDelegation(grid);
  attachGridKeyboardNavigation(grid);
  setupHistogramDelegation(grid);
  perf.end('render');
}

/** Setup event delegation for histogram tooltips (runs once per grid) */
function setupHistogramDelegation(grid: HTMLElement & { _histDelegation?: boolean }): void {
  const hostGrid = grid;
  if (hostGrid._histDelegation) {
    return;
  }
  hostGrid._histDelegation = true;

  const showTip = (e: Event) => {
    const col = (e.target as Element).closest('.hist .col') as HTMLElement | null;
    if (!col?.dataset.tip) {
      return;
    }
    const { cardName = '', tip } = col.dataset;
    const html = cardName ? `<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>` : escapeHtml(tip);
    const { clientX: x, clientY: y } = e as MouseEvent;
    showGridTooltip(html, x, y);
  };

  hostGrid.addEventListener('mousemove', showTip, { passive: true });
  hostGrid.addEventListener(
    'focusin',
    e => {
      const col = (e.target as Element).closest('.hist .col') as HTMLElement | null;
      if (!col?.dataset.tip) {
        return;
      }
      const rect = col.getBoundingClientRect();
      const { cardName = '', tip } = col.dataset;
      const html = cardName ? `<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>` : escapeHtml(tip);
      showGridTooltip(html, rect.left + rect.width / 2, rect.top);
    },
    { passive: true }
  );
  hostGrid.addEventListener(
    'mouseleave',
    e => {
      if ((e.target as Element).closest('.hist .col')) {
        hideGridTooltip();
      }
    },
    { passive: true, capture: true }
  );
  hostGrid.addEventListener(
    'focusout',
    e => {
      if ((e.target as Element).closest('.hist .col')) {
        hideGridTooltip();
      }
    },
    { passive: true }
  );
}
