/**
 * Main application bootstrap and initialization
 * @module Main
 */

import { fetchReport, fetchOverrides, fetchArchetypeReport, fetchTournamentsList, fetchArchetypesList, fetchMeta, fetchCardIndex } from './api.js';
import { parseReport } from './parse.js';
import { render, renderSummary, updateLayout } from './render.js';
import { applyFiltersSort } from './controls.js';
import { initMissingThumbsDev, dumpMissingReport } from './dev/missingThumbs.js';
import { initCacheDev } from './dev/cacheDev.js';
import { getStateFromURL, setStateInURL, normalizeRouteOnLoad, parseHash } from './router.js';
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
 * Cache management for tournament data
 */
class DataCache {
  constructor() {
    this.cache = storage.get('gridCache');
    this.ttl = CONFIG.CACHE.TTL_MS;
  }

  isExpired(timestamp) {
    return Date.now() - (timestamp || 0) > this.ttl;
  }

  getCachedMaster(tournament) {
    const entry = this.cache?.master?.[tournament];
    if (!entry || this.isExpired(entry.ts)) {
      return null;
    }
    return entry;
  }

  setCachedMaster(tournament, data) {
    this.cache.master = this.cache.master || {};
    this.cache.master[tournament] = {
      ts: Date.now(),
      deckTotal: data.deckTotal,
      items: data.items
    };
    storage.set('gridCache', this.cache);
  }

  setCachedCardIndex(tournament, idx){
    this.cache.cardIndex = this.cache.cardIndex || {};
    this.cache.cardIndex[tournament] = { ts: Date.now(), idx };
    storage.set('gridCache', this.cache);
  }

  getCachedCardIndex(tournament){
    const entry = this.cache?.cardIndex?.[tournament];
    if(!entry || this.isExpired(entry.ts)) return null;
    return entry.idx;
  }

  getCachedArcheIndex(tournament) {
    const entry = this.cache?.archeIndex?.[tournament];
    if (!entry || this.isExpired(entry.ts)) {
      return null;
    }
    return entry.list;
  }

  setCachedArcheIndex(tournament, list) {
    this.cache.archeIndex = this.cache.archeIndex || {};
    this.cache.archeIndex[tournament] = {
      ts: Date.now(),
      list
    };
    storage.set('gridCache', this.cache);
  }
}

/**
 * Initialize tournament selector with data from API
 * @param {AppState} state
 * @returns {HTMLSelectElement}
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

/**
 * Load and parse tournament data
 * @param {string} tournament
 * @param {DataCache} cache
 * @returns {Promise<{deckTotal: number, items: any[]}>}
 */
async function loadTournamentData(tournament, cache) {
  // Check cache first
  const cached = cache.getCachedMaster(tournament);
  if (cached) {
    logger.debug(`Using cached data for ${tournament}`);
    return { deckTotal: cached.deckTotal, items: cached.items };
  }
  
  // Prefer precomputed cardIndex to avoid heavy parsing when available
  try{
    const idx = await fetchCardIndex(tournament);
    if(idx && idx.cards){
      const items = Object.keys(idx.cards).map(name => ({ name, ...idx.cards[name] }));
      const parsed = { deckTotal: idx.deckTotal, items };
      cache.setCachedMaster(tournament, parsed);
      return parsed;
    }
  }catch{}

  // Fallback to master.json
  const data = await fetchReport(tournament);
  const parsed = parseReport(data);
  
  // Cache the result
  cache.setCachedMaster(tournament, parsed);
  
  return parsed;
}

/**
 * Setup archetype selector and event handlers
 * @param {string} tournament
 * @param {DataCache} cache
 * @param {AppState} state
 */
async function setupArchetypeSelector(tournament, cache, state) {
  const archeSel = document.getElementById('archetype');
  if (!archeSel) return;

  // Clear existing options except "All archetypes"
  while (archeSel.children.length > 1) {
    archeSel.removeChild(archeSel.lastChild);
  }

  // Try to load archetype index
  let archetypesList = cache.getCachedArcheIndex(tournament);
  
  if (!archetypesList) {
    archetypesList = await safeAsync(
      () => fetchArchetypesList(tournament),
      `fetching archetypes for ${tournament}`,
      []
    );
    
    if (archetypesList.length > 0) {
      cache.setCachedArcheIndex(tournament, archetypesList);
    }
  }

  // Populate archetype options
  archetypesList.forEach(archetype => {
    const option = document.createElement('option');
    option.value = archetype;
    option.textContent = archetype.replace(/_/g, ' ');
    archeSel.appendChild(option);
  });

  // Set up change handler with caching
  const handleArchetypeChange = async () => {
    const selectedValue = archeSel.value;
    
    if (selectedValue === '__all__') {
      // Show all cards
      const data = await loadTournamentData(tournament, cache);
      state.current = data;
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      applyFiltersSort(data.items, state.overrides);
      setStateInURL({ archetype: selectedValue }, { merge: true });
      return;
    }

    // Load specific archetype data
    let cached = state.archeCache.get(selectedValue);
    if (!cached) {
      const data = await safeAsync(
        () => fetchArchetypeReport(tournament, selectedValue),
        `fetching archetype ${selectedValue}`,
        { items: [], deckTotal: 0 }
      );
      const parsed = parseReport(data);
      cached = { data, deckTotal: parsed.deckTotal, items: parsed.items };
      state.archeCache.set(selectedValue, cached);
    }

    state.current = { items: cached.items, deckTotal: cached.deckTotal };
    renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
    applyFiltersSort(cached.items, state.overrides);
    setStateInURL({ archetype: selectedValue }, { merge: true });
  };

  // Add event listener with cleanup
  state.cleanup.addEventListener(archeSel, 'change', handleArchetypeChange);
  
  // Set initial value from URL state
  const urlState = getStateFromURL();
  if (urlState.archetype && urlState.archetype !== '__all__') {
    // Check if this archetype exists in the list
    const hasArchetype = archetypesList.includes(urlState.archetype);
    archeSel.value = hasArchetype ? urlState.archetype : '__all__';
    if (hasArchetype) {
      handleArchetypeChange();
    }
  }
}

/**
 * Setup control event handlers
 * @param {AppState} state
 */
function setupControlHandlers(state) {
  const elements = validateElements({
    search: '#search',
    sort: '#sort',
    favFilter: '#fav-filter',
    tournament: '#tournament'
  }, 'controls');

  // Debounced search handler
  const handleSearch = debounce(() => {
    applyFiltersSort(state.current.items, state.overrides);
  // Use replace while typing to avoid polluting history; final commit can push
  setStateInURL({ q: elements.search.value }, { merge: true, replace: true });
  });

  // Sort change handler
  const handleSort = () => {
    applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ sort: elements.sort.value }, { merge: true });
  };

  // Favorites filter handler
  const handleFavoritesFilter = () => {
    applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ fav: elements.favFilter.value }, { merge: true });
  };

  // Tournament change handler
  const handleTournamentChange = async () => {
    const newTournament = elements.tournament.value;
    if (newTournament === state.currentTournament) return;

    logger.info(`Switching to tournament: ${newTournament}`);
    state.currentTournament = newTournament;
    state.archeCache.clear(); // Clear archetype cache

    const cache = new DataCache();
    
    // Load new tournament data
    const data = await loadTournamentData(newTournament, cache);
    state.current = data;

    // Update archetype selector
    await setupArchetypeSelector(newTournament, cache, state);

    // Reset archetype to "All"
    elements.archetype?.selectAll?.(0);

    // Update display
    renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
    applyFiltersSort(data.items, state.overrides);
    setStateInURL({ tour: newTournament }, { merge: true });
  };

  // Add event listeners with cleanup
  state.cleanup.addEventListener(elements.search, 'input', handleSearch);
  state.cleanup.addEventListener(elements.sort, 'change', handleSort);
  state.cleanup.addEventListener(elements.favFilter, 'change', handleFavoritesFilter);
  state.cleanup.addEventListener(elements.tournament, 'change', handleTournamentChange);

  // Restore initial state from URL
  const urlState = getStateFromURL();
  if (urlState.q) elements.search.value = urlState.q;
  if (urlState.sort) elements.sort.value = urlState.sort;
  if (urlState.fav && elements.favFilter) elements.favFilter.value = urlState.fav;
}

// Restore state from URL when navigating back/forward
function handlePopState(state){
  logger.debug('popstate detected, restoring URL state');
  const parsed = parseHash();
  if(parsed.route === 'card' && parsed.name){
    const target = `${location.pathname.replace(/index\.html?$/i, 'card.html')}${location.search}#card/${encodeURIComponent(parsed.name)}`;
    location.assign(target);
    return;
  }
  applyInitialState(state);
}

window.addEventListener('popstate', () => handlePopState(appState));

/**
 * Setup layout resize handler
 * @param {AppState} state
 */
function setupResizeHandler(state) {
  // rAF scheduler: update at most once per animation frame during resize
  let ticking = false;
  const onResize = () => {
    if (ticking) return;
    ticking = true;
    try {
      window.requestAnimationFrame(() => {
        logger.debug('Window resized (rAF), updating layout');
        updateLayout();
        ticking = false;
      });
    } catch {
      // Fallback without rAF
      updateLayout();
      ticking = false;
    }
  };

  state.cleanup.addEventListener(window, 'resize', onResize);
}

/**
 * Apply initial filters from URL state
 * @param {AppState} state
 */
function applyInitialState(state) {
  const urlState = getStateFromURL();
  const elements = validateElements({
    search: '#search',
    sort: '#sort', 
    archetype: '#archetype',
    favFilter: '#fav-filter'
  }, 'applying initial state');

  // Apply URL state to controls and trigger filtering
  if (urlState.q) {
    elements.search.value = urlState.q;
  }
  if (urlState.sort) {
    elements.sort.value = urlState.sort;
  }
  if (urlState.archetype && urlState.archetype !== '__all__') {
    elements.archetype.value = urlState.archetype;
    elements.archetype.dispatchEvent(new Event('change'));
  } else {
    applyFiltersSort(state.current.items, state.overrides);
  }
  if (urlState.fav && elements.favFilter) {
    elements.favFilter.value = urlState.fav === 'fav' ? 'fav' : 'all';
  }
}

/**
 * Main application initialization
 */
async function initializeApp() {
  try {
    // Normalize hash routes like #card/... to card.html
    if (normalizeRouteOnLoad()) return;

    logger.info('Initializing Ciphermaniac application');

    // Initialize development tools
    initMissingThumbsDev();
    initCacheDev();

    // Create application state
    appState = new AppState();
    const cache = new DataCache();

    // Load configuration data
    appState.overrides = await safeAsync(
      () => fetchOverrides(),
      'loading thumbnail overrides',
      {}
    );

    // Initialize tournament selector
    const tournamentSelect = await initializeTournamentSelector(appState);

    // Load initial tournament data
    const initialData = await loadTournamentData(appState.currentTournament, cache);
    appState.current = initialData;

    // Setup archetype selector
    await setupArchetypeSelector(appState.currentTournament, cache, appState);

    // Setup all control handlers
    setupControlHandlers(appState);

    // Setup resize handler
    setupResizeHandler(appState);

    // Initial render
    renderSummary(document.getElementById('summary'), initialData.deckTotal, initialData.items.length);
    
    // Apply initial state from URL
    applyInitialState(appState);

    logger.info('Application initialization complete');

  } catch (error) {
    logger.exception('Failed to initialize application', error);
    
    // Show user-friendly error message
    const grid = document.getElementById('grid');
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h2>Failed to load</h2>
          <p>Unable to initialize the application. Please refresh the page or try again later.</p>
        </div>
      `;
    }
  }
}

// Start the application
initializeApp();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (appState) {
    appState.destroy();
  }
});
