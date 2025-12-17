/**
 * Hierarchical card type dropdown component with enhanced UX
 * Features: visual nesting, indeterminate states, collapse/expand, smart parent selection
 * @module HierarchicalCardTypeDropdown
 */

import { CARD_TYPE_HIERARCHY, getChildrenForParent, getParentForChild } from '../utils/cardTypeHierarchy.js';
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

interface CardTypeDropdownConfig {
  key: string;
  triggerId: string;
  menuId: string;
  listId: string;
  summaryId: string;
  searchId: string;
  chipsId: string;
  addButtonId: string;
  labelId: string;
  placeholder?: string;
  onChange?: (selected: string[]) => Promise<void> | void;
}

interface HierarchicalState {
  selected: Set<string>;
  collapsed: Set<string>;
  filterText: string;
}

export interface DropdownInstance {
  render: (options?: any[], selection?: any[]) => void;
  setSelection: (selection: any[], options?: { silent?: boolean }) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  key: string;
  contains: (node: Node | null) => boolean;
}

/**
 * Create an enhanced hierarchical card type dropdown
 */
export function createHierarchicalCardTypeDropdown(
  state: AppState,
  config: CardTypeDropdownConfig
): DropdownInstance | null {
  const trigger = document.getElementById(config.triggerId) as HTMLButtonElement | null;
  const menu = document.getElementById(config.menuId) as HTMLElement | null;
  const list = document.getElementById(config.listId) as HTMLElement | null;
  const summary = document.getElementById(config.summaryId) as HTMLElement | null;
  const search = document.getElementById(config.searchId) as HTMLInputElement | null;
  const chipsContainer = document.getElementById(config.chipsId) as HTMLElement | null;
  const addButton = document.getElementById(config.addButtonId) as HTMLButtonElement | null;
  const labelElement = document.getElementById(config.labelId) as HTMLElement | null;
  const comboRoot = trigger?.closest('.filter-combobox');
  const root = trigger?.closest('.filter-dropdown');

  if (!(trigger && menu && list && summary && search && chipsContainer && addButton)) {
    logger.error('Missing required elements for hierarchical dropdown');
    return null;
  }

  const hierarchicalState: HierarchicalState = {
    selected: new Set<string>(),
    collapsed: new Set<string>(CARD_TYPE_HIERARCHY.map(p => p.value)),
    filterText: ''
  };

  let isOpen = false;
  let isMulti = false;

  /**
   * Get selection state for a parent category
   * Returns: 'none', 'some', or 'all'
   */
  function getParentState(parentValue: string): 'none' | 'some' | 'all' {
    const children = getChildrenForParent(parentValue);
    if (children.length === 0) return 'none';

    const selectedChildren = children.filter(child => hierarchicalState.selected.has(child));

    if (selectedChildren.length === 0) return 'none';
    if (selectedChildren.length === children.length) return 'all';
    return 'some';
  }

  /**
   * Update the summary display
   */
  function updateSummary() {
    if (!summary || !trigger) return;

    const count = hierarchicalState.selected.size;
    const hasSelection = count > 0;
    const totalOptions = CARD_TYPE_HIERARCHY.reduce((sum, p) => sum + p.children.length, 0);
    const allSelected = count === totalOptions;

    let summaryText = config.placeholder || 'All card types';
    let stateValue = 'empty';

    if (!hasSelection) {
      summaryText = config.placeholder || 'All card types';
      stateValue = 'empty';
    } else if (allSelected) {
      summaryText = 'All types selected';
      stateValue = 'full';
    } else {
      const firstValue = Array.from(hierarchicalState.selected)[0];
      const formatted = formatCardTypeLabel(firstValue);
      summaryText = count > 1 ? `${formatted} +${count - 1}` : formatted;
      stateValue = count > 1 ? 'multi' : 'single';
    }

    summary.textContent = count > 1 ? '' : summaryText;
    summary.classList.toggle('is-hidden', count > 1);
    trigger.dataset.state = stateValue;
    trigger.disabled = false;

    if (addButton) {
      const showAdd = hasSelection && !allSelected;
      addButton.hidden = !showAdd;
      addButton.classList.toggle('is-visible', showAdd);
    }

    if (comboRoot) {
      comboRoot.classList.toggle('has-selection', hasSelection);
      comboRoot.classList.toggle('is-full', allSelected);
      comboRoot.setAttribute('data-state', stateValue);
    }

    if (root) {
      root.classList.toggle('has-selection', hasSelection);
      root.classList.toggle('is-multi', count > 1);
    }

    updateLabelText();
  }

  /**
   * Update label text (singular/plural)
   */
  function updateLabelText() {
    if (!labelElement) return;
    const count = hierarchicalState.selected.size;
    const singular = labelElement.dataset.labelSingular || 'Card type';
    const plural = labelElement.dataset.labelPlural || 'Card types';
    labelElement.textContent = count > 1 ? plural : singular;
  }

  /**
   * Render chips for selected items
   */
  function renderChips() {
    if (!chipsContainer) return;

    chipsContainer.innerHTML = '';
    const selectedArray = Array.from(hierarchicalState.selected);
    const showChips = selectedArray.length > 1;
    chipsContainer.hidden = !showChips;

    if (!showChips) return;

    // Group by parent for smarter display
    const grouped = groupSelectionByParent(selectedArray);
    const maxVisible = 3;
    let visibleCount = 0;

    for (const [parentValue, children] of grouped) {
      if (visibleCount >= maxVisible) break;

      const parent = CARD_TYPE_HIERARCHY.find(p => p.value === parentValue);
      if (!parent) continue;

      const allChildrenSelected = children.length === parent.children.length;

      if (allChildrenSelected) {
        // Show parent chip
        const chip = createChip(parent.label, () => {
          // Remove all children of this parent
          parent.children.forEach(child => hierarchicalState.selected.delete(child.value));
          commitSelection();
        });
        chipsContainer.appendChild(chip);
        visibleCount++;
      } else {
        // Show individual child chips
        for (const childValue of children) {
          if (visibleCount >= maxVisible) break;
          const child = parent.children.find(c => c.value === childValue);
          if (child) {
            const chip = createChip(`${parent.label} - ${child.label}`, () => {
              hierarchicalState.selected.delete(childValue);
              commitSelection();
            });
            chipsContainer.appendChild(chip);
            visibleCount++;
          }
        }
      }
    }

    // Show "+N more" if needed
    if (selectedArray.length > maxVisible) {
      const remaining = selectedArray.length - visibleCount;
      const moreButton = document.createElement('button');
      moreButton.type = 'button';
      moreButton.className = 'filter-chip filter-chip--more';
      moreButton.textContent = `+${remaining} more`;
      moreButton.addEventListener('click', () => open());
      chipsContainer.appendChild(moreButton);
    }
  }

  /**
   * Create a chip element
   */
  function createChip(label: string, onRemove: () => void): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'filter-chip';
    chip.setAttribute('role', 'listitem');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'filter-chip-label';
    labelSpan.textContent = label;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'filter-chip-remove';
    removeButton.setAttribute('aria-label', `Remove ${label}`);
    removeButton.textContent = '×';
    removeButton.addEventListener('click', e => {
      e.stopPropagation();
      onRemove();
    });

    chip.appendChild(labelSpan);
    chip.appendChild(removeButton);
    return chip;
  }

  /**
   * Group selections by parent for smart chip display
   */
  function groupSelectionByParent(selected: string[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();

    for (const value of selected) {
      const parent = getParentForChild(value);
      if (parent) {
        if (!grouped.has(parent)) {
          grouped.set(parent, []);
        }
        grouped.get(parent)!.push(value);
      }
    }

    return grouped;
  }

  /**
   * Format a card type value for display
   */
  function formatCardTypeLabel(value: string): string {
    for (const parent of CARD_TYPE_HIERARCHY) {
      if (parent.value === value) {
        return parent.label;
      }
      const child = parent.children.find(c => c.value === value);
      if (child) {
        return `${parent.label} - ${child.label}`;
      }
    }
    return value;
  }

  function normalizeForSearch(s: string): string {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Render the hierarchical options list
   */
  function renderOptions() {
    if (!list) return;

    list.innerHTML = '';

    // Add "All" option
    const allOption = document.createElement('button');
    allOption.type = 'button';
    allOption.className = 'filter-option filter-option--single filter-option--all';
    allOption.textContent = 'All card types';
    allOption.setAttribute('role', 'option');
    const isAllActive = hierarchicalState.selected.size === 0;
    allOption.setAttribute('aria-selected', isAllActive ? 'true' : 'false');
    if (isAllActive) {
      allOption.classList.add('is-active');
    }
    allOption.addEventListener('click', () => {
      hierarchicalState.selected.clear();
      commitSelection();
      close();
    });
    list.appendChild(allOption);

    // Render hierarchical structure
    for (const parent of CARD_TYPE_HIERARCHY) {
      const parentState = getParentState(parent.value);
      const isCollapsed = hierarchicalState.collapsed.has(parent.value);

      // Check if parent or children match filter (accent-insensitive)
      const parentMatches =
        !hierarchicalState.filterText || normalizeForSearch(parent.label).includes(hierarchicalState.filterText);
      const matchingChildren = parent.children.filter(
        child =>
          !hierarchicalState.filterText ||
          normalizeForSearch(child.label).includes(hierarchicalState.filterText) ||
          normalizeForSearch(parent.label).includes(hierarchicalState.filterText)
      );

      if (!parentMatches && matchingChildren.length === 0) continue;

      // Create parent option
      const parentOption = createParentOption(parent, parentState, isCollapsed);
      list.appendChild(parentOption);

      // Create children options (if not collapsed and filter matches)
      if (!isCollapsed && (parentMatches || matchingChildren.length > 0)) {
        const childrenToShow = hierarchicalState.filterText ? matchingChildren : parent.children;
        for (const child of childrenToShow) {
          const childOption = createChildOption(parent, child);
          list.appendChild(childOption);
        }
      }
    }
  }

  /**
   * Create a parent option element with expand/collapse
   */
  function createParentOption(parent: any, state: 'none' | 'some' | 'all', isCollapsed: boolean): HTMLElement {
    const label = document.createElement('label');
    label.className = 'filter-option filter-option--multi filter-option--parent';
    label.setAttribute('role', 'option');
    label.setAttribute('data-parent', parent.value);

    // Expand/collapse button
    const expandButton = document.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'filter-option-expand';
    expandButton.setAttribute('aria-label', isCollapsed ? 'Expand' : 'Collapse');
    expandButton.innerHTML = isCollapsed ? '▶' : '▼';
    expandButton.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (hierarchicalState.collapsed.has(parent.value)) {
        hierarchicalState.collapsed.delete(parent.value);
      } else {
        hierarchicalState.collapsed.add(parent.value);
      }
      renderOptions();
    });

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state === 'all';
    checkbox.indeterminate = state === 'some';
    checkbox.addEventListener('change', () => {
      handleParentToggle(parent.value, checkbox.checked);
    });

    // Label text
    const textSpan = document.createElement('span');
    textSpan.className = 'filter-option-text';
    textSpan.textContent = parent.label;

    // Count badge
    const countSpan = document.createElement('span');
    countSpan.className = 'filter-option-count';
    countSpan.textContent = `(${parent.children.length})`;

    label.appendChild(expandButton);
    label.appendChild(checkbox);
    label.appendChild(textSpan);
    label.appendChild(countSpan);

    return label;
  }

  /**
   * Create a child option element
   */
  function createChildOption(parent: any, child: any): HTMLElement {
    const label = document.createElement('label');
    label.className = 'filter-option filter-option--multi filter-option--child';
    label.setAttribute('role', 'option');
    label.setAttribute('data-parent', parent.value);
    label.setAttribute('data-child', child.value);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = hierarchicalState.selected.has(child.value);
    checkbox.addEventListener('change', () => {
      handleChildToggle(child.value, checkbox.checked);
    });

    const textSpan = document.createElement('span');
    textSpan.className = 'filter-option-text';
    textSpan.textContent = child.label;

    label.appendChild(checkbox);
    label.appendChild(textSpan);

    return label;
  }

  /**
   * Handle parent checkbox toggle
   */
  function handleParentToggle(parentValue: string, checked: boolean) {
    const children = getChildrenForParent(parentValue);

    if (checked) {
      // Select all children
      children.forEach(child => hierarchicalState.selected.add(child));
    } else {
      // Deselect all children
      children.forEach(child => hierarchicalState.selected.delete(child));
    }

    commitSelection();
  }

  /**
   * Handle child checkbox toggle with smart parent selection
   */
  function handleChildToggle(childValue: string, checked: boolean) {
    if (checked) {
      hierarchicalState.selected.add(childValue);
    } else {
      hierarchicalState.selected.delete(childValue);
    }

    commitSelection();
  }

  /**
   * Commit selection and trigger onChange
   */
  function commitSelection() {
    renderOptions();
    updateSummary();
    renderChips();

    const selectedArray = Array.from(hierarchicalState.selected);

    if (config.onChange) {
      try {
        const result = config.onChange(selectedArray);
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

  /**
   * Open the dropdown
   */
  function open() {
    if (isOpen || !menu || !trigger || !search) return;

    document.dispatchEvent(new CustomEvent('dropdown:open', { detail: { key: config.key } }));

    isOpen = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root?.classList.add('is-open');

    hierarchicalState.filterText = '';
    search.value = '';

    renderOptions();
    search.focus();

    if (state?.ui) {
      state.ui.openDropdown = config.key;
    }
  }

  /**
   * Close the dropdown
   */
  function close() {
    if (!isOpen || !menu || !trigger) return;

    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    root?.classList.remove('is-open');

    if (state?.ui?.openDropdown === config.key) {
      state.ui.openDropdown = null;
    }
  }

  /**
   * Toggle the dropdown
   */
  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  /**
   * Set selection programmatically
   */
  function setSelection(selection: string[], options: { silent?: boolean } = {}) {
    hierarchicalState.selected.clear();
    selection.forEach(value => hierarchicalState.selected.add(value));

    if (!options.silent) {
      commitSelection();
    } else {
      renderOptions();
      updateSummary();
      renderChips();
    }
  }

  /**
   * Render with initial data
   */
  function render(options?: any[], selection?: any[]) {
    if (Array.isArray(selection)) {
      hierarchicalState.selected.clear();
      selection.forEach(value => hierarchicalState.selected.add(value));
    }
    renderOptions();
    updateSummary();
    renderChips();
  }

  // Event listeners
  state.cleanup.addEventListener(trigger, 'click', toggle);

  state.cleanup.addEventListener(trigger, 'keydown', (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  state.cleanup.addEventListener(search, 'input', () => {
    hierarchicalState.filterText = normalizeForSearch(search.value.trim());
    renderOptions();
  });

  state.cleanup.addEventListener(menu, 'keydown', (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      trigger.focus();
    }
  });

  if (addButton) {
    state.cleanup.addEventListener(addButton, 'click', () => {
      open();
    });
  }

  // Add action buttons
  const clearButton = menu.querySelector('[data-action="clear"]');
  const closeButton = menu.querySelector('[data-action="close"]');

  if (clearButton) {
    state.cleanup.addEventListener(clearButton, 'click', () => {
      hierarchicalState.selected.clear();
      commitSelection();
    });
  }

  if (closeButton) {
    state.cleanup.addEventListener(closeButton, 'click', () => {
      close();
      trigger.focus();
    });
  }

  // Handle external close requests
  document.addEventListener('dropdown:open', ((e: CustomEvent) => {
    if (e.detail.key !== config.key) {
      close();
    }
  }) as EventListener);

  document.addEventListener('dropdown:close-all', () => {
    close();
  });

  // Initial render
  render([], []);

  return {
    render,
    setSelection,
    open,
    close,
    toggle,
    key: config.key,
    contains: (node: Node | null) => {
      if (!node) return false;
      return menu.contains(node) || trigger.contains(node) || (addButton?.contains(node) ?? false);
    }
  };
}
