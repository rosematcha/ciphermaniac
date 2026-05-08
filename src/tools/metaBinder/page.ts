import { fetchTournamentsList } from '../../api.js';
import { debounce } from '../../utils/performance.js';
import { logger } from '../../utils/logger.js';
import {
  DEFAULT_ONLINE_META,
  DEFAULT_RECENT_EVENTS,
  elements,
  hideError,
  setLoading,
  setPendingMessage,
  showError,
  state,
  updateGenerateState
} from './state.js';
import {
  markBinderDirty,
  renderArchetypeControls,
  renderBinderSections,
  renderTournamentsControls,
  updateIncludeThresholdLabel,
  updateStats,
  updateThresholdLabel
} from './ui.js';
import {
  checkOnlineMetaAvailability,
  computeSelectionDecks,
  generateBinder,
  loadSelections,
  recomputeFromSelection,
  saveSelections,
  setArchetypeToggleCallback
} from './analysis.js';
import { handleExportLayout, handleExportPtcgLive, handleImportLayout } from './export.js';

function handleTournamentToggle(tournament: string, isSelected: boolean): void {
  if (isSelected) {
    state.selectedTournaments.add(tournament);
  } else {
    state.selectedTournaments.delete(tournament);
  }
  saveSelections();
  recomputeFromSelection();
}

function handleSelectAllTournaments(): void {
  state.selectedTournaments = new Set(state.tournaments);
  renderTournamentsControls(handleTournamentToggle);
  saveSelections();
  recomputeFromSelection();
}

function handleSelectRecentTournaments(): void {
  const recent = state.tournaments.slice(0, DEFAULT_RECENT_EVENTS);
  state.selectedTournaments = recent.length ? new Set(recent) : new Set(state.tournaments);
  renderTournamentsControls(handleTournamentToggle);
  saveSelections();
  recomputeFromSelection();
}

function handleClearTournaments(): void {
  state.selectedTournaments.clear();
  renderTournamentsControls(handleTournamentToggle);
  saveSelections();
  recomputeFromSelection();
}

function handleArchetypeToggle(archetype: string, isSelected: boolean): void {
  if (isSelected) {
    state.selectedArchetypes.add(archetype);
  } else {
    state.selectedArchetypes.delete(archetype);
  }
  computeSelectionDecks();
  markBinderDirty();
  updateStats();
  saveSelections();
}

function handleSelectAllArchetypes(): void {
  if (!state.analysis) {
    return;
  }
  state.selectedArchetypes.clear();
  renderArchetypeControls(handleArchetypeToggle);
  computeSelectionDecks();
  markBinderDirty();
  updateStats();
  saveSelections();
}

function handleClearArchetypes(): void {
  if (!state.analysis) {
    return;
  }
  state.selectedArchetypes = new Set(['__NONE__']);
  renderArchetypeControls(handleArchetypeToggle);
  computeSelectionDecks();
  markBinderDirty();
  updateStats();
  saveSelections();
}

// Register the archetype toggle callback for use by analysis.ts
setArchetypeToggleCallback(handleArchetypeToggle);

function bindControlEvents() {
  elements.tournamentsAll?.addEventListener('click', () => {
    handleSelectAllTournaments();
  });
  elements.tournamentsRecent?.addEventListener('click', () => {
    handleSelectRecentTournaments();
  });
  elements.tournamentsClear?.addEventListener('click', () => {
    handleClearTournaments();
  });

  elements.archetypesAll?.addEventListener('click', () => {
    handleSelectAllArchetypes();
  });
  elements.archetypesClear?.addEventListener('click', () => {
    handleClearArchetypes();
  });

  if (elements.archetypeSearch) {
    elements.archetypeSearch.addEventListener(
      'input',
      debounce(event => {
        const target = event.target as HTMLInputElement | null;
        state.archetypeFilter = target?.value ?? '';
        renderArchetypeControls(handleArchetypeToggle);
      }, 150)
    );
  }

  elements.generate?.addEventListener('click', () => {
    generateBinder();
  });

  elements.exportButton?.addEventListener('click', () => {
    handleExportLayout();
  });

  elements.exportPtcgLiveButton?.addEventListener('click', () => {
    handleExportPtcgLive();
  });

  elements.importButton?.addEventListener('click', () => {
    elements.importFile?.click();
  });

  elements.importFile?.addEventListener('change', event => {
    handleImportLayout(event, handleTournamentToggle, handleArchetypeToggle);
  });

  if (elements.placementFilterSelect) {
    elements.placementFilterSelect.addEventListener('change', () => {
      state.placementFilter = Number(elements.placementFilterSelect?.value ?? 0);
      recomputeFromSelection();
    });
  }

  if (elements.thresholdSlider) {
    elements.thresholdSlider.addEventListener('input', () => {
      const pct = Number(elements.thresholdSlider?.value ?? 0);
      state.copyThreshold = pct / 100;
      updateThresholdLabel(pct);
      if (state.binderData && !state.isBinderDirty) {
        renderBinderSections();
      }
    });
  }

  if (elements.includeThresholdSlider) {
    elements.includeThresholdSlider.addEventListener('input', () => {
      const pct = Number(elements.includeThresholdSlider?.value ?? 0);
      state.includeThreshold = pct / 100;
      updateIncludeThresholdLabel(pct);
      if (state.binderData && !state.isBinderDirty) {
        renderBinderSections();
      }
    });
  }
}

async function initialize() {
  try {
    bindControlEvents();
    setLoading(true);
    hideError();
    setPendingMessage('Select events, then click "Generate Binder" to begin.');

    const [tournaments, overrides, hasOnlineMeta] = await Promise.all([
      fetchTournamentsList(),
      Promise.resolve({}),
      checkOnlineMetaAvailability()
    ]);

    state.tournaments = tournaments;
    state.overrides = overrides || {};

    if (hasOnlineMeta && !state.tournaments.includes(DEFAULT_ONLINE_META)) {
      state.tournaments.unshift(DEFAULT_ONLINE_META);
    }

    if (!state.tournaments.length) {
      showError(
        'No tournaments are available. This may be a temporary network issue. Please refresh the page to try again.'
      );
      return;
    }

    const savedSelections = loadSelections();
    if (savedSelections && savedSelections.tournaments.length) {
      state.selectedTournaments = new Set(
        savedSelections.tournaments.filter(tournament => state.tournaments.includes(tournament))
      );
      if (savedSelections.archetypes.length) {
        import('./state.js').then(mod => {
          mod.setPendingArchetypeSelection(new Set(savedSelections.archetypes));
        });
      }
    }

    if (!state.selectedTournaments.size) {
      const defaults = state.tournaments.slice(0, DEFAULT_RECENT_EVENTS);
      state.selectedTournaments = defaults.length ? new Set(defaults) : new Set(state.tournaments);
    }

    renderTournamentsControls(handleTournamentToggle);
    await recomputeFromSelection();
    renderBinderSections();
    updateStats();
    updateGenerateState();
    setLoading(false);
  } catch (error) {
    logger.error('Failed to initialize meta binder', error);
    showError('Something went wrong while loading the meta binder.');
  }
}

if (typeof document !== 'undefined') {
  initialize();
}
