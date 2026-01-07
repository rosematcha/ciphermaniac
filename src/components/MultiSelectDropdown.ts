/**
 * Multi-select dropdown component
 * @module MultiSelectDropdown
 */

import { logger } from '../utils/logger.js';

interface AppState {
  cleanup: {
    addEventListener: (element: EventTarget, event: string, handler: EventListenerOrEventListenerObject) => void;
  };
  ui?: {
    openDropdown: string | null;
  };
  [key: string]: any;
}

interface DropdownConfig {
  key: string;
  triggerId: string;
  menuId: string;
  listId: string;
  summaryId: string;
  searchId?: string;
  chipsId?: string;
  addButtonId?: string;
  labelId?: string;
  baseWidth?: number;
  maxWidth?: number;
  placeholder?: string;
  emptyMessage?: string;
  formatOption?: (value: string) => string | { label: string; fullName?: string; code?: string; codeLabel?: string };
  addButtonLabel?: string;
  addAriaLabel?: string;
  allSelectedLabel?: string;
  includeAllOption?: boolean;
  allOptionLabel?: string;
  maxVisibleChips?: number;
  singularLabel?: string;
  pluralLabel?: string;
  placeholderAriaLabel?: string;
  disabledSummary?: string;
  onChange?: (selected: string[]) => Promise<void> | void;
  onOpen?: () => Promise<void> | void;
}

interface DropdownState {
  options: string[];
  selected: string[];
  filterText: string;
  isOpen: boolean;
  disabled: boolean;
  chipsExpanded: boolean;
  multi: boolean;
}

export interface DropdownInstance {
  render: (options?: string[], selection?: string[]) => void;
  setSelection: (selection: string[], options?: { silent?: boolean }) => void;
  setDisabled: (disabled: boolean) => void;
  open: (options?: { multi?: boolean }) => void;
  close: (restoreFocus?: boolean) => void;
  toggle: () => void;
  destroy: () => void;
  key: string;
  contains: (node: Node | null) => boolean;
  refresh: () => void;
}

/**
 * Create a multi-select dropdown component
 * @param state - Application state
 * @param config - Dropdown configuration
 * @returns Dropdown instance or null if elements missing
 */
export function createMultiSelectDropdown(state: AppState, config: DropdownConfig): DropdownInstance | null {
  const trigger = document.getElementById(config.triggerId) as HTMLButtonElement | null;
  const menu = document.getElementById(config.menuId) as HTMLElement | null;
  const list = document.getElementById(config.listId) as HTMLElement | null;
  const summary = document.getElementById(config.summaryId) as HTMLElement | null;
  const search = config.searchId ? (document.getElementById(config.searchId) as HTMLInputElement | null) : null;
  const chipsContainer = config.chipsId ? (document.getElementById(config.chipsId) as HTMLElement | null) : null;
  const addButton = config.addButtonId
    ? (document.getElementById(config.addButtonId) as HTMLButtonElement | null)
    : null;
  const labelElement = config.labelId ? document.getElementById(config.labelId) : null;
  const comboRoot = trigger ? trigger.closest('.filter-combobox') : null;
  const root = trigger ? trigger.closest('.filter-dropdown') : null;
  const actionsFooter = menu ? (menu.querySelector('[data-multi-only]') as HTMLElement | null) : null;

  if (!(trigger && menu && list && summary && chipsContainer && addButton)) {
    return null;
  }

  const baseWidth = config.baseWidth || 320;
  const maxWidth = config.maxWidth || 500;
  const placeholderSummary = config.placeholder || 'Select option';
  const emptyMessage = config.emptyMessage || 'No results';
  const formatOption = config.formatOption || ((value: string) => String(value));
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
  chipsContainer.setAttribute('aria-label', `Selected ${pluralLabel.toLowerCase()}`);
  addButton.textContent = addButtonLabel;
  addButton.setAttribute('aria-label', addButtonAriaLabel);

  const getDisplayParts = (optionValue: string) => {
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

  const dropdownState: DropdownState = {
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

    const showChips = selection.length > 1;
    chipsContainer.hidden = !showChips;

    if (!showChips) {
      dropdownState.chipsExpanded = false;
      chipsContainer.removeAttribute('aria-label');
      chipsContainer.replaceChildren(); // Efficiently clear children
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

    // Build chips in a DocumentFragment for efficient DOM updates
    const fragment = document.createDocumentFragment();

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
      removeButton.setAttribute('aria-label', `Remove ${display.label} from selection`);
      removeButton.textContent = 'x';
      removeButton.addEventListener('click', () => {
        const nextSelection = dropdownState.selected.filter(item => item !== value);
        commitSelection(nextSelection);
        renderOptions();
      });

      chip.appendChild(label);
      chip.appendChild(removeButton);
      fragment.appendChild(chip);
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
        fragment.appendChild(expandButton);
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
        fragment.appendChild(collapseButton);
      }
    }

    // Replace all children at once for efficient DOM update
    chipsContainer.replaceChildren(...fragment.childNodes);
  };

  const measureWidth = (textValue: string) => {
    if (!measureContext) {
      return textValue.length * 8;
    }
    const computedStyle = window.getComputedStyle(trigger);
    const font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    measureContext.font = font;
    return measureContext.measureText(textValue).width;
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

  const commitSelection = (selection: string[], { silent = false } = {}) => {
    const wasMulti = dropdownState.multi;
    let normalized = Array.isArray(selection) ? dropdownState.options.filter(option => selection.includes(option)) : [];

    if (!dropdownState.multi && normalized.length > 1) {
      let chosen: string | null = null;
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
          if (result && typeof (result as Promise<any>).catch === 'function') {
            (result as Promise<any>).catch(error =>
              logger.error(`Dropdown ${config.key} change handler rejected`, error)
            );
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
    // Build options in a DocumentFragment for efficient DOM updates
    const fragment = document.createDocumentFragment();
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
        trigger?.focus();
      });
      fragment.appendChild(allButton);
    }

    const filtered = getFilteredOptions();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'filter-menu-empty';
      empty.textContent = emptyMessage;
      fragment.appendChild(empty);
      list.replaceChildren(...fragment.childNodes);
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
        checkbox.value = String(optionValue); // Value must be string for input
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
        fragment.appendChild(optionLabel);
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
          trigger?.focus();
        });

        fragment.appendChild(optionButton);
      }
    });

    // Replace all children at once for efficient DOM update
    list.replaceChildren(...fragment.childNodes);
  };

  const render = (options: string[] = dropdownState.options, selection: string[] = dropdownState.selected) => {
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

  const setSelection = (selection: string[], options: { silent?: boolean } = {}) => {
    commitSelection(selection, { silent: options.silent === true });
    renderOptions();
  };

  const setDisabled = (disabled: boolean) => {
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
   * @param options
   * @param options.multi
   */
  const open = async (options: { multi?: boolean } = {}) => {
    const { multi } = options;
    if (dropdownState.disabled || dropdownState.isOpen) {
      return;
    }

    // Call onOpen callback if provided (e.g., for lazy loading data)
    if (config.onOpen) {
      await config.onOpen();
    }

    // Dispatch open event to close other dropdowns
    document.dispatchEvent(new CustomEvent('dropdown:open', { detail: { key: config.key } }));

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
      window.requestAnimationFrame(() => search?.focus());
    }
    if (state && state.ui) {
      state.ui.openDropdown = config.key;
    }
  };

  const close = (restoreFocus = true) => {
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

    // Restore focus to trigger if focus was inside menu
    if (restoreFocus && document.activeElement && menu.contains(document.activeElement)) {
      trigger?.focus();
    }

    updateWidth();
    if (state && state.ui && state.ui.openDropdown === config.key) {
      state.ui.openDropdown = null;
    }
  };

  const toggle = () => {
    if (dropdownState.isOpen) {
      close();
    } else {
      open();
    }
  };

  state.cleanup.addEventListener(trigger, 'click', toggle);
  state.cleanup.addEventListener(trigger, 'keydown', (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (trigger.disabled) {
      return;
    }
    if (keyboardEvent.key === 'ArrowDown' || keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
      keyboardEvent.preventDefault();
      open();
    } else if (
      (keyboardEvent.key === 'Backspace' || keyboardEvent.key === 'Delete') &&
      !dropdownState.isOpen &&
      dropdownState.selected.length > 0
    ) {
      keyboardEvent.preventDefault();
      const nextSelection = dropdownState.selected.slice(0, -1);
      commitSelection(nextSelection);
      renderOptions();
    } else if (keyboardEvent.key === 'Escape') {
      close();
    }
  });
  state.cleanup.addEventListener(menu, 'keydown', (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Escape') {
      keyboardEvent.stopPropagation();
      close();
      trigger?.focus();
    }
  });

  if (search) {
    state.cleanup.addEventListener(search, 'input', (event: Event) => {
      const target = event.target as HTMLInputElement;
      dropdownState.filterText = target.value.trim().toLowerCase();
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
        window.requestAnimationFrame(() => search?.focus());
      }
      if (state && state.ui) {
        state.ui.openDropdown = config.key;
      }
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
        trigger?.focus();
      }
    });
  });

  // Handle external close requests (e.g. from other dropdowns opening)
  const handleDropdownOpen = ((e: CustomEvent) => {
    if (e.detail.key !== config.key) {
      close();
    }
  }) as EventListener;

  // Handle global close requests
  const handleCloseAll = () => {
    close();
  };

  document.addEventListener('dropdown:open', handleDropdownOpen);
  document.addEventListener('dropdown:close-all', handleCloseAll);

  /**
   * Destroy the dropdown instance and clean up event listeners.
   * Call this method when the dropdown is no longer needed to prevent memory leaks.
   */
  const destroy = () => {
    document.removeEventListener('dropdown:open', handleDropdownOpen);
    document.removeEventListener('dropdown:close-all', handleCloseAll);
  };

  render();

  return {
    render,
    setSelection,
    setDisabled,
    open,
    close,
    toggle,
    destroy,
    // Expose key for identification
    key: config.key,
    // Expose contains for click handling
    contains: (node: Node | null) => {
      if (!node) {
        return false;
      }
      if (addButton) {
        return menu.contains(node) || trigger.contains(node) || addButton.contains(node);
      }
      return menu.contains(node) || trigger.contains(node);
    },
    refresh: () => {
      updateLabelText();
      updateTriggerState();
      renderChips();
      updateWidth();
    }
  };
}
