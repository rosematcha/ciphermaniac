// Number of rows to render as 'large' rows in grid view. Edit this value to change how many rows are 'large'.
export const NUM_LARGE_ROWS = 1;
// Number of rows to render as 'medium' rows (after large rows)
export const NUM_MEDIUM_ROWS = 1;
const MOBILE_MAX_WIDTH = 880;

// Safari detection for performance tuning - Safari's ResizeObserver needs longer throttle
const IS_SAFARI = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// Safari needs longer throttle (150ms) due to slower layout recalculation
const RESIZE_THROTTLE_MS = IS_SAFARI ? 150 : 50;
import { buildThumbCandidates } from './thumbs.js';
import { computeLayout, syncControlsWidth } from './layoutHelper.js';
import { trackMissing } from './dev/missingThumbs.js';
import { buildCardPath, normalizeCardNumber } from './card/routing.js';
import { parallelImageLoader } from './utils/parallelImageLoader.js';
import { createElement, setStyles } from './utils/dom.js';
import { CONFIG } from './config.js';
import { perf } from './utils/performance.js';
import { escapeHtml } from './utils/html.js';
import { getGridTooltip } from './utils/tooltip.js';
import type { CardItem } from './types/index.js';

// Re-export types from render/types.ts for backwards compatibility
export type { LayoutMode, RenderOptions, CachedLayoutMetrics, GridElement } from './render/types.js';
import type { GridElement, RenderOptions } from './render/types.js';

// Import formatCardPrice from cardElement module
import { formatCardPrice } from './render/cardElement.js';

// Note: Card element creation functions are also available from './render/cardElement.js'
// for reuse in other modules. The local versions below are kept for backwards compatibility.

// Throttle helper for resize handling - limits execution frequency
function throttle<T extends (...args: Parameters<T>) => void>(fn: T, wait: number): T {
  let lastCall = 0;
  let scheduledCall: ReturnType<typeof setTimeout> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (scheduledCall) {
      clearTimeout(scheduledCall);
      scheduledCall = null;
    }

    if (timeSinceLastCall >= wait) {
      lastCall = now;
      fn(...args);
    } else {
      // Schedule a trailing call to ensure final state is captured
      scheduledCall = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
        scheduledCall = null;
      }, wait - timeSinceLastCall);
    }
  }) as T;
}

// Cached throttled updateLayout for ResizeObserver
let throttledUpdateLayout: (() => void) | null = null;

/**
 * Initialize ResizeObserver for the grid element to handle container-based resizing.
 * This is more reliable than window resize for detecting actual grid width changes.
 */
export function initGridResizeObserver(): void {
  const grid = getGridElement();
  if (!grid || grid._resizeObserver) {
    return;
  }

  if (!throttledUpdateLayout) {
    throttledUpdateLayout = throttle(() => {
      updateLayout();
    }, RESIZE_THROTTLE_MS);
  }

  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      const newWidth = entry.contentRect.width;
      const lastWidth = grid._lastContainerWidth ?? 0;

      // Only update if width changed significantly (> 1px to avoid float precision issues)
      if (Math.abs(newWidth - lastWidth) > 1) {
        grid._lastContainerWidth = newWidth;
        throttledUpdateLayout!();
      }
    }
  });

  observer.observe(grid);
  grid._resizeObserver = observer;
}

/**
 * Cleanup the ResizeObserver when the grid is removed
 */
export function cleanupGridResizeObserver(): void {
  const grid = getGridElement();
  if (grid?._resizeObserver) {
    grid._resizeObserver.disconnect();
    grid._resizeObserver = null;
  }
}

/**
 * @returns {GridElement | null}
 */
function getGridElement(): GridElement | null {
  return document.getElementById('grid') as GridElement | null;
}

// Use shared tooltip manager for grid histograms
const gridTooltip = getGridTooltip();
function showGridTooltip(html: string, x: number, y: number) {
  gridTooltip.show(html, x, y);
}
function hideGridTooltip() {
  gridTooltip.hide();
}

/**
 * Render summary information including deck count, card count, and row visibility
 * @param container - Summary container element
 * @param deckTotal - Total number of decks
 * @param count - Total number of cards
 * @param visibleRows - Number of currently visible rows (optional)
 * @param totalRows - Total number of rows available (optional)
 */
export function renderSummary(
  container: HTMLElement | null,
  deckTotal: number,
  count: number,
  visibleRows: number | null = null,
  totalRows: number | null = null
) {
  if (!container) {
    return;
  } // Handle case where summary element doesn't exist
  const parts: string[] = [];
  if (deckTotal) {
    parts.push(`${deckTotal} decklists`);
  }
  parts.push(`${count} cards`);

  // Add row count if provided and there are more rows to show
  if (
    visibleRows !== null &&
    totalRows !== null &&
    Number.isFinite(visibleRows) &&
    Number.isFinite(totalRows) &&
    totalRows > visibleRows
  ) {
    parts.push(`showing ${visibleRows} of ${totalRows} rows`);
  }

  container.textContent = parts.join(' • ');
}

/**
 * Update the summary with current grid row visibility state
 * @param deckTotal - Total number of decks
 * @param cardCount - Total number of cards
 */
export function updateSummaryWithRowCounts(deckTotal: number, cardCount: number) {
  const grid = getGridElement();
  const summaryEl = document.getElementById('summary');

  if (!grid || !summaryEl) {
    return;
  }

  const currentVisibleRows = grid.querySelectorAll('.row').length;
  const totalRows = grid._totalRows || currentVisibleRows;

  renderSummary(summaryEl, deckTotal, cardCount, currentVisibleRows, totalRows);
}

/**
 * Render card items to the grid
 * @param items - Array of card items to render
 * @param overrides - Thumbnail override mappings
 * @param options - Render options
 */
export function render(items: CardItem[], overrides: Record<string, string> = {}, options: RenderOptions = {}) {
  perf.start('render');
  perf.start('render:setup');
  const grid = getGridElement();
  if (!grid) {
    perf.end('render:setup');
    perf.end('render');
    return;
  }

  // Track which cards were visible before this render AND capture for DOM reuse
  // Combined into single pass for efficiency
  const previousCardIds = new Set<string>();
  const existingCardsMap = new Map<string, HTMLElement>();
  const existingCards = grid.querySelectorAll('.card');
  existingCards.forEach((card: Element) => {
    const htmlCard = card as HTMLElement;
    const { uid, cardId, name } = htmlCard.dataset;
    // Add to previousCardIds for animation tracking
    if (uid) {
      previousCardIds.add(uid);
    }
    if (cardId) {
      previousCardIds.add(cardId);
    }
    if (name) {
      previousCardIds.add(name);
    }
    // Add to existingCardsMap for DOM reuse
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

  // Empty state for no results - use replaceChildren for atomic update
  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<h2>Dead draw.</h2><p>No results for this search, try another!</p>`;
    grid.replaceChildren(empty);
    perf.end('render');
    return;
  }

  // If we previously showed an empty state, remove it now that we have items.
  const prevEmpty = grid.querySelector('.empty-state');
  if (prevEmpty) {
    prevEmpty.remove();
  }

  perf.start('render:layout');
  // Compute per-row layout and sync controls width using helper
  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  const layout = computeLayout(containerWidth);
  const { base, perRowBig, bigRowContentWidth, targetMedium, mediumScale, targetSmall, smallScale } = layout;
  syncControlsWidth(bigRowContentWidth);
  perf.end('render:layout');

  const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);

  const largeRowsLimit = forceCompact ? 0 : NUM_LARGE_ROWS;
  const mediumRowsLimit = forceCompact ? 0 : NUM_MEDIUM_ROWS;

  // Use the shared card creation function
  const makeCard = (it: CardItem, useSm: boolean): HTMLElement => {
    // Try to reuse existing element
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
      // Remove entering class if present
      cardEl.classList.remove('card-entering');
      // Mark as reused so we know not to re-parent it unnecessarily
      // Note: _reused is a transient property used only within render() to track DOM reuse
      cardEl.dataset.reused = 'true';
    } else {
      cardEl = makeCardElement(it, useSm, overrides, { showPrice }, previousCardIds);
      cardEl.dataset.reused = 'false';
    }

    return cardEl;
  };

  // ===== IN-PLACE DOM UPDATE STRATEGY =====
  // Instead of replaceChildren (which causes flash), we update the DOM in place:
  // 1. Reuse existing rows, update their cards
  // 2. Add new rows only if needed
  // 3. Remove excess rows at the end

  const existingRows = Array.from(grid.querySelectorAll('.row')) as HTMLElement[];
  const existingMoreWrap = grid.querySelector('.more-rows') as HTMLElement | null;

  let i = 0;
  let rowIndex = 0;
  // visible rows limit (rows, not cards). Default to initial value from config; clicking More loads incremental rows
  if (!Number.isInteger(grid._visibleRows)) {
    grid._visibleRows = CONFIG.UI.INITIAL_VISIBLE_ROWS;
  }
  const visibleRowsLimit = grid._visibleRows || CONFIG.UI.INITIAL_VISIBLE_ROWS;

  // Track cards that will be in the new layout
  const newLayoutCards = new Set<HTMLElement>();

  // Build rows - reuse existing or create new
  const rowsToKeep: HTMLElement[] = [];

  perf.start('render:create-cards');
  while (i < items.length && rowIndex < visibleRowsLimit) {
    // Reuse existing row if available, otherwise create new
    let row: HTMLElement;
    const isExistingRow = rowIndex < existingRows.length;
    if (isExistingRow) {
      row = existingRows[rowIndex];
    } else {
      row = document.createElement('div');
      row.className = 'row';
    }
    row.dataset.rowIndex = String(rowIndex);

    // Determine row type: large (0), medium (1), or small (2+)
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
      // If small rows aren't used, continue with medium sizing
      scale = mediumScale;
      maxCount = targetMedium;
    }

    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', `${base}px`);
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';

    // Get current cards in this row
    const existingRowCards = isExistingRow ? (Array.from(row.querySelectorAll('.card')) as HTMLElement[]) : [];

    const count = Math.min(maxCount, items.length - i);

    // First pass: collect all cards we need for this row
    const cardsForRow: HTMLElement[] = [];
    const tempI = i; // Save i for card collection
    for (let j = 0; j < count && tempI + j < items.length; j++) {
      const useSm = isLarge || isMedium || !isSmall;
      const cardEl = makeCard(items[tempI + j], useSm);
      cardEl.dataset.row = String(rowIndex);
      cardEl.dataset.col = String(j);
      newLayoutCards.add(cardEl);
      cardsForRow.push(cardEl);
    }

    // Update row: clear and repopulate if cards changed, otherwise update in place
    // Check if we can do a simple in-place update (same cards in same order)
    const canUpdateInPlace =
      cardsForRow.length === existingRowCards.length &&
      cardsForRow.every((card, idx) => existingRowCards[idx] === card);

    if (!canUpdateInPlace) {
      // Cards changed - rebuild row content
      // Use replaceChildren for atomic update of this row only
      row.replaceChildren(...cardsForRow);
    }
    // If canUpdateInPlace, cards are already correct, no DOM changes needed

    // Advance i by the number of cards we processed
    i += count;

    // Add row to grid if it's new
    if (!isExistingRow) {
      // Insert before the "more" button if it exists, otherwise append
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
  // Remove excess rows (those beyond what we need)
  for (let r = rowIndex; r < existingRows.length; r++) {
    existingRows[r].remove();
  }
  perf.end('render:cleanup');

  perf.start('render:preload-images');
  // Set up image preloading for better performance
  // setupImagePreloading(items, overrides); // Disabled - using parallelImageLoader instead

  // Additionally, preload visible images in parallel batches for even faster loading
  // Use moderate concurrency to balance performance with browser resources
  if (items.length > 0) {
    requestAnimationFrame(() => {
      preloadVisibleImagesParallel(items, overrides);
    });
  }
  perf.end('render:preload-images');

  // If there are remaining rows not rendered, show a More control
  // Determine total rows that would be generated for all items
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
  // Persist totals so resize handler can decide whether to show More after reflow
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

    // Calculate how many more rows are available
    const remainingRows = estimateTotalRows - rowIndex;
    const nextBatchSize = Math.min(CONFIG.UI.ROWS_PER_LOAD, remainingRows);

    // Update button text to show how many more will load
    moreBtn.textContent =
      remainingRows <= CONFIG.UI.ROWS_PER_LOAD
        ? `Load ${remainingRows} more row${remainingRows === 1 ? '' : 's'}...`
        : `Load more (${nextBatchSize} of ${remainingRows} rows)...`;
    moreBtn.setAttribute('aria-label', `Load ${nextBatchSize} more rows. ${remainingRows} rows remaining.`);

    moreBtn.addEventListener('click', () => {
      // Load the next batch of rows incrementally
      const targetRows = Math.min(rowIndex + CONFIG.UI.ROWS_PER_LOAD, estimateTotalRows);

      // Add loading state
      const originalText = moreBtn.textContent;
      moreBtn.textContent = 'Loading...';
      moreBtn.disabled = true;
      moreBtn.style.opacity = '0.6';

      // Use requestAnimationFrame to ensure DOM updates before heavy work
      requestAnimationFrame(() => {
        expandGridRows(items, overrides, targetRows, settings);

        // Restore button state (if it still exists - it might be removed if all rows loaded)
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

    // Add or update the more button in-place
    if (existingMoreWrap) {
      existingMoreWrap.replaceWith(moreWrap);
    } else {
      grid.appendChild(moreWrap);
    }
    // Keep a reference so updateLayout can re-attach after rebuilds
    grid._moreWrapRef = moreWrap;
  } else {
    // No more button needed, remove it if it exists
    if (existingMoreWrap) {
      existingMoreWrap.remove();
    }
    grid._moreWrapRef = null;
  }

  // Note: No replaceChildren needed - DOM was updated in-place above

  // Keyboard navigation: arrow keys move focus across cards by row/column
  if (!grid._kbNavAttached) {
    grid.addEventListener('keydown', event => {
      const active = document.activeElement;

      // Check for 'Load more' shortcut (M key) when not focused on an input
      if (event.key === 'm' || event.key === 'M') {
        const activeTag = active?.tagName?.toLowerCase();
        const isInputFocused = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

        if (!isInputFocused) {
          const moreBtn = grid.querySelector('.more-rows .btn') as HTMLButtonElement | null;
          if (moreBtn && !moreBtn.disabled) {
            event.preventDefault();
            moreBtn.click();
            // Briefly highlight the button to provide feedback
            moreBtn.style.outline = '2px solid var(--primary, #4a9eff)';
            moreBtn.style.outlineOffset = '2px';
            setTimeout(() => {
              moreBtn.style.outline = '';
              moreBtn.style.outlineOffset = '';
            }, 200);
            return;
          }
        }
      }

      if (!active || !active.classList || !active.classList.contains('card')) {
        return;
      }
      const activeEl = active as HTMLElement;
      const rowEl = activeEl.closest('.row') as HTMLElement;
      const rowIdx = Number(activeEl.dataset.row ?? rowEl?.dataset.rowIndex ?? 0);
      const colIdx = Number(activeEl.dataset.col ?? 0);
      const move = (dr: number, dc: number) => {
        const rowsEls = Array.from(grid.querySelectorAll('.row'));
        const targetRowIndex = Math.max(0, Math.min(rowsEls.length - 1, rowIdx + dr));
        const targetRow = rowsEls[targetRowIndex];
        if (!targetRow) {
          return;
        }
        const cards = Array.from(targetRow.querySelectorAll('.card'));
        const targetColIndex = Math.max(0, Math.min(cards.length - 1, colIdx + dc));
        const next = cards[targetColIndex] as HTMLElement | undefined;
        next?.focus();
      };
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          move(0, +1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          move(0, -1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          move(+1, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          move(-1, 0);
          break;
        default:
      }
    });
    grid._kbNavAttached = true;
  }
  perf.end('render');
}

// Expand grid by adding remaining rows without touching existing cards
function expandGridRows(
  items: CardItem[],
  overrides: Record<string, string>,
  targetTotalRows: number,
  options: RenderOptions = {}
) {
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

  // Track which cards were visible before expanding
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

  // Preserve scroll position during DOM manipulation
  const { scrollY } = window;

  // Remove the More button
  const moreWrap = grid.querySelector('.more-rows');
  if (moreWrap) {
    moreWrap.remove();
  }

  // Get current layout metrics
  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  const layout = computeLayout(containerWidth);
  const { base, perRowBig, bigRowContentWidth, targetMedium, mediumScale, targetSmall, smallScale } = layout;

  const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);

  const largeRowsLimit = forceCompact ? 0 : NUM_LARGE_ROWS;
  const mediumRowsLimit = forceCompact ? 0 : NUM_MEDIUM_ROWS;

  // Count existing cards and determine where to start adding new ones
  const existingCards = grid.querySelectorAll('.card').length;
  const existingRows = grid.querySelectorAll('.row').length;

  // Create remaining rows
  let cardIndex = existingCards;
  let rowIndex = existingRows;
  const frag = document.createDocumentFragment();

  while (cardIndex < items.length && rowIndex < targetTotalRows) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);

    // Determine row type: large (0), medium (1), or small (2+)
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
      // If small rows aren't used, continue with medium sizing
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

  // Add new rows to grid
  grid.appendChild(frag);

  // Update grid metadata
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

  // Update or remove the "More..." button based on remaining rows
  const currentRowCount = grid.querySelectorAll('.row').length;
  const remainingRows = totalAvailableRows - currentRowCount;

  // Update summary with new row counts
  const summaryEl = document.getElementById('summary');
  if (summaryEl && grid._totalCards) {
    // Try to get deck total from summary's current text or use a fallback
    const currentText = summaryEl.textContent || '';
    const deckMatch = currentText.match(/(\d+)\s+decklists/);
    const deckTotal = deckMatch ? Number(deckMatch[1]) : 0;
    renderSummary(summaryEl, deckTotal, grid._totalCards, currentRowCount, totalAvailableRows);
  }

  if (remainingRows > 0) {
    // There are more rows to load - update or create the button
    let moreWrap = grid.querySelector('.more-rows') as HTMLElement | null;
    if (!moreWrap) {
      moreWrap = document.createElement('div');
      moreWrap.className = 'more-rows';
      grid.appendChild(moreWrap);
      grid._moreWrapRef = moreWrap;
    }

    let moreBtn = moreWrap.querySelector('.btn') as HTMLButtonElement | null;
    if (!moreBtn) {
      moreBtn = document.createElement('button');
      moreBtn.className = 'btn';
      moreBtn.type = 'button';
      moreWrap.appendChild(moreBtn);
    }

    // Update button text with remaining count
    const nextBatchSize = Math.min(CONFIG.UI.ROWS_PER_LOAD, remainingRows);
    moreBtn.textContent =
      remainingRows <= CONFIG.UI.ROWS_PER_LOAD
        ? `Load ${remainingRows} more row${remainingRows === 1 ? '' : 's'}...`
        : `Load more (${nextBatchSize} of ${remainingRows} rows)...`;
    moreBtn.setAttribute('aria-label', `Load ${nextBatchSize} more rows. ${remainingRows} rows remaining.`);

    // Remove old event listeners by cloning the button
    const newBtn = moreBtn.cloneNode(true) as HTMLButtonElement;
    if (moreBtn.parentNode) {
      moreBtn.parentNode.replaceChild(newBtn, moreBtn);
    }

    // Add new event listener for the next batch
    newBtn.addEventListener('click', () => {
      const nextTargetRows = Math.min(currentRowCount + CONFIG.UI.ROWS_PER_LOAD, totalAvailableRows);
      expandGridRows(items, overrides, nextTargetRows, options);
    });
  } else {
    // No more rows to load - remove the button
    const moreWrap = grid.querySelector('.more-rows');
    if (moreWrap) {
      moreWrap.remove();
      grid._moreWrapRef = null;
    }
  }

  // Set up image preloading for new cards only
  const newItems = items.slice(existingCards);
  // setupImagePreloading(newItems, overrides); // Disabled - using parallelImageLoader instead

  // Additionally preload new images in parallel for better performance
  // Use lower concurrency to avoid overwhelming the browser
  if (newItems.length > 0) {
    requestAnimationFrame(() => {
      const newCandidatesList = newItems.flatMap(item => {
        const variant = { set: item.set, number: item.number };
        return [
          buildThumbCandidates(item.name, true, overrides, variant),
          buildThumbCandidates(item.name, false, overrides, variant)
        ];
      });
      parallelImageLoader.preloadImages(newCandidatesList, 4);
    });
  }

  // Restore scroll position after DOM manipulation
  requestAnimationFrame(() => {
    if (window.scrollY !== scrollY) {
      window.scrollTo(0, scrollY);
    }
  });
}

function setupCardImage(
  img: HTMLImageElement | null,
  cardName: string,
  useSm: boolean,
  overrides: Record<string, string>,
  cardData: CardItem
) {
  if (!img) {
    return;
  }

  // Remove any skeleton classes and elements from the thumb container
  const thumbContainer = img.closest('.thumb');
  if (thumbContainer) {
    // Remove skeleton image if it exists
    const skeletonImg = thumbContainer.querySelector('.skeleton-img');
    if (skeletonImg) {
      skeletonImg.remove();
    }
    // Remove skeleton-loading class
    thumbContainer.classList.remove('skeleton-loading');
  }

  // Only pass variant info if cardData exists and has both set and number
  const variant =
    cardData && cardData.set && cardData.number ? { set: cardData.set, number: cardData.number } : undefined;

  const candidates = buildThumbCandidates(cardName, useSm, overrides, variant);

  // Use parallel image loader for better performance
  parallelImageLoader.setupImageElement(img, candidates, {
    alt: cardName,
    fadeIn: false, // Disabled to prevent flashing on re-render
    maxParallel: 3, // Try first 3 candidates in parallel
    onFailure: () => {
      // Track missing images for debugging
      trackMissing(cardName, useSm, overrides);
    }
  });
}

/**
 * Preload visible images using parallel loading for even faster performance
 * @param items - Array of card items to preload images for
 * @param overrides - Thumbnail override mappings
 */
function preloadVisibleImagesParallel(items: CardItem[], overrides: Record<string, string> = {}): void {
  const grid = getGridElement();
  if (!grid || !Array.isArray(items)) {
    return;
  }

  // Build lookup maps once - O(n) instead of O(n²) with repeated .find() calls
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

  // Get visible cards
  const visibleCards = Array.from(grid.querySelectorAll('.card'));
  const candidatesList: string[][] = [];

  visibleCards.forEach((cardEl: Element) => {
    const htmlCard = cardEl as HTMLElement;
    const { uid, cardId } = htmlCard.dataset;
    let cardData: CardItem | null = null;

    // O(1) lookup by uid
    if (uid) {
      cardData = itemsByUid.get(uid.toLowerCase()) ?? null;
    }

    // O(1) lookup by set~number
    if (!cardData && cardId) {
      cardData = itemsBySetNumber.get(cardId) ?? null;
    }

    // O(1) lookup by name
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

  // Preload in batches with moderate concurrency for visible images
  // Reduced from 8 to 6 to be more conservative with resources
  if (candidatesList.length > 0) {
    parallelImageLoader.preloadImages(candidatesList, 6);
  }
}

function populateCardContent(el: DocumentFragment | HTMLElement, cardData: CardItem, renderFlags: RenderOptions = {}) {
  // Remove skeleton classes from the card element itself
  // el could be the card directly or a fragment containing the card
  let card: HTMLElement | null = null;
  if (el instanceof HTMLElement && el.classList.contains('card')) {
    card = el; // el is the card itself
  } else if (el.querySelector) {
    card = el.querySelector('.card'); // el is a fragment, find the card
  }

  const shouldShowPrice = Boolean(renderFlags.showPrice);
  const formattedPrice = shouldShowPrice ? formatCardPrice(cardData.price) : null;

  if (card) {
    card.classList.remove('skeleton-card');
    card.removeAttribute('aria-hidden');
    card.classList.toggle('has-price', shouldShowPrice);

    const thumb = card.querySelector('.thumb');
    if (thumb) {
      let priceBadge = thumb.querySelector('.price-badge') as HTMLElement | null;
      if (shouldShowPrice) {
        if (!priceBadge) {
          priceBadge = document.createElement('div');
          priceBadge.className = 'price-badge';
          thumb.appendChild(priceBadge);
        }
        priceBadge.textContent = formattedPrice ?? '—';
        priceBadge.classList.toggle('price-badge--missing', !formattedPrice);
        priceBadge.setAttribute('aria-label', formattedPrice ? `Price ${formattedPrice}` : 'Price unavailable');
        priceBadge.setAttribute('role', 'status');
        priceBadge.title = formattedPrice ?? 'Price unavailable';
      } else if (priceBadge) {
        priceBadge.remove();
      }
    }
  }

  // Calculate percentage once
  const pct = Number.isFinite(cardData.pct)
    ? cardData.pct
    : cardData.total
      ? (100 * cardData.found) / cardData.total
      : 0;

  const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—';
  const widthPct = `${Math.max(0, Math.min(100, pct))}%`;

  // Update count badge with most frequent count
  const countBadge = el.querySelector('.count-badge') as HTMLElement | null;
  if (countBadge && cardData.dist && cardData.dist.length > 0) {
    // Find the distribution entry with the highest percentage
    const mostFrequent = cardData.dist.reduce((max, current) => {
      const currentPct = current.percent ?? 0;
      const maxPct = max.percent ?? 0;
      if (currentPct > maxPct) {
        return current;
      }
      return max;
    });
    const mfCopies = mostFrequent.copies ?? 0;
    const mfPercent = mostFrequent.percent ?? 0;
    countBadge.textContent = String(mfCopies);
    countBadge.title = `Most common: ${mfCopies}x (${mfPercent.toFixed(1)}%)`;
  } else if (countBadge) {
    // Hide badge if no distribution data
    countBadge.style.display = 'none';
  }

  // Update name element - remove skeleton and set real content
  const nameEl = el.querySelector('.name') as HTMLElement | null;
  if (nameEl) {
    // Remove any existing skeleton-text elements and classes
    nameEl.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
    nameEl.classList.remove('skeleton-text');

    // Clear existing content
    nameEl.innerHTML = '';

    // Create the main name text
    const nameText = document.createElement('span');
    nameText.textContent = cardData.name;
    nameEl.appendChild(nameText);

    // Add set ID and number in smaller, de-emphasized text if available
    if (cardData.set && cardData.number) {
      const setSpan = document.createElement('span');
      setSpan.className = 'card-title-set';
      setSpan.textContent = `${cardData.set} ${cardData.number}`;
      nameEl.appendChild(setSpan);
    }

    // Set tooltip with full card name and set info if available
    const tooltipText =
      cardData.set && cardData.number ? `${cardData.name} ${cardData.set} ${cardData.number}` : cardData.name;
    nameEl.title = tooltipText;
  }

  // Update percentage display - remove skeleton elements
  const barEl = el.querySelector('.bar') as HTMLElement | null;
  const pctEl = el.querySelector('.pct') as HTMLElement | null;

  if (barEl) {
    barEl.classList.remove('skeleton-usage-bar');
    barEl.style.width = widthPct;
  }

  if (pctEl) {
    // Remove skeleton text elements and classes
    pctEl.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
    pctEl.classList.remove('skeleton-text', 'small');
    pctEl.textContent = pctText;
  }

  // Update usage tooltip
  const usageEl = el.querySelector('.usagebar') as HTMLElement | null;
  if (usageEl) {
    const haveCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
    const countsText = haveCounts ? ` (${cardData.found}/${cardData.total} decks)` : '';
    usageEl.title = `Played ${pctText}${countsText}`;
  }
}

function createCardHistogram(el: DocumentFragment | HTMLElement, cardData: CardItem) {
  const hist = el.querySelector('.hist');

  if (hist) {
    // Remove skeleton elements and classes
    hist.querySelectorAll('.skeleton-bar').forEach(skeleton => skeleton.remove());
    hist.classList.remove('skeleton-loading');
    hist.innerHTML = '';

    if (!cardData.dist || !cardData.dist.length) {
      return;
    }
  } else {
    return;
  }

  // Sort distribution by percentage (descending) and take top 4
  const sortedDist = [...cardData.dist].sort((itemA, itemB) => (itemB.percent ?? 0) - (itemA.percent ?? 0));
  const topFourDist = sortedDist.slice(0, 4);

  // Get the copy counts we're showing and sort them for display
  const copiesToShow = topFourDist.map(distItem => distItem.copies ?? 0).sort((countA, countB) => countA - countB);
  const maxPct = Math.max(1, ...topFourDist.map(distItem => distItem.percent ?? 0));

  for (const copies of copiesToShow) {
    const distData = cardData.dist!.find(x => x.copies === copies);
    const col = createElement('div', { className: 'col' });
    const bar = createElement('div', { className: 'bar' });
    const lbl = createElement('div', {
      className: 'lbl',
      textContent: String(copies)
    });

    const distPct = distData?.percent ?? 0;
    const height = distData ? Math.max(2, Math.round(54 * (distPct / maxPct))) : 2;
    setStyles(bar, {
      height: `${height}px`,
      ...(distData ? {} : { opacity: '0.25' })
    });

    // Setup tooltip
    if (distData) {
      const total = Number.isFinite(cardData.total) ? cardData.total : null;
      const players = Number.isFinite(distData.players) ? distData.players : undefined;
      const exactPct = Number.isFinite(distData.percent)
        ? distData.percent
        : players !== undefined && total
          ? (100 * players) / total
          : undefined;
      const pctStr = exactPct !== undefined ? `${exactPct.toFixed(1)}%` : '—';
      const countsStr = players !== undefined && total !== null ? ` (${players}/${total})` : '';
      const tip = `${copies}x: ${pctStr}${countsStr}`;

      setupHistogramTooltip(col, cardData.name, tip);
    } else {
      const tip = `${copies}x: 0%`;
      setupHistogramTooltip(col, cardData.name, tip);
    }

    col.appendChild(bar);
    col.appendChild(lbl);
    hist.appendChild(col);
  }
}

function setupHistogramTooltip(col: HTMLElement, cardName: string, tip: string) {
  col.setAttribute('tabindex', '0');
  col.setAttribute('role', 'img');
  col.setAttribute('aria-label', tip);
  col.setAttribute('aria-describedby', 'grid-tooltip');

  const showTooltip = (ev: MouseEvent) =>
    showGridTooltip(
      `<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>`,
      ev.clientX || 0,
      ev.clientY || 0
    );

  col.addEventListener('mousemove', showTooltip);
  col.addEventListener('mouseenter', showTooltip);
  col.addEventListener('mouseleave', hideGridTooltip);
  col.addEventListener('blur', hideGridTooltip);
  col.addEventListener('focus', (_ev: FocusEvent) => {
    const rect = col.getBoundingClientRect();
    showGridTooltip(
      `<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>`,
      rect.left + rect.width / 2,
      rect.top
    );
  });
}

function attachCardNavigation(card: HTMLElement, cardData: CardItem) {
  const cardIdentifier = cardData.uid || cardData.name;
  const url = buildCardPath(cardIdentifier);

  card.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey) {
      window.open(url, '_blank');
    } else {
      location.assign(url);
    }
  });

  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      location.assign(url);
    }
  });
}

// Simplified card creation - single responsibility
function makeCardElement(
  cardData: CardItem,
  useSm: boolean,
  overrides: Record<string, string>,
  renderFlags: RenderOptions = {},
  previousCardIds: Set<string> | null = null
): HTMLElement {
  const template = document.getElementById('card-template') as HTMLTemplateElement | null;
  const fragment = template
    ? (template.content.cloneNode(true) as DocumentFragment)
    : document.createDocumentFragment();

  let card = fragment.querySelector('.card') as HTMLElement | null;

  if (!(card instanceof HTMLElement)) {
    card = document.createElement('div');
    card.className = 'card';
    fragment.appendChild(card);
  }

  // Mark card as newly entering for animation only if it wasn't visible before
  if (previousCardIds) {
    const { uid } = cardData;
    const setCode = cardData.set ? String(cardData.set).toUpperCase() : '';
    const number = cardData.number ? normalizeCardNumber(cardData.number) : '';
    const cardId = setCode && number ? `${setCode}~${number}` : null;
    const name = cardData.name ? cardData.name.toLowerCase() : null;

    const wasVisible =
      (uid && previousCardIds.has(uid)) ||
      (cardId && previousCardIds.has(cardId)) ||
      (name && previousCardIds.has(name));

    if (!wasVisible) {
      card.classList.add('card-entering');

      // Remove the entering class after animation completes
      // Using { once: true } to automatically remove the listener and prevent memory leaks
      card.addEventListener(
        'animationend',
        () => {
          card.classList.remove('card-entering');
        },
        { once: true }
      );
    }
  }

  // Setup card attributes
  setupCardAttributes(card, cardData);

  // Setup image
  const img = fragment.querySelector('img') as HTMLImageElement | null;
  setupCardImage(img, cardData.name, useSm, overrides, cardData);

  // Populate content
  populateCardContent(fragment, cardData, renderFlags);
  setupCardCounts(fragment, cardData);
  createCardHistogram(fragment, cardData);

  // Attach behavior
  attachCardNavigation(card, cardData);

  return card;
}

// Extract card attributes setup
function setupCardAttributes(card: HTMLElement, cardData: CardItem) {
  if (cardData.name) {
    card.dataset.name = cardData.name.toLowerCase();
  } else {
    delete card.dataset.name;
  }
  const categorySlug = typeof cardData.category === 'string' ? cardData.category : '';
  if (categorySlug) {
    card.dataset.category = categorySlug;
  } else {
    delete card.dataset.category;
  }
  if (cardData.trainerType) {
    card.dataset.trainerType = cardData.trainerType;
  } else {
    delete card.dataset.trainerType;
  }
  if (cardData.energyType) {
    card.dataset.energyType = cardData.energyType;
  } else {
    delete card.dataset.energyType;
  }
  const baseCategory = categorySlug.split('/')[0] || '';
  if (baseCategory) {
    card.dataset.categoryPrimary = baseCategory;
  } else {
    delete card.dataset.categoryPrimary;
  }
  if (cardData.uid) {
    card.dataset.uid = cardData.uid;
  } else {
    delete card.dataset.uid;
  }
  const setCode = cardData.set ? String(cardData.set).toUpperCase() : '';
  const number = cardData.number ? normalizeCardNumber(cardData.number) : '';
  if (setCode && number) {
    card.dataset.cardId = `${setCode}~${number}`;
  } else {
    delete card.dataset.cardId;
  }
  // Store usage percent for CSS-based visibility filtering (avoids DOM rebuild on threshold change)
  const pct = getCardUsagePercent(cardData);
  if (Number.isFinite(pct)) {
    card.dataset.pct = String(pct);
  } else {
    delete card.dataset.pct;
  }
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  // Make aria-label more descriptive with usage percentage when available
  const pctText = cardData.pct != null ? `${cardData.pct.toFixed(1)}% usage` : '';
  const setInfo = cardData.set && cardData.number ? ` ${cardData.set} ${cardData.number}` : '';
  card.setAttribute('aria-label', `${cardData.name}${setInfo}${pctText ? `, ${pctText}` : ''}, click for details`);
  card.setAttribute('aria-roledescription', 'card');
}

// Helper to extract usage percent from card data
function getCardUsagePercent(card: CardItem): number {
  if (Number.isFinite(card.pct)) {
    return Number(card.pct);
  }
  if (Number.isFinite(card.found) && Number.isFinite(card.total) && card.total > 0) {
    return (card.found / card.total) * 100;
  }
  return 0;
}

// Extract counts setup
function setupCardCounts(element: DocumentFragment | HTMLElement, cardData: CardItem) {
  const counts = element.querySelector('.counts');

  if (!counts) {
    return;
  }

  // Remove any skeleton elements and classes
  counts.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
  counts.classList.remove('skeleton-text');
  counts.innerHTML = '';

  const hasValidCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
  const countsText = createElement('span', {
    textContent: hasValidCounts ? `${cardData.found} / ${cardData.total} decks` : 'no data'
  });
  counts.appendChild(countsText);
}

/**
 * Helper to compute the expected card count for a given row index based on layout parameters.
 * This ensures consistent row sizing logic across all functions.
 */
function getExpectedCardsForRow(
  rowIndex: number,
  forceCompact: boolean,
  effectiveBigRows: number,
  effectiveMediumRows: number,
  useSmallRows: boolean,
  perRowBig: number,
  targetMedium: number,
  targetSmall: number
): number {
  if (forceCompact) {
    return targetSmall;
  }

  const isLarge = rowIndex < effectiveBigRows;
  const isMedium = !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
  const isSmall = !isLarge && !isMedium && useSmallRows;

  if (isLarge) {
    return perRowBig;
  }
  if (isMedium) {
    return targetMedium;
  }
  if (isSmall) {
    return targetSmall;
  }
  return targetMedium;
}

/**
 * Compute total rows needed for a given card count based on layout parameters.
 */
function computeTotalRows(
  cardCount: number,
  forceCompact: boolean,
  effectiveBigRows: number,
  effectiveMediumRows: number,
  useSmallRows: boolean,
  perRowBig: number,
  targetMedium: number,
  targetSmall: number
): number {
  let cnt = 0;
  let idx = 0;
  while (idx < cardCount) {
    const maxCount = getExpectedCardsForRow(
      cnt,
      forceCompact,
      effectiveBigRows,
      effectiveMediumRows,
      useSmallRows,
      perRowBig,
      targetMedium,
      targetSmall
    );
    idx += maxCount;
    cnt++;
  }
  return cnt;
}

// Reflow-only: recompute per-row sizing and move existing cards into new rows without rebuilding cards/images.
export function updateLayout() {
  perf.start('updateLayout');
  const grid = getGridElement();
  if (!grid) {
    perf.end('updateLayout');
    return;
  }
  // Collect existing card elements in current order
  const cards = Array.from(grid.querySelectorAll('.card')) as HTMLElement[];
  if (cards.length === 0) {
    perf.end('updateLayout');
    return;
  }

  // Compute layout based on current container width
  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;

  // Skip layout update if container width is invalid (element may be hidden)
  if (containerWidth <= 0) {
    perf.end('updateLayout');
    return;
  }

  const {
    base,
    perRowBig,
    bigRowContentWidth,
    targetMedium,
    mediumScale,
    targetSmall,
    smallScale,
    bigRows,
    mediumRows
  } = computeLayout(containerWidth);
  syncControlsWidth(bigRowContentWidth);

  const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;
  const forceCompact = prefersCompact || grid._renderOptions?.layoutMode === 'compact';
  grid._autoCompact = prefersCompact;
  const effectiveBigRows = forceCompact ? 0 : bigRows;
  const effectiveMediumRows = forceCompact ? 0 : mediumRows;

  const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);

  // Check if row grouping (cards per row) has changed
  const prev = grid._layoutMetrics;
  const groupingUnchanged =
    prev &&
    prev.perRowBig === perRowBig &&
    prev.forceCompact === forceCompact &&
    prev.targetMedium === targetMedium &&
    prev.targetSmall === targetSmall &&
    prev.bigRows === effectiveBigRows &&
    prev.mediumRows === effectiveMediumRows &&
    prev.useSmallRows === useSmallRows;

  // Even if grouping seems unchanged, verify that existing rows have correct card counts.
  // This catches edge cases where the grid state doesn't match expectations.
  let rowsHaveCorrectCounts = true;
  if (groupingUnchanged) {
    const existingRows = Array.from(grid.querySelectorAll('.row')) as HTMLElement[];
    for (let rowIdx = 0; rowIdx < existingRows.length; rowIdx++) {
      const row = existingRows[rowIdx];
      const actualCardCount = row.querySelectorAll('.card').length;
      const expectedCount = getExpectedCardsForRow(
        rowIdx,
        forceCompact,
        effectiveBigRows,
        effectiveMediumRows,
        useSmallRows,
        perRowBig,
        targetMedium,
        targetSmall
      );

      // Allow last row to have fewer cards (partial row)
      const isLastRow = rowIdx === existingRows.length - 1;
      const isValidCount = isLastRow ? actualCardCount <= expectedCount : actualCardCount === expectedCount;

      if (!isValidCount) {
        rowsHaveCorrectCounts = false;
        break;
      }
    }
  }

  // Fast path: If row grouping hasn't changed AND rows have correct card counts,
  // only update CSS vars and row widths/scales in-place to minimize DOM churn.
  if (groupingUnchanged && rowsHaveCorrectCounts) {
    const rows = Array.from(grid.querySelectorAll('.row')) as HTMLElement[];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const isLarge = !forceCompact && rowIndex < effectiveBigRows;
      const isMedium = !forceCompact && !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
      const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);

      let scale;
      if (forceCompact) {
        scale = smallScale;
      } else if (isLarge) {
        scale = 1;
      } else if (isMedium) {
        scale = mediumScale;
      } else if (isSmall) {
        scale = smallScale;
      } else {
        scale = mediumScale;
      }

      row.style.setProperty('--scale', String(scale));
      row.style.setProperty('--card-base', `${base}px`);
      row.style.width = `${bigRowContentWidth}px`;
      row.style.margin = '0 auto';
    }
    // Store latest metrics and return
    grid._layoutMetrics = {
      base,
      perRowBig,
      bigRowContentWidth,
      targetMedium,
      mediumScale,
      targetSmall,
      smallScale,
      bigRows: effectiveBigRows,
      mediumRows: effectiveMediumRows,
      useSmallRows,
      forceCompact
    };
    perf.end('updateLayout');
    return;
  }

  // Full rebuild: redistribute cards across rows based on new layout
  // Preserve existing More... control, if any, to re-attach after rebuild
  const savedMore = (grid.querySelector('.more-rows') as HTMLElement | null) || grid._moreWrapRef || null;
  const frag = document.createDocumentFragment();
  let i = 0;
  let rowIndex = 0;

  // Compute the total number of rows for ALL items based on latest layout
  const totalCards = Number.isInteger(grid._totalCards) ? grid._totalCards! : cards.length;
  const newTotalRows = computeTotalRows(
    totalCards,
    forceCompact,
    effectiveBigRows,
    effectiveMediumRows,
    useSmallRows,
    perRowBig,
    targetMedium,
    targetSmall
  );

  while (i < cards.length) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);

    const maxCount = getExpectedCardsForRow(
      rowIndex,
      forceCompact,
      effectiveBigRows,
      effectiveMediumRows,
      useSmallRows,
      perRowBig,
      targetMedium,
      targetSmall
    );

    const isLarge = !forceCompact && rowIndex < effectiveBigRows;
    const isMedium = !forceCompact && !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
    const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);

    let scale;
    if (forceCompact) {
      scale = smallScale;
    } else if (isLarge) {
      scale = 1;
    } else if (isMedium) {
      scale = mediumScale;
    } else if (isSmall) {
      scale = smallScale;
    } else {
      scale = mediumScale;
    }

    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', `${base}px`);
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';

    const count = Math.min(maxCount, cards.length - i);
    for (let j = 0; j < count && i < cards.length; j++, i++) {
      const cardEl = cards[i];
      if (cardEl) {
        cardEl.dataset.row = String(rowIndex);
        cardEl.dataset.col = String(j);
      }
      row.appendChild(cardEl);
    }
    frag.appendChild(row);
    rowIndex++;
  }

  // Update visible rows count to match the actual row count after redistribution
  grid._visibleRows = rowIndex;

  // Restore More... button if there are additional rows beyond the visible ones
  if (savedMore && rowIndex < newTotalRows) {
    frag.appendChild(savedMore);
    grid._moreWrapRef = savedMore;
  } else if (savedMore && rowIndex >= newTotalRows) {
    // All rows are now visible, remove the More button reference
    grid._moreWrapRef = null;
  }

  // Atomically replace grid content - wrap in rAF for Safari layout batching
  requestAnimationFrame(() => {
    grid.replaceChildren(frag);
  });

  // Cache last layout metrics for fast-path updates on minor resizes
  grid._layoutMetrics = {
    base,
    perRowBig,
    bigRowContentWidth,
    targetMedium,
    mediumScale,
    targetSmall,
    smallScale,
    bigRows: effectiveBigRows,
    mediumRows: effectiveMediumRows,
    useSmallRows,
    forceCompact
  };
  grid._totalRows = newTotalRows;
  perf.end('updateLayout');
}
