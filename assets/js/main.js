/**
 * Main application bootstrap and initialization
 * @module Main
 */

// Clear any existing scroll listeners that might be left over from imagePreloader
(function clearExistingScrollListeners() {
  const oldListeners = window.__imagePreloaderListeners || [];
  oldListeners.forEach(listener => {
    window.removeEventListener('scroll', listener);
  });
  window.__imagePreloaderListeners = [];
}());

// DEBUG: Intercept Image loading to track erroneous thumbnail requests
(function setupImageLoadingDebug() {
  const OriginalImage = window.Image;
  const problematicCards = ['Boss\'s_Orders.png', 'Pokégear_3.0.png', 'Ethan\'s_', 'Team_Rocket\'s_', 'Lillie\'s_', 'Exp._Share.png', 'Pokémon_Catcher.png'];

  window.Image = function (...args) {
    const img = new OriginalImage(...args);
    const originalSrcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set;

    Object.defineProperty(img, 'src', {
      set(value) {
        // Catch all problematic thumbnail requests without set/number codes
        if (value.includes('thumbnails/') &&
            problematicCards.some(card => value.includes(card)) &&
            !value.match(/_[A-Z]+_\d+\.png$/)) { // Doesn't end with _SET_NUMBER.png
          console.error('🚨 ERRONEOUS THUMBNAIL REQUEST:', value);
          console.trace('Call stack:');
          // debugger; // Uncomment to break
        }
        originalSrcSetter.call(this, value);
      },
      get() {
        return this.getAttribute('src');
      }
    });

    return img;
  };

  // Copy static properties
  Object.setPrototypeOf(window.Image, OriginalImage);
  Object.setPrototypeOf(window.Image.prototype, OriginalImage.prototype);
}());

import { fetchReport, fetchOverrides, fetchArchetypeReport, fetchTournamentsList, fetchArchetypesList } from './api.js';
import { AppError, safeAsync } from './utils/errorHandler.js';
import { parseReport } from './parse.js';
import { renderSummary, updateLayout } from './render.js';
import { applyFiltersSort } from './controls.js';
import { initMissingThumbsDev as _initMissingThumbsDev } from './dev/missingThumbs.js';
import { initCacheDev } from './dev/cacheDev.js';
// import { imagePreloader } from './utils/imagePreloader.js'; // Disabled - using parallelImageLoader instead
import { getStateFromURL, setStateInURL, normalizeRouteOnLoad, parseHash } from './router.js';
import { logger } from './utils/logger.js';
import { storage } from './utils/storage.js';
import { CleanupManager, debounce, validateElements } from './utils/performance.js';
import { CONFIG } from './config.js';
import { prettyTournamentName } from './utils/format.js';
import { showGridSkeleton, hideGridSkeleton, updateSkeletonLayout } from './components/placeholders.js';

/**
 * Application state - simple object
 */
const appState = {
  currentTournament: null,
  current: { items: [], deckTotal: 0 },
  overrides: {},
  masterCache: new Map(),
  archeCache: new Map(),
  cleanup: new CleanupManager()
};

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

  setCachedCardIndex(tournament, idx) {
    this.cache.cardIndex = this.cache.cardIndex || {};
    this.cache.cardIndex[tournament] = { ts: Date.now(), idx };
    storage.set('gridCache', this.cache);
  }

  getCachedCardIndex(tournament) {
    const entry = this.cache?.cardIndex?.[tournament];
    if (!entry || this.isExpired(entry.ts)) {return null;}
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
    ['2025-08-15, World Championships 2025'], // fallback
    'fetching tournaments list'
  );

  const urlState = getStateFromURL();

  // Populate tournament options
  tournaments.forEach(tournament => {
    const option = document.createElement('option');
    option.value = tournament;
    option.textContent = prettyTournamentName(tournament);
    elements.tournamentSelect.appendChild(option);
  });

  // Set selected tournament from URL or use first as default
  const selectedTournament = urlState.tour && tournaments.includes(urlState.tour)
    ? urlState.tour
    : tournaments[0];

  elements.tournamentSelect.value = selectedTournament;
  // eslint-disable-next-line no-param-reassign
  state.currentTournament = selectedTournament;

  // Clean up URL if invalid tournament was specified
  if (urlState.tour && !tournaments.includes(urlState.tour)) {
    setStateInURL({ tour: selectedTournament }, { merge: true, replace: true });
  }

  logger.info(`Initialized with tournament: ${selectedTournament}`);
  return elements.tournamentSelect;
}

/**
 * Load and parse tournament data
 * @param {string} tournament
 * @param {DataCache} cache
 * @param {boolean} showSkeletonLoading - Whether to show skeleton loading state
 * @returns {Promise<{deckTotal: number, items: any[]}>}
 */
async function loadTournamentData(tournament, cache, showSkeletonLoading = false) {
  // Check cache first
  const cached = cache.getCachedMaster(tournament);
  if (cached) {
    logger.debug(`Using cached data for ${tournament}`);
    return { deckTotal: cached.deckTotal, items: cached.items };
  }

  // Show skeleton loading if requested
  if (showSkeletonLoading) {
    showGridSkeleton();
  }

  try {
    // Note: Do not use aggregated cardIndex for main grid; master.json preserves per-variant distinctions.

    // Fallback to master.json
    const data = await fetchReport(tournament);
    const parsed = parseReport(data);

    // Cache the result
    cache.setCachedMaster(tournament, parsed);

    return parsed;
  } finally {
    // Always hide skeleton when done
    if (showSkeletonLoading) {
      hideGridSkeleton();
    }
  }
}

/**
 * Setup archetype selector and event handlers
 * @param {string} tournament
 * @param {DataCache} cache
 * @param {AppState} state
 * @param {boolean} skipUrlInit - Skip URL-based initialization (e.g., during tournament change)
 */
async function setupArchetypeSelector(tournament, cache, state, skipUrlInit = false) {
  const archeSel = document.getElementById('archetype');
  if (!archeSel) {return;}

  // Clear existing options except "All archetypes"
  while (archeSel.children.length > 1) {
    archeSel.removeChild(archeSel.lastChild);
  }

  // Try to load archetype index
  let archetypesList = cache.getCachedArcheIndex(tournament);

  if (!archetypesList) {
    archetypesList = await safeAsync(
      () => fetchArchetypesList(tournament),
      [], // fallback
      `fetching archetypes for ${tournament}`
    );

    if (archetypesList.length > 0) {
      cache.setCachedArcheIndex(tournament, archetypesList);
    }
  }

  // Ensure we have an array
  if (!Array.isArray(archetypesList)) {
    logger.warn('archetypesList is not an array, using empty array as fallback', { archetypesList, tournament });
    archetypesList = [];
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
    const { currentTournament } = state;

    if (selectedValue === '__all__') {
      // Show all cards
      const data = await loadTournamentData(currentTournament, cache);
      // eslint-disable-next-line no-param-reassign, require-atomic-updates
      state.current = data;
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      await applyFiltersSort(data.items, state.overrides);
      setStateInURL({ archetype: selectedValue }, { merge: true });
      return;
    }

    // Load specific archetype data
    let cached = state.archeCache.get(selectedValue);
    if (!cached) {
      let data;
      try {
        data = await fetchArchetypeReport(currentTournament, selectedValue);
      } catch (error) {
        // Handle missing archetype files gracefully
        if (error instanceof AppError && error.context?.status === 404) {
          logger.debug(`Archetype ${selectedValue} not available for ${currentTournament}, using empty data`);
          data = { items: [], deckTotal: 0 };
        } else {
          // Log other errors normally and use fallback
          logger.exception(`Failed fetching archetype ${selectedValue}`, error);
          data = { items: [], deckTotal: 0 };
        }
      }

      const parsed = parseReport(data);
      cached = { data, deckTotal: parsed.deckTotal, items: parsed.items };
      state.archeCache.set(selectedValue, cached);
    }

    // eslint-disable-next-line no-param-reassign
    state.current = { items: cached.items, deckTotal: cached.deckTotal };
    renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
    await applyFiltersSort(cached.items, state.overrides);
    setStateInURL({ archetype: selectedValue }, { merge: true });
  };

  // Add event listener with cleanup
  state.cleanup.addEventListener(archeSel, 'change', handleArchetypeChange);

  // Set initial value from URL state (unless skipping URL initialization)
  if (!skipUrlInit) {
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
    tournament: '#tournament',
    archetype: '#archetype'
  }, 'controls');

  // Debounced search handler
  const handleSearch = debounce(async () => {
    await applyFiltersSort(state.current.items, state.overrides);
    // Use replace while typing to avoid polluting history; final commit can push
    setStateInURL({ 'q': elements.search.value }, { merge: true, replace: true });
  });

  // Sort change handler
  const handleSort = async () => {
    await applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ sort: elements.sort.value }, { merge: true });
  };

  // Favorites filter handler
  const handleFavoritesFilter = async () => {
    await applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ fav: elements.favFilter.value }, { merge: true });
  };

  // Tournament change handler
  const handleTournamentChange = async () => {
    const newTournament = elements.tournament.value;
    if (newTournament === state.currentTournament) {return;}

    // Get currently selected archetype before switching
    const currentArchetype = elements.archetype?.value || '__all__';

    logger.info(`Switching to tournament: ${newTournament}`);
    // eslint-disable-next-line no-param-reassign
    state.currentTournament = newTournament;
    state.archeCache.clear(); // Clear archetype cache
    // imagePreloader.clearCache(); // Clear image preloader cache - disabled

    const cache = new DataCache();

    // Load new tournament data with skeleton loading
    const data = await loadTournamentData(newTournament, cache, true);
    // eslint-disable-next-line no-param-reassign, require-atomic-updates
    state.current = data;

    // Load archetype list for the new tournament to check availability
    const newArchetypesList = await safeAsync(
      () => fetchArchetypesList(newTournament),
      `fetching archetypes for ${newTournament}`,
      []
    );

    // Determine if we can preserve the current archetype
    const canPreserveArchetype = currentArchetype !== '__all__' && newArchetypesList.includes(currentArchetype);
    const targetArchetype = canPreserveArchetype ? currentArchetype : '__all__';

    logger.debug(`Archetype preservation: ${currentArchetype} → ${targetArchetype} (available: ${canPreserveArchetype})`);

    // Update archetype selector (skip URL initialization to avoid conflicts)
    await setupArchetypeSelector(newTournament, cache, state, true);

    // Set archetype to preserved value or "All"
    const archetypeElement = elements.archetype;
    archetypeElement.value = targetArchetype;

    // Load archetype data if preserving a specific archetype
    if (canPreserveArchetype) {
      // Trigger archetype change to load the specific archetype data
      const archetypeChangeEvent = new Event('change');
      elements.archetype.dispatchEvent(archetypeChangeEvent);
    } else {
      // Update display with all tournament data
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      await applyFiltersSort(data.items, state.overrides);
    }

    // Update URL with both tournament and archetype
    setStateInURL({ tour: newTournament, archetype: targetArchetype }, { merge: true });
  };

  // Add event listeners with cleanup
  state.cleanup.addEventListener(elements.search, 'input', handleSearch);
  state.cleanup.addEventListener(elements.sort, 'change', handleSort);
  state.cleanup.addEventListener(elements.favFilter, 'change', handleFavoritesFilter);
  state.cleanup.addEventListener(elements.tournament, 'change', handleTournamentChange);

  // Restore initial state from URL
  const urlState = getStateFromURL();
  if (urlState.q) {elements.search.value = urlState.q;}
  if (urlState.sort) {elements.sort.value = urlState.sort;}
  if (urlState.fav && elements.favFilter) {elements.favFilter.value = urlState.fav;}
}

// Restore state from URL when navigating back/forward
async function handlePopState(state) {
  logger.debug('popstate detected, restoring URL state');
  const parsed = parseHash();
  if (parsed.route === 'card' && parsed.name) {
    const target = `${location.pathname.replace(/index\.html?$/i, 'card.html')}${location.search}#card/${encodeURIComponent(parsed.name)}`;
    location.assign(target);
    return;
  }
  await applyInitialState(state);
}

window.addEventListener('popstate', () => {
  handlePopState(appState).catch(error => logger.error('Failed to handle popstate', error));
});

/**
 * Setup layout resize handler
 * @param {AppState} state
 */
function setupResizeHandler(state) {
  // rAF scheduler: update at most once per animation frame during resize
  let ticking = false;
  const onResize = () => {
    if (ticking) {return;}
    ticking = true;
    try {
      window.requestAnimationFrame(() => {
        logger.debug('Window resized (rAF), updating layout');
        // Update skeleton layout if it's currently showing
        updateSkeletonLayout();
        updateLayout();
        ticking = false;
      });
    } catch {
      // Fallback without rAF
      updateSkeletonLayout();
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
async function applyInitialState(state) {
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
    await applyFiltersSort(state.current.items, state.overrides);
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
    if (normalizeRouteOnLoad()) {return;}

    logger.info('Initializing Ciphermaniac application');

    // Show skeleton loading immediately
    showGridSkeleton();

    // Initialize development tools
    // initMissingThumbsDev(); // Disabled to prevent redundant thumbnail requests
    initCacheDev();

    const cache = new DataCache();

    // Load configuration data
    appState.overrides = await safeAsync(
      () => fetchOverrides(),
      'loading thumbnail overrides',
      {}
    );

    // Initialize tournament selector
    await initializeTournamentSelector(appState);

    // Load initial tournament data
    const initialData = await loadTournamentData(appState.currentTournament, cache);
    // eslint-disable-next-line no-param-reassign, require-atomic-updates
    appState.current = initialData;

    // Setup archetype selector
    await setupArchetypeSelector(appState.currentTournament, cache, appState);

    // Setup all control handlers
    setupControlHandlers(appState);

    // Setup resize handler
    setupResizeHandler(appState);

    // Hide skeleton and show real content
    hideGridSkeleton();

    // Initial render
    renderSummary(document.getElementById('summary'), initialData.deckTotal, initialData.items.length);

    // Apply initial state from URL
    await applyInitialState(appState);

    logger.info('Application initialization complete');
  } catch (error) {
    logger.exception('Failed to initialize application', error);

    // Hide skeleton and show error
    hideGridSkeleton();

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
  appState.cleanup.cleanup();
});
