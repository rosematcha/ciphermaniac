/**
 * Active Filters Bar — shows applied filters as dismissible chips
 * when the filter panel is closed.
 * @module ActiveFilters
 */

import { readSelectedCardTypes, readSelectedRegulationMarks, readSelectedSets } from '../utils/filterState.js';

interface ActiveFiltersCallbacks {
  onClearSets?: () => void;
  onClearCardTypes?: () => void;
  onClearRegulationMarks?: () => void;
  onClearSuccess?: () => void;
  onClearSearch?: () => void;
  onClearAll?: () => void;
}

interface ActiveFilter {
  type: string;
  label: string;
  onClear: () => void;
}

let callbacks: ActiveFiltersCallbacks = {};
let containerEl: HTMLElement | null = null;

export function initActiveFilters(cbs: ActiveFiltersCallbacks): void {
  callbacks = cbs;
  containerEl = document.getElementById('active-filters');
}

export function updateActiveFilters(): void {
  if (!containerEl) {
    return;
  }

  const filters: ActiveFilter[] = [];

  // Search query
  const searchInput = document.getElementById('search') as HTMLInputElement | null;
  const query = searchInput?.value?.trim() || '';
  if (query.length > 0) {
    filters.push({
      type: 'search',
      label: `Search: "${query}"`,
      onClear: () => callbacks.onClearSearch?.()
    });
  }

  // Success/finish filter
  const successSelect = document.getElementById('success-filter') as HTMLSelectElement | null;
  const successVal = successSelect?.value || 'all';
  if (successVal !== 'all') {
    const selectedOption = successSelect?.selectedOptions[0];
    const label = selectedOption?.textContent || successVal;
    filters.push({
      type: 'success',
      label: `Finish: ${label}`,
      onClear: () => callbacks.onClearSuccess?.()
    });
  }

  // Sets
  const sets = readSelectedSets();
  if (sets.length > 0) {
    const label = sets.length === 1 ? `Set: ${sets[0]}` : `Sets: ${sets.length} selected`;
    filters.push({
      type: 'sets',
      label,
      onClear: () => callbacks.onClearSets?.()
    });
  }

  // Card types
  const cardTypes = readSelectedCardTypes();
  if (cardTypes.length > 0) {
    const label = cardTypes.length === 1 ? `Type: ${cardTypes[0]}` : `Types: ${cardTypes.length} selected`;
    filters.push({
      type: 'cardTypes',
      label,
      onClear: () => callbacks.onClearCardTypes?.()
    });
  }

  // Regulation marks
  const regMarks = readSelectedRegulationMarks();
  if (regMarks.length > 0) {
    filters.push({
      type: 'regMarks',
      label: `Reg: ${regMarks.join(', ')}`,
      onClear: () => callbacks.onClearRegulationMarks?.()
    });
  }

  // Render
  if (filters.length === 0) {
    containerEl.hidden = true;
    containerEl.innerHTML = '';
    return;
  }

  containerEl.hidden = false;

  const frag = document.createDocumentFragment();

  for (const filter of filters) {
    const chip = document.createElement('button');
    chip.className = 'active-filter-chip';
    chip.type = 'button';
    chip.setAttribute('aria-label', `Remove filter: ${filter.label}`);
    chip.innerHTML = `<span>${escapeText(filter.label)}</span><span class="chip-x" aria-hidden="true">×</span>`;
    chip.addEventListener('click', filter.onClear);
    frag.appendChild(chip);
  }

  if (filters.length > 1) {
    const clearAll = document.createElement('button');
    clearAll.className = 'active-filter-clear-all';
    clearAll.type = 'button';
    clearAll.textContent = 'Clear all';
    clearAll.setAttribute('aria-label', 'Clear all filters');
    clearAll.addEventListener('click', () => callbacks.onClearAll?.());
    frag.appendChild(clearAll);
  }

  containerEl.replaceChildren(frag);
}

function escapeText(str: string): string {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
