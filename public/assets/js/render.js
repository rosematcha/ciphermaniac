// Number of rows to render as 'large' rows in grid view. Edit this value to change how many rows are 'large'.
export const NUM_LARGE_ROWS = 1;
// Number of rows to render as 'medium' rows (after large rows)
export const NUM_MEDIUM_ROWS = 1;
const MOBILE_MAX_WIDTH = 880;
import { buildThumbCandidates } from './thumbs.js';
import { computeLayout, syncControlsWidth } from './layoutHelper.js';
import { trackMissing } from './dev/missingThumbs.js';
import { buildCardPath, normalizeCardNumber } from './card/routing.js';
// import { setupImagePreloading } from './utils/imagePreloader.js'; // Disabled - using parallelImageLoader instead
import { parallelImageLoader } from './utils/parallelImageLoader.js';
import { createElement, setStyles } from './utils/dom.js';
import { CONFIG } from './config.js';
// Modal removed: navigate to card page instead
const USD_FORMATTER = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});
function formatCardPrice(rawPrice) {
    if (typeof rawPrice === 'number' && Number.isFinite(rawPrice)) {
        return USD_FORMATTER.format(rawPrice);
    }
    return null;
}
/**
 * @returns {GridElement | null}
 */
function getGridElement() {
    return document.getElementById('grid');
}
// Lightweight floating tooltip used for thumbnails' histograms
let __gridGraphTooltip = null;
function ensureGridTooltip() {
    if (__gridGraphTooltip) {
        return __gridGraphTooltip;
    }
    const tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    tooltip.setAttribute('role', 'status');
    tooltip.style.position = 'fixed';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.zIndex = '9999';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
    __gridGraphTooltip = tooltip;
    return tooltip;
}
function showGridTooltip(html, x, y) {
    const tooltip = ensureGridTooltip();
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    const offsetX = 12;
    const offsetY = 12;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    let left = x + offsetX;
    let top = y + offsetY;
    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > vw) {
        left = Math.max(8, x - rect.width - offsetX);
    }
    if (top + rect.height > vh) {
        top = Math.max(8, y - rect.height - offsetY);
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}
function hideGridTooltip() {
    if (__gridGraphTooltip) {
        __gridGraphTooltip.style.display = 'none';
    }
}
function escapeHtml(str) {
    if (!str) {
        return '';
    }
    return String(str).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}
const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
/**
 * Render summary information including deck count, card count, and row visibility
 * @param container - Summary container element
 * @param deckTotal - Total number of decks
 * @param count - Total number of cards
 * @param visibleRows - Number of currently visible rows (optional)
 * @param totalRows - Total number of rows available (optional)
 */
export function renderSummary(container, deckTotal, count, visibleRows = null, totalRows = null) {
    if (!container) {
        return;
    } // Handle case where summary element doesn't exist
    const parts = [];
    if (deckTotal) {
        parts.push(`${deckTotal} decklists`);
    }
    parts.push(`${count} cards`);
    // Add row count if provided and there are more rows to show
    if (visibleRows !== null && totalRows !== null && Number.isFinite(visibleRows) && Number.isFinite(totalRows) && totalRows > visibleRows) {
        parts.push(`showing ${visibleRows} of ${totalRows} rows`);
    }
    container.textContent = parts.join(' • ');
}
/**
 * Update the summary with current grid row visibility state
 * @param deckTotal - Total number of decks
 * @param cardCount - Total number of cards
 */
export function updateSummaryWithRowCounts(deckTotal, cardCount) {
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
 *
 * @param items
 * @param overrides
 * @param options
 */
export function render(items, overrides = {}, options = {}) {
    const grid = getGridElement();
    if (!grid) {
        return;
    }
    // Track which cards were visible before this render
    const previousCardIds = new Set();
    const existingCards = grid.querySelectorAll('.card');
    existingCards.forEach((card) => {
        const htmlCard = card;
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
    const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;
    const requestedLayout = options?.layoutMode === 'compact' ? 'compact' : 'standard';
    const layoutMode = requestedLayout;
    const showPrice = Boolean(options?.showPrice);
    const settings = {
        layoutMode,
        showPrice
    };
    const forceCompact = prefersCompact || settings.layoutMode === 'compact';
    grid._renderOptions = settings;
    grid._autoCompact = prefersCompact;
    // Empty state for no results - use replaceChildren for atomic update
    if (!items || items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `<h2>Dead draw.</h2><p>No results for this search, try another!</p>`;
        grid.replaceChildren(empty);
        return;
    }
    // Compute per-row layout and sync controls width using helper
    const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
    const layout = computeLayout(containerWidth);
    const { base, perRowBig, bigRowContentWidth, targetMedium, mediumScale, targetSmall, smallScale } = layout;
    syncControlsWidth(bigRowContentWidth);
    const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);
    const largeRowsLimit = forceCompact ? 0 : NUM_LARGE_ROWS;
    const mediumRowsLimit = forceCompact ? 0 : NUM_MEDIUM_ROWS;
    // Capture existing cards to reuse DOM elements (prevents image flashing)
    const existingCardsMap = new Map();
    grid.querySelectorAll('.card').forEach(el => {
        const cardEl = el;
        const uid = cardEl.dataset.uid;
        const cardId = cardEl.dataset.cardId;
        const name = cardEl.dataset.name;
        const key = uid || cardId || name;
        if (key)
            existingCardsMap.set(key, cardEl);
    });
    // Use the shared card creation function
    const makeCard = (it, useSm) => {
        // Try to reuse existing element
        const uid = it.uid;
        const setCode = it.set ? String(it.set).toUpperCase() : '';
        const number = it.number ? normalizeCardNumber(it.number) : '';
        const cardId = setCode && number ? `${setCode}~${number}` : null;
        const name = it.name ? it.name.toLowerCase() : null;
        const key = uid || cardId || name;
        let cardEl;
        if (key && existingCardsMap.has(key)) {
            cardEl = existingCardsMap.get(key);
            // Update dynamic content
            setupCardCounts(cardEl, it);
            createCardHistogram(cardEl, it);
            // Ensure attributes are up to date
            setupCardAttributes(cardEl, it);
            // Remove entering class if present
            cardEl.classList.remove('card-entering');
            // Mark as reused so we know not to re-parent it unnecessarily
            cardEl._reused = true;
        }
        else {
            cardEl = makeCardElement(it, useSm, overrides, { showPrice }, previousCardIds);
            cardEl._reused = false;
        }
        return cardEl;
    };
    // ===== IN-PLACE DOM UPDATE STRATEGY =====
    // Instead of replaceChildren (which causes flash), we update the DOM in place:
    // 1. Reuse existing rows, update their cards
    // 2. Add new rows only if needed
    // 3. Remove excess rows at the end
    const existingRows = Array.from(grid.querySelectorAll('.row'));
    const existingMoreWrap = grid.querySelector('.more-rows');
    let i = 0;
    let rowIndex = 0;
    // visible rows limit (rows, not cards). Default to initial value from config; clicking More loads incremental rows
    if (!Number.isInteger(grid._visibleRows)) {
        grid._visibleRows = CONFIG.UI.INITIAL_VISIBLE_ROWS;
    }
    const visibleRowsLimit = grid._visibleRows || CONFIG.UI.INITIAL_VISIBLE_ROWS;
    // Track cards that will be in the new layout
    const newLayoutCards = new Set();
    // Build rows - reuse existing or create new
    const rowsToKeep = [];
    while (i < items.length && rowIndex < visibleRowsLimit) {
        // Reuse existing row if available, otherwise create new
        let row;
        const isExistingRow = rowIndex < existingRows.length;
        if (isExistingRow) {
            row = existingRows[rowIndex];
        }
        else {
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
        }
        else if (isLarge) {
            scale = 1;
            maxCount = perRowBig;
        }
        else if (isMedium) {
            scale = mediumScale;
            maxCount = targetMedium;
        }
        else if (isSmall) {
            scale = smallScale;
            maxCount = targetSmall;
        }
        else {
            // If small rows aren't used, continue with medium sizing
            scale = mediumScale;
            maxCount = targetMedium;
        }
        row.style.setProperty('--scale', String(scale));
        row.style.setProperty('--card-base', `${base}px`);
        row.style.width = `${bigRowContentWidth}px`;
        row.style.margin = '0 auto';
        // Get current cards in this row
        const existingRowCards = isExistingRow ? Array.from(row.querySelectorAll('.card')) : [];
        const count = Math.min(maxCount, items.length - i);
        // First pass: collect all cards we need for this row
        const cardsForRow = [];
        const tempI = i; // Save i for card collection
        for (let j = 0; j < count && (tempI + j) < items.length; j++) {
            const useSm = isLarge || isMedium || !isSmall;
            const cardEl = makeCard(items[tempI + j], useSm);
            cardEl.dataset.row = String(rowIndex);
            cardEl.dataset.col = String(j);
            newLayoutCards.add(cardEl);
            cardsForRow.push(cardEl);
        }
        // Update row: clear and repopulate if cards changed, otherwise update in place
        // Check if we can do a simple in-place update (same cards in same order)
        const canUpdateInPlace = cardsForRow.length === existingRowCards.length &&
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
            }
            else {
                grid.appendChild(row);
            }
        }
        rowsToKeep.push(row);
        rowIndex++;
    }
    // Remove excess rows (those beyond what we need)
    for (let r = rowIndex; r < existingRows.length; r++) {
        existingRows[r].remove();
    }
    // Set up image preloading for better performance
    // setupImagePreloading(items, overrides); // Disabled - using parallelImageLoader instead
    // Additionally, preload visible images in parallel batches for even faster loading
    // Use moderate concurrency to balance performance with browser resources
    if (items.length > 0) {
        requestAnimationFrame(() => {
            preloadVisibleImagesParallel(items, overrides);
        });
    }
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
            }
            else if (isLargeLocal) {
                maxCount = perRowBig;
            }
            else if (isMediumLocal) {
                maxCount = targetMedium;
            }
            else if (isSmallLocal) {
                maxCount = targetSmall;
            }
            else {
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
        }
        else {
            grid.appendChild(moreWrap);
        }
        // Keep a reference so updateLayout can re-attach after rebuilds
        grid._moreWrapRef = moreWrap;
    }
    else {
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
                    const moreBtn = grid.querySelector('.more-rows .btn');
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
            const activeEl = active;
            const rowEl = activeEl.closest('.row');
            const rowIdx = Number(activeEl.dataset.row ?? rowEl?.dataset.rowIndex ?? 0);
            const colIdx = Number(activeEl.dataset.col ?? 0);
            const move = (dr, dc) => {
                const rowsEls = Array.from(grid.querySelectorAll('.row'));
                const targetRowIndex = Math.max(0, Math.min(rowsEls.length - 1, rowIdx + dr));
                const targetRow = rowsEls[targetRowIndex];
                if (!targetRow) {
                    return;
                }
                const cards = Array.from(targetRow.querySelectorAll('.card'));
                const targetColIndex = Math.max(0, Math.min(cards.length - 1, colIdx + dc));
                const next = cards[targetColIndex];
                if (next) {
                    next.focus();
                }
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
}
// Expand grid by adding remaining rows without touching existing cards
function expandGridRows(items, overrides, targetTotalRows, options = {}) {
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
    const previousCardIds = new Set();
    const existingCardEls = grid.querySelectorAll('.card');
    existingCardEls.forEach((card) => {
        const htmlCard = card;
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
        }
        else if (isLarge) {
            scale = 1;
            maxCount = perRowBig;
        }
        else if (isMedium) {
            scale = mediumScale;
            maxCount = targetMedium;
        }
        else if (isSmall) {
            scale = smallScale;
            maxCount = targetSmall;
        }
        else {
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
        let moreWrap = grid.querySelector('.more-rows');
        if (!moreWrap) {
            moreWrap = document.createElement('div');
            moreWrap.className = 'more-rows';
            grid.appendChild(moreWrap);
            grid._moreWrapRef = moreWrap;
        }
        let moreBtn = moreWrap.querySelector('.btn');
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
        // Remove old event listeners by cloning the button
        const newBtn = moreBtn.cloneNode(true);
        if (moreBtn.parentNode) {
            moreBtn.parentNode.replaceChild(newBtn, moreBtn);
        }
        // Add new event listener for the next batch
        newBtn.addEventListener('click', () => {
            const nextTargetRows = Math.min(currentRowCount + CONFIG.UI.ROWS_PER_LOAD, totalAvailableRows);
            expandGridRows(items, overrides, nextTargetRows, options);
        });
    }
    else {
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
function setupCardImage(img, cardName, useSm, overrides, cardData) {
    if (!img)
        return;
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
    const variant = cardData && cardData.set && cardData.number ? { set: cardData.set, number: cardData.number } : undefined;
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
 * @param items
 * @param overrides
 */
function preloadVisibleImagesParallel(items, overrides = {}) {
    const grid = getGridElement();
    if (!grid || !Array.isArray(items)) {
        return;
    }
    // Get visible cards
    const visibleCards = Array.from(grid.querySelectorAll('.card'));
    const candidatesList = [];
    visibleCards.forEach((cardEl) => {
        const htmlCard = cardEl;
        const { uid, cardId } = htmlCard.dataset;
        let cardData = null;
        if (uid) {
            cardData = items.find(item => item.uid === uid) || null;
        }
        if (!cardData && cardId) {
            const [setCode, number] = cardId.split('~');
            cardData =
                items.find(item => {
                    const candidateSet = String(item.set || '').toUpperCase();
                    const candidateNumber = normalizeCardNumber(item.number);
                    return candidateSet === setCode && candidateNumber === number;
                }) || null;
        }
        if (!cardData) {
            const baseNameSpan = htmlCard.querySelector('.name span');
            const baseName = baseNameSpan?.textContent || '';
            if (baseName) {
                cardData = items.find(item => item.name === baseName) || null;
            }
        }
        if (cardData) {
            candidatesList.push(buildThumbCandidates(cardData.name, true, overrides, {
                set: cardData.set,
                number: cardData.number
            }), buildThumbCandidates(cardData.name, false, overrides, {
                set: cardData.set,
                number: cardData.number
            }));
        }
    });
    // Preload in batches with moderate concurrency for visible images
    // Reduced from 8 to 6 to be more conservative with resources
    if (candidatesList.length > 0) {
        parallelImageLoader.preloadImages(candidatesList, 6);
    }
}
function populateCardContent(el, cardData, renderFlags = {}) {
    // Remove skeleton classes from the card element itself
    // el could be the card directly or a fragment containing the card
    let card = null;
    if (el instanceof HTMLElement && el.classList.contains('card')) {
        card = el; // el is the card itself
    }
    else if (el.querySelector) {
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
            let priceBadge = thumb.querySelector('.price-badge');
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
            }
            else if (priceBadge) {
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
    const countBadge = el.querySelector('.count-badge');
    if (countBadge && cardData.dist && cardData.dist.length > 0) {
        // Find the distribution entry with the highest percentage
        const mostFrequent = cardData.dist.reduce((max, current) => {
            if (current.percent > max.percent) {
                return current;
            }
            return max;
        });
        countBadge.textContent = String(mostFrequent.copies);
        countBadge.title = `Most common: ${mostFrequent.copies}x (${mostFrequent.percent.toFixed(1)}%)`;
    }
    else if (countBadge) {
        // Hide badge if no distribution data
        countBadge.style.display = 'none';
    }
    // Update name element - remove skeleton and set real content
    const nameEl = el.querySelector('.name');
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
        const tooltipText = cardData.set && cardData.number ? `${cardData.name} ${cardData.set} ${cardData.number}` : cardData.name;
        nameEl.title = tooltipText;
    }
    // Update percentage display - remove skeleton elements
    const barEl = el.querySelector('.bar');
    const pctEl = el.querySelector('.pct');
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
    const usageEl = el.querySelector('.usagebar');
    if (usageEl) {
        const haveCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
        const countsText = haveCounts ? ` (${cardData.found}/${cardData.total} decks)` : '';
        usageEl.title = `Played ${pctText}${countsText}`;
    }
}
function createCardHistogram(el, cardData) {
    const hist = el.querySelector('.hist');
    if (hist) {
        // Remove skeleton elements and classes
        hist.querySelectorAll('.skeleton-bar').forEach(skeleton => skeleton.remove());
        hist.classList.remove('skeleton-loading');
        hist.innerHTML = '';
        if (!cardData.dist || !cardData.dist.length) {
            return;
        }
    }
    else {
        return;
    }
    // Sort distribution by percentage (descending) and take top 4
    const sortedDist = [...cardData.dist].sort((itemA, itemB) => itemB.percent - itemA.percent);
    const topFourDist = sortedDist.slice(0, 4);
    // Get the copy counts we're showing and sort them for display
    const copiesToShow = topFourDist.map(distItem => distItem.copies).sort((countA, countB) => countA - countB);
    const maxPct = Math.max(1, ...topFourDist.map(distItem => distItem.percent));
    for (const copies of copiesToShow) {
        const distData = cardData.dist.find((x) => x.copies === copies);
        const col = createElement('div', { className: 'col' });
        const bar = createElement('div', { className: 'bar' });
        const lbl = createElement('div', {
            className: 'lbl',
            textContent: String(copies)
        });
        const height = distData ? Math.max(2, Math.round(54 * (distData.percent / maxPct))) : 2;
        setStyles(bar, {
            height: `${height}px`,
            ...(distData ? {} : { opacity: '0.25' })
        });
        // Setup tooltip
        if (distData) {
            const total = Number.isFinite(cardData.total) ? cardData.total : null;
            const players = Number.isFinite(distData.players) ? distData.players : null;
            const exactPct = Number.isFinite(distData.percent)
                ? distData.percent
                : players !== null && total
                    ? (100 * players) / total
                    : null;
            const pctStr = exactPct !== null ? `${exactPct.toFixed(1)}%` : '—';
            const countsStr = players !== null && total !== null ? ` (${players}/${total})` : '';
            const tip = `${copies}x: ${pctStr}${countsStr}`;
            setupHistogramTooltip(col, cardData.name, tip);
        }
        else {
            const tip = `${copies}x: 0%`;
            setupHistogramTooltip(col, cardData.name, tip);
        }
        col.appendChild(bar);
        col.appendChild(lbl);
        hist.appendChild(col);
    }
}
function setupHistogramTooltip(col, cardName, tip) {
    col.setAttribute('tabindex', '0');
    col.setAttribute('role', 'img');
    col.setAttribute('aria-label', tip);
    const showTooltip = (ev) => showGridTooltip(`<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>`, ev.clientX || 0, ev.clientY || 0);
    col.addEventListener('mousemove', showTooltip);
    col.addEventListener('mouseenter', showTooltip);
    col.addEventListener('mouseleave', hideGridTooltip);
    col.addEventListener('blur', hideGridTooltip);
}
function attachCardNavigation(card, cardData) {
    const cardIdentifier = cardData.uid || cardData.name;
    const url = buildCardPath(cardIdentifier);
    card.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey) {
            window.open(url, '_blank');
        }
        else {
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
function makeCardElement(cardData, useSm, overrides, renderFlags = {}, previousCardIds = null) {
    const template = document.getElementById('card-template');
    const fragment = template
        ? template.content.cloneNode(true)
        : document.createDocumentFragment();
    let card = fragment.querySelector('.card');
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
        const wasVisible = (uid && previousCardIds.has(uid)) ||
            (cardId && previousCardIds.has(cardId)) ||
            (name && previousCardIds.has(name));
        if (!wasVisible) {
            card.classList.add('card-entering');
            // Remove the entering class after animation completes
            const removeEnteringClass = () => {
                if (card) {
                    card.classList.remove('card-entering');
                    card.removeEventListener('animationend', removeEnteringClass);
                }
            };
            card.addEventListener('animationend', removeEnteringClass);
        }
    }
    // Setup card attributes
    setupCardAttributes(card, cardData);
    // Setup image
    const img = fragment.querySelector('img');
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
function setupCardAttributes(card, cardData) {
    if (cardData.name) {
        card.dataset.name = cardData.name.toLowerCase();
    }
    else {
        delete card.dataset.name;
    }
    const categorySlug = typeof cardData.category === 'string' ? cardData.category : '';
    if (categorySlug) {
        card.dataset.category = categorySlug;
    }
    else {
        delete card.dataset.category;
    }
    if (cardData.trainerType) {
        card.dataset.trainerType = cardData.trainerType;
    }
    else {
        delete card.dataset.trainerType;
    }
    if (cardData.energyType) {
        card.dataset.energyType = cardData.energyType;
    }
    else {
        delete card.dataset.energyType;
    }
    const baseCategory = categorySlug.split('/')[0] || '';
    if (baseCategory) {
        card.dataset.categoryPrimary = baseCategory;
    }
    else {
        delete card.dataset.categoryPrimary;
    }
    if (cardData.uid) {
        card.dataset.uid = cardData.uid;
    }
    else {
        delete card.dataset.uid;
    }
    const setCode = cardData.set ? String(cardData.set).toUpperCase() : '';
    const number = cardData.number ? normalizeCardNumber(cardData.number) : '';
    if (setCode && number) {
        card.dataset.cardId = `${setCode}~${number}`;
    }
    else {
        delete card.dataset.cardId;
    }
    // Store usage percent for CSS-based visibility filtering (avoids DOM rebuild on threshold change)
    const pct = getCardUsagePercent(cardData);
    if (Number.isFinite(pct)) {
        card.dataset.pct = String(pct);
    }
    else {
        delete card.dataset.pct;
    }
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${cardData.name} – open details`);
}
// Helper to extract usage percent from card data
function getCardUsagePercent(card) {
    if (Number.isFinite(card.pct)) {
        return Number(card.pct);
    }
    if (Number.isFinite(card.found) && Number.isFinite(card.total) && card.total > 0) {
        return (card.found / card.total) * 100;
    }
    return 0;
}
// Extract counts setup
function setupCardCounts(element, cardData) {
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
// Reflow-only: recompute per-row sizing and move existing cards into new rows without rebuilding cards/images.
export function updateLayout() {
    const grid = getGridElement();
    if (!grid) {
        return;
    }
    // Collect existing card elements in current order
    const cards = Array.from(grid.querySelectorAll('.card'));
    if (cards.length === 0) {
        return;
    }
    // Compute layout based on current container width
    const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
    const { base, perRowBig, bigRowContentWidth, targetMedium, mediumScale, targetSmall, smallScale, bigRows, mediumRows } = computeLayout(containerWidth);
    syncControlsWidth(bigRowContentWidth);
    const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;
    const forceCompact = prefersCompact || grid._renderOptions?.layoutMode === 'compact';
    grid._autoCompact = prefersCompact;
    const effectiveBigRows = forceCompact ? 0 : bigRows;
    const effectiveMediumRows = forceCompact ? 0 : mediumRows;
    const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);
    // Fast path: If row grouping hasn't changed, avoid rebuilding the entire grid.
    // Only update CSS vars and row widths/scales in-place to minimize DOM churn.
    const prev = grid._layoutMetrics;
    const groupingUnchanged = prev &&
        prev.perRowBig === perRowBig &&
        prev.forceCompact === forceCompact &&
        prev.targetMedium === targetMedium &&
        prev.targetSmall === targetSmall &&
        prev.bigRows === effectiveBigRows &&
        prev.mediumRows === effectiveMediumRows &&
        prev.useSmallRows === useSmallRows;
    if (groupingUnchanged) {
        const rows = Array.from(grid.querySelectorAll('.row'));
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const isLarge = !forceCompact && rowIndex < effectiveBigRows;
            const isMedium = !forceCompact && !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
            const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);
            let scale;
            if (forceCompact) {
                scale = smallScale;
            }
            else if (isLarge) {
                scale = 1;
            }
            else if (isMedium) {
                scale = mediumScale;
            }
            else if (isSmall) {
                scale = smallScale;
            }
            else {
                scale = mediumScale;
            }
            row.style.setProperty('--scale', String(scale));
            row.style.setProperty('--card-base', `${base}px`);
            // Keep consistent width and centering
            const widthPx = `${bigRowContentWidth}px`;
            if (row.style.width !== widthPx) {
                row.style.width = widthPx;
            }
            if (row.style.margin !== '0 auto') {
                row.style.margin = '0 auto';
            }
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
        return;
    }
    // Build rows and re-append existing cards
    // Preserve existing More... control, if any, to re-attach after rebuild
    const savedMore = grid.querySelector('.more-rows') || grid._moreWrapRef || null;
    const frag = document.createDocumentFragment();
    let i = 0;
    let rowIndex = 0;
    // Compute the total number of rows for ALL items based on latest layout
    const totalCards = Number.isInteger(grid._totalCards) ? grid._totalCards : cards.length;
    const newTotalRows = (() => {
        let cnt = 0;
        let idx = 0;
        while (idx < totalCards) {
            const rowIdx = cnt;
            const isLargeLocal = !forceCompact && rowIdx < effectiveBigRows;
            const isMediumLocal = !forceCompact && !isLargeLocal && rowIdx < effectiveBigRows + effectiveMediumRows;
            const isSmallLocal = forceCompact || (!isLargeLocal && !isMediumLocal && useSmallRows);
            let maxCount;
            if (isLargeLocal) {
                maxCount = perRowBig;
            }
            else if (isMediumLocal) {
                maxCount = targetMedium;
            }
            else if (isSmallLocal) {
                maxCount = targetSmall;
            }
            else {
                maxCount = targetMedium;
            }
            idx += maxCount;
            cnt++;
        }
        return cnt;
    })();
    while (i < cards.length) {
        const row = document.createElement('div');
        row.className = 'row';
        row.dataset.rowIndex = String(rowIndex);
        const isLarge = !forceCompact && rowIndex < effectiveBigRows;
        const isMedium = !forceCompact && !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
        const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);
        let scale;
        let maxCount;
        if (forceCompact) {
            scale = smallScale;
            maxCount = targetSmall;
        }
        else if (isLarge) {
            scale = 1;
            maxCount = perRowBig;
        }
        else if (isMedium) {
            scale = mediumScale;
            maxCount = targetMedium;
        }
        else if (isSmall) {
            scale = smallScale;
            maxCount = targetSmall;
        }
        else {
            scale = mediumScale;
            maxCount = targetMedium;
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
    // Restore More... button if there are additional rows beyond the visible ones
    if (savedMore && rowIndex < newTotalRows) {
        frag.appendChild(savedMore);
        grid._moreWrapRef = savedMore;
    }
    // Atomically replace grid content to prevent flashing
    grid.replaceChildren(frag);
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
}
