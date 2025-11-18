/* eslint-disable no-console, id-length, max-lines-per-function, max-statements, complexity, no-param-reassign, prefer-destructuring, max-len, no-multiple-empty-lines, require-atomic-updates, jsdoc/require-param, jsdoc/check-param-names */
/**
 * Main application bootstrap and initialization
 * @module Main
 */

// Clear any existing scroll listeners that might be left over from imagePreloader
// eslint-disable-next-line wrap-iife
(function clearExistingScrollListeners() {
  const oldListeners = /** @type {EventListener[]} */ (window.__imagePreloaderListeners || []);
  oldListeners.forEach(listener => {
    window.removeEventListener('scroll', listener);
  });
  window.__imagePreloaderListeners = [];
})();

// DEBUG: Intercept Image loading to track erroneous thumbnail requests
// Disabled in production to reduce console noise
// (function setupImageLoadingDebug() {
//   const OriginalImage = window.Image;
//   const problematicCards = [
//     'Boss\'s_Orders.png',
//     'Pokégear_3.0.png',
//     'Ethan\'s_',
//     'Team_Rocket\'s_',
//     'Lillie\'s_',
//     'Exp._Share.png',
//     'Pokémon_Catcher.png'
//   ];

//   class DebugImage extends OriginalImage {
//     constructor(...args) {
//       super(...args);

//       const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
//       const originalSrcSetter = descriptor && descriptor.set;

//       if (originalSrcSetter) {
//         Object.defineProperty(this, 'src', {
//           configurable: true,
//           enumerable: true,
//           get() {
//             return this.getAttribute('src');
//           },
//           set(value) {
//             if (
//               typeof value === 'string' &&
//               value.includes('thumbnails/') &&
//               problematicCards.some(card => value.includes(card)) &&
//               !/_ [A-Z]+_\d+\.png$/u.test(value.replace(/.*\//, ''))
//             ) {
//               console.error('🚨 ERRONEOUS THUMBNAIL REQUEST:', value);
//               console.trace('Call stack:');
//             }
//             originalSrcSetter.call(this, value);
//           }
//         });
//       }
//     }
//   }

//   window.Image = DebugImage;
// }());

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
import { storage } from './utils/storage.js';
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

/**
 * Application state - simple object
 */
const appState = {
  currentTournament: null,
  selectedTournaments: [],
  selectedSets: [],
  selectedCardType: '__all__',
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

/** @typedef {typeof appState} AppState */

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
    if (!entry || this.isExpired(entry.ts)) {
      return null;
    }
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
 * Deduplicate and normalize a selection of tournaments.
 * @param {string|string[]} selection
 * @returns {string[]}
 */
function normalizeTournamentSelection(selection) {
  if (!selection) {
    return [];
  }
  const array = Array.isArray(selection) ? selection : [selection];
  const seen = new Set();
  const normalized = [];
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
function updateSetFilterOptions(items) {
  const dropdown = appState.ui?.dropdowns?.sets || null;

  const setCodes = new Set();
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

  const orderedCodes = sortSetCodesByRelease(setCodes);
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

function closeAllDropdowns(exceptKey) {
  const dropdowns = appState.ui?.dropdowns || {};
  Object.entries(dropdowns).forEach(([key, dropdown]) => {
    if (!dropdown) {
      return;
    }
    if (exceptKey && key === exceptKey) {
      return;
    }
    dropdown.close();
  });
}

function createMultiSelectDropdown(state, config) {
  const trigger = /** @type {HTMLButtonElement|null} */ (document.getElementById(config.triggerId));
  const menu = /** @type {HTMLElement|null} */ (document.getElementById(config.menuId));
  const list = /** @type {HTMLElement|null} */ (document.getElementById(config.listId));
  const summary = /** @type {HTMLElement|null} */ (document.getElementById(config.summaryId));
  const search = config.searchId
    ? /** @type {HTMLInputElement|null} */ (document.getElementById(config.searchId))
    : null;
  const chipsContainer = config.chipsId
    ? /** @type {HTMLElement|null} */ (document.getElementById(config.chipsId))
    : null;
  const addButton = config.addButtonId
    ? /** @type {HTMLButtonElement|null} */ (document.getElementById(config.addButtonId))
    : null;
  const labelElement = config.labelId ? document.getElementById(config.labelId) : null;
  const comboRoot = trigger ? trigger.closest('.filter-combobox') : null;
  const root = trigger ? trigger.closest('.filter-dropdown') : null;
  /** @type {HTMLElement|null} */
  const actionsFooter = menu ? menu.querySelector('[data-multi-only]') : null;

  if (!(trigger && menu && list && summary && chipsContainer && addButton)) {
    return null;
  }

  const baseWidth = config.baseWidth || 320;
  const maxWidth = config.maxWidth || 500;
  const placeholderSummary = config.placeholder || 'Select option';
  const emptyMessage = config.emptyMessage || 'No results';
  const formatOption = config.formatOption || (value => String(value));
  const addButtonLabel = config.addButtonLabel || 'Add another';
  const addButtonAriaLabel = config.addAriaLabel || 'Add another selection';
  const allSelectedLabel = config.allSelectedLabel || 'All selected';
  const includeAllOption = config.includeAllOption === true;
  const allOptionLabel = config.allOptionLabel || 'All';
  const maxVisibleChips = Number.isFinite(config.maxVisibleChips) ? Number(config.maxVisibleChips) : 2;
  const singularLabel =
    config.singularLabel || labelElement?.dataset.labelSingular || labelElement?.textContent?.trim() || 'Selection';
  const pluralLabel = config.pluralLabel || labelElement?.dataset.labelPlural || singularLabel;
  const placeholderAriaLabel = config.placeholderAriaLabel || placeholderSummary;
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  chipsContainer.setAttribute('role', 'list');
  addButton.textContent = addButtonLabel;

  const getDisplayParts = optionValue => {
    const raw = formatOption(optionValue);
    if (raw && typeof raw === 'object') {
      const label = typeof raw.label === 'string' ? raw.label : '';
      const fullName = typeof raw.fullName === 'string' ? raw.fullName : label || String(optionValue ?? '');
      const codeValue = typeof raw.code === 'string' ? raw.code : '';
      const codeLabel = typeof raw.codeLabel === 'string' ? raw.codeLabel : codeValue;
      const finalLabel = label || `${fullName}${codeLabel ? ` (${codeLabel})` : ''}`;
      return {
        label: finalLabel,
        name: fullName,
        code: codeValue,
        codeLabel
      };
    }
    const fallback = String(raw ?? optionValue ?? '');
    return {
      label: fallback,
      name: fallback,
      code: '',
      codeLabel: ''
    };
  };

  const dropdownState = {
    options: [],
    selected: [],
    filterText: '',
    isOpen: false,
    disabled: false,
    chipsExpanded: false,
    multi: false
  };

  const updateLabelText = () => {
    if (!labelElement) {
      return;
    }
    const count = dropdownState.selected.length;
    const nextLabel = count > 1 ? pluralLabel : singularLabel;
    labelElement.textContent = nextLabel;
  };

  const updateTriggerState = () => {
    const totalOptions = dropdownState.options.length;
    const count = dropdownState.selected.length;
    const hasSelection = count > 0;
    const hasMultiple = count > 1;
    const allSelected = hasSelection && totalOptions > 0 && count === totalOptions;
    const firstValue = hasSelection ? dropdownState.selected[0] : null;
    const firstDisplay = firstValue ? getDisplayParts(firstValue) : null;
    const firstLabel = firstDisplay ? firstDisplay.label : '';

    let summaryText = placeholderSummary;
    let ariaLabel = placeholderAriaLabel;
    let stateValue = 'empty';

    if (dropdownState.disabled) {
      summaryText = config.disabledSummary || 'Not available';
      ariaLabel = summaryText;
      stateValue = 'disabled';
    } else if (!hasSelection) {
      summaryText = placeholderSummary;
      ariaLabel = placeholderAriaLabel;
      stateValue = 'empty';
    } else if (allSelected) {
      summaryText = allSelectedLabel;
      ariaLabel = `${pluralLabel} fully selected`;
      stateValue = 'full';
    } else {
      summaryText = hasMultiple ? `${firstLabel} +${count - 1}` : firstLabel;
      ariaLabel = hasMultiple
        ? `${count} ${pluralLabel.toLowerCase()} selected. First: ${firstLabel}`
        : `${singularLabel} ${firstLabel} selected`;
      stateValue = hasMultiple ? 'multi' : 'single';
    }

    const shouldDisableTrigger = dropdownState.disabled || totalOptions === 0;
    trigger.disabled = shouldDisableTrigger;
    trigger.setAttribute('aria-disabled', shouldDisableTrigger ? 'true' : 'false');
    summary.textContent = hasMultiple ? '' : summaryText;
    summary.setAttribute('aria-hidden', hasMultiple ? 'true' : 'false');
    summary.classList.toggle('is-hidden', hasMultiple);
    trigger.dataset.state = stateValue;
    trigger.setAttribute('aria-label', ariaLabel);

    if (addButton) {
      const showAdd = hasSelection && !allSelected && !dropdownState.disabled;
      addButton.hidden = !showAdd;
      addButton.classList.toggle('is-visible', showAdd);
      addButton.disabled = !showAdd;
      if (showAdd) {
        addButton.setAttribute('aria-label', addButtonAriaLabel);
      }
    }

    if (comboRoot) {
      comboRoot.classList.toggle('is-disabled', shouldDisableTrigger);
      comboRoot.classList.toggle('is-full', allSelected);
      comboRoot.classList.toggle('has-selection', hasSelection);
      comboRoot.setAttribute('data-state', stateValue);
    }

    if (root) {
      root.classList.toggle('has-selection', hasSelection);
      root.classList.toggle('is-disabled', shouldDisableTrigger);
      root.classList.toggle('is-multi', hasMultiple);
    }

    if (actionsFooter) {
      const multiActive = dropdownState.multi && !shouldDisableTrigger;
      actionsFooter.hidden = !multiActive;
    }
  };

  const renderChips = () => {
    if (!chipsContainer) {
      return;
    }
    const selection = dropdownState.selected;
    chipsContainer.innerHTML = '';

    const showChips = selection.length > 1;
    chipsContainer.hidden = !showChips;

    if (!showChips) {
      dropdownState.chipsExpanded = false;
      chipsContainer.removeAttribute('aria-label');
      return;
    }

    const labelCount = selection.length;
    const ariaSummary =
      labelCount === 1
        ? `${singularLabel} ${getDisplayParts(selection[0]).label} selected`
        : `${labelCount} ${pluralLabel.toLowerCase()} selected`;
    chipsContainer.setAttribute('aria-label', ariaSummary);

    if (selection.length <= maxVisibleChips) {
      dropdownState.chipsExpanded = false;
    }

    const visibleCount =
      dropdownState.chipsExpanded || selection.length <= maxVisibleChips
        ? selection.length
        : Math.min(selection.length, maxVisibleChips);

    selection.slice(0, visibleCount).forEach(value => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.setAttribute('role', 'listitem');

      const label = document.createElement('span');
      const display = getDisplayParts(value);
      label.className = 'filter-chip-label';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'filter-chip-name';
      nameSpan.textContent = display.name;
      label.appendChild(nameSpan);

      if (config.key !== 'sets' && display.code) {
        const codeSpan = document.createElement('span');
        codeSpan.className = 'filter-chip-code';
        codeSpan.textContent = display.code;
        label.appendChild(codeSpan);
      }

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'filter-chip-remove';
      removeButton.setAttribute('aria-label', `Remove ${display.label}`);
      removeButton.textContent = 'x';
      removeButton.addEventListener('click', () => {
        const nextSelection = dropdownState.selected.filter(item => item !== value);
        commitSelection(nextSelection);
        renderOptions();
      });

      chip.appendChild(label);
      chip.appendChild(removeButton);
      chipsContainer.appendChild(chip);
    });

    if (selection.length > maxVisibleChips) {
      if (!dropdownState.chipsExpanded) {
        const hiddenCount = selection.length - maxVisibleChips;
        const expandButton = document.createElement('button');
        expandButton.type = 'button';
        expandButton.className = 'filter-chip filter-chip--more';
        expandButton.textContent = `+${hiddenCount} more`;
        expandButton.setAttribute('aria-label', `Show ${hiddenCount} more selections`);
        expandButton.setAttribute('aria-expanded', 'false');
        expandButton.addEventListener('click', () => {
          dropdownState.chipsExpanded = true;
          renderChips();
        });
        chipsContainer.appendChild(expandButton);
      } else {
        const collapseButton = document.createElement('button');
        collapseButton.type = 'button';
        collapseButton.className = 'filter-chip filter-chip--collapse';
        collapseButton.textContent = 'Show less';
        collapseButton.setAttribute('aria-label', 'Collapse selected list');
        collapseButton.setAttribute('aria-expanded', 'true');
        collapseButton.addEventListener('click', () => {
          dropdownState.chipsExpanded = false;
          renderChips();
        });
        chipsContainer.appendChild(collapseButton);
      }
    }
  };

  const measureWidth = textValue => {
    const safeValue = typeof textValue === 'string' ? textValue : String(textValue ?? '');
    if (!measureContext) {
      return safeValue.length * 8;
    }
    const computedStyle = window.getComputedStyle(trigger);
    const font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    measureContext.font = font;
    return measureContext.measureText(safeValue).width;
  };

  const updateWidth = () => {
    if (!menu) {
      return;
    }
    let width = baseWidth;
    if (dropdownState.options.length) {
      const optionWidths = dropdownState.options.map(option => measureWidth(getDisplayParts(option).label));
      const longest = Math.max(...optionWidths, measureWidth(summary?.textContent || ''));
      width = Math.min(Math.max(Math.ceil(longest + 120), baseWidth), maxWidth);
    }
    menu.style.minWidth = `${width}px`;
    menu.style.maxWidth = `${width}px`;
  };

  const getFilteredOptions = () => {
    if (!dropdownState.filterText) {
      return dropdownState.options;
    }
    const term = dropdownState.filterText.toLowerCase();
    return dropdownState.options.filter(option => {
      const display = getDisplayParts(option);
      return display.label.toLowerCase().includes(term);
    });
  };

  const commitSelection = (selection, { silent = false } = {}) => {
    const wasMulti = dropdownState.multi;
    let normalized = Array.isArray(selection) ? dropdownState.options.filter(option => selection.includes(option)) : [];

    if (!dropdownState.multi && normalized.length > 1) {
      let chosen = null;
      if (Array.isArray(selection)) {
        for (let index = selection.length - 1; index >= 0; index -= 1) {
          const candidate = selection[index];
          if (normalized.includes(candidate)) {
            chosen = candidate;
            break;
          }
        }
      }
      if (chosen !== null && chosen !== undefined) {
        normalized = dropdownState.options.filter(option => option === chosen);
      } else {
        normalized = normalized.slice(-1);
      }
    }

    const unchanged =
      normalized.length === dropdownState.selected.length &&
      normalized.every((value, index) => value === dropdownState.selected[index]);

    if (!unchanged) {
      dropdownState.selected = normalized;
      if (!silent && typeof config.onChange === 'function') {
        try {
          const result = config.onChange([...dropdownState.selected]);
          if (result && typeof result.catch === 'function') {
            result.catch(error => logger.error(`Dropdown ${config.key} change handler rejected`, error));
          }
        } catch (error) {
          logger.error(`Dropdown ${config.key} change handler threw`, error);
        }
      }
    }

    dropdownState.multi = dropdownState.selected.length > 1 || (dropdownState.isOpen && wasMulti);
    if (!dropdownState.multi) {
      dropdownState.chipsExpanded = false;
    }

    updateLabelText();
    updateTriggerState();
    renderChips();
    updateWidth();
  };

  const renderOptions = () => {
    list.innerHTML = '';
    if (!dropdownState.multi && dropdownState.selected.length > 1) {
      dropdownState.multi = true;
    }

    if (includeAllOption) {
      const allButton = document.createElement('button');
      allButton.type = 'button';
      allButton.className = 'filter-option filter-option--single filter-option--all';
      const isAllActive = dropdownState.selected.length === 0;
      allButton.textContent = allOptionLabel;
      allButton.setAttribute('role', 'option');
      allButton.setAttribute('aria-selected', isAllActive ? 'true' : 'false');
      if (isAllActive) {
        allButton.classList.add('is-active');
      }
      allButton.addEventListener('click', () => {
        dropdownState.multi = false;
        commitSelection([]);
        renderOptions();
        close();
        trigger.focus();
      });
      list.appendChild(allButton);
    }

    const filtered = getFilteredOptions();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'filter-menu-empty';
      empty.textContent = emptyMessage;
      list.appendChild(empty);
      return;
    }

    filtered.forEach(optionValue => {
      const display = getDisplayParts(optionValue);
      const isSelected = dropdownState.selected.includes(optionValue);

      if (dropdownState.multi) {
        const optionLabel = document.createElement('label');
        optionLabel.className = 'filter-option filter-option--multi';
        optionLabel.setAttribute('role', 'option');
        optionLabel.setAttribute('aria-selected', isSelected ? 'true' : 'false');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = optionValue;
        checkbox.checked = isSelected;
        checkbox.addEventListener('change', () => {
          const nextSelection = checkbox.checked
            ? [...dropdownState.selected, optionValue]
            : dropdownState.selected.filter(value => value !== optionValue);
          commitSelection(nextSelection);
          renderOptions();
        });

        const textSpan = document.createElement('span');
        textSpan.textContent = display.label;

        optionLabel.appendChild(checkbox);
        optionLabel.appendChild(textSpan);
        list.appendChild(optionLabel);
      } else {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'filter-option filter-option--single';
        optionButton.setAttribute('role', 'option');

        const labelWrapper = document.createElement('span');
        labelWrapper.className = 'filter-option-label';

        const fullNameSpan = document.createElement('span');
        fullNameSpan.className = 'filter-option-name';
        fullNameSpan.textContent = display.name || display.label;
        labelWrapper.appendChild(fullNameSpan);

        const codeSpan = document.createElement('span');
        codeSpan.className = 'filter-option-code';
        codeSpan.textContent = display.code || display.codeLabel || '';

        if (codeSpan.textContent) {
          labelWrapper.appendChild(codeSpan);
        }

        optionButton.appendChild(labelWrapper);
        if (isSelected) {
          optionButton.classList.add('is-active');
        }
        optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');

        optionButton.addEventListener('click', () => {
          const nextSelection = [optionValue];
          commitSelection(nextSelection);
          renderOptions();
          close();
          trigger.focus();
        });

        list.appendChild(optionButton);
      }
    });
  };

  const render = (options = dropdownState.options, selection = dropdownState.selected) => {
    dropdownState.options = Array.isArray(options) ? options.slice() : [];
    dropdownState.selected = Array.isArray(selection)
      ? dropdownState.options.filter(option => selection.includes(option))
      : [];
    dropdownState.multi = dropdownState.selected.length > 1;
    dropdownState.chipsExpanded = false;
    renderOptions();
    updateLabelText();
    updateTriggerState();
    renderChips();
    updateWidth();
  };

  const setSelection = (selection, options = {}) => {
    commitSelection(selection, { silent: options.silent === true });
    renderOptions();
  };

  const setDisabled = disabled => {
    dropdownState.disabled = Boolean(disabled);
    if (dropdownState.disabled) {
      close();
    }
    updateLabelText();
    updateTriggerState();
    renderChips();
    updateWidth();
  };

  /**
   * Open the dropdown, optionally forcing multi-select behavior.
   * @param {{ multi?: boolean }} [options]
   */
  const open = (options = {}) => {
    const { multi } = options;
    if (dropdownState.disabled || dropdownState.isOpen) {
      return;
    }
    closeAllDropdowns(config.key);
    dropdownState.isOpen = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (root) {
      root.classList.add('is-open');
    }
    dropdownState.filterText = '';
    dropdownState.chipsExpanded = false;
    const shouldUseMulti = typeof multi === 'boolean' ? multi : dropdownState.selected.length > 1;
    dropdownState.multi = shouldUseMulti;
    if (search) {
      search.value = '';
    }
    renderOptions();
    updateWidth();
    if (search) {
      window.requestAnimationFrame(() => search.focus());
    }
    appState.ui.openDropdown = config.key;
  };

  const close = () => {
    if (!dropdownState.isOpen) {
      return;
    }
    dropdownState.isOpen = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (root) {
      root.classList.remove('is-open');
    }
    dropdownState.multi = dropdownState.selected.length > 1;
    updateWidth();
    if (appState.ui.openDropdown === config.key) {
      appState.ui.openDropdown = null;
    }
  };

  const toggle = () => {
    if (trigger.disabled) {
      return;
    }
    if (dropdownState.isOpen) {
      close();
    } else {
      open();
    }
  };

  const contains = node => {
    if (!node) {
      return false;
    }
    if (addButton) {
      return menu.contains(node) || trigger.contains(node) || addButton.contains(node);
    }
    return menu.contains(node) || trigger.contains(node);
  };

  state.cleanup.addEventListener(trigger, 'click', toggle);
  state.cleanup.addEventListener(trigger, 'keydown', event => {
    if (trigger.disabled) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    } else if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !dropdownState.isOpen &&
      dropdownState.selected.length > 0
    ) {
      event.preventDefault();
      const nextSelection = dropdownState.selected.slice(0, -1);
      commitSelection(nextSelection);
      renderOptions();
    } else if (event.key === 'Escape') {
      close();
    }
  });
  state.cleanup.addEventListener(menu, 'keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      trigger.focus();
    }
  });

  if (search) {
    state.cleanup.addEventListener(search, 'input', event => {
      dropdownState.filterText = event.target.value.trim().toLowerCase();
      renderOptions();
    });
  }

  if (addButton) {
    state.cleanup.addEventListener(addButton, 'click', () => {
      if (addButton.disabled) {
        return;
      }
      if (!dropdownState.isOpen) {
        open({ multi: true });
      } else {
        dropdownState.multi = true;
        renderOptions();
        updateWidth();
      }
      if (search) {
        search.value = '';
        window.requestAnimationFrame(() => search.focus());
      }
      appState.ui.openDropdown = config.key;
    });
  }

  menu.querySelectorAll('[data-action]').forEach(actionButton => {
    const action = actionButton.getAttribute('data-action');
    state.cleanup.addEventListener(actionButton, 'click', () => {
      if (action === 'select-all') {
        dropdownState.multi = true;
        commitSelection([...dropdownState.options]);
        renderOptions();
      } else if (action === 'clear') {
        dropdownState.multi = false;
        commitSelection([]);
        renderOptions();
      } else if (action === 'close') {
        close();
        trigger.focus();
      }
    });
  });

  render();

  return {
    key: config.key,
    render,
    setSelection,
    open,
    close,
    contains,
    setDisabled,
    refresh: () => {
      updateLabelText();
      updateTriggerState();
      renderChips();
      updateWidth();
    }
  };
}

function setupDropdownFilters(state) {
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
      onChange: selection => state.ui.onTournamentSelection?.(selection)
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
      onChange: selection => state.ui.onSetSelection?.(selection)
    })
  };

  state.ui.dropdowns = dropdowns;

  const onDocumentPointerDown = event => {
    const target = event.target;
    const dropdownList = Object.values(dropdowns).filter(Boolean);
    const clickedInsideDropdown = dropdownList.some(dropdown => dropdown.contains(target));

    if (!clickedInsideDropdown) {
      closeAllDropdowns();
    }
  };

  const onDocumentKeydown = event => {
    if (event.key === 'Escape') {
      closeAllDropdowns();
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

function closeFiltersPanel(options = {}) {
  const { skipDropdownClose = false } = options;
  const result = closeFiltersPanelState({ restoreFocus: false });
  if (result === 'closed' && !skipDropdownClose) {
    closeAllDropdowns();
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
    closeAllDropdowns();
  }
  return result;
}

async function applyCurrentFilters(state) {
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
async function loadSelectionData(selection, cache, options = {}) {
  const { showSkeleton = false } = options;
  const tournaments = normalizeTournamentSelection(selection);

  if (tournaments.length === 0) {
    return { deckTotal: 0, items: [] };
  }

  if (showSkeleton) {
    showGridSkeleton();
  }

  try {
    const reports = new Array(tournaments.length);
    const pendingFetches = [];

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
async function initializeTournamentSelector(state) {
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
  if (hasOnlineMeta) {
    tournaments.unshift(DEFAULT_ONLINE_META);
  }

  const urlState = getStateFromURL();
  const urlSelectionRaw = urlState.tour ? urlState.tour.split(',') : [];
  const normalizedFromUrl = normalizeTournamentSelection(urlSelectionRaw);

  let selection = normalizedFromUrl.filter(value => tournaments.includes(value));

  if (selection.length === 0 && state.selectedTournaments.length > 0) {
    selection = normalizeTournamentSelection(state.selectedTournaments).filter(value => tournaments.includes(value));
  }

  if (selection.length === 0 && tournaments.includes(DEFAULT_ONLINE_META)) {
    selection = [DEFAULT_ONLINE_META];
  }

  if (selection.length === 0 && tournaments.length > 0) {
    selection = [tournaments[0]];
  }

  state.availableTournaments = tournaments;
  state.selectedTournaments = selection;
  state.currentTournament = selection[0] || null;

  if (urlState.tour) {
    const normalizedParam = selection.join(',');
    const normalizedUrlParam = normalizeTournamentSelection(urlSelectionRaw)
      .filter(value => tournaments.includes(value))
      .join(',');
    if (normalizedUrlParam !== normalizedParam) {
      setStateInURL({ tour: normalizedParam }, { merge: true, replace: true });
    }
  }

  const dropdown = state.ui?.dropdowns?.tournaments;
  if (dropdown) {
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
async function hydrateOnlineTournaments(state, options = {}) {
  const tournaments = await safeAsync(
    () => fetchLimitlessTournaments(options),
    'fetching Limitless online tournaments',
    []
  );

  state.onlineTournaments = tournaments;

  if (tournaments.length > 0) {
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
 * @param {string|string[]} tournaments
 * @param {DataCache} cache
 * @param {AppState} state
 * @param {boolean} skipUrlInit - Skip URL-based initialization (e.g., during tournament change)
 */
async function setupArchetypeSelector(tournaments, cache, state, skipUrlInit = false) {
  const archeSel = /** @type {HTMLSelectElement|null} */ (document.getElementById('archetype'));
  if (!archeSel) {
    return;
  }

  // Clear existing options except "All archetypes"
  while (archeSel.children.length > 1) {
    archeSel.removeChild(archeSel.lastChild);
  }

  const normalizedTournaments = normalizeTournamentSelection(tournaments);

  // Filter out online tournaments - they should not contribute to archetypes
  const physicalTournaments = normalizedTournaments.filter(tournament => tournament !== DEFAULT_ONLINE_META);

  const combinedArchetypes = new Set();

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
      archetypesList.forEach(archetype => combinedArchetypes.add(archetype));
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
      const data = await loadSelectionData(selection, cache);
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

    const archetypeCacheKey = `${selectedValue}::${physicalTournamentsForArchetype.join('|')}`;

    let cached = state.archeCache.get(archetypeCacheKey);
    if (!cached) {
      const archetypeReports = [];

      for (const tournament of physicalTournamentsForArchetype) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await fetchArchetypeReport(tournament, selectedValue);
          const parsed = parseReport(data);
          archetypeReports.push(parsed);
        } catch (error) {
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
function setupControlHandlers(state) {
  const elements = validateElements(
    {
      search: '#search',
      sort: '#sort',
      archetype: '#archetype',
      cardType: '#card-type'
    },
    'controls'
  );

  const handleSearch = debounce(async () => {
    await applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ q: elements.search.value }, { merge: true, replace: true });
  });

  const handleSort = async () => {
    await applyFiltersSort(state.current.items, state.overrides);
    setStateInURL({ sort: elements.sort.value }, { merge: true });
  };

  const handleSetSelectionChange = async (selection, { silent = false } = {}) => {
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

  const selectionsEqual = (first, second) => {
    if (!Array.isArray(first) || !Array.isArray(second)) {
      return false;
    }
    if (first.length !== second.length) {
      return false;
    }
    return first.every((value, index) => value === second[index]);
  };

  const handleTournamentSelectionChange = async newSelection => {
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

    if (selectionsEqual(selection, state.selectedTournaments)) {
      return;
    }

    const previousArchetype = elements.archetype?.value || '__all__';

    logger.info(`Switching to tournaments: ${selection.join(', ')}`);
    state.selectedTournaments = selection;
    state.currentTournament = selection[0] || null;
    state.archeCache.clear();

    const cache = state.cache || (state.cache = new DataCache());

    const data = await loadSelectionData(selection, cache, {
      showSkeleton: true
    });
    state.current = data;
    updateSetFilterOptions(data.items);
    await applyCurrentFilters(state);

    await setupArchetypeSelector(selection, cache, state, true);

    const archetypeElement = /** @type {HTMLSelectElement} */ (elements.archetype);
    const availableValues = Array.from(archetypeElement.options).map(option => option.value);
    const canPreserveArchetype = previousArchetype !== '__all__' && availableValues.includes(previousArchetype);
    const targetArchetype = canPreserveArchetype ? previousArchetype : '__all__';

    archetypeElement.value = targetArchetype;

    if (canPreserveArchetype) {
      archetypeElement.dispatchEvent(new Event('change'));
    } else {
      renderSummary(document.getElementById('summary'), data.deckTotal, data.items.length);
    }

    setStateInURL(
      {
        tour: selection.join(','),
        archetype: canPreserveArchetype ? previousArchetype : ''
      },
      { merge: true }
    );
  };

  const handleCardTypeChange = async () => {
    state.selectedCardType = readCardType();
    await applyCurrentFilters(state);
  };

  state.cleanup.addEventListener(elements.search, 'input', handleSearch);
  state.cleanup.addEventListener(elements.sort, 'change', handleSort);
  state.cleanup.addEventListener(elements.cardType, 'change', handleCardTypeChange);

  state.ui.onTournamentSelection = selection => {
    handleTournamentSelectionChange(selection).catch(error => logger.error('Failed to update tournaments', error));
  };

  state.ui.onSetSelection = (selection, options = {}) => {
    handleSetSelectionChange(selection, options).catch(error => logger.error('Failed to update sets', error));
  };

  // Restore initial state from URL
  const urlState = getStateFromURL();
  if (urlState.q) {
    elements.search.value = urlState.q;
  }
  if (urlState.sort) {
    elements.sort.value = urlState.sort;
  }
  writeSelectedSets(state.selectedSets);
  state.selectedCardType = readCardType();
}

// Restore state from URL when navigating back/forward
async function handlePopState(state) {
  logger.debug('popstate detected, restoring URL state');
  const parsed = parseHash();
  if (parsed.route === 'card' && parsed.name) {
    location.assign(buildCardPath(parsed.name));
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
    if (ticking) {
      return;
    }
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
  const elements = validateElements(
    {
      search: '#search',
      sort: '#sort',
      archetype: '#archetype',
      cardType: '#card-type'
    },
    'applying initial state'
  );

  // Apply URL state to controls and trigger filtering
  if (urlState.q) {
    elements.search.value = urlState.q;
  }
  if (urlState.sort) {
    elements.sort.value = urlState.sort;
  }

  if (elements.cardType instanceof HTMLSelectElement && urlState.cardType) {
    const hasCardTypeOption = Array.from(elements.cardType.options).some(option => option.value === urlState.cardType);
    if (hasCardTypeOption) {
      elements.cardType.value = urlState.cardType;
      state.selectedCardType = urlState.cardType;
      setStateInURL({ cardType: '' }, { merge: true, replace: true });
    }
  }

  const setSelection = parseSetList(urlState.sets);

  if (setSelection.length > 0) {
    if (typeof state.ui.onSetSelection === 'function') {
      state.ui.onSetSelection(setSelection, { silent: true });
    } else {
      state.selectedSets = setSelection;
      writeSelectedSets(setSelection);
    }
    const setsDropdown = state.ui?.dropdowns?.sets;
    if (setsDropdown) {
      setsDropdown.setSelection(setSelection, { silent: true });
    }
    setStateInURL({ sets: '' }, { merge: true, replace: true });
  }

  let filtersHandled = false;
  if (urlState.archetype && urlState.archetype !== '__all__') {
    elements.archetype.value = urlState.archetype;
    elements.archetype.dispatchEvent(new Event('change'));
    filtersHandled = true;
  }

  if (!filtersHandled) {
    await applyCurrentFilters(state);
    filtersHandled = true;
  }
}

/**
 * Main application initialization
 */
async function initializeApp() {
  try {
    // Normalize legacy hash routes like #card/... to the new card path
    if (normalizeRouteOnLoad()) {
      return;
    }

    logger.info('Initializing Ciphermaniac application');

    // Show skeleton loading immediately
    showGridSkeleton();

    // Initialize development tools
    // initMissingThumbsDev(); // Disabled to prevent redundant thumbnail requests
    initCacheDev();

    appState.cache = appState.cache || new DataCache();
    const cache = appState.cache;

    // Load configuration data
    appState.overrides = {};

    // Setup control handlers and dropdown UI
    setupControlHandlers(appState);
    setupDropdownFilters(appState);

    // Initialize tournament selector
    await initializeTournamentSelector(appState);

    const initialSelection =
      appState.selectedTournaments.length > 0
        ? appState.selectedTournaments
        : normalizeTournamentSelection(appState.currentTournament ? [appState.currentTournament] : []);

    const initialData = await loadSelectionData(initialSelection, cache);
    // eslint-disable-next-line no-param-reassign
    appState.current = initialData;
    updateSetFilterOptions(initialData.items);

    await setupArchetypeSelector(initialSelection, cache, appState);

    // Setup resize handler
    setupResizeHandler(appState);

    // Hide skeleton and show real content
    hideGridSkeleton();

    // Initial render
    renderSummary(document.getElementById('summary'), initialData.deckTotal, initialData.items.length);

    // Apply initial state from URL
    await applyInitialState(appState);
    setStateInURL({ advanced: '' }, { merge: true, replace: true });

    const redirectState = consumeFiltersRedirectFlag();
    if (redirectState) {
      const searchInput = /** @type {HTMLInputElement|null} */ (document.getElementById('search'));
      if (redirectState.query && searchInput && !searchInput.value) {
        searchInput.value = redirectState.query;
      }
      await applyCurrentFilters(appState);
      if (redirectState.open) {
        openFiltersPanel();
      }
    }

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
