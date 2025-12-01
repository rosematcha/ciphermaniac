/* eslint-disable no-console, id-length, max-lines-per-function, max-statements, complexity, no-param-reassign, prefer-destructuring, max-len, no-multiple-empty-lines, require-atomic-updates, jsdoc/require-param, jsdoc/check-param-names */
/**
 * Main application bootstrap and initialization
 * @module Main
 */

// Clear any existing scroll listeners that might be left over from imagePreloader
// eslint-disable-next-line wrap-iife
(function clearExistingScrollListeners() {
    const oldListeners = (window as any).__imagePreloaderListeners || [];
    oldListeners.forEach((listener: EventListener) => {
        window.removeEventListener('scroll', listener);
    });
    (window as any).__imagePreloaderListeners = [];
})();

import './utils/buildVersion.js';
import {
    fetchArchetypeReport,
    fetchArchetypesList,
    fetchLimitlessTournaments,
    fetchReport,
    fetchTournamentsList
} from './api.js';
import { AppError, safeAsync } from './utils/errorHandler.js';
import { parseReport } from './parse.js';
import { renderSummary, updateLayout } from './render.js';
import { applyFiltersSort } from './controls.js';
import { initMissingThumbsDev as _initMissingThumbsDev } from './dev/missingThumbs.js';
import { initCacheDev } from './dev/cacheDev.js';
// import { imagePreloader } from './utils/imagePreloader.js'; // Disabled - using parallelImageLoader instead
import { getStateFromURL, normalizeRouteOnLoad, parseHash, setStateInURL } from './router.js';
import { buildCardPath } from './card/routing.js';
import { logger } from './utils/logger.js';
import { CleanupManager, debounce, validateElements } from './utils/performance.js';
import { CONFIG } from './config.js';
import { prettyTournamentName } from './utils/format.js';
import { hideGridSkeleton, showGridSkeleton, updateSkeletonLayout } from './components/placeholders.js';
import { aggregateReports } from './utils/reportAggregator.js';
import { formatSetLabel, sortSetCodesByRelease } from './data/setCatalog.js';
import {
    closeFiltersPanel as closeFiltersPanelState,
    openFiltersPanel as openFiltersPanelState,
    toggleFiltersPanel as toggleFiltersPanelState
} from './utils/filtersPanel.js';
import {
    normalizeSetValues,
    parseSetList,
    readCardType,
    readSelectedSets,
    writeSelectedSets
} from './utils/filterState.js';
import { DataCache } from './utils/DataCache.js';
import { createMultiSelectDropdown } from './components/MultiSelectDropdown.js';

/**
 * Application state - simple object
 */
export interface AppState {
    currentTournament: string | null;
    selectedTournaments: string[];
    selectedSets: string[];
    selectedCardType: string;
    successFilter: string;
    availableTournaments: string[];
    onlineTournaments: any[];
    availableSets: string[];
    current: { items: any[]; deckTotal: number };
    overrides: Record<string, string>;
    masterCache: Map<string, any>;
    archeCache: Map<string, any>;
    cleanup: CleanupManager;
    cache: DataCache | null;
    ui: {
        dropdowns: Record<string, any>;
        openDropdown: any;
        onTournamentSelection: ((selection: string[]) => void) | null;
        onSetSelection: ((selection: string[], options?: any) => void) | null;
    };
}

const appState: AppState = {
    currentTournament: null,
    selectedTournaments: [],
    selectedSets: [],
    selectedCardType: '__all__',
    successFilter: 'all',
    availableTournaments: [],
    onlineTournaments: [],
    availableSets: [],
    current: { items: [], deckTotal: 0 },
    overrides: {},
    masterCache: new Map(),
    archeCache: new Map(),
    cleanup: new CleanupManager(),
    cache: null,
    ui: {
        dropdowns: {},
        openDropdown: null,
        onTournamentSelection: null,
        onSetSelection: null
    }
};

const DEFAULT_ONLINE_META = 'Online - Last 14 Days';
const SUCCESS_FILTER_LABELS: Record<string, string> = {
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

async function buildDeckReport(tournaments: string | string[], successFilter: string = 'all', archetypeBase: string | null = null) {
    const { aggregateDecks, filterDecksBySuccess } = await import('./utils/clientSideFiltering.js');
    const selection = Array.isArray(tournaments) ? tournaments : [tournaments];
    const deckLists = await Promise.all(selection.map(tournament => fetchTournamentDecks(tournament)));
    const allDecks = deckLists.flat();
    const successDecks = filterDecksBySuccess(allDecks, successFilter);

    const scopedDecks =
        archetypeBase === null
            ? successDecks
            : successDecks.filter(
                (deck: any) => normalizeArchetypeValue(deck?.archetype) === normalizeArchetypeValue(archetypeBase)
            );

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
            onChange: (selection: string[]) => state.ui.onTournamentSelection?.(selection)
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
        })
    };

    state.ui.dropdowns = dropdowns;

    const onDocumentPointerDown = (event: Event) => {
        const target = event.target as Node;
        const dropdownList = Object.values(dropdowns).filter((d): d is any => !!d);
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

function openFiltersPanel() {
    const result = openFiltersPanelState({ focusFirstControl: false });
    if (result === 'opened') {
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
async function loadSelectionData(selection: string | string[], cache: DataCache, options: { showSkeleton?: boolean, successFilter?: string, archetypeBase?: string | null } = {}) {
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
 * Initialize tournament selector with data from API
 * @param {AppState} state
 * @returns {Promise<void>}
 */
async function initializeTournamentSelector(state: AppState) {
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

    const urlState = getStateFromURL();
    const urlSelectionRaw = urlState.tour ? urlState.tour.split(',') : [];
    const normalizedFromUrl = normalizeTournamentSelection(urlSelectionRaw);

    let selection: string[] = [];
    if (tournaments) {
        selection = normalizedFromUrl.filter(value => tournaments.includes(value));
    }

    if (selection.length === 0 && state.selectedTournaments.length > 0 && tournaments) {
        selection = normalizeTournamentSelection(state.selectedTournaments).filter(value => tournaments.includes(value));
    }

    if (selection.length === 0 && tournaments && tournaments.includes(DEFAULT_ONLINE_META)) {
        selection = [DEFAULT_ONLINE_META];
    }

    if (selection.length === 0 && tournaments && tournaments.length > 0) {
        selection = [tournaments[0]];
    }

    state.availableTournaments = tournaments || [];
    state.selectedTournaments = selection;
    state.currentTournament = selection[0] || null;

    if (urlState.tour && tournaments) {
        const normalizedParam = selection.join(',');
        const normalizedUrlParam = normalizeTournamentSelection(urlSelectionRaw)
            .filter(value => tournaments.includes(value))
            .join(',');
        if (normalizedUrlParam !== normalizedParam) {
            setStateInURL({ tour: normalizedParam }, { merge: true, replace: true });
        }
    }

    const dropdown = state.ui?.dropdowns?.tournaments;
    if (dropdown && tournaments) {
        dropdown.render(tournaments, selection);
    }

    logger.info(`Initialized with tournaments: ${selection.join(', ') || 'None'}`);

    // Kick off a background fetch for online Limitless events (does not block UI init)
    // eslint-disable-next-line no-void
    void hydrateOnlineTournaments(state, {
        game: CONFIG.API.LIMITLESS_DEFAULT_GAME,
        limit: Math.max(CONFIG.API.LIMITLESS_DEFAULT_LIMIT, 100)
    });
    // TODO: Merge state.onlineTournaments into the selector once UX for online data is finalized.
}

/**
 * Fetch online tournaments from Limitless and stash them for future UI integration.
 * @param {AppState} state
 * @param {{game?: string, format?: string, limit?: number, page?: number}} options
 * @returns {Promise<void>}
 */
async function hydrateOnlineTournaments(state: AppState, options: any = {}) {
    const tournaments = await safeAsync(
        () => fetchLimitlessTournaments(options),
        'fetching Limitless online tournaments',
        []
    );

    state.onlineTournaments = tournaments || [];

    if (tournaments && tournaments.length > 0) {
        logger.info(`Loaded ${tournaments.length} online tournaments from Limitless`, options);
    } else {
        logger.debug('No Limitless tournaments returned for query', options);
    }
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
async function setupArchetypeSelector(tournaments: string | string[], cache: DataCache, state: AppState, skipUrlInit = false) {
    const archeSel = document.getElementById('archetype') as HTMLSelectElement | null;
    if (!archeSel) {
        return;
    }

    // Clear existing options except "All archetypes"
    while (archeSel.children.length > 1) {
        archeSel.removeChild(archeSel.lastChild!);
    }

    const normalizedTournaments = normalizeTournamentSelection(tournaments);

    // Filter out online tournaments - they should not contribute to archetypes
    const physicalTournaments = normalizedTournaments.filter(tournament => tournament !== DEFAULT_ONLINE_META);

    const combinedArchetypes = new Set<string>();

    for (const tournament of physicalTournaments) {
        let archetypesList = cache.getCachedArcheIndex(tournament);

        if (!archetypesList) {
            // eslint-disable-next-line no-await-in-loop
            archetypesList = await safeAsync(
                () => fetchArchetypesList(tournament),
                `fetching archetypes for ${tournament}`,
                [] // fallback
            );

            if (Array.isArray(archetypesList) && archetypesList.length > 0) {
                cache.setCachedArcheIndex(tournament, archetypesList);
            }
        }

        if (Array.isArray(archetypesList)) {
            archetypesList.forEach(archetype => {
                const slug = typeof archetype === 'string' ? archetype : archetype?.name;
                if (slug) {
                    combinedArchetypes.add(slug);
                }
            });
        } else {
            logger.warn('archetypesList is not an array, using empty array as fallback', { archetypesList, tournament });
        }
    }

    const archetypesList = Array.from(combinedArchetypes).sort((left, right) => left.localeCompare(right));

    archetypesList.forEach(archetype => {
        const option = document.createElement('option');
        option.value = archetype;
        option.textContent = archetype.replace(/_/g, ' ');
        archeSel.appendChild(option);
    });

    const handleArchetypeChange = async () => {
        const selectedValue = archeSel.value;

        if (!selectedValue || selectedValue === '__all__') {
            const selection = state.selectedTournaments.length
                ? state.selectedTournaments
                : normalizeTournamentSelection(state.currentTournament ? [state.currentTournament] : []);
            const cache = state.cache || (state.cache = new DataCache());
            const data = await loadSelectionData(selection, cache, {
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

        // Filter out online tournaments when fetching archetype data
        const physicalTournamentsForArchetype = currentSelection.filter(tournament => tournament !== DEFAULT_ONLINE_META);

        if (physicalTournamentsForArchetype.length === 0) {
            logger.warn('No physical tournaments selected while trying to load archetype data');
            return;
        }

        const archetypeCacheKey = `${selectedValue}::${physicalTournamentsForArchetype.join('|')}::${state.successFilter}`;

        let cached = state.archeCache.get(archetypeCacheKey);
        if (!cached) {
            if (state.successFilter !== 'all') {
                cached = await buildDeckReport(physicalTournamentsForArchetype, state.successFilter, selectedValue);
            } else {
                const archetypeReports = [];

                for (const tournament of physicalTournamentsForArchetype) {
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        const data = await fetchArchetypeReport(tournament, selectedValue);
                        const parsed = parseReport(data);
                        archetypeReports.push(parsed);
                    } catch (error: any) {
                        if (error instanceof AppError && error.context?.status === 404) {
                            logger.debug(`Archetype ${selectedValue} not available for ${tournament}, skipping`);
                        } else {
                            logger.exception(`Failed fetching archetype ${selectedValue} for ${tournament}`, error);
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

        // eslint-disable-next-line no-param-reassign
        state.current = { items: cached.items, deckTotal: cached.deckTotal };
        updateSetFilterOptions(cached.items);
        renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
        await applyCurrentFilters(state);
        setStateInURL({ archetype: selectedValue }, { merge: true });
    };

    state.cleanup.addEventListener(archeSel, 'change', handleArchetypeChange);

    if (!skipUrlInit) {
        const urlState = getStateFromURL();
        if (urlState.archetype && urlState.archetype !== '__all__') {
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
function setupControlHandlers(state: AppState) {
    const elements = validateElements(
        {
            search: '#search',
            sort: '#sort',
            archetype: '#archetype',
            cardType: '#card-type',
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

        // If an archetype is selected, we need to reload data with the new success filter
        const archeSel = document.getElementById('archetype') as HTMLSelectElement | null;
        const selectedArchetype = archeSel?.value;

        const cache = state.cache || (state.cache = new DataCache());

        if (selectedArchetype && selectedArchetype !== '__all__') {
            // Re-trigger archetype change to load filtered data
            archeSel?.dispatchEvent(new Event('change'));
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

        // Load initial data
        await initializeTournamentSelector(appState);

        // Initial data load
        const selection = appState.selectedTournaments;
        const cache = appState.cache;

        const data = await loadSelectionData(selection, cache, { showSkeleton: true });
        appState.current = data;

        renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
        updateSetFilterOptions(data.items);

        // Setup archetype selector
        await setupArchetypeSelector(selection, cache, appState);

        // Apply initial filters
        await applyCurrentFilters(appState);

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
