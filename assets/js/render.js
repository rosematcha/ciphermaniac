// Number of rows to render as 'large' rows in grid view. Edit this value to change how many rows are 'large'.
export const NUM_LARGE_ROWS = 2;
import { buildThumbCandidates } from './thumbs.js';
import { computeLayout, syncControlsWidth } from './layoutHelper.js';
import { trackMissing } from './dev/missingThumbs.js';
import { buildCardPath } from './card/routing.js';
// import { setupImagePreloading } from './utils/imagePreloader.js'; // Disabled - using parallelImageLoader instead
import { parallelImageLoader } from './utils/parallelImageLoader.js';
import { setProperties as _setProperties, setStyles, createElement } from './utils/dom.js';
// Modal removed: navigate to card page instead

// Lightweight floating tooltip used for thumbnails' histograms
let __gridGraphTooltip = null;
function ensureGridTooltip() {
  if (__gridGraphTooltip) {return __gridGraphTooltip;}
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
  const offsetX = 12; const offsetY = 12;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  let left = x + offsetX;
  let top = y + offsetY;
  const rect = tooltip.getBoundingClientRect();
  if (left + rect.width > vw) {left = Math.max(8, x - rect.width - offsetX);}
  if (top + rect.height > vh) {top = Math.max(8, y - rect.height - offsetY);}
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
function hideGridTooltip() { if (__gridGraphTooltip) {__gridGraphTooltip.style.display = 'none';} }
function escapeHtml(str) { if (!str) {return '';} return String(str).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

/**
 *
 * @param container
 * @param deckTotal
 * @param count
 */
export function renderSummary(container, deckTotal, count) {
  if (!container) {return;} // Handle case where summary element doesn't exist
  const parts = [];
  if (deckTotal) {parts.push(`${deckTotal} decklists`);}
  parts.push(`${count} cards`);
  // eslint-disable-next-line no-param-reassign
  container.textContent = parts.join(' • ');
}

/**
 *
 * @param items
 * @param overrides
 */
export function render(items, overrides = {}) {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  // Empty state for no results
  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<h2>Dead draw.</h2><p>No results for this search, try another!</p>`;
    grid.appendChild(empty);
    return;
  }

  // Compute per-row layout and sync controls width using helper
  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  const layout = computeLayout(containerWidth);
  // Override bigRows with NUM_LARGE_ROWS
  const { base } = layout;
  const { perRowBig } = layout;
  const { bigRowContentWidth } = layout;
  const { targetSmall } = layout;
  const { smallScale } = layout;
  // Use NUM_LARGE_ROWS constant directly
  syncControlsWidth(bigRowContentWidth);

  // Use the shared card creation function
  const makeCard = (it, useSm) => {
    const cardEl = makeCardElement(it, useSm, overrides);
    // Wrap in document fragment to match expected return type
    const frag = document.createDocumentFragment();
    frag.appendChild(cardEl);
    return frag;
  };

  const frag = document.createDocumentFragment();
  let i = 0;
  let rowIndex = 0;
  // visible rows limit (rows, not cards). Default to 6; clicking More loads +8 rows
  if (!Number.isInteger(grid._visibleRows)) {grid._visibleRows = 6;}
  const visibleRowsLimit = grid._visibleRows;
  while (i < items.length && rowIndex < visibleRowsLimit) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);
    const isBig = rowIndex < NUM_LARGE_ROWS;
    const scale = isBig ? 1 : smallScale;
    const maxCount = isBig ? perRowBig : targetSmall;
    row.style.setProperty('--scale', String(scale));
    // Use the base width for big rows and base for small rows (scaled via --scale)
    row.style.setProperty('--card-base', `${base}px`);
    // Keep a consistent row width based on big row content and center it
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';
    const count = Math.min(maxCount, items.length - i);
    for (let j = 0; j < count && i < items.length; j++, i++) {
      // sm thumbs for big rows, xs for small rows
      const elFrag = makeCard(items[i], isBig);
      const cardEl = elFrag.querySelector('.card');
      if (cardEl) { cardEl.dataset.row = String(rowIndex); cardEl.dataset.col = String(j); }
      row.appendChild(elFrag);
    }
    frag.appendChild(row);
    rowIndex++;
  }
  grid.appendChild(frag);

  // Set up image preloading for better performance
  // setupImagePreloading(items, overrides); // Disabled - using parallelImageLoader instead

  // Additionally, preload visible images in parallel batches for even faster loading
  if (items.length > 0) {
    requestAnimationFrame(() => {
      preloadVisibleImagesParallel(items, overrides);
    });
  }

  // If there are remaining rows not rendered, show a More control
  // Determine total rows that would be generated for all items
  const estimateTotalRows = (() => {
    let cnt = 0; let idx = 0;
    while (idx < items.length) {
      cnt++;
      const isBigLocal = cnt - 1 < NUM_LARGE_ROWS;
      const maxCount = isBigLocal ? perRowBig : targetSmall;
      idx += maxCount;
    }
    return cnt;
  })();
  // Persist totals so resize handler can decide whether to show More after reflow
  grid._totalRows = estimateTotalRows;
  grid._totalCards = items.length;
  if (rowIndex < estimateTotalRows) {
    const moreWrap = document.createElement('div'); moreWrap.className = 'more-rows';
    const moreBtn = document.createElement('button'); moreBtn.className = 'btn'; moreBtn.type = 'button'; moreBtn.textContent = 'More...';
    moreBtn.addEventListener('click', () => {
      // Instead of re-rendering everything, just add the remaining rows
      expandGridRows(items, overrides, estimateTotalRows);
    });
    moreWrap.appendChild(moreBtn);
    grid.appendChild(moreWrap);
    // Keep a reference so updateLayout can re-attach after rebuilds
    grid._moreWrapRef = moreWrap;
  }

  // Keyboard navigation: arrow keys move focus across cards by row/column
  if (!grid._kbNavAttached) {
    grid.addEventListener('keydown', event => {
      const active = document.activeElement;
      if (!active || !active.classList || !active.classList.contains('card')) {return;}
      const rowEl = active.closest('.row');
      const rowIdx = Number(active.dataset.row ?? rowEl?.dataset.rowIndex ?? 0);
      const colIdx = Number(active.dataset.col ?? 0);
      const move = (dr, dc) => {
        const rowsEls = Array.from(grid.querySelectorAll('.row'));
        const targetRowIndex = Math.max(0, Math.min(rowsEls.length - 1, rowIdx + dr));
        const targetRow = rowsEls[targetRowIndex];
        if (!targetRow) {return;}
        const cards = Array.from(targetRow.querySelectorAll('.card'));
        const targetColIndex = Math.max(0, Math.min(cards.length - 1, colIdx + dc));
        const next = cards[targetColIndex];
        if (next) { next.focus(); }
      };
      switch (event.key) {
        case 'ArrowRight': event.preventDefault(); move(0, +1); break;
        case 'ArrowLeft': event.preventDefault(); move(0, -1); break;
        case 'ArrowDown': event.preventDefault(); move(+1, 0); break;
        case 'ArrowUp': event.preventDefault(); move(-1, 0); break;
        default:
      }
    });
    grid._kbNavAttached = true;
  }
}

// Expand grid by adding remaining rows without touching existing cards
function expandGridRows(items, overrides, targetTotalRows) {
  const grid = document.getElementById('grid');
  if (!grid || !Array.isArray(items)) {
    return;
  }

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
  // Override bigRows with NUM_LARGE_ROWS
  const { base } = layout;
  const { perRowBig } = layout;
  const { bigRowContentWidth } = layout;
  const { targetSmall } = layout;
  const { smallScale } = layout;
  // Use NUM_LARGE_ROWS constant directly

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
    const isBig = rowIndex < NUM_LARGE_ROWS;
    const scale = isBig ? 1 : smallScale;
    const maxCount = isBig ? perRowBig : targetSmall;
    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', `${base}px`);
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';

    const count = Math.min(maxCount, items.length - cardIndex);
    for (let j = 0; j < count && cardIndex < items.length; j++, cardIndex++) {
      const item = items[cardIndex];
      const cardEl = makeCardElement(item, isBig, overrides);
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
  grid._totalRows = targetTotalRows;

  // Set up image preloading for new cards only
  const newItems = items.slice(existingCards);
  // setupImagePreloading(newItems, overrides); // Disabled - using parallelImageLoader instead

  // Additionally preload new images in parallel for better performance
  if (newItems.length > 0) {
    requestAnimationFrame(() => {
      const newCandidatesList = newItems.flatMap(item => [
        buildThumbCandidates(item.name, true, overrides, { set: item.set, number: item.number }), // sm
        buildThumbCandidates(item.name, false, overrides, { set: item.set, number: item.number }) // xs
      ]);
      parallelImageLoader.preloadImages(newCandidatesList, 6);
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
  const variant = (cardData && cardData.set && cardData.number)
    ? { set: cardData.set, number: cardData.number }
    : undefined;

  // DEBUG: Log cards without variant data
  if (!variant && cardName && (cardName.includes('Boss') || cardName.includes('Pokégear') || cardName.includes('Ethan'))) {
    console.warn('Card missing variant data:', cardName, cardData);
  }

  const candidates = buildThumbCandidates(cardName, useSm, overrides, variant);

  // Use parallel image loader for better performance
  parallelImageLoader.setupImageElement(img, candidates, {
    alt: cardName,
    fadeIn: true,
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
  const grid = document.getElementById('grid');
  if (!grid || !Array.isArray(items)) {return;}

  // Get visible cards
  const visibleCards = Array.from(grid.querySelectorAll('.card'));
  const candidatesList = [];

  visibleCards.forEach(cardEl => {
    const nameEl = cardEl.querySelector('.name');
    const cardName = nameEl?.textContent;

    if (cardName) {
      const cardData = items.find(item => item.name === cardName);
      if (cardData) {
        // Add both sm and xs candidates for each visible card
        candidatesList.push(
          buildThumbCandidates(cardName, true, overrides, { set: cardData.set, number: cardData.number }), // sm
          buildThumbCandidates(cardName, false, overrides, { set: cardData.set, number: cardData.number }) // xs
        );
      } else {
        // DEBUG: Log when cardData is not found
        console.warn('Card data not found for preloading:', cardName, 'Available names:', items.slice(0, 5).map(i => i.name));
      }
    }
  });

  // Preload in batches with high concurrency for visible images
  if (candidatesList.length > 0) {
    parallelImageLoader.preloadImages(candidatesList, 8); // Higher concurrency for visible images
  }
}

function populateCardContent(el, cardData) {
  // Remove skeleton classes from the card element itself
  // el could be the card directly or a fragment containing the card
  let card = null;
  if (el.classList && el.classList.contains('card')) {
    card = el; // el is the card itself
  } else if (el.querySelector) {
    card = el.querySelector('.card'); // el is a fragment, find the card
  }

  if (card) {
    card.classList.remove('skeleton-card');
    card.removeAttribute('aria-hidden');
  }

  // Calculate percentage once
  const pct = Number.isFinite(cardData.pct)
    ? cardData.pct
    : (cardData.total ? (100 * cardData.found / cardData.total) : 0);

  const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—';
  const widthPct = `${Math.max(0, Math.min(100, pct))}%`;

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
    const tooltipText = cardData.set && cardData.number
      ? `${cardData.name} ${cardData.set} ${cardData.number}`
      : cardData.name;
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

  const minCopies = Math.min(...cardData.dist.map(distItem => distItem.copies));
  const maxCopies = Math.max(...cardData.dist.map(distItem => distItem.copies));
  const maxPct = Math.max(1, ...cardData.dist.map(distItem => distItem.percent));

  for (let copies = minCopies; copies <= maxCopies; copies++) {
    const distData = cardData.dist.find(x => x.copies === copies);
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
        : (players !== null && total ? (100 * players / total) : null);
      const pctStr = exactPct !== null ? `${exactPct.toFixed(1)}%` : '—';
      const countsStr = (players !== null && total !== null) ? ` (${players}/${total})` : '';
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

function setupHistogramTooltip(col, cardName, tip) {
  col.setAttribute('tabindex', '0');
  col.setAttribute('role', 'img');
  col.setAttribute('aria-label', tip);

  const showTooltip = ev => showGridTooltip(`<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>`, ev.clientX || 0, ev.clientY || 0);

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
function makeCardElement(cardData, useSm, overrides) {
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById('card-template'));
  const fragment = template
    ? /** @type {DocumentFragment} */ (template.content.cloneNode(true))
    : document.createDocumentFragment();

  let card = fragment.querySelector('.card');

  if (!(card instanceof HTMLElement)) {
    card = document.createElement('div');
    card.className = 'card';
    fragment.appendChild(card);
  }

  // Setup card attributes
  setupCardAttributes(card, cardData);

  // Setup image
  const img = /** @type {HTMLImageElement | null} */ (fragment.querySelector('img'));
  setupCardImage(img, cardData.name, useSm, overrides, cardData);

  // Populate content
  populateCardContent(fragment, cardData);
  setupCardCounts(fragment, cardData);
  createCardHistogram(fragment, cardData);

  // Attach behavior
  attachCardNavigation(card, cardData);

  return card;
}

// Extract card attributes setup
function setupCardAttributes(card, cardData) {
  // eslint-disable-next-line no-param-reassign
  card.dataset.name = cardData.name.toLowerCase();
  if (cardData.category) {
    // eslint-disable-next-line no-param-reassign
    card.dataset.category = cardData.category;
  }
  card.setAttribute('role', 'link');
  card.setAttribute('aria-label', `${cardData.name} – open details`);
}

// Extract counts setup
function setupCardCounts(element, cardData) {
  const counts = element.querySelector('.counts');

  if (counts) {
    // Remove any skeleton elements and classes
    counts.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
    counts.classList.remove('skeleton-text', 'counts');
    counts.innerHTML = '';

    const hasValidCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
    const countsText = createElement('span', {
      textContent: hasValidCounts ? `${cardData.found} / ${cardData.total} decks` : 'no data'
    });
    counts.appendChild(countsText);
  }
}

// Reflow-only: recompute per-row sizing and move existing cards into new rows without rebuilding cards/images.
export function updateLayout() {
  const grid = document.getElementById('grid');
  if (!grid) {return;}
  // Collect existing card elements in current order
  const cards = Array.from(grid.querySelectorAll('.card'));
  if (cards.length === 0) {return;}

  // Compute layout based on current container width
  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  const { base, perRowBig, bigRowContentWidth, targetSmall, smallScale, bigRows } = computeLayout(containerWidth);
  syncControlsWidth(bigRowContentWidth);

  // Fast path: If row grouping hasn't changed, avoid rebuilding the entire grid.
  // Only update CSS vars and row widths/scales in-place to minimize DOM churn.
  const prev = grid._layoutMetrics;
  const groupingUnchanged = prev
    && prev.perRowBig === perRowBig
    && prev.targetSmall === targetSmall
    && prev.bigRows === bigRows;
  if (groupingUnchanged) {
    const rows = Array.from(grid.querySelectorAll('.row'));
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const isBig = rowIndex < NUM_LARGE_ROWS;
      const scale = isBig ? 1 : smallScale;
      row.style.setProperty('--scale', String(scale));
      row.style.setProperty('--card-base', `${base}px`);
      // Keep consistent width and centering
      const widthPx = `${bigRowContentWidth}px`;
      if (row.style.width !== widthPx) {row.style.width = widthPx;}
      if (row.style.margin !== '0 auto') {row.style.margin = '0 auto';}
    }
    // Store latest metrics and return
    grid._layoutMetrics = { base, perRowBig, bigRowContentWidth, targetSmall, smallScale, bigRows };
    return;
  }

  // Build rows and re-append existing cards
  // Preserve existing More... control, if any, to re-attach after rebuild
  const savedMore = /** @type {HTMLElement | null} */ (grid.querySelector('.more-rows')) || grid._moreWrapRef || null;
  const frag = document.createDocumentFragment();
  let i = 0;
  let rowIndex = 0;
  // Compute the total number of rows for ALL items based on latest layout
  const totalCards = Number.isInteger(grid._totalCards) ? grid._totalCards : cards.length;
  const newTotalRows = (() => {
    let cnt = 0; let idx = 0;
    while (idx < totalCards) {
      cnt++;
      const isBigLocal = cnt - 1 < bigRows;
      const maxCount = isBigLocal ? perRowBig : targetSmall;
      idx += maxCount;
    }
    return cnt;
  })();
  while (i < cards.length) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);
    const isBig = rowIndex < NUM_LARGE_ROWS;
    const scale = isBig ? 1 : smallScale;
    const maxCount = isBig ? perRowBig : targetSmall;
    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', `${base}px`);
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';

    const count = Math.min(maxCount, cards.length - i);
    for (let j = 0; j < count && i < cards.length; j++, i++) {
      const cardEl = cards[i];
      if (cardEl) { cardEl.dataset.row = String(rowIndex); cardEl.dataset.col = String(j); }
      row.appendChild(cardEl);
    }
    frag.appendChild(row);
    rowIndex++;
  }

  // Replace rows; event listeners on cards remain intact
  grid.innerHTML = '';
  grid.appendChild(frag);
  // Restore More... button if there are additional rows beyond the visible ones
  if (savedMore && rowIndex < newTotalRows) {
    grid.appendChild(savedMore);
    grid._moreWrapRef = savedMore;
  }
  // Cache last layout metrics for fast-path updates on minor resizes
  grid._layoutMetrics = { base, perRowBig, bigRowContentWidth, targetSmall, smallScale, bigRows };
  grid._totalRows = newTotalRows;
}
