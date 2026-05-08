import { fetchArchetypeReport, fetchArchetypesList } from '../api.js';
import { AppError, safeAsync } from '../utils/errorHandler.js';
import { initActiveFilters, updateActiveFilters } from '../components/activeFilters.js';
import { parseReport } from '../parse.js';
import { renderSummary } from '../render.js';
import { applyFiltersSort } from '../controls.js';
import { getStateFromURL, setStateInURL } from '../router.js';
import { logger } from '../utils/logger.js';
import { debounce, validateElements } from '../utils/performance.js';
import { prettyTournamentName } from '../utils/format.js';
import { aggregateReports } from '../utils/reportAggregator.js';
import { formatSetLabel, sortSetCodesByRelease } from '../data/setCatalog.js';
import {
  closeFiltersPanel as closeFiltersPanelState,
  openFiltersPanel as openFiltersPanelState,
  toggleFiltersPanel as toggleFiltersPanelState
} from '../utils/filtersPanel.js';
import {
  normalizeSetValues,
  parseCardTypeList,
  readCardType,
  readSelectedSets,
  writeSelectedCardTypes,
  writeSelectedRegulationMarks,
  writeSelectedSets
} from '../utils/filterState.js';
import { DataCache } from '../utils/DataCache.js';
import { createHierarchicalCardTypeDropdown } from '../components/HierarchicalCardTypeDropdown.js';
import { createMultiSelectDropdown } from '../components/MultiSelectDropdown.js';
import type { CardItem, TournamentReport } from '../types/index.js';
import {
  type AnyDropdownInstance,
  appState,
  type AppState,
  type ArchetypeOptionMeta,
  DEFAULT_ONLINE_META,
  isMultiSelectDropdown,
  pendingSelectionController,
  setPendingSelectionController,
  SUCCESS_FILTER_LABELS
} from './state.js';
import {
  buildDeckReport,
  ensureTournamentListLoaded,
  getArchetypeSourceTournaments,
  loadSelectionData,
  normalizeTournamentSelection,
  parseArchetypeQueryParam
} from './data.js';

function updateSetFilterOptions(items: CardItem[]): void {
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
    if (isMultiSelectDropdown(dropdown)) {
      dropdown.setDisabled(orderedCodes.length === 0);
    }
    dropdown.render(orderedCodes, appState.selectedSets);
  }
}

export { updateSetFilterOptions };

export async function applyCurrentFilters(state: AppState) {
  await applyFiltersSort(state.current.items, state.overrides);
  const existingSets =
    Array.isArray(state.selectedSets) && state.selectedSets.length > 0 ? [...state.selectedSets] : readSelectedSets();
  state.selectedSets = existingSets;
  state.selectedCardType = readCardType();
  updateActiveFilters();
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

export { consumeFiltersRedirectFlag };

function refreshFiltersDropdowns() {
  const dropdowns = appState.ui?.dropdowns || {};
  Object.values(dropdowns).forEach(dropdown => {
    if (dropdown && isMultiSelectDropdown(dropdown)) {
      dropdown.refresh();
    }
  });
}

export function openFiltersPanel() {
  const result = openFiltersPanelState({ focusFirstControl: false });
  if (result === 'opened') {
    ensureTournamentListLoaded(appState).catch(error => {
      logger.warn('Failed to load tournament list on filters open', error);
    });
    refreshFiltersDropdowns();
  }
  return result;
}

export function closeFiltersPanel(options: { skipDropdownClose?: boolean } = {}) {
  const { skipDropdownClose = false } = options;
  const result = closeFiltersPanelState({ restoreFocus: false });
  if (result === 'closed' && !skipDropdownClose) {
    document.dispatchEvent(new CustomEvent('dropdown:close-all'));
  }
  return result;
}

export function toggleFiltersPanel() {
  const result = toggleFiltersPanelState({
    focusFirstControlOnOpen: false,
    restoreFocusOnClose: false
  });
  if (result === 'opened') {
    ensureTournamentListLoaded(appState).catch(error => {
      logger.warn('Failed to load tournament list on filters open', error);
    });
    refreshFiltersDropdowns();
  } else if (result === 'closed') {
    document.dispatchEvent(new CustomEvent('dropdown:close-all'));
  }
  return result;
}

export function setupDropdownFilters(state: AppState) {
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
    }),
    cardTypes: createHierarchicalCardTypeDropdown(state, {
      key: 'cardTypes',
      triggerId: 'card-type-filter-trigger',
      menuId: 'card-type-filter-menu',
      listId: 'card-type-filter-list',
      summaryId: 'card-type-filter-summary',
      searchId: 'card-type-filter-search',
      chipsId: 'card-type-filter-chips',
      addButtonId: 'card-type-filter-add',
      labelId: 'card-type-label',
      placeholder: 'All card types',
      onChange: async (selection: string[]) => {
        writeSelectedCardTypes(selection);
        await applyCurrentFilters(state);
        setStateInURL({ cardType: selection.length ? selection.join(',') : '' }, { merge: true });
      }
    })
  };

  state.ui.dropdowns = dropdowns;

  const onDocumentPointerDown = (event: Event) => {
    const target = event.target as Node;
    const dropdownList = Object.values(dropdowns).filter((d): d is AnyDropdownInstance => Boolean(d));
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

  state.cleanup.addEventListener(document, 'pointerdown', event => {
    const panel = document.getElementById('filters');
    const toggle = document.getElementById('filtersToggle');
    if (!(panel instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
      return;
    }

    const isMobileViewport = window.matchMedia('(max-width: 899px)').matches;
    const isPanelOpen = panel.getAttribute('aria-hidden') === 'false';
    const target = event.target as Node | null;
    if (!isMobileViewport || !isPanelOpen || !target) {
      return;
    }

    if (!panel.contains(target) && !toggle.contains(target)) {
      closeFiltersPanel();
    }
  });

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

export async function setupArchetypeSelector(
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
  if (isMultiSelectDropdown(dropdown)) {
    dropdown.setDisabled(optionValues.length === 0);
  }

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
    if (isMultiSelectDropdown(dropdown)) {
      dropdown.refresh();
    }

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
        const archetypeReports: TournamentReport[] = [];

        for (const tournament of archetypeTournaments) {
          for (const archetypeBase of normalizedSelection) {
            try {
              const data = await fetchArchetypeReport(tournament, archetypeBase);
              const parsed = parseReport(data);
              archetypeReports.push(parsed);
            } catch (error: unknown) {
              if (error instanceof AppError && error.context?.status === 404) {
                logger.debug(`Archetype ${archetypeBase} not available for ${tournament}, skipping`);
              } else {
                logger.exception(`Failed fetching archetype ${archetypeBase} for ${tournament}`, error);
              }
            }
          }
        }

        let aggregate: TournamentReport;
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

export function setupControlHandlers(state: AppState) {
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
    updateActiveFilters();
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
    if (pendingSelectionController) {
      pendingSelectionController.abort();
    }
    const controller = new AbortController();
    setPendingSelectionController(controller);
    const { signal } = controller;

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
    try {
      const data = await loadSelectionData(selection, cache, {
        showSkeleton: true,
        successFilter: state.successFilter,
        archetypeBase: null
      });

      if (signal.aborted) {
        return;
      }

      state.current = data;
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      updateSetFilterOptions(data.items);
      await setupArchetypeSelector(selection, cache, state, true);

      if (signal.aborted) {
        return;
      }

      await applyCurrentFilters(state);

      setStateInURL({ tour: selection.join('|') }, { merge: true });
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      throw error;
    }
  };

  state.ui.onTournamentSelection = handleTournamentSelectionChange;
  state.ui.onSetSelection = handleSetSelectionChange;

  state.cleanup.addEventListener(elements.search, 'input', handleSearch);
  state.cleanup.addEventListener(elements.sort, 'change', handleSort);

  const handleSuccessFilterChange = async () => {
    const select = elements.success as HTMLSelectElement;
    const { value } = select;
    state.successFilter = value;

    const selection = state.selectedTournaments.length
      ? state.selectedTournaments
      : normalizeTournamentSelection(state.currentTournament ? [state.currentTournament] : []);

    const cache = state.cache || (state.cache = new DataCache());

    if (state.selectedArchetypes.length > 0) {
      await state.applyArchetypeSelection?.([...state.selectedArchetypes], { force: true });
    } else {
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

    setStateInURL({ success: value === 'all' ? '' : value }, { merge: true });
  };

  state.cleanup.addEventListener(elements.success, 'change', handleSuccessFilterChange);

  const cardTypeSelect = document.getElementById('card-type') as HTMLSelectElement | null;
  const cardTypeDropdown = state.ui?.dropdowns?.cardTypes || null;
  if (cardTypeSelect) {
    state.cleanup.addEventListener(cardTypeSelect, 'change', async () => {
      state.selectedCardType = cardTypeSelect.value;
      await applyCurrentFilters(state);
      setStateInURL({ cardType: state.selectedCardType }, { merge: true });
    });
  }

  const regmarkCheckboxes = document.querySelectorAll<HTMLInputElement>('input[name="regmark"]');
  const handleRegmarkChange = async () => {
    const selected: string[] = [];
    regmarkCheckboxes.forEach(cb => {
      if (cb.checked) {
        selected.push(cb.value.toUpperCase());
      }
    });
    writeSelectedRegulationMarks(selected);
    await applyCurrentFilters(state);
  };
  regmarkCheckboxes.forEach(cb => {
    state.cleanup.addEventListener(cb, 'change', handleRegmarkChange);
  });

  const urlState = getStateFromURL();
  if (urlState.query) {
    (elements.search as HTMLInputElement).value = urlState.query;
  }
  if (urlState.sort) {
    (elements.sort as HTMLSelectElement).value = urlState.sort;
  }
  if (urlState.success && SUCCESS_FILTER_LABELS[urlState.success]) {
    (elements.success as HTMLSelectElement).value = urlState.success;
    state.successFilter = urlState.success;
  }
  if (urlState.cardType) {
    const parsed = parseCardTypeList(urlState.cardType);
    if (parsed.length && cardTypeDropdown && typeof cardTypeDropdown.setSelection === 'function') {
      writeSelectedCardTypes(parsed);
      cardTypeDropdown.setSelection(parsed, { silent: true });
    } else if (cardTypeSelect) {
      cardTypeSelect.value = urlState.cardType;
      state.selectedCardType = urlState.cardType;
    }
  }
}

export function setupActiveFilterCallbacks(state: AppState) {
  initActiveFilters({
    onClearSearch: async () => {
      const s = document.getElementById('search') as HTMLInputElement | null;
      if (s) {
        s.value = '';
      }
      await applyCurrentFilters(state);
      setStateInURL({ query: '' }, { merge: true, replace: true });
    },
    onClearSets: async () => {
      writeSelectedSets([]);
      state.selectedSets = [];
      state.ui?.dropdowns?.sets?.setSelection([], { silent: true });
      await applyCurrentFilters(state);
      setStateInURL({ sets: '' }, { merge: true });
    },
    onClearCardTypes: async () => {
      writeSelectedCardTypes([]);
      state.selectedCardType = '';
      state.ui?.dropdowns?.cardTypes?.setSelection([], { silent: true });
      await applyCurrentFilters(state);
      setStateInURL({ cardType: '' }, { merge: true });
    },
    onClearRegulationMarks: async () => {
      writeSelectedRegulationMarks([]);
      document.querySelectorAll<HTMLInputElement>('input[name="regmark"]').forEach(el => {
        el.checked = false;
      });
      await applyCurrentFilters(state);
    },
    onClearSuccess: async () => {
      const sel = document.getElementById('success-filter') as HTMLSelectElement | null;
      if (sel) {
        sel.value = 'all';
      }
      state.successFilter = 'all';
      const selection = state.selectedTournaments.length
        ? state.selectedTournaments
        : [state.currentTournament || DEFAULT_ONLINE_META];
      const cache = state.cache || (state.cache = new DataCache());
      const data = await loadSelectionData(selection, cache, {
        showSkeleton: true,
        successFilter: 'all'
      });
      state.current = data;
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      updateSetFilterOptions(data.items);
      await applyCurrentFilters(state);
      setStateInURL({ success: '' }, { merge: true });
    },
    onClearAll: async () => {
      const s = document.getElementById('search') as HTMLInputElement | null;
      if (s) {
        s.value = '';
      }
      writeSelectedSets([]);
      state.selectedSets = [];
      state.ui?.dropdowns?.sets?.setSelection([], { silent: true });
      writeSelectedCardTypes([]);
      state.selectedCardType = '';
      state.ui?.dropdowns?.cardTypes?.setSelection([], { silent: true });
      writeSelectedRegulationMarks([]);
      document.querySelectorAll<HTMLInputElement>('input[name="regmark"]').forEach(el => {
        el.checked = false;
      });
      const sel = document.getElementById('success-filter') as HTMLSelectElement | null;
      if (sel) {
        sel.value = 'all';
      }
      state.successFilter = 'all';
      const selection = state.selectedTournaments.length
        ? state.selectedTournaments
        : [state.currentTournament || DEFAULT_ONLINE_META];
      const cache = state.cache || (state.cache = new DataCache());
      const data = await loadSelectionData(selection, cache, {
        showSkeleton: true,
        successFilter: 'all'
      });
      state.current = data;
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
      updateSetFilterOptions(data.items);
      await applyCurrentFilters(state);
      setStateInURL({ query: '', sets: '', cardType: '', success: '' }, { merge: true });
    }
  });
}
