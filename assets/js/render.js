// Number of rows to render as 'large' rows in grid view. Edit this value to change how many rows are 'large'.
export const NUM_LARGE_ROWS = 2;
import { buildThumbCandidates } from './thumbs.js';
import { computeLayout, syncControlsWidth } from './layoutHelper.js';
import { trackMissing } from './dev/missingThumbs.js';
import { isFavorite, toggleFavorite, subscribeFavorites } from './favorites.js';
import { setupImagePreloading } from './utils/imagePreloader.js';
import { setProperties, setStyles, createElement, batchAppend } from './utils/dom.js';
// Modal removed: navigate to card page instead

// Lightweight floating tooltip used for thumbnails' histograms
let __gridGraphTooltip = null;
function ensureGridTooltip(){
  if(__gridGraphTooltip) {return __gridGraphTooltip;}
  const t = document.createElement('div');
  t.className = 'graph-tooltip';
  t.setAttribute('role', 'status');
  t.style.position = 'fixed';
  t.style.pointerEvents = 'none';
  t.style.zIndex = 9999;
  t.style.display = 'none';
  document.body.appendChild(t);
  __gridGraphTooltip = t;
  return t;
}
function showGridTooltip(html, x, y){
  const t = ensureGridTooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  const offsetX = 12; const offsetY = 12;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  let left = x + offsetX;
  let top = y + offsetY;
  const rect = t.getBoundingClientRect();
  if(left + rect.width > vw) {left = Math.max(8, x - rect.width - offsetX);}
  if(top + rect.height > vh) {top = Math.max(8, y - rect.height - offsetY);}
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}
function hideGridTooltip(){ if(__gridGraphTooltip) {__gridGraphTooltip.style.display = 'none';} }
function escapeHtml(s){ if(!s) {return '';} return String(s).replace(/[&<>"]/g, (ch)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

export function renderSummary(container, deckTotal, count){
  if (!container) return; // Handle case where summary element doesn't exist
  const parts = [];
  if(deckTotal) {parts.push(`${deckTotal} decklists`);}
  parts.push(`${count} cards`);
  container.textContent = parts.join(' • ');
}

export function render(items, overrides={}){
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  // Empty state for no results
  if(!items || items.length === 0){
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
  const base = layout.base;
  const perRowBig = layout.perRowBig;
  const bigRowContentWidth = layout.bigRowContentWidth;
  const targetSmall = layout.targetSmall;
  const smallScale = layout.smallScale;
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
  if(!Number.isInteger(grid._visibleRows)) {grid._visibleRows = 6;}
  const visibleRowsLimit = grid._visibleRows;
  while(i < items.length && rowIndex < visibleRowsLimit){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);
    const isBig = rowIndex < NUM_LARGE_ROWS;
    const scale = isBig ? 1 : smallScale;
    const maxCount = isBig ? perRowBig : targetSmall;
    row.style.setProperty('--scale', String(scale));
    // Use the base width for big rows and base for small rows (scaled via --scale)
    row.style.setProperty('--card-base', base + 'px');
    // Keep a consistent row width based on big row content and center it
    row.style.width = bigRowContentWidth + 'px';
    row.style.margin = '0 auto';
    const count = Math.min(maxCount, items.length - i);
    for(let j=0; j<count && i<items.length; j++, i++){
      // sm thumbs for big rows, xs for small rows
      const elFrag = makeCard(items[i], isBig);
      const cardEl = elFrag.querySelector('.card');
      if(cardEl){ cardEl.dataset.row = String(rowIndex); cardEl.dataset.col = String(j); }
      row.appendChild(elFrag);
    }
    frag.appendChild(row);
    rowIndex++;
  }
  grid.appendChild(frag);

  // Set up image preloading for better performance
  setupImagePreloading(items, overrides);

  // If there are remaining rows not rendered, show a More control
  // Determine total rows that would be generated for all items
  const estimateTotalRows = (() => {
    let cnt = 0; let idx = 0;
    while(idx < items.length){ cnt++; const isBigLocal = cnt-1 < NUM_LARGE_ROWS; const maxCount = isBigLocal ? perRowBig : targetSmall; idx += maxCount; }
    return cnt;
  })();
  // Persist totals so resize handler can decide whether to show More after reflow
  grid._totalRows = estimateTotalRows;
  grid._totalCards = items.length;
  if(rowIndex < estimateTotalRows){
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
  if(!grid._kbNavAttached){
    grid.addEventListener('keydown', (e) => {
      const active = document.activeElement;
      if(!active || !active.classList || !active.classList.contains('card')) {return;}
      const rowEl = active.closest('.row');
      const rowIdx = Number(active.dataset.row ?? rowEl?.dataset.rowIndex ?? 0);
      const colIdx = Number(active.dataset.col ?? 0);
      const move = (dr, dc) => {
        const rowsEls = Array.from(grid.querySelectorAll('.row'));
        const r = Math.max(0, Math.min(rowsEls.length - 1, rowIdx + dr));
        const targetRow = rowsEls[r];
        if(!targetRow) {return;}
        const cards = Array.from(targetRow.querySelectorAll('.card'));
        const c = Math.max(0, Math.min(cards.length - 1, colIdx + dc));
        const next = cards[c];
        if(next){ next.focus(); }
      };
      switch(e.key){
      case 'ArrowRight': e.preventDefault(); move(0, +1); break;
      case 'ArrowLeft': e.preventDefault(); move(0, -1); break;
      case 'ArrowDown': e.preventDefault(); move(+1, 0); break;
      case 'ArrowUp': e.preventDefault(); move(-1, 0); break;
      default: return;
      }
    });
    grid._kbNavAttached = true;
  }

  // Live update stars if favorites change elsewhere
  if(!grid._favSub){
    grid._favSub = subscribeFavorites(() => {
      grid.querySelectorAll('.card').forEach(card => {
        const name = card.querySelector('.name')?.textContent;
        const btn = card.querySelector('.star-btn');
        if(name && btn){
          const fav = isFavorite(name);
          btn.classList.toggle('is-active', fav);
          btn.setAttribute('aria-pressed', String(fav));
          btn.title = fav ? 'Unfavorite' : 'Favorite';
          btn.textContent = fav ? '★' : '☆';
        }
      });
    });
  }
}

// Expand grid by adding remaining rows without touching existing cards
function expandGridRows(items, overrides, targetTotalRows) {
  const grid = document.getElementById('grid');
  if (!grid || !Array.isArray(items)) {
    return;
  }

  // Preserve scroll position during DOM manipulation
  const scrollY = window.scrollY;

  // Remove the More button
  const moreWrap = grid.querySelector('.more-rows');
  if (moreWrap) {
    moreWrap.remove();
  }

  // Get current layout metrics
  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  const layout = computeLayout(containerWidth);
  // Override bigRows with NUM_LARGE_ROWS
  const base = layout.base;
  const perRowBig = layout.perRowBig;
  const bigRowContentWidth = layout.bigRowContentWidth;
  const targetSmall = layout.targetSmall;
  const smallScale = layout.smallScale;
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
    row.style.setProperty('--card-base', base + 'px');
    row.style.width = bigRowContentWidth + 'px';
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
  setupImagePreloading(newItems, overrides);

  // Restore scroll position after DOM manipulation
  requestAnimationFrame(() => {
    if (window.scrollY !== scrollY) {
      window.scrollTo(0, scrollY);
    }
  });
}

// Card creation helper functions
function createStarButton(cardName) {
  const starBtn = createElement('button', {
    attributes: { type: 'button' },
    className: 'star-btn'
  });

  const updateStarState = () => {
    const fav = isFavorite(cardName);
    starBtn.classList.toggle('is-active', fav);
    starBtn.setAttribute('aria-pressed', String(fav));
    starBtn.title = fav ? 'Unfavorite' : 'Favorite';
    starBtn.textContent = fav ? '★' : '☆';
  };

  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(cardName);
    updateStarState();
  });

  updateStarState();
  return starBtn;
}

function setupCardImage(img, cardName, useSm, overrides, cardData) {
  // Set basic image attributes - no mutations of parameters
  setProperties(img, {
    alt: cardName,
    decoding: 'async',
    loading: useSm ? 'eager' : 'lazy'
  });

  setStyles(img, {
    opacity: '0',
    transition: 'opacity .18s ease-out'
  });

  const candidates = buildThumbCandidates(cardName, useSm, overrides, { set: cardData.set, number: cardData.number });
  let idx = 0;

  const tryNext = () => {
    if (idx >= candidates.length) {
      trackMissing(cardName, useSm, overrides);
      return;
    }
    img.src = candidates[idx++];
  };

  img.onerror = tryNext;
  img.onload = () => { img.style.opacity = '1'; };
  tryNext();
}

function populateCardContent(el, cardData) {
  // Calculate percentage once
  const pct = Number.isFinite(cardData.pct)
    ? cardData.pct
    : (cardData.total ? (100 * cardData.found / cardData.total) : 0);

  const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—';
  const widthPct = `${Math.max(0, Math.min(100, pct))}%`;

  // Update name element - show only the card name in grid view
  const nameEl = el.querySelector('.name');
  nameEl.textContent = cardData.name;

  // Set full title with set info for tooltip, but display only name
  if (cardData.set && cardData.number) {
    nameEl.title = `${cardData.name} ${cardData.set} ${cardData.number}`;
  } else {
    nameEl.title = cardData.name;
  }

  // Update percentage display
  el.querySelector('.bar').style.width = widthPct;
  el.querySelector('.pct').textContent = pctText;

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
  hist.innerHTML = '';

  if (!cardData.dist || !cardData.dist.length) {
    return;
  }

  const minC = Math.min(...cardData.dist.map(d=>d.copies));
  const maxC = Math.max(...cardData.dist.map(d=>d.copies));
  const maxPct = Math.max(1, ...cardData.dist.map(d=>d.percent));

  for (let c=minC; c<=maxC; c++) {
    const d = cardData.dist.find(x=>x.copies===c);
    const col = createElement('div', { className: 'col' });
    const bar = createElement('div', { className: 'bar' });
    const lbl = createElement('div', {
      className: 'lbl',
      textContent: String(c)
    });

    const h = d ? Math.max(2, Math.round(54 * (d.percent / maxPct))) : 2;
    setStyles(bar, {
      height: `${h}px`,
      ...(d ? {} : { opacity: '0.25' })
    });

    // Setup tooltip
    if (d) {
      const total = Number.isFinite(cardData.total) ? cardData.total : null;
      const players = Number.isFinite(d.players) ? d.players : null;
      const exactPct = Number.isFinite(d.percent) ? d.percent : (players !== null && total ? (100*players/total) : null);
      const pctStr = exactPct !== null ? exactPct.toFixed(1)+'%' : '—';
      const countsStr = (players !== null && total !== null) ? ` (${players}/${total})` : '';
      const tip = `${c}x: ${pctStr}${countsStr}`;

      setupHistogramTooltip(col, cardData.name, tip);
    } else {
      const tip = `${c}x: 0%`;
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
  col.addEventListener('focus', showTooltip);
  col.addEventListener('blur', hideGridTooltip);
}

function attachCardNavigation(card, cardData) {
  const cardIdentifier = cardData.uid || cardData.name;
  const url = `card.html#card/${encodeURIComponent(cardIdentifier)}`;

  card.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) {
      window.open(url, '_blank');
    } else {
      location.assign(url);
    }
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      location.assign(url);
    }
  });
}

// Simplified card creation - single responsibility
function makeCardElement(cardData, useSm, overrides) {
  const template = document.getElementById('card-template');
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.card');

  // Setup card attributes
  setupCardAttributes(card, cardData);

  // Setup image
  const img = fragment.querySelector('img');
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
  card.dataset.name = cardData.name.toLowerCase();
  card.setAttribute('role', 'link');
  card.setAttribute('aria-label', `${cardData.name} – open details`);
}

// Extract counts setup
function setupCardCounts(element, cardData) {
  const counts = element.querySelector('.counts');
  counts.innerHTML = '';

  const hasValidCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
  const countsText = createElement('span', {
    textContent: hasValidCounts ? `${cardData.found} / ${cardData.total} decks` : 'no data'
  });

  const starBtn = createStarButton(cardData.name);
  batchAppend(counts, [countsText, starBtn]);
}

// Reflow-only: recompute per-row sizing and move existing cards into new rows without rebuilding cards/images.
export function updateLayout(){
  const grid = document.getElementById('grid');
  if(!grid) {return;}
  // Collect existing card elements in current order
  const cards = Array.from(grid.querySelectorAll('.card'));
  if(cards.length === 0) {return;}

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
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++){
      const row = rows[rowIndex];
      const isBig = rowIndex < NUM_LARGE_ROWS;
      const scale = isBig ? 1 : smallScale;
      row.style.setProperty('--scale', String(scale));
      row.style.setProperty('--card-base', base + 'px');
      // Keep consistent width and centering
      const widthPx = bigRowContentWidth + 'px';
      if (row.style.width !== widthPx) {row.style.width = widthPx;}
      if (row.style.margin !== '0 auto') {row.style.margin = '0 auto';}
    }
    // Store latest metrics and return
    grid._layoutMetrics = { base, perRowBig, bigRowContentWidth, targetSmall, smallScale, bigRows };
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
    let cnt = 0; let idx = 0;
    while(idx < totalCards){ cnt++; const isBigLocal = cnt-1 < bigRows; const maxCount = isBigLocal ? perRowBig : targetSmall; idx += maxCount; }
    return cnt;
  })();
  while(i < cards.length){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);
    const isBig = rowIndex < NUM_LARGE_ROWS;
    const scale = isBig ? 1 : smallScale;
    const maxCount = isBig ? perRowBig : targetSmall;
    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', base + 'px');
    row.style.width = bigRowContentWidth + 'px';
    row.style.margin = '0 auto';

    const count = Math.min(maxCount, cards.length - i);
    for(let j = 0; j < count && i < cards.length; j++, i++){
      const cardEl = cards[i];
      if(cardEl){ cardEl.dataset.row = String(rowIndex); cardEl.dataset.col = String(j); }
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
