import '../utils/buildVersion.js';
import { initBackToTop } from '../components/backToTop.js';
import { restoreGridScroll } from '../utils/scrollRestore.js';
import { initGridResizeObserver, renderSummary, updateLayout } from '../render.js';
import { normalizeRouteOnLoad } from '../router.js';
import { logger } from '../utils/logger.js';
import { debounce } from '../utils/performance.js';
import { DataCache } from '../utils/DataCache.js';
import { applyPageSeo, buildWebPageSchema } from '../utils/seo.js';
import { appState, DEFAULT_ONLINE_META } from './state.js';
import { getInitialTournamentSelection, loadSelectionData, loadTournamentList } from './data.js';
import {
  applyCurrentFilters,
  consumeFiltersRedirectFlag,
  setupActiveFilterCallbacks,
  setupArchetypeSelector,
  setupControlHandlers,
  setupDropdownFilters,
  updateSetFilterOptions
} from './render.js';

async function init() {
  try {
    logger.info('Initializing application...');

    const path = window.location.pathname.replace(/\/$/, '');
    if (path === '/cards' || path === '/cards.html') {
      const title = 'Pokemon TCG Card Database - Usage Stats & Prices | Ciphermaniac';
      const description =
        'Browse Pokemon TCG card usage statistics, deck inclusion rates, and market prices. Filter by archetype, card type, set, and tournament performance.';
      const canonicalPath = '/cards';
      const absoluteCanonical = new URL(canonicalPath, window.location.origin).toString();
      const hasQuery = window.location.search.length > 0;

      applyPageSeo({
        title,
        description,
        canonicalPath,
        structuredData: buildWebPageSchema(title, description, absoluteCanonical),
        robots: hasQuery ? 'noindex, follow' : 'index, follow'
      });
    }

    appState.cache = new DataCache();

    if (normalizeRouteOnLoad()) {
      return;
    }

    setupDropdownFilters(appState);
    setupControlHandlers(appState);
    setupActiveFilterCallbacks(appState);

    initBackToTop();
    initGridResizeObserver();
    window.addEventListener(
      'resize',
      debounce(() => {
        updateLayout();
      }, 100)
    );

    const { selection: initialSelection, needsTournamentList } = getInitialTournamentSelection(appState);
    appState.selectedTournaments = initialSelection;
    appState.currentTournament = initialSelection[0] || null;

    logger.info(`Starting with initial selection: ${initialSelection.join(', ')}`);

    const { cache } = appState;
    let finalSelection = initialSelection;

    if (needsTournamentList) {
      logger.info('URL specifies tournament, loading tournament list for validation');
      await loadTournamentList(appState, initialSelection);

      finalSelection = appState.selectedTournaments.length > 0 ? appState.selectedTournaments : [DEFAULT_ONLINE_META];

      logger.info(`Validated selection: ${finalSelection.join(', ')}`);
    }

    const data = await loadSelectionData(finalSelection, cache!, {
      showSkeleton: true,
      successFilter: appState.successFilter
    });
    appState.current = data;

    renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
    updateSetFilterOptions(data.items);

    await Promise.all([setupArchetypeSelector(finalSelection, cache!, appState), applyCurrentFilters(appState)]);

    restoreGridScroll();

    const redirectPayload = consumeFiltersRedirectFlag();
    if (redirectPayload) {
      logger.info('Consuming filters redirect payload', redirectPayload);
      if (redirectPayload.sets) {
        const setsDropdown = appState.ui?.dropdowns?.sets;
        if (setsDropdown) {
          setsDropdown.setSelection(redirectPayload.sets);
        }
      }
    }

    if (!needsTournamentList) {
      logger.info('Deprioritizing tournament list load (not needed for initial render)');
      setTimeout(() => {
        loadTournamentList(appState, initialSelection).catch(error => {
          logger.warn('Background tournament list load failed', error);
        });
      }, 100);
    }

    logger.info('Initialization complete');
  } catch (error) {
    logger.exception('Fatal initialization error', error);
    const grid = document.getElementById('grid');
    if (grid) {
      grid.innerHTML = `<div class="error-state">
                <h2>Something went wrong</h2>
                <p>Failed to load application data. Please try refreshing the page.</p>
                <pre>${error instanceof Error ? error.message : String(error)}</pre>
            </div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
