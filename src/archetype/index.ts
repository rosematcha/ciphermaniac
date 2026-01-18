import { fetchArchetypeReport, fetchReport } from '../api.js';
import { parseReport } from '../parse.js';
import { updateLayout } from '../render.js';
import { AppError, ErrorTypes } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { GRANULARITY_DEFAULT_PERCENT, SUCCESS_FILTER_LABELS } from './constants.js';
import { applyFilters } from './filters/apply.js';
import { addQuickFilterForCard, populateCardDropdowns } from './filters/rows.js';
import { updateFilterMessage } from './filters/utils.js';
import { getState } from './state.js';
import { elements } from './ui/elements.js';
import { setupControlsToggle, setupFilterCollapse } from './ui/controls.js';
import { setupGranularityListeners, syncGranularityOutput } from './ui/granularity.js';
import { setupTabNavigation } from './ui/keyboard.js';
import { setPageState, showError, toggleLoading, updateHero } from './ui/page.js';
import { renderCards } from './ui/render.js';
import { setQuickFilterHandler, setupSkeletonExport } from './ui/skeleton.js';
import { decodeArchetypeLabel } from './utils/format.js';

const state = getState();

function extractArchetypeFromLocation(loc = window.location) {
  const params = new URLSearchParams(loc.search);
  const paramValue = params.get('archetype');
  if (paramValue) {
    return paramValue;
  }

  const pathname = loc.pathname || '';
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  if (parts[0] === 'archetype' && parts.length > 1) {
    try {
      return decodeURIComponent(parts[1]);
    } catch {
      return parts[1];
    }
  }

  try {
    return decodeURIComponent(parts[0]);
  } catch {
    return parts[0];
  }
}

function setupSuccessFilter() {
  const select = elements.successFilter;
  if (!select) {
    return;
  }
  select.value = state.successFilter;
  select.addEventListener('change', async event => {
    const target = event.target as HTMLSelectElement | null;
    const next = String(target?.value || 'all');
    if (next === state.successFilter) {
      return;
    }
    state.successFilter = next;
    state.filterCache.clear();
    updateFilterMessage(`Loading ${SUCCESS_FILTER_LABELS[next] || 'selected finish'} decks...`, 'info');
    try {
      await applyFilters();
    } catch (error) {
      logger.exception('Failed to apply success filter', error);
      updateFilterMessage('Unable to apply placement filter. Showing all decks instead.', 'warning');
      state.successFilter = 'all';
      if (elements.successFilter) {
        elements.successFilter.value = 'all';
      }
      await applyFilters();
    }
  });
}

async function initialize() {
  const base = extractArchetypeFromLocation();
  if (!base) {
    showError('Choose an archetype from the archetypes page first.');
    setPageState('error');
    toggleLoading(false);
    return;
  }

  state.archetypeBase = base;
  state.archetypeLabel = decodeArchetypeLabel(base);
  state.thresholdPercent = GRANULARITY_DEFAULT_PERCENT;
  syncGranularityOutput(GRANULARITY_DEFAULT_PERCENT);

  try {
    setPageState('loading');
    toggleLoading(true);

    const onlineMeta = 'Online - Last 14 Days';
    state.tournament = onlineMeta;

    const [overrides, tournamentReport, archetypeRaw] = await Promise.all([
      Promise.resolve<Record<string, string>>({}),
      fetchReport(state.tournament),
      fetchArchetypeReport(state.tournament, state.archetypeBase)
    ]);

    if (!tournamentReport || typeof tournamentReport.deckTotal !== 'number') {
      throw new AppError(
        ErrorTypes.DATA_FORMAT,
        `Tournament report for ${state.tournament} is missing deck totals.`
      );
    }

    const parsedArchetype = parseReport(archetypeRaw);
    Object.assign(state, {
      overrides: overrides || {},
      tournamentDeckTotal: tournamentReport.deckTotal,
      archetypeDeckTotal: parsedArchetype.deckTotal,
      items: parsedArchetype.items,
      allCards: parsedArchetype.items,
      defaultItems: parsedArchetype.items,
      defaultDeckTotal: parsedArchetype.deckTotal,
      filterCache: new Map()
    });

    updateHero();
    updateFilterMessage('');
    setupSuccessFilter();
    populateCardDropdowns();

    if (elements.loading) {
      elements.loading.hidden = true;
    }
    if (elements.error) {
      elements.error.hidden = true;
    }
    const simple = elements.simple as HTMLElement | null;
    const grid = elements.grid as HTMLElement | null;
    if (simple) {
      simple.hidden = false;
    }
    if (grid) {
      grid.hidden = false;
    }

    renderCards();

    setPageState('ready');
  } catch (error) {
    logger.exception('Failed to load archetype detail', error);
    toggleLoading(false);
    showError("We couldn't load that archetype.");
    setPageState('error');
  }
}

/**
 * Initialize the archetype detail page.
 */
export function initArchetypePage(): void {
  if (typeof document === 'undefined') {
    return;
  }

  let resizeTicking = false;
  window.addEventListener('resize', () => {
    if (resizeTicking || state.items.length === 0) {
      return;
    }
    resizeTicking = true;
    requestAnimationFrame(() => {
      updateLayout();
      resizeTicking = false;
    });
  });

  setupGranularityListeners();
  setQuickFilterHandler(addQuickFilterForCard);
  setupSkeletonExport();
  setupFilterCollapse();
  setupControlsToggle();
  setupTabNavigation();
  initialize();
}
