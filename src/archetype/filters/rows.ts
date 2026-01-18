import { logger } from '../../utils/logger.js';
import { CARD_COUNT_DEFAULT_MAX } from '../constants.js';
import { buildCardId, buildCardLookup, getMaxCopiesForCard } from '../data/cards.js';
import { elements } from '../ui/elements.js';
import { getState } from '../state.js';
import { isAceSpec } from '../cardCategories.js';
import { applyFilters } from './apply.js';
import { formatCardOptionLabel, getFilterRowCardsData, updateFilterEmptyState } from './utils.js';

type OperatorOption = { value: string; label: string };

const state = getState();

/**
 * Create a new filter row with card selector, operator, and count.
 */
/**
 * Create a new filter row element.
 */
export function createFilterRow(): HTMLDivElement {
  const filterId = state.nextFilterId++;
  const filterRow = document.createElement('div');
  filterRow.className = 'archetype-filter-group';
  filterRow.dataset.filterId = String(filterId);

  const abortController = new AbortController();
  const { signal } = abortController;

  const cardSelect = document.createElement('select');
  cardSelect.className = 'filter-card-select';
  cardSelect.title = 'Select card to filter by';
  cardSelect.setAttribute('aria-label', 'Select card to filter by');
  cardSelect.innerHTML = '<option value="">Choose card...</option>';

  const operatorSelect = document.createElement('select');
  operatorSelect.className = 'filter-operator-select';
  operatorSelect.title = 'Quantity condition';
  operatorSelect.setAttribute('aria-label', 'Quantity condition');
  operatorSelect.hidden = true;

  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.className = 'filter-count-input';
  countInput.title = 'Number of copies';
  countInput.setAttribute('aria-label', 'Number of copies');
  countInput.min = '1';
  countInput.max = String(CARD_COUNT_DEFAULT_MAX);
  countInput.step = '1';
  countInput.value = '1';
  countInput.placeholder = '#';
  countInput.hidden = true;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'remove-filter-btn';
  removeButton.title = 'Remove this filter';
  removeButton.setAttribute('aria-label', 'Remove this filter');
  removeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  filterRow.appendChild(cardSelect);
  filterRow.appendChild(operatorSelect);
  filterRow.appendChild(countInput);
  filterRow.appendChild(removeButton);

  cardSelect.addEventListener('change', () => handleFilterChange(filterId), { signal });
  operatorSelect.addEventListener('change', () => handleFilterChange(filterId), { signal });
  countInput.addEventListener('change', () => handleFilterChange(filterId), { signal });
  countInput.addEventListener('input', () => handleFilterChange(filterId), { signal });
  removeButton.addEventListener('click', () => removeFilterRow(filterId), { signal });

  state.filterRows.push({
    id: filterId,
    cardId: null,
    operator: null,
    count: null,
    elements: { cardSelect, operatorSelect, countInput, removeButton, container: filterRow },
    abortController
  });

  updateFilterEmptyState();
  populateFilterRowCards(filterId);

  return filterRow;
}

/**
 * Remove a filter row.
 */
/**
 * Remove a filter row by id.
 * @param filterId - Filter row id.
 */
export function removeFilterRow(filterId: number): void {
  const index = state.filterRows.findIndex(row => row.id === filterId);
  if (index === -1) {
    return;
  }

  const row = state.filterRows[index];
  row.abortController?.abort();
  row.elements.container.remove();
  state.filterRows.splice(index, 1);
  updateFilterEmptyState();

  state.filterRows.forEach(r => populateFilterRowCards(r.id));
  updateAddFilterButtonVisibility();

  applyFilters().catch(error => {
    logger.debug('Filter removal failed', error?.message || error);
  });
}

/**
 * Programmatically add a filter for a card by its name.
 */
/**
 * Add a filter row prefilled for the provided card name.
 * @param cardName - Card name to target.
 */
export function addQuickFilterForCard(cardName: string): void {
  if (!cardName) {
    return;
  }

  const matchingCard = state.allCards.find(card => card.name === cardName);
  if (!matchingCard) {
    logger.warn('Quick filter: card not found', { cardName });
    return;
  }

  const cardId = buildCardId(matchingCard);
  if (!cardId) {
    logger.warn('Quick filter: could not build card ID', { cardName });
    return;
  }

  const existingFilter = state.filterRows.find(row => row.cardId === cardId);
  if (existingFilter) {
    logger.debug('Quick filter: card already has a filter', { cardName, cardId });
    return;
  }

  let targetRow = state.filterRows.find(row => !row.cardId);
  if (!targetRow && elements.filterRowsContainer) {
    const newRowEl = createFilterRow();
    elements.filterRowsContainer.appendChild(newRowEl);
    targetRow = state.filterRows[state.filterRows.length - 1];
  }

  if (!targetRow) {
    logger.warn('Quick filter: could not find or create filter row');
    return;
  }

  const { cardSelect, operatorSelect } = targetRow.elements;
  cardSelect.value = cardId;
  handleFilterChange(targetRow.id);

  if (isAceSpec(cardName)) {
    const options = getOperatorOptionsForCard(cardId);
    const anyOption = options.find(opt => opt.value === 'any');
    if (anyOption) {
      operatorSelect.value = 'any';
      targetRow.operator = 'any';
      handleFilterChange(targetRow.id);
    }
  }

  logger.info('Quick filter added', { cardName, cardId });
}

/**
 * Populate card options for a specific filter row, excluding already-selected cards.
 */
/**
 * Populate card options for the given filter row.
 * @param filterId - Filter row id.
 */
export function populateFilterRowCards(filterId: number): void {
  const row = state.filterRows.find(r => r.id === filterId);
  if (!row) {
    return;
  }

  const { cardSelect } = row.elements;
  const currentValue = cardSelect.value;
  const selectedCards = new Set(state.filterRows.filter(r => r.id !== filterId && r.cardId).map(r => r.cardId));
  const deckTotal = state.defaultDeckTotal || state.archetypeDeckTotal || 0;
  const { sortedCards, duplicateCounts } = getFilterRowCardsData(state.allCards, deckTotal);

  cardSelect.length = 1;

  sortedCards.forEach(card => {
    const cardId = buildCardId(card);
    if (!cardId || selectedCards.has(cardId)) {
      return;
    }

    const option = document.createElement('option');
    option.value = cardId;
    option.textContent = formatCardOptionLabel(card, duplicateCounts);
    option.dataset.cardName = card.name || cardId;
    cardSelect.appendChild(option);
  });

  if (currentValue) {
    cardSelect.value = currentValue;
  }
}

/**
 * Handle filter row changes.
 */
/**
 * Apply logic when a filter row changes.
 * @param filterId - Filter row id.
 */
export function handleFilterChange(filterId: number): void {
  const row = state.filterRows.find(r => r.id === filterId);
  if (!row) {
    return;
  }

  const { cardSelect, operatorSelect, countInput } = row.elements;
  const cardId = cardSelect.value || null;
  const operator = operatorSelect.value || null;
  let count = countInput.value ? parseInt(countInput.value, 10) : null;

  row.cardId = cardId;
  row.operator = operator;
  row.count = count;

  const hasCard = cardId !== null && cardId !== '';

  if (hasCard) {
    const options = getOperatorOptionsForCard(cardId);
    const currentOperator = operatorSelect.value;
    operatorSelect.innerHTML = '';
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      operatorSelect.appendChild(option);
    });

    if (currentOperator && options.some(opt => opt.value === currentOperator)) {
      operatorSelect.value = currentOperator;
    } else {
      operatorSelect.value = options[0].value;
      row.operator = options[0].value;
    }

    operatorSelect.hidden = false;
  } else {
    operatorSelect.hidden = true;
  }

  const maxCopies = hasCard ? getMaxCopiesForCard(cardId) : CARD_COUNT_DEFAULT_MAX;
  countInput.max = String(maxCopies);
  if (count !== null && count > maxCopies) {
    count = maxCopies;
    countInput.value = String(count);
    row.count = count;
  }

  const needsCount = hasCard && operator && operator !== 'any' && operator !== '';
  countInput.hidden = !needsCount;

  updateAddFilterButtonVisibility();

  if (hasCard) {
    state.filterRows.forEach(r => {
      if (r.id !== filterId) {
        populateFilterRowCards(r.id);
      }
    });
  }

  if (state.filterRows.length > 1) {
    state.filterRows.forEach(r => (r.elements.removeButton.hidden = false));
  }

  applyFilters().catch(error => {
    logger.debug('Filter change failed', error?.message || error);
  });
}

/**
 * Update add filter button visibility.
 */
/**
 * Toggle the add-filter button state based on current rows.
 */
export function updateAddFilterButtonVisibility(): void {
  if (!elements.addFilterButton) {
    return;
  }

  const totalCards = state.allCards.length;
  const selectedCount = state.filterRows.filter(r => r.cardId).length;
  const hasMoreCards = selectedCount < totalCards;

  elements.addFilterButton.hidden = !hasMoreCards;
}

/**
 * Initialize filter rows (create the first one).
 */
/**
 * Initialize filter rows from stored state.
 */
export function initializeFilterRows(): void {
  const { filterRowsContainer } = elements;
  const { addFilterButton } = elements;
  if (!filterRowsContainer || !addFilterButton) {
    return;
  }

  filterRowsContainer.innerHTML = '';
  state.filterRows = [];
  state.nextFilterId = 1;

  const firstRow = createFilterRow();
  filterRowsContainer.appendChild(firstRow);

  addFilterButton.addEventListener('click', () => {
    const newRow = createFilterRow();
    filterRowsContainer.appendChild(newRow);
    updateAddFilterButtonVisibility();
  });

  updateAddFilterButtonVisibility();
}

/**
 * Populate all filter card dropdowns from current data.
 */
export function populateCardDropdowns(): void {
  buildCardLookup();
  initializeFilterRows();
}

function getOperatorOptionsForCard(cardId: string): OperatorOption[] {
  const cardInfo = state.cardLookup.get(cardId);
  if (!cardInfo) {
    return [
      { value: '', label: 'None' },
      { value: 'any', label: 'Any' },
      { value: '<', label: 'Less than' },
      { value: '>', label: 'More than' },
      { value: '=', label: 'Exactly' }
    ];
  }

  const isAlwaysIncluded = cardInfo.alwaysIncluded;
  const isAce = isAceSpec(cardInfo.name);

  if (isAce) {
    return [
      { value: '', label: 'None' },
      { value: 'any', label: 'Any' }
    ];
  }

  if (isAlwaysIncluded) {
    return [
      { value: 'any', label: 'Any' },
      { value: '<', label: 'Less than' },
      { value: '>', label: 'More than' },
      { value: '=', label: 'Exactly' }
    ];
  }

  return [
    { value: '', label: 'None' },
    { value: 'any', label: 'Any' },
    { value: '<', label: 'Less than' },
    { value: '>', label: 'More than' },
    { value: '=', label: 'Exactly' }
  ];
}
