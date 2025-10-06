import { buildThumbCandidates } from './thumbs.js';
import { logger } from './utils/logger.js';
import { computeLayout } from './layoutHelper.js';
import { parseCardRoute, buildCardPath } from './card/routing.js';

// Data fetch
async function fetchSuggestions() {
  try {
    const res = await fetch('/reports/suggestions.json', { cache: 'no-store' });
    if (!res.ok) {return { categories: [] };}
    const data = await res.json();
    return { categories: Array.isArray(data.categories) ? data.categories : [] };
  } catch { return { categories: [] }; }
}

// Card item factory
function makeCardItem(name, opts) {
  const card = document.createElement('article');
  card.className = 'card';
  card.setAttribute('role', 'link');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${name} – open details`);
  if (opts && typeof opts.base === 'number') {card.style.setProperty('--card-base', `${Math.round(opts.base)}px`);}

  const thumb = document.createElement('div'); thumb.className = 'thumb';
  const img = document.createElement('img'); img.alt = name; img.loading = 'lazy'; img.decoding = 'async';
  img.style.opacity = '0'; img.style.transition = 'opacity .18s ease-out';
  const candidates = buildThumbCandidates(name, /* useSm*/ false, {}, { set: opts?.set, number: opts?.number });
  let idx = 0; const tryNext = () => { if (idx >= candidates.length) {return;} img.src = candidates[idx++]; };
  img.onerror = tryNext; img.onload = () => { img.style.opacity = '1'; };
  tryNext(); thumb.appendChild(img);

  const titleRow = document.createElement('div'); titleRow.className = 'titleRow';
  const h3 = document.createElement('h3'); h3.className = 'name'; h3.title = name;

  // Create the main name text
  const nameText = document.createElement('span');
  nameText.textContent = name;
  h3.appendChild(nameText);

  // Add set ID and number in smaller, de-emphasized text if available
  if (opts?.set && opts?.number) {
    const setSpan = document.createElement('span');
    setSpan.className = 'card-title-set';
    setSpan.textContent = `${opts.set} ${opts.number}`;
    h3.appendChild(setSpan);
  }

  titleRow.appendChild(h3);
  card.appendChild(thumb); card.appendChild(titleRow);

  // Use UID if available, otherwise fall back to name
  const cardIdentifier = opts?.uid || name;
  const url = buildCardPath(cardIdentifier);
  const go = newTab => { newTab ? window.open(url, '_blank') : location.assign(url); };
  card.addEventListener('click', event => { go(event.ctrlKey || event.metaKey); });
  card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(false); } });
  return card;
}

// View preference
const PREF_KEY = 'suggestionsView';
function getPref() { try { return localStorage.getItem(PREF_KEY) || 'carousel'; } catch (error) { logger.warn('Failed to get preference:', error); return 'carousel'; } }
// Note: setPref currently unused but kept for future use
// eslint-disable-next-line no-unused-vars
function setPref(value) { try { localStorage.setItem(PREF_KEY, value); } catch (error) { logger.warn('Failed to set preference:', error); } }

// Note: rows view removed — suggestions now always render as a carousel

// Accessible, centered carousel using scroll-snap + buttons
function createArrow(dir) {
  const button = document.createElement('button'); button.type = 'button';
  button.className = `carousel-arrow ${dir}`;
  button.innerHTML = dir === 'prev' ? '&#10094;' : '&#10095;';
  button.setAttribute('aria-label', dir === 'prev' ? 'Previous' : 'Next');
  return button;
}
function renderCarousel(container, items) {
  // Use safe container update
  const containerElement = container;
  containerElement.innerHTML = '';
  const prev = createArrow('prev'); const next = createArrow('next');
  const viewport = document.createElement('div'); viewport.className = 'carousel-viewport';
  const track = document.createElement('div'); track.className = 'carousel-track'; viewport.appendChild(track);
  containerElement.appendChild(prev); containerElement.appendChild(viewport); containerElement.appendChild(next);

  // sizing
  const measureBase = () => {
    const rect = containerElement.getBoundingClientRect();
    const cw = rect?.width || document.documentElement.clientWidth || window.innerWidth;
    const { base, smallScale } = computeLayout(cw);
    return Math.max(120, Math.round(base * smallScale));
  };
  let cardBase = measureBase();
  const build = () => {
    track.innerHTML = '';
    for (const it of items) {
      track.appendChild(makeCardItem(it.name, { base: cardBase, set: it.set, number: it.number, uid: it.uid }));
    }
  };
  build();
  const onResize = () => { const nb = measureBase(); if (nb !== cardBase) { cardBase = nb; build(); } };
  window.addEventListener('resize', onResize, { passive: true });

  // nav
  const page = dir => {
    const vw = viewport.clientWidth || 1;
    const delta = dir < 0 ? -vw : vw;
    viewport.scrollBy({ left: delta, behavior: 'smooth' });
  };
  prev.addEventListener('click', () => page(-1));
  next.addEventListener('click', () => page(+1));
}

// Controls per category
function _buildControls(/* current */) {
  // No controls - return empty div
  const bar = document.createElement('div'); bar.className = 'suggestion-controls';
  return bar;
}

// Main init
async function init() {
  // Only run on /suggested page
  const pathname = window.location.pathname;
  if (!pathname.match(/\/suggested(?:\.html)?$/i)) {
    return;
  }

  const data = await fetchSuggestions();
  const root = document.getElementById('suggestions-root'); const sect = document.getElementById('cards-landing');
  if (!root || !sect) {return;}
  root.innerHTML = '';

  const cats = (data.categories || []).filter(category => Array.isArray(category.items) && category.items.length);
  if (cats.length === 0) {
    const msg = document.createElement('div'); msg.className = 'note'; msg.textContent = 'No suggestions available.'; root.appendChild(msg);
  }

  const pref = getPref();
  for (const category of cats) {
    const block = document.createElement('div'); block.className = 'suggestion-block';
    const header = document.createElement('div'); header.className = 'suggestion-header';
    const title = document.createElement('h2'); title.textContent = category.title || category.id; header.appendChild(title);
    const state = { value: pref, onchange: () => {} };
    // Controls removed as requested
    block.appendChild(header);
    const area = document.createElement('div'); area.className = 'suggestion-area'; block.appendChild(area);
    // Always render as carousel (rows option removed)
    const render = () => { renderCarousel(area, category.items.slice(0, 48)); };
    state.onchange = render; render();
    root.appendChild(block);
  }

  try { sect.style.display = ''; if (sect.hasAttribute && sect.hasAttribute('hidden')) {sect.removeAttribute('hidden');} } catch {
    // Ignore DOM manipulation errors
  }
  const meta = document.getElementById('card-meta'); if (meta) {meta.style.display = 'none';}
  const analysis = document.getElementById('card-analysis'); if (analysis) {analysis.style.display = 'none';}
}

init();
