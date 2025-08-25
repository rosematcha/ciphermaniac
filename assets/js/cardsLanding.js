import { buildThumbCandidates } from './thumbs.js';
import { computeLayout } from './layoutHelper.js';

// Data fetch
async function fetchSuggestions(){
  try{
    const res = await fetch('reports/suggestions.json', { cache: 'no-store' });
    if(!res.ok) {return { categories: [] };}
    const data = await res.json();
    return { categories: Array.isArray(data.categories) ? data.categories : [] };
  }catch{ return { categories: [] }; }
}

// Card item factory
function makeCardItem(name, opts){
  const card = document.createElement('article');
  card.className = 'card';
  card.setAttribute('role','link');
  card.setAttribute('tabindex','0');
  card.setAttribute('aria-label', `${name} – open details`);
  if(opts && typeof opts.base === 'number') {card.style.setProperty('--card-base', Math.round(opts.base) + 'px');}

  const thumb = document.createElement('div'); thumb.className = 'thumb';
  const img = document.createElement('img'); img.alt = name; img.loading = 'lazy'; img.decoding = 'async';
  img.style.opacity = '0'; img.style.transition = 'opacity .18s ease-out';
  const candidates = buildThumbCandidates(name, /*useSm*/ false, {}, { set: opts?.set, number: opts?.number });
  let idx = 0; const tryNext = () => { if(idx >= candidates.length) {return;} img.src = candidates[idx++]; };
  img.onerror = tryNext; img.onload = () => { img.style.opacity = '1'; };
  tryNext(); thumb.appendChild(img);

  const titleRow = document.createElement('div'); titleRow.className = 'titleRow';
  const h3 = document.createElement('h3'); h3.className = 'name'; h3.textContent = name; h3.title = name; titleRow.appendChild(h3);
  card.appendChild(thumb); card.appendChild(titleRow);

  // Use UID if available, otherwise fall back to name
  const cardIdentifier = opts?.uid || name;
  const url = `card.html#card/${encodeURIComponent(cardIdentifier)}`;
  const go = (newTab) => { newTab ? window.open(url, '_blank') : location.assign(url); };
  card.addEventListener('click', (e)=>{ go(e.ctrlKey||e.metaKey); });
  card.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(false); } });
  return card;
}

// View preference
const PREF_KEY = 'suggestionsView';
function getPref(){ try{ return localStorage.getItem(PREF_KEY) || 'carousel'; }catch(error){ console.warn('Failed to get preference:', error); return 'carousel'; } }
// Note: setPref currently unused but kept for future use
// eslint-disable-next-line no-unused-vars
function setPref(v){ try{ localStorage.setItem(PREF_KEY, v); }catch(error){ console.warn('Failed to set preference:', error); } }

// Note: rows view removed — suggestions now always render as a carousel

// Accessible, centered carousel using scroll-snap + buttons
function createArrow(dir){
  const b = document.createElement('button'); b.type='button';
  b.className = `carousel-arrow ${dir}`;
  b.innerHTML = dir === 'prev' ? '&#10094;' : '&#10095;';
  b.setAttribute('aria-label', dir==='prev' ? 'Previous' : 'Next');
  return b;
}
function renderCarousel(container, items){
  // Use safe container update
  container.innerHTML = '';
  const prev = createArrow('prev'); const next = createArrow('next');
  const viewport = document.createElement('div'); viewport.className='carousel-viewport';
  const track = document.createElement('div'); track.className='carousel-track'; viewport.appendChild(track);
  container.appendChild(prev); container.appendChild(viewport); container.appendChild(next);

  // sizing
  const measureBase = () => {
    const rect = container.getBoundingClientRect();
    const cw = rect?.width || document.documentElement.clientWidth || window.innerWidth;
    const { base, smallScale } = computeLayout(cw);
    return Math.max(120, Math.round(base * smallScale));
  };
  let cardBase = measureBase();
  const build = () => {
    track.innerHTML = '';
    for(const it of items){
      track.appendChild(makeCardItem(it.name, { base: cardBase, set: it.set, number: it.number, uid: it.uid }));
    }
  };
  build();
  const onResize = () => { const nb = measureBase(); if(nb !== cardBase){ cardBase = nb; build(); } };
  window.addEventListener('resize', onResize, { passive:true });

  // nav
  const page = (dir) => {
    const vw = viewport.clientWidth || 1;
    const delta = dir<0 ? -vw : vw;
    viewport.scrollBy({ left: delta, behavior: 'smooth' });
  };
  prev.addEventListener('click', ()=>page(-1));
  next.addEventListener('click', ()=>page(+1));
}

// Controls per category
function buildControls(/* current */){
  // Simple static control indicating carousel-only view
  const bar = document.createElement('div'); bar.className='suggestion-controls';
  const label = document.createElement('span'); label.textContent = 'View:'; bar.appendChild(label);
  const car = document.createElement('span'); car.className = 'seg is-active'; car.textContent = 'Carousel';
  bar.appendChild(car);
  return bar;
}

// Main init
async function init(){
  // Only show landing on card page when no specific card is selected
  if(/^(?:#card\/)/.test(location.hash) || new URLSearchParams(location.search).has('name')) {return;}
  const data = await fetchSuggestions();
  const root = document.getElementById('suggestions-root'); const sect = document.getElementById('cards-landing');
  if(!root || !sect) {return;}
  root.innerHTML = '';

  const cats = (data.categories||[]).filter(c=>Array.isArray(c.items) && c.items.length);
  if(cats.length === 0){
    const msg = document.createElement('div'); msg.className = 'note'; msg.textContent = 'No suggestions available.'; root.appendChild(msg);
  }

  const pref = getPref();
  for(const c of cats){
    const block = document.createElement('div'); block.className='suggestion-block';
    const header = document.createElement('div'); header.className='suggestion-header';
    const title = document.createElement('h2'); title.textContent = c.title || c.id; header.appendChild(title);
    const state = { value: pref, onchange: ()=>{} };
    const controls = buildControls(); header.appendChild(controls);
    block.appendChild(header);
    const area = document.createElement('div'); area.className='suggestion-area'; block.appendChild(area);
    // Always render as carousel (rows option removed)
    const render = () => { renderCarousel(area, c.items.slice(0, 48)); };
    state.onchange = render; render();
    root.appendChild(block);
  }

  try{ sect.style.display = ''; if(sect.hasAttribute && sect.hasAttribute('hidden')) {sect.removeAttribute('hidden');} }catch{}
  const meta = document.getElementById('card-meta'); if(meta) {meta.style.display = 'none';}
  const analysis = document.getElementById('card-analysis'); if(analysis) {analysis.style.display = 'none';}
}

init();
