/**
 * Main application bootstrap and initialization
 * @module Main
 */

import { fetchReport, fetchOverrides, fetchArchetypeReport, fetchTournamentsList, fetchArchetypesList } from './api.js';
import { parseReport } from './parse.js';
import { render, renderSummary, updateLayout } from './render.js';
import { applyFiltersSort } from './controls.js';
import { initMissingThumbsDev, dumpMissingReport } from './dev/missingThumbs.js';
import { initCacheDev } from './dev/cacheDev.js';
import { getStateFromURL, setStateInURL, normalizeRouteOnLoad } from './router.js';
import { logger } from './utils/logger.js';
import { storage } from './utils/storage.js';
import { CleanupManager, debounce, validateElements } from './utils/performance.js';
import { CONFIG } from './config.js';
import { safeAsync } from './utils/errorHandler.js';

/**
 * Application state and caches
 */
class AppState {
  constructor() {
    this.currentTournament = null;
    this.current = { items: [], deckTotal: 0 };
    this.overrides = {};
    this.masterCache = new Map();
    this.archeCache = new Map();
    this.cleanup = new CleanupManager();
  }

  /**
   * Clean up application resources
   */
  destroy() {
    this.cleanup.cleanup();
  }
}

let appState;

/**
 * Initialize tournament selector with data from API
 * @param {AppState} state
 */
async function initializeTournamentSelector(state) {
  const elements = validateElements({
    tournamentSelect: '#tournament'
  }, 'tournament selector');
  
  const tournaments = await safeAsync(
    () => fetchTournamentsList(),
    'fetching tournaments list',
    ['World Championships 2025'] // fallback
  );
  
  const urlState = getStateFromURL();
  
  // Populate tournament options
  tournaments.forEach(tournament => {
    const option = document.createElement('option');
    option.value = tournament;
    option.textContent = tournament;
    elements.tournamentSelect.appendChild(option);
  });
  
  // Set selected tournament from URL or use first as default
  const selectedTournament = urlState.tour && tournaments.includes(urlState.tour) 
    ? urlState.tour 
    : tournaments[0];
  
  elements.tournamentSelect.value = selectedTournament;
  state.currentTournament = selectedTournament;
  
  // Clean up URL if invalid tournament was specified
  if (urlState.tour && !tournaments.includes(urlState.tour)) {
    setStateInURL({
      q: urlState.q,
      sort: urlState.sort,
      archetype: urlState.archetype,
      tour: selectedTournament
    }, { replace: true });
  }
  
  logger.info(`Initialized with tournament: ${selectedTournament}`);
  return elements.tournamentSelect;
}
  const cache = loadGridCache();
  const getCachedMaster = (tour) => {
    const entry = cache?.master?.[tour];
    if(!entry) return null;
    if(now - (entry.ts||0) > TTL_MS) return null;
    return entry;
  };
  const setCachedMaster = (tour, data) => {
    cache.master = cache.master || {};
    cache.master[tour] = { ts: Date.now(), deckTotal: data.deckTotal, items: data.items };
    saveGridCache(cache);
  };
  const getCachedArcheIndex = (tour) => {
    const entry = cache?.archeIndex?.[tour];
    if(!entry) return null;
    if(now - (entry.ts||0) > TTL_MS) return null;
    return entry;
  };
  const setCachedArcheIndex = (tour, list) => {
    cache.archeIndex = cache.archeIndex || {};
    cache.archeIndex[tour] = { ts: Date.now(), list };
    saveGridCache(cache);
  };
  try{
    // Prefill from cache if available
    const cached = getCachedMaster(currentTournament);
    if(cached){ ({ deckTotal, items } = cached); }
    // Always fetch fresh and update UI/cache
    const master = await fetchReport(currentTournament);
    const parsed = parseReport(master);
    ({ deckTotal, items } = parsed);
    setCachedMaster(currentTournament, parsed);
  }catch(err){
    console.error(err);
    document.getElementById('summary').textContent = `No data for "${currentTournament}". Ensure reports/${currentTournament}/master.json exists.`;
  }

  renderSummary(document.getElementById('summary'), deckTotal, items.length);

  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const favFilter = document.getElementById('fav-filter');
  const archeSel = document.getElementById('archetype');
  // Initialize controls from URL state
  if(urlState.q) search.value = urlState.q;
  if(urlState.sort && sort.querySelector(`option[value="${urlState.sort}"]`)) sort.value = urlState.sort;
  if(urlState.fav && favFilter && favFilter.querySelector(`option[value="${urlState.fav}"]`)) favFilter.value = urlState.fav;

  let current = { items, deckTotal };
  const rerender = () => {
    applyFiltersSort(current.items, overrides);
    dumpMissingReport();
  };
  const syncURL = (opts={}) => {
    setStateInURL({
      q: search.value.trim(),
      sort: sort.value,
      archetype: archeSel.value !== '__all__' ? archeSel.value : '',
      tour: currentTournament || '',
      fav: (favFilter && favFilter.value === 'fav') ? 'fav' : ''
    }, opts);
  };
  search.addEventListener('input', () => { rerender(); syncURL({ replace: true }); });
  sort.addEventListener('change', () => { rerender(); syncURL(); });
  if(favFilter){ favFilter.addEventListener('change', () => { rerender(); syncURL(); }); }
  rerender();

  // Reflow-only on resize so per-row scaling adapts without reloading images
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if(resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; updateLayout(); });
  });

  // cache per tournament
  const archeCacheByTournament = new Map(); // tournament -> Map(name -> {data, deckTotal, items})
  const getTournamentCache = (t) => {
    if(!archeCacheByTournament.has(t)) archeCacheByTournament.set(t, new Map());
    return archeCacheByTournament.get(t);
  };
  let archeCache = getTournamentCache(currentTournament);

  async function populateArchetypesSelector(tournament, preserveValue){
    // Remove all options except the first (All archetypes)
    while(archeSel.options.length > 1){ archeSel.remove(1); }
    let list = [];
    try{
      const cachedIndex = getCachedArcheIndex(tournament);
      if(cachedIndex){ list = cachedIndex.list; }
      // Fetch fresh and update cache
      const fresh = await fetchArchetypesList(tournament);
      list = Array.isArray(fresh) && fresh.length ? fresh : list;
      if(Array.isArray(fresh) && fresh.length){ setCachedArcheIndex(tournament, fresh); }
    }catch(err){
      console.warn('No archetype index for', tournament, err);
      list = [];
    }
  // Populate alphabetically without eager fetching; defer per-archetype fetch to selection/hover
  const entries = list.map(fileBase => ({ file: fileBase, label: fileBase.replace(/_/g,' ') }));
  entries.sort((a,b)=> a.label.localeCompare(b.label));
  for(const e of entries){
      const opt = document.createElement('option');
      opt.value = e.file;
      opt.textContent = e.label;
      archeSel.appendChild(opt);
    }
    // preserve selection if still present
    if(preserveValue && entries.some(e => e.file === preserveValue)){
      archeSel.value = preserveValue;
    }else{
      archeSel.value = '__all__';
    }
    // If URL requested a specific archetype and we have it, select it
    if(urlState.archetype && Array.from(archeSel.options).some(o=>o.value===urlState.archetype)){
      archeSel.value = urlState.archetype;
    }
  }

  await populateArchetypesSelector(currentTournament);
  // If URL selected an archetype, trigger dataset switch now; otherwise just sync URL
  if(archeSel.value !== '__all__'){
    archeSel.dispatchEvent(new Event('change'));
  }
  // Ensure URL reflects current initial state
  syncURL({ replace: true });

  archeSel.addEventListener('change', async () => {
    const val = archeSel.value;
    if(val === '__all__'){
      current = { items, deckTotal };
      renderSummary(document.getElementById('summary'), deckTotal, items.length);
      rerender(); syncURL();
      return;
    }
    let cached = archeCache.get(val);
    if(!cached){
      const data = await fetchArchetypeReport(currentTournament, val);
      const parsed = parseReport(data);
      cached = { data, deckTotal: parsed.deckTotal, items: parsed.items };
      archeCache.set(val, cached);
    }
    current = { items: cached.items, deckTotal: cached.deckTotal };
  renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
  rerender(); syncURL();
  });

  // Hover prefetch for the currently highlighted option in the native select (best-effort)
  // When the dropdown is open, many browsers update selectedIndex as you hover options.
  let lastPrefetched = null;
  archeSel.addEventListener('mousemove', async () => {
    const opt = archeSel.options[archeSel.selectedIndex];
    if(!opt) return;
    const val = opt.value;
    if(val === '__all__') return;
    if(lastPrefetched === val) return;
    lastPrefetched = val;
    if(!archeCache.has(val)){
      try{
        const data = await fetchArchetypeReport(currentTournament, val);
        const parsed = parseReport(data);
        archeCache.set(val, { data, deckTotal: parsed.deckTotal, items: parsed.items });
      }catch{/* ignore */}
    }
  });

  // Tournament change: refetch master and archetype summaries for the selected tournament
  tourSel.addEventListener('change', async () => {
    currentTournament = tourSel.value;
    const prevArchetype = archeSel.value !== '__all__' ? archeSel.value : null;
    let parsedMaster = { deckTotal: 0, items: [] };
    try{
      const masterNew = await fetchReport(currentTournament);
      parsedMaster = parseReport(masterNew);
    }catch(err){
      console.error(err);
      document.getElementById('summary').textContent = `No data for "${currentTournament}". Ensure reports/${currentTournament}/master.json exists.`;
    }
    // swap current dataset
    current = { items: parsedMaster.items, deckTotal: parsedMaster.deckTotal };
  renderSummary(document.getElementById('summary'), current.deckTotal, current.items.length);
  rerender(); syncURL();
    // warm archetype cache (non-blocking fetch)
    archeCache = getTournamentCache(currentTournament);
    await populateArchetypesSelector(currentTournament, prevArchetype);
    // If we preserved selection, switch dataset accordingly
    if(archeSel.value !== '__all__'){
      const sel = archeSel.value;
      const cached = archeCache.get(sel);
      if(cached){
        current = { items: cached.items, deckTotal: cached.deckTotal };
        renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
        rerender(); syncURL({ replace: true });
      }
    }
  });

  // Handle back/forward navigation restoring state
  window.addEventListener('popstate', () => {
    const st = getStateFromURL();
    // Tournament
    if(st.tour && tournaments.includes(st.tour) && tourSel.value !== st.tour){
      tourSel.value = st.tour;
      tourSel.dispatchEvent(new Event('change'));
    } else if(st.tour && !tournaments.includes(st.tour)){
      // Fallback to default and replace URL so back/forward remains sane
      tourSel.value = tournaments[0];
      setStateInURL({
        q: st.q,
        sort: st.sort,
        archetype: st.archetype,
        tour: tourSel.value
      }, { replace: true });
      tourSel.dispatchEvent(new Event('change'));
    }
    // Controls
    search.value = st.q || '';
    if(st.sort && sort.querySelector(`option[value="${st.sort}"]`)) sort.value = st.sort;
  if(st.archetype && Array.from(archeSel.options).some(o=>o.value===st.archetype)){
      archeSel.value = st.archetype;
      archeSel.dispatchEvent(new Event('change'));
    } else if(!st.archetype) {
      archeSel.value = '__all__';
      archeSel.dispatchEvent(new Event('change'));
    } else {
      rerender();
    }
  if(favFilter){ favFilter.value = (st.fav === 'fav') ? 'fav' : 'all'; }
  });
})();
