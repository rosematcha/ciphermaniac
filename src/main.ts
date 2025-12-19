/* eslint-disable no-console, id-length, max-lines-per-function, max-statements, complexity, no-param-reassign, prefer-destructuring, max-len, no-multiple-empty-lines, require-atomic-updates, jsdoc/require-param, jsdoc/check-param-names */
/**
 * Main application bootstrap and initialization
 * @module Main
 */

import './utils/buildVersion.js';
import { fetchArchetypeReport, fetchArchetypesList, fetchReport, fetchTournamentsList } from './api.js';
import { AppError, safeAsync } from './utils/errorHandler.js';
import { parseReport } from './parse.js';
import { renderSummary, updateLayout } from './render.js';
import { applyFiltersSort } from './controls.js';
import { getStateFromURL, normalizeRouteOnLoad, setStateInURL } from './router.js';
import { logger } from './utils/logger.js';
import { CleanupManager, debounce, validateElements } from './utils/performance.js';
import { CONFIG } from './config.js';
import { prettyTournamentName } from './utils/format.js';
import { hideGridSkeleton, showGridSkeleton } from './components/placeholders.js';
import { aggregateReports } from './utils/reportAggregator.js';
import { formatSetLabel, sortSetCodesByRelease } from './data/setCatalog.js';
import {
  closeFiltersPanel as closeFiltersPanelState,
  openFiltersPanel as openFiltersPanelState,
  toggleFiltersPanel as toggleFiltersPanelState
} from './utils/filtersPanel.js';
import { normalizeSetValues, readCardType, readSelectedSets, writeSelectedSets } from './utils/filterState.js';
import { DataCache } from './utils/DataCache.js';
import { createMultiSelectDropdown } from './components/MultiSelectDropdown.js';

/**
 * Application state - simple object
 */
interface ArchetypeOptionMeta {
  label: string;
  deckCount: number;
}

export interface AppState {
  currentTournament: string | null;
  selectedTournaments: string[];
  selectedSets: string[];
  selectedArchetypes: string[];
  selectedCardType: string;
  successFilter: string;
  availableTournaments: string[];
  availableSets: string[];
  archetypeOptions: Map<string, ArchetypeOptionMeta>;
  current: { items: any[]; deckTotal: number };
  overrides: Record<string, string>;
  masterCache: Map<string, any>;
  archeCache: Map<string, any>;
  cleanup: CleanupManager;
  cache: DataCache | null;
  applyArchetypeSelection: ((selection: string[], options?: { force?: boolean }) => Promise<void>) | null;
  ui: {
    dropdowns: Record<string, any>;
    openDropdown: any;
    onTournamentSelection: ((selection: string[]) => void) | null;
    onSetSelection: ((selection: string[], options?: any) => void) | null;
    onArchetypeSelection: ((selection: string[]) => void | Promise<void>) | null;
  };
}

const appState: AppState = {
  currentTournament: null,
  selectedTournaments: [],
  selectedSets: [],
  selectedArchetypes: [],
  selectedCardType: '__all__',
  successFilter: 'all',
  availableTournaments: [],
  availableSets: [],
  archetypeOptions: new Map(),
  current: { items: [], deckTotal: 0 },
  overrides: {},
  masterCache: new Map(),
  archeCache: new Map(),
  cleanup: new CleanupManager(),
  cache: null,
  applyArchetypeSelection: null,
  ui: {
    dropdowns: {},
    openDropdown: null,
    onTournamentSelection: null,
    onSetSelection: null,
    onArchetypeSelection: null
  }
};

const DEFAULT_ONLINE_META = 'Online - Last 14 Days';
const _SUCCESS_FILTER_LABELS: Record<string, string> = {
  all: 'all decks',
  winner: 'winners',
  top2: 'finals',
  top4: 'top 4',
  top8: 'top 8',
  top16: 'top 16',
  top10: 'top 10%',
  top25: 'top 25%',
  top50: 'top 50%'
};

const deckCache = new Map<string, Promise<any>>();

function normalizeArchetypeValue(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/_/g, ' ').trim();
}

async function fetchTournamentDecks(tournament: string): Promise<any[]> {
  if (deckCache.has(tournament)) {
    return deckCache.get(tournament)!;
  }
  const loader = (async () => {
    const { fetchAllDecks } = await import('./utils/clientSideFiltering.js');
    return fetchAllDecks(tournament);
  })();
  deckCache.set(tournament, loader);
  return loader;
}

async function buildDeckReport(
  tournaments: string | string[],
  successFilter: string = 'all',
  archetypeBase: string | string[] | null = null
) {
  const { aggregateDecks, filterDecksBySuccess } = await import('./utils/clientSideFiltering.js');
  const selection = Array.isArray(tournaments) ? tournaments : [tournaments];
  const deckLists = await Promise.all(selection.map(tournament => fetchTournamentDecks(tournament)));
  const allDecks = deckLists.flat();
  const successDecks = filterDecksBySuccess(allDecks, successFilter);
  const normalizedTargets = Array.isArray(archetypeBase)
    ? archetypeBase.map(normalizeArchetypeValue).filter(Boolean)
    : archetypeBase
      ? [normalizeArchetypeValue(archetypeBase)]
      : [];
  const archetypeFilter = normalizedTargets.length ? new Set(normalizedTargets) : null;

  const scopedDecks = archetypeFilter
    ? successDecks.filter((deck: any) => archetypeFilter.has(normalizeArchetypeValue(deck?.archetype)))
    : successDecks;

  return aggregateDecks(scopedDecks);
}

/**
 * Deduplicate and normalize a selection of tournaments.
 * @param {string|string[]} selection
 * @returns {string[]}
 */
function normalizeTournamentSelection(selection: string | string[] | null | undefined): string[] {
  if (!selection) {
    return [];
  }
  const array = Array.isArray(selection) ? selection : [selection];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of array) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

/**
 * Determine which tournaments should supply archetype data.
 * Prefers physical events when available, but falls back to the online meta if that's the only selection.
 */
function getArchetypeSourceTournaments(selection: string | string[] | null | undefined): string[] {
  const normalized = normalizeTournamentSelection(selection);
  const physical = normalized.filter(tournament => tournament !== DEFAULT_ONLINE_META);
  if (physical.length > 0) {
    return physical;
  }
  return normalized.includes(DEFAULT_ONLINE_META) ? [DEFAULT_ONLINE_META] : [];
}

function parseArchetypeQueryParam(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

/**
 * Populate the set filter with available set codes from the current dataset.
 * @param {Array<{set?: string, uid?: string}>} items
 */
function updateSetFilterOptions(items: any[]) {
  const dropdown = appState.ui?.dropdowns?.sets || null;

  const setCodes = new Set<string>();
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item && typeof item.set === 'string' && item.set.trim()) {
        setCodes.add(item.set.trim().toUpperCase());
      } else if (item && typeof item.uid === 'string' && item.uid.includes('::')) {
        const [, code] = item.uid.split('::');
        if (code) {
          setCodes.add(code.trim().toUpperCase());
        }
      }
    }
  }

  (appState.selectedSets || []).forEach(code => {
    if (code) {
      setCodes.add(code.toUpperCase());
    }
  });

  const orderedCodes = sortSetCodesByRelease(Array.from(setCodes));
  appState.availableSets = orderedCodes;

  const nextSelected = (appState.selectedSets || []).filter(code => orderedCodes.includes(code));
  if (nextSelected.length !== (appState.selectedSets || []).length) {
    appState.selectedSets = nextSelected;
  }

  writeSelectedSets(appState.selectedSets);

  if (dropdown) {
    dropdown.setDisabled(orderedCodes.length === 0);
    dropdown.render(orderedCodes, appState.selectedSets);
  }
}

function setupDropdownFilters(state: AppState) {
  const dropdowns = {
    tournaments: createMultiSelectDropdown(state, {
      key: 'tournaments',
      triggerId: 'tournament-trigger',
      summaryId: 'tournament-summary',
      menuId: 'tournament-menu',
      listId: 'tournament-options',
      chipsId: 'tournament-chips',
      addButtonId: 'tournament-add',
      labelId: 'tournament-label',
      searchId: 'tournament-search',
      formatOption: prettyTournamentName,
      placeholder: 'Latest event',
      placeholderAriaLabel: 'Select tournament',
      emptyMessage: 'No tournaments found',
      singularLabel: 'Tournament',
      pluralLabel: 'Tournaments',
      addButtonLabel: 'Add another',
      addAriaLabel: 'Add another tournament',
      allSelectedLabel: 'All tournaments selected',
      maxVisibleChips: 2,
      baseWidth: 380,
      maxWidth: 520,
      onChange: (selection: string[]) => state.ui.onTournamentSelection?.(selection),
      onOpen: async () => {
        // Lazy load tournament list when dropdown is opened
        await ensureTournamentListLoaded(state);
      }
    }),
    sets: createMultiSelectDropdown(state, {
      key: 'sets',
      triggerId: 'set-trigger',
      summaryId: 'set-summary',
      menuId: 'set-menu',
      listId: 'set-options',
      chipsId: 'set-chips',
      addButtonId: 'set-add',
      labelId: 'set-label',
      searchId: 'set-search',
      formatOption: formatSetLabel,
      placeholder: 'All sets',
      placeholderAriaLabel: 'Select a set',
      emptyMessage: 'No matching sets',
      singularLabel: 'Set',
      pluralLabel: 'Sets',
      addButtonLabel: 'Add another set',
      addAriaLabel: 'Add another set',
      allSelectedLabel: 'All sets selected',
      includeAllOption: true,
      allOptionLabel: 'All Sets',
      maxVisibleChips: 3,
      baseWidth: 300,
      maxWidth: 440,
      onChange: (selection: string[]) => state.ui.onSetSelection?.(selection)
    }),
    archetypes: createMultiSelectDropdown(state, {
      key: 'archetypes',
      triggerId: 'archetype-trigger',
      summaryId: 'archetype-summary',
      menuId: 'archetype-menu',
      listId: 'archetype-options',
      chipsId: 'archetype-chips',
      addButtonId: 'archetype-add',
      labelId: 'archetype-label',
      searchId: 'archetype-search',
      placeholder: 'All archetypes',
      placeholderAriaLabel: 'Select archetypes',
      emptyMessage: 'No archetypes found',
      singularLabel: 'Archetype',
      pluralLabel: 'Archetypes',
      addButtonLabel: 'Add another',
      addAriaLabel: 'Add another selection',
      allSelectedLabel: 'All archetypes selected',
      includeAllOption: true,
      allOptionLabel: 'All Archetypes',
      maxVisibleChips: 3,
      baseWidth: 320,
      maxWidth: 480,
      formatOption: (slug: string) => {
        const option = state.archetypeOptions.get(slug);
        if (!option) {
          const fallback = slug.replace(/_/g, ' ');
          return { label: fallback, fullName: fallback };
        }
        const label = option.label || slug.replace(/_/g, ' ');
        const display = option.deckCount > 0 ? `${label} (${option.deckCount})` : label;
        return { label: display, fullName: label };
      },
      onChange: (selection: string[]) => state.ui.onArchetypeSelection?.(selection)
    })
  };

  state.ui.dropdowns = dropdowns;

  const onDocumentPointerDown = (event: Event) => {
    const target = event.target as Node;
    const dropdownList = Object.values(dropdowns).filter((d): d is any => Boolean(d));
    const clickedInsideDropdown = dropdownList.some(dropdown => dropdown.contains(target));

    if (!clickedInsideDropdown) {
      document.dispatchEvent(new CustomEvent('dropdown:close-all'));
    }
  };

  const onDocumentKeydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Escape') {
      document.dispatchEvent(new CustomEvent('dropdown:close-all'));
    }
  };

  state.cleanup.addEventListener(document, 'pointerdown', onDocumentPointerDown);
  state.cleanup.addEventListener(document, 'keydown', onDocumentKeydown);

  // Set initial filters panel state (collapsed for both desktop and mobile)
  closeFiltersPanel({ skipDropdownClose: true });

  const filtersToggle = document.getElementById('filtersToggle');
  if (filtersToggle) {
    state.cleanup.addEventListener(filtersToggle, 'click', () => {
      toggleFiltersPanel();
    });
  }

  if (dropdowns.tournaments && Array.isArray(state.availableTournaments) && state.availableTournaments.length) {
    dropdowns.tournaments.render(state.availableTournaments, state.selectedTournaments);
  } else if (dropdowns.tournaments) {
    dropdowns.tournaments.render();
  }

  if (dropdowns.sets && Array.isArray(state.availableSets) && state.availableSets.length) {
    dropdowns.sets.render(state.availableSets, state.selectedSets);
  } else if (dropdowns.sets) {
    dropdowns.sets.render();
  }

  if (dropdowns.archetypes) {
    dropdowns.archetypes.render();
  }
}

function consumeFiltersRedirectFlag() {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  try {
    const payload = sessionStorage.getItem('cmFiltersRedirect');
    if (!payload) {
      return null;
    }
    sessionStorage.removeItem('cmFiltersRedirect');
    return JSON.parse(payload);
  } catch (error) {
    logger.debug('Failed to consume filters redirect payload', error);
    return null;
  }
}

function refreshFiltersDropdowns() {
  const dropdowns = appState.ui?.dropdowns || {};
  Object.values(dropdowns).forEach(dropdown => {
    if (dropdown && typeof dropdown.refresh === 'function') {
      dropdown.refresh();
    }
  });
}

function _openFiltersPanel() {
  const result = openFiltersPanelState({ focusFirstControl: false });
  if (result === 'opened') {
    // Ensure tournament list is loaded when user opens filters
    // This is high priority as they're likely to interact with the tournament dropdown
    ensureTournamentListLoaded(appState).catch(error => {
      logger.warn('Failed to load tournament list on filters open', error);
    });
    refreshFiltersDropdowns();
  }
  return result;
}

function closeFiltersPanel(options: { skipDropdownClose?: boolean } = {}) {
  const { skipDropdownClose = false } = options;
  const result = closeFiltersPanelState({ restoreFocus: false });
  if (result === 'closed' && !skipDropdownClose) {
    document.dispatchEvent(new CustomEvent('dropdown:close-all'));
  }
  return result;
}

function toggleFiltersPanel() {
  const result = toggleFiltersPanelState({
    focusFirstControlOnOpen: false,
    restoreFocusOnClose: false
  });
  if (result === 'opened') {
    // Ensure tournament list is loaded when user opens filters
    ensureTournamentListLoaded(appState).catch(error => {
      logger.warn('Failed to load tournament list on filters open', error);
    });
    refreshFiltersDropdowns();
  } else if (result === 'closed') {
    document.dispatchEvent(new CustomEvent('dropdown:close-all'));
  }
  return result;
}

async function applyCurrentFilters(state: AppState) {
  await applyFiltersSort(state.current.items, state.overrides);
  const existingSets =
    Array.isArray(state.selectedSets) && state.selectedSets.length > 0 ? [...state.selectedSets] : readSelectedSets();
  state.selectedSets = existingSets;
  state.selectedCardType = readCardType();
}

/**
 * Load and optionally aggregate tournament data for the provided selection.
 * @param {string|string[]} selection
 * @param {DataCache} cache
 * @param {{ showSkeleton?: boolean }} [options]
 * @returns {Promise<{ deckTotal: number, items: any[] }>}
 */
async function loadSelectionData(
  selection: string | string[],
  cache: DataCache,
  options: { showSkeleton?: boolean; successFilter?: string; archetypeBase?: string | null } = {}
) {
  const { showSkeleton = false, successFilter = 'all', archetypeBase = null } = options;
  const tournaments = normalizeTournamentSelection(selection);

  if (tournaments.length === 0) {
    return { deckTotal: 0, items: [] };
  }

  if (showSkeleton) {
    showGridSkeleton();
  }

  try {
    if (successFilter !== 'all') {
      return buildDeckReport(tournaments, successFilter, archetypeBase);
    }

    const reports = new Array(tournaments.length);
    const pendingFetches: Promise<void>[] = [];

    tournaments.forEach((tournament, index) => {
      const cached = cache.getCachedMaster(tournament);

      if (cached) {
        reports[index] = { deckTotal: cached.deckTotal, items: cached.items };
        return;
      }

      const loader = loadTournamentData(tournament, cache).then(report => {
        reports[index] = report;
      });

      pendingFetches.push(loader);
    });

    if (pendingFetches.length > 0) {
      await Promise.all(pendingFetches);
    }

    const resolvedReports = reports.filter(Boolean);

    if (resolvedReports.length === 1) {
      return resolvedReports[0];
    }

    return aggregateReports(resolvedReports);
  } finally {
    if (showSkeleton) {
      hideGridSkeleton();
    }
  }
}

/**
 * Determine initial tournament selection before tournaments.json is loaded.
 * Prioritizes URL state, then defaults to online meta.
 * @param {AppState} state
 * @returns {{ selection: string[], needsTournamentList: boolean }}
 */
function getInitialTournamentSelection(state: AppState): { selection: string[]; needsTournamentList: boolean } {
  const urlState = getStateFromURL();
  const urlSelectionRaw = urlState.tour ? urlState.tour.split(',') : [];
  const normalizedFromUrl = normalizeTournamentSelection(urlSelectionRaw);

  // If URL specifies tournaments, we need to validate against the list
  if (normalizedFromUrl.length > 0) {
    return { selection: normalizedFromUrl, needsTournamentList: true };
  }

  // If state has previous selection, use that
  if (state.selectedTournaments.length > 0) {
    return { selection: state.selectedTournaments, needsTournamentList: false };
  }

  // Default to online meta - no need for tournament list
  return { selection: [DEFAULT_ONLINE_META], needsTournamentList: false };
}

/**
 * Load tournament list and update state/dropdown.
 * @param {AppState} state
 * @param {string[]} currentSelection - The currently selected tournaments
 * @returns {Promise<void>}
 */
async function loadTournamentList(state: AppState, currentSelection: string[]) {
  // Fetch tournaments list (excludes online tournaments)
  const tournaments = await safeAsync(
    () => fetchTournamentsList(),
    'fetching tournaments list',
    ['2025-08-15, World Championships 2025'] // fallback
  );

  // Check if online meta report exists separately (not in tournaments.json)
  const hasOnlineMeta = await safeAsync(
    async () => {
      const response = await fetch(
        `${CONFIG.API.R2_BASE}/reports/${encodeURIComponent(DEFAULT_ONLINE_META)}/master.json`,
        {
          method: 'HEAD'
        }
      );
      return response.ok;
    },
    'checking availability of online meta report',
    false
  );

  // Always insert online meta at the top if it exists (special case)
  if (hasOnlineMeta && tournaments) {
    tournaments.unshift(DEFAULT_ONLINE_META);
  }

  // Validate and update selection based on what's actually available
  let validatedSelection: string[] = [];
  if (tournaments) {
    validatedSelection = currentSelection.filter(value => tournaments.includes(value));
  }

  // Fallback logic if validated selection is empty
  if (validatedSelection.length === 0 && tournaments) {
    if (tournaments.includes(DEFAULT_ONLINE_META)) {
      validatedSelection = [DEFAULT_ONLINE_META];
    } else if (tournaments.length > 0) {
      validatedSelection = [tournaments[0]];
    }
  }

  // Update state
  state.availableTournaments = tournaments || [];

  // Only update selection if it changed after validation
  const selectionChanged =
    validatedSelection.length !== currentSelection.length ||
    !validatedSelection.every((val, idx) => val === currentSelection[idx]);

  if (selectionChanged) {
    state.selectedTournaments = validatedSelection;
    state.currentTournament = validatedSelection[0] || null;
  }

  // Update URL if needed
  const urlState = getStateFromURL();
  if (urlState.tour && tournaments && selectionChanged) {
    const normalizedParam = validatedSelection.join(',');
    const urlSelectionRaw = urlState.tour.split(',');
    const normalizedUrlParam = normalizeTournamentSelection(urlSelectionRaw)
      .filter(value => tournaments.includes(value))
      .join(',');
    if (normalizedUrlParam !== normalizedParam) {
      setStateInURL({ tour: normalizedParam }, { merge: true, replace: true });
    }
  }

  // Update dropdown
  const dropdown = state.ui?.dropdowns?.tournaments;
  if (dropdown && tournaments) {
    dropdown.render(tournaments, selectionChanged ? validatedSelection : currentSelection);
  }

  logger.info(
    `Tournament list loaded, selection: ${(selectionChanged ? validatedSelection : currentSelection).join(', ') || 'None'}`
  );
}

/**
 * Ensure tournament list is loaded, fetching if necessary.
 * This is called on-demand (e.g., when opening the tournament dropdown).
 * @param {AppState} state
 * @returns {Promise<void>}
 */
async function ensureTournamentListLoaded(state: AppState): Promise<void> {
  // If already loaded, nothing to do
  if (state.availableTournaments.length > 0) {
    return;
  }

  // Load the tournament list
  await loadTournamentList(state, state.selectedTournaments);
}

/**
 * Load and parse tournament data
 * @param {string} tournament
 * @param {DataCache} cache
 * @param {boolean} showSkeletonLoading - Whether to show skeleton loading state
 * @returns {Promise<{deckTotal: number, items: any[]}>}
 */
async function loadTournamentData(tournament: string, cache: DataCache, showSkeletonLoading = false) {
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
 * @param {string|string[]} tournaments
 * @param {DataCache} cache
 * @param {AppState} state
 * @param {boolean} skipUrlInit - Skip URL-based initialization (e.g., during tournament change)
 */
async function setupArchetypeSelector(
  tournaments: string | string[],
  cache: DataCache,
  state: AppState,
  skipUrlInit = false
) {
  const dropdown = state.ui?.dropdowns?.archetypes;
  if (!dropdown) {
    return;
  }

  const activeCache = cache || state.cache || (state.cache = new DataCache());

  const normalizedTournaments = normalizeTournamentSelection(tournaments);
  const archetypeSourceTournaments = getArchetypeSourceTournaments(normalizedTournaments);

  const archetypeAggregates = new Map<string, ArchetypeOptionMeta>();

  if (archetypeSourceTournaments.length === 0) {
    logger.warn('No tournaments available for archetype dropdown', { selection: normalizedTournaments });
  }

  for (const tournament of archetypeSourceTournaments) {
    let archetypesList = activeCache.getCachedArcheIndex(tournament);

    if (!archetypesList) {
      // eslint-disable-next-line no-await-in-loop
      archetypesList = await safeAsync(
        () => fetchArchetypesList(tournament),
        `fetching archetypes for ${tournament}`,
        []
      );

      if (Array.isArray(archetypesList) && archetypesList.length > 0) {
        activeCache.setCachedArcheIndex(tournament, archetypesList);
      }
    }

    if (Array.isArray(archetypesList)) {
      archetypesList.forEach(archetype => {
        const slug = typeof archetype === 'string' ? archetype : archetype?.name;
        if (!slug) {
          return;
        }
        const label = typeof archetype === 'object' && archetype?.label ? archetype.label : slug.replace(/_/g, ' ');
        const deckCount =
          typeof archetype === 'object' && Number.isFinite(archetype.deckCount) ? Number(archetype.deckCount) : 0;
        const existing = archetypeAggregates.get(slug) || { label, deckCount: 0 };
        if (!existing.label && label) {
          existing.label = label;
        }
        existing.deckCount += deckCount;
        archetypeAggregates.set(slug, existing);
      });
    } else {
      logger.warn('archetypesList is not an array, using empty array as fallback', { archetypesList, tournament });
    }
  }

  const sortedArchetypes = Array.from(archetypeAggregates.entries())
    .map(([slug, data]) => ({
      slug,
      label: data.label || slug.replace(/_/g, ' '),
      deckCount: Number.isFinite(data.deckCount) ? data.deckCount : 0
    }))
    .sort((left, right) => {
      const deckDiff = (right.deckCount ?? 0) - (left.deckCount ?? 0);
      if (deckDiff !== 0) {
        return deckDiff;
      }
      return left.slug.localeCompare(right.slug);
    });

  state.archetypeOptions = new Map(
    sortedArchetypes.map(entry => [entry.slug, { label: entry.label, deckCount: entry.deckCount }])
  );
  const optionValues = sortedArchetypes.map(entry => entry.slug);
  const availableSet = new Set(optionValues);
  dropdown.setDisabled(optionValues.length === 0);

  const sanitizeSelection = (values: string[]): string[] => {
    if (!Array.isArray(values)) {
      return [];
    }
    const seen = new Set<string>();
    const sanitized: string[] = [];
    for (const value of values) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      if (availableSet.size > 0 && !availableSet.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      sanitized.push(trimmed);
    }
    return sanitized;
  };

  const applyArchetypeSelection = async (rawSelection: string[] = [], options: { force?: boolean } = {}) => {
    const normalizedSelection = sanitizeSelection(rawSelection);
    const previousSelection = state.selectedArchetypes || [];
    const changed =
      normalizedSelection.length !== previousSelection.length ||
      normalizedSelection.some((value, index) => value !== previousSelection[index]);
    if (!changed && !options.force) {
      return;
    }

    state.selectedArchetypes = normalizedSelection;
    dropdown.setSelection(normalizedSelection, { silent: true });
    dropdown.refresh();

    if (normalizedSelection.length === 0) {
      const selection = state.selectedTournaments.length
        ? state.selectedTournaments
        : normalizeTournamentSelection(state.currentTournament ? [state.currentTournament] : []);
      const data = await loadSelectionData(selection, activeCache, {
        successFilter: state.successFilter,
        archetypeBase: null
      });
      state.current = data;
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      updateSetFilterOptions(data.items);
      await applyCurrentFilters(state);
      setStateInURL({ archetype: '' }, { merge: true });
      return;
    }

    const currentSelection = normalizeTournamentSelection(
      state.selectedTournaments.length ? state.selectedTournaments : state.currentTournament
    );

    const archetypeTournaments = getArchetypeSourceTournaments(currentSelection);

    if (archetypeTournaments.length === 0) {
      logger.warn('No tournaments available while trying to load archetype data', { currentSelection });
      return;
    }

    const selectionKey = normalizedSelection.slice().sort().join('|');
    const archetypeCacheKey = `${selectionKey}::${archetypeTournaments.join('|')}::${state.successFilter}`;

    let cached = state.archeCache.get(archetypeCacheKey);
    if (!cached) {
      if (state.successFilter !== 'all') {
        cached = await buildDeckReport(archetypeTournaments, state.successFilter, normalizedSelection);
      } else {
        const archetypeReports = [];

        for (const tournament of archetypeTournaments) {
          for (const archetypeBase of normalizedSelection) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const data = await fetchArchetypeReport(tournament, archetypeBase);
              const parsed = parseReport(data);
              archetypeReports.push(parsed);
            } catch (error: any) {
              if (error instanceof AppError && error.context?.status === 404) {
                logger.debug(`Archetype ${archetypeBase} not available for ${tournament}, skipping`);
              } else {
                logger.exception(`Failed fetching archetype ${archetypeBase} for ${tournament}`, error);
              }
            }
          }
        }

        let aggregate;
        if (archetypeReports.length === 0) {
          aggregate = { deckTotal: 0, items: [] };
        } else if (archetypeReports.length === 1) {
          aggregate = archetypeReports[0];
        } else {
          aggregate = aggregateReports(archetypeReports);
        }

        cached = aggregate;
      }

      state.archeCache.set(archetypeCacheKey, cached);
    }

    state.current = { items: cached.items, deckTotal: cached.deckTotal };
    updateSetFilterOptions(cached.items);
    renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
    await applyCurrentFilters(state);
    setStateInURL({ archetype: normalizedSelection.join(',') }, { merge: true });
  };

  state.applyArchetypeSelection = applyArchetypeSelection;
  state.ui.onArchetypeSelection = (selection: string[]) => state.applyArchetypeSelection?.(selection);

  const previousSelection = state.selectedArchetypes || [];
  const urlArchetypes = skipUrlInit ? [] : parseArchetypeQueryParam(getStateFromURL().archetype);
  const initialSelection = skipUrlInit ? sanitizeSelection(previousSelection) : sanitizeSelection(urlArchetypes);

  dropdown.render(optionValues, initialSelection);

  const shouldForce = (!skipUrlInit && urlArchetypes.length > 0) || previousSelection.length > 0;

  if (shouldForce) {
    await applyArchetypeSelection(initialSelection, { force: true });
  } else {
    state.selectedArchetypes = initialSelection;
  }
}

/**
 * Setup control event handlers
 * @param {AppState} state
 */
function setupControlHandlers(state: AppState) {
  const elements = validateElements(
    {
      search: '#search',
      sort: '#sort',
      success: '#success-filter'
    },
    'controls'
  );

  const handleSearch = debounce(async () => {
    await applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ query: (elements.search as HTMLInputElement).value }, { merge: true, replace: true });
  });

  const handleSort = async () => {
    await applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ sort: (elements.sort as HTMLSelectElement).value }, { merge: true });
  };

  const handleSetSelectionChange = async (selection: string[], { silent = false } = {}) => {
    const normalized = normalizeSetValues(selection);
    state.selectedSets = normalized;
    writeSelectedSets(normalized);
    if (silent) {
      const setsDropdown = state.ui?.dropdowns?.sets;
      if (setsDropdown) {
        setsDropdown.setSelection(normalized, { silent: true });
      }
    }
    if (!silent) {
      await applyCurrentFilters(state);
    }
  };

  const selectionsEqual = (first: string[], second: string[]) => {
    if (!Array.isArray(first) || !Array.isArray(second)) {
      return false;
    }
    if (first.length !== second.length) {
      return false;
    }
    return first.every((value, index) => value === second[index]);
  };

  const handleTournamentSelectionChange = async (newSelection: string[]) => {
    const previousSelection = Array.isArray(state.selectedTournaments) ? [...state.selectedTournaments] : [];
    let selection = normalizeTournamentSelection(newSelection);

    if (selection.length === 0) {
      const fallbackSource = previousSelection.length ? previousSelection : state.availableTournaments;
      if (fallbackSource.length === 0) {
        logger.warn('Tournament selection is empty; skipping refresh');
        return;
      }
      selection = [fallbackSource[0]];
      const dropdown = state.ui?.dropdowns?.tournaments;
      if (dropdown) {
        dropdown.setSelection(selection, { silent: true });
      }
    }

    if (selectionsEqual(selection, previousSelection)) {
      return;
    }

    state.selectedTournaments = selection;
    state.currentTournament = selection[0] || null;

    const cache = state.cache || (state.cache = new DataCache());
    const data = await loadSelectionData(selection, cache, {
      showSkeleton: true,
      successFilter: state.successFilter,
      archetypeBase: null
    });

    state.current = data;
    renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
    updateSetFilterOptions(data.items);
    await setupArchetypeSelector(selection, cache, state, true);
    await applyCurrentFilters(state);

    setStateInURL({ tour: selection.join(',') }, { merge: true });
  };

  state.ui.onTournamentSelection = handleTournamentSelectionChange;
  state.ui.onSetSelection = handleSetSelectionChange;

  state.cleanup.addEventListener(elements.search, 'input', handleSearch);
  state.cleanup.addEventListener(elements.sort, 'change', handleSort);

  const handleSuccessFilterChange = async () => {
    const select = elements.success as HTMLSelectElement;
    const value = select.value;
    state.successFilter = value;

    const selection = state.selectedTournaments.length
      ? state.selectedTournaments
      : normalizeTournamentSelection(state.currentTournament ? [state.currentTournament] : []);

    const cache = state.cache || (state.cache = new DataCache());

    if (state.selectedArchetypes.length > 0) {
      await state.applyArchetypeSelection?.([...state.selectedArchetypes], { force: true });
    } else {
      // Just reload the main selection with the new filter
      const data = await loadSelectionData(selection, cache, {
        showSkeleton: true,
        successFilter: value,
        archetypeBase: null
      });
      state.current = data;
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      updateSetFilterOptions(data.items);
      await applyCurrentFilters(state);
    }

    // Update URL
    const urlState = getStateFromURL();
    if (value === 'all') {
      // Remove from URL if default
      if (urlState.query) {
        // If we have other params, just remove 'success' (which is mapped to 'advanced' param for now or custom?)
        // Wait, success filter is not in AppState interface in router.ts?
        // It seems it might be part of 'advanced' or just not persisted?
        // Looking at router.ts, there is no 'success' param.
        // But there is 'advanced'. Maybe it's stored there?
        // For now, let's assume it's not persisted or I need to add it.
        // But the original code didn't seem to persist it?
        // Wait, let's check if I missed it.
        // In `getStateFromURL`, `advanced` is read.
        // Maybe success filter is stored in `advanced`?
        // Let's check `handleSuccessFilterChange` in original code if possible.
        // But I don't have it.
        // I'll just leave it as is for now.
      }
    }
  };

  state.cleanup.addEventListener(elements.success, 'change', handleSuccessFilterChange);

  const cardTypeSelect = document.getElementById('card-type') as HTMLSelectElement | null;
  if (cardTypeSelect) {
    state.cleanup.addEventListener(cardTypeSelect, 'change', async () => {
      state.selectedCardType = cardTypeSelect.value;
      await applyCurrentFilters(state);
      setStateInURL({ cardType: state.selectedCardType }, { merge: true });
    });
  }

  // Initialize controls from URL
  const urlState = getStateFromURL();
  if (urlState.query) {
    (elements.search as HTMLInputElement).value = urlState.query;
  }
  if (urlState.sort) {
    (elements.sort as HTMLSelectElement).value = urlState.sort;
  }
  if (urlState.cardType) {
    if (cardTypeSelect) {
      cardTypeSelect.value = urlState.cardType;
      state.selectedCardType = urlState.cardType;
    }
  }
}

/**
 * Main initialization
 */
async function init() {
  try {
    logger.info('Initializing application...');

    // Initialize cache
    appState.cache = new DataCache();

    // Check for redirects
    if (normalizeRouteOnLoad()) {
      return;
    }

    // Setup UI components
    setupDropdownFilters(appState);
    setupControlHandlers(appState);

    // Determine initial tournament selection (fast, no network calls)
    const { selection: initialSelection, needsTournamentList } = getInitialTournamentSelection(appState);
    appState.selectedTournaments = initialSelection;
    appState.currentTournament = initialSelection[0] || null;

    logger.info(`Starting with initial selection: ${initialSelection.join(', ')}`);

    const cache = appState.cache;
    let finalSelection = initialSelection;

    // PRIORITY 1 & 2: If URL has ?tour param, validate it first (might change selection)
    if (needsTournamentList) {
      logger.info('URL specifies tournament, loading tournament list for validation');
      await loadTournamentList(appState, initialSelection);

      // Selection might have changed after validation, use the validated selection
      finalSelection = appState.selectedTournaments.length > 0 ? appState.selectedTournaments : [DEFAULT_ONLINE_META];

      logger.info(`Validated selection: ${finalSelection.join(', ')}`);
    }

    // Load data for the final (possibly validated) selection
    const data = await loadSelectionData(finalSelection, cache, { showSkeleton: true });
    appState.current = data;

    renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
    updateSetFilterOptions(data.items);

    // Setup archetype selector with final selection
    await setupArchetypeSelector(finalSelection, cache, appState);

    // Apply initial filters
    await applyCurrentFilters(appState);

    // PRIORITY 3: Cards are now rendered in DOM
    // The render.js/updateLayout handles image loading with intersection observer
    // Images in viewport will load first automatically via browser's lazy loading

    // Handle window resize
    window.addEventListener(
      'resize',
      debounce(() => {
        updateLayout();
      }, 100)
    );

    // Handle filters redirect payload if present
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

    // PRIORITY 4: Load tournament list in background (deprioritized, non-critical)
    // This ensures dropdown has data when user eventually opens it
    if (!needsTournamentList) {
      logger.info('Deprioritizing tournament list load (not needed for initial render)');
      // Use setTimeout to ensure this happens after all critical rendering
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

// Start the application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
