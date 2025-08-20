import { buildThumbCandidates } from './thumbs.js';
import { computeLayout, syncControlsWidth } from './layoutHelper.js';
import { trackMissing } from './dev/missingThumbs.js';
import { isFavorite, toggleFavorite, subscribeFavorites } from './favorites.js';
// Modal removed: navigate to card page instead

export function renderSummary(container, deckTotal, count){
  const parts = [];
  if(deckTotal) parts.push(`${deckTotal} decklists`);
  parts.push(`${count} cards`);
  container.textContent = parts.join(' • ');
}

export function render(items, overrides={}){
  const grid = document.getElementById('grid');
  const tpl = document.getElementById('card-template');
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
  const { base, perRowBig, bigRowContentWidth, targetSmall, smallScale, bigRows } = computeLayout(containerWidth);
  syncControlsWidth(bigRowContentWidth);

  const makeCard = (it, useSm) => {
    const el = tpl.content.cloneNode(true);
    const card = el.querySelector('.card');
    card.dataset.name = it.name.toLowerCase();
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${it.name} – open details`);

    // Prepare star toggle button (will be placed next to counts)
    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'star-btn';
    const setStar = () => {
      const fav = isFavorite(it.name);
      starBtn.classList.toggle('is-active', fav);
      starBtn.setAttribute('aria-pressed', String(fav));
      starBtn.title = fav ? 'Unfavorite' : 'Favorite';
      starBtn.textContent = fav ? '★' : '☆';
    };
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(it.name);
      setStar();
    });
    setStar();

  const img = el.querySelector('img');
  img.alt = it.name;
  img.decoding = 'async';
  img.loading = useSm ? 'eager' : 'lazy';
  img.style.opacity = '0';
  img.style.transition = 'opacity .18s ease-out';
  const candidates = buildThumbCandidates(it.name, useSm, overrides);
    let idx = 0;
    const tryNext = () => {
      if(idx >= candidates.length){
  trackMissing(it.name, useSm, overrides);
        return;
      }
      img.src = candidates[idx++];
    };
  img.onerror = () => { tryNext(); };
  img.onload = () => { img.style.opacity = '1'; };
    tryNext();

  const nameEl = el.querySelector('.name');
  nameEl.textContent = it.name;
    nameEl.title = it.name;

    const pct = Number.isFinite(it.pct) ? it.pct : (it.total ? (100*it.found/it.total) : 0);
    el.querySelector('.bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    el.querySelector('.pct').textContent = Number.isFinite(pct) ? pct.toFixed(1)+'%' : '—';
    const usageEl = el.querySelector('.usagebar');
    if(usageEl){
      const haveCounts = Number.isFinite(it.found) && Number.isFinite(it.total);
      const tipPct = Number.isFinite(pct) ? pct.toFixed(1)+'%' : '—';
      usageEl.title = haveCounts ? `Played ${tipPct} (${it.found}/${it.total} decks)` : `Played ${tipPct}`;
    }

    const counts = el.querySelector('.counts');
    counts.innerHTML = '';
    const countsText = document.createElement('span');
    if(Number.isFinite(it.found) && Number.isFinite(it.total)){
      countsText.textContent = `${it.found} / ${it.total} decks`;
    } else {
      countsText.textContent = 'no data';
    }
    counts.appendChild(countsText);
    counts.appendChild(starBtn);

    const hist = el.querySelector('.hist');
    hist.innerHTML = '';
    if(it.dist && it.dist.length){
      const minC = Math.min(...it.dist.map(d=>d.copies));
      const maxC = Math.max(...it.dist.map(d=>d.copies));
      const maxPct = Math.max(1, ...it.dist.map(d=>d.percent));
      for(let c=minC; c<=maxC; c++){
        const d = it.dist.find(x=>x.copies===c);
        const col = document.createElement('div');
        col.className = 'col';
        const bar = document.createElement('div');
        bar.className = 'bar';
        const lbl = document.createElement('div');
        lbl.className = 'lbl';
        lbl.textContent = String(c);
        const h = d ? Math.max(2, Math.round(54 * (d.percent / maxPct))) : 2;
        bar.style.height = h + 'px';
        if(!d){ bar.style.opacity = 0.25; }
        // Tooltip: for each N, percent and raw counts if available
        if(d){
          const total = Number.isFinite(it.total) ? it.total : null;
          const players = Number.isFinite(d.players) ? d.players : null;
          const exactPct = Number.isFinite(d.percent) ? d.percent : (players!=null && total ? (100*players/total) : null);
          const pctStr = exactPct!=null ? exactPct.toFixed(1)+'%' : '—';
          const countsStr = (players!=null && total!=null) ? ` (${players}/${total})` : '';
          col.title = `${c}x: ${pctStr}${countsStr}`;
        } else {
          col.title = `${c}x: 0%`;
        }
        col.appendChild(bar);
        col.appendChild(lbl);
        hist.appendChild(col);
      }
    }
    // Navigate to per-card page on click/Enter; ctrl/meta opens new tab
    card.addEventListener('click', (e) => {
      const url = `card.html#card/${encodeURIComponent(it.name)}`;
      if(e.ctrlKey || e.metaKey){
        window.open(url, '_blank');
      } else {
        location.assign(url);
      }
    });
    card.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        const url = `card.html#card/${encodeURIComponent(it.name)}`;
        location.assign(url);
      }
    });
    return el;
  };

  const frag = document.createDocumentFragment();
  let i = 0;
  let rowIndex = 0;
  // visible rows limit (rows, not cards). Default to 6; clicking More loads +8 rows
  if(!Number.isInteger(grid._visibleRows)) grid._visibleRows = 6;
  const visibleRowsLimit = grid._visibleRows;
  while(i < items.length && rowIndex < visibleRowsLimit){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);
  const isBig = rowIndex < bigRows;
    const scale = isBig ? 1 : smallScale;
    const maxCount = isBig ? perRowBig : targetSmall;
    row.style.setProperty('--scale', String(scale));
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

  // If there are remaining rows not rendered, show a More control
  // Determine total rows that would be generated for all items
  const estimateTotalRows = (() => {
    let cnt = 0; let idx = 0;
    while(idx < items.length){ cnt++; const isBigLocal = cnt-1 < bigRows; const maxCount = isBigLocal ? perRowBig : targetSmall; idx += maxCount; }
    return cnt;
  })();
  // Persist totals so resize handler can decide whether to show More after reflow
  grid._totalRows = estimateTotalRows;
  grid._totalCards = items.length;
  if(rowIndex < estimateTotalRows){
    const moreWrap = document.createElement('div'); moreWrap.className = 'more-rows';
    const moreBtn = document.createElement('button'); moreBtn.className = 'btn'; moreBtn.type = 'button'; moreBtn.textContent = 'More...';
    moreBtn.addEventListener('click', () => {
      // Reveal all remaining rows (remove incremental +8 behaviour)
      grid._visibleRows = estimateTotalRows;
      // Preserve scroll position to avoid jumping to top after re-render
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
      // Re-render with same inputs
      render(items, overrides);
      // Restore scroll after render completes (use rAF to ensure DOM painted)
      try{ window.requestAnimationFrame(()=>{ window.scrollTo(0, scrollY); const ev = new Event('resize'); window.dispatchEvent(ev); }); }catch{}
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
      if(!active || !active.classList || !active.classList.contains('card')) return;
      const rowEl = active.closest('.row');
      const rowIdx = Number(active.dataset.row ?? rowEl?.dataset.rowIndex ?? 0);
      const colIdx = Number(active.dataset.col ?? 0);
      const move = (dr, dc) => {
        const rowsEls = Array.from(grid.querySelectorAll('.row'));
        let r = Math.max(0, Math.min(rowsEls.length - 1, rowIdx + dr));
        const targetRow = rowsEls[r];
        if(!targetRow) return;
        const cards = Array.from(targetRow.querySelectorAll('.card'));
        let c = Math.max(0, Math.min(cards.length - 1, colIdx + dc));
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

// Reflow-only: recompute per-row sizing and move existing cards into new rows without rebuilding cards/images.
export function updateLayout(){
  const grid = document.getElementById('grid');
  if(!grid) return;
  // Collect existing card elements in current order
  const cards = Array.from(grid.querySelectorAll('.card'));
  if(cards.length === 0) return;

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
      const isBig = rowIndex < bigRows;
      const scale = isBig ? 1 : smallScale;
      row.style.setProperty('--scale', String(scale));
      row.style.setProperty('--card-base', base + 'px');
      // Keep consistent width and centering
      const widthPx = bigRowContentWidth + 'px';
      if (row.style.width !== widthPx) row.style.width = widthPx;
      if (row.style.margin !== '0 auto') row.style.margin = '0 auto';
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
    const isBig = rowIndex < bigRows;
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
