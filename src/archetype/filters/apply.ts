import { AppError } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { loadFilterCombination, loadSuccessBaseline } from '../data/report.js';
import { renderCards } from '../ui/render.js';
import { getState } from '../state.js';
import type { FilterRow } from '../types.js';
import { describeFilters, describeSuccessFilter, getFilterKey, updateFilterMessage } from './utils.js';

export async function resetToDefaultData(): Promise<void> {
  await applySuccessFilter();
  const state = getState();
  state.filterRows.forEach(row => {
    row.cardId = null;
    row.operator = null;
    row.count = null;
    row.elements.cardSelect.value = '';
    row.elements.operatorSelect.value = '';
    row.elements.operatorSelect.hidden = true;
    row.elements.countInput.value = '';
    row.elements.countInput.hidden = true;
  });
  updateFilterMessage('');
}

export async function applyFilters(): Promise<void> {
  const state = getState();
  if (!state.tournament || !state.archetypeBase) {
    return;
  }

  const activeFilters = state.filterRows
    .filter((row): row is FilterRow & { cardId: string } => Boolean(row.cardId))
    .map(row => ({
      cardId: row.cardId,
      operator: row.operator || null,
      count: row.count || null
    }));

  logger.debug('Applying filters', { activeFilters, filterRowsCount: state.filterRows.length });

  if (activeFilters.length === 0) {
    await resetToDefaultData();
    return;
  }

  for (const filter of activeFilters) {
    const info = state.cardLookup.get(filter.cardId);
    if (info?.alwaysIncluded && (!filter.operator || filter.operator === '')) {
      updateFilterMessage(
        `${info.name} is in 100% of decks. Select "Any" or a quantity operator to filter by copy count.`,
        'info'
      );
      return;
    }
  }

  const successLabel = describeSuccessFilter(state.successFilter);
  const comboLabel = successLabel
    ? `${describeFilters(activeFilters)} (${successLabel})`
    : describeFilters(activeFilters);
  updateFilterMessage(`Crunching the numbers for decks ${comboLabel}...`, 'info');

  const requestKey = getFilterKey(activeFilters, state.successFilter);

  try {
    const result = await loadFilterCombination(activeFilters);
    if (!result) {
      logger.warn('Filter combination returned undefined');
      return;
    }

    logger.debug('Filter result', { deckTotal: result.deckTotal, itemsCount: result.items.length });

    const currentActiveFilters = state.filterRows
      .filter((row): row is FilterRow & { cardId: string } => Boolean(row.cardId))
      .map(row => ({
        cardId: row.cardId,
        operator: row.operator || null,
        count: row.count || null
      }));
    const activeKey = getFilterKey(currentActiveFilters, state.successFilter);
    if (activeKey !== requestKey) {
      logger.debug('Filter request outdated, ignoring');
      return;
    }

    Object.assign(state, {
      items: result.items,
      archetypeDeckTotal: result.deckTotal
    });

    if (!result.deckTotal || result.items.length === 0) {
      updateFilterMessage(`No decks match ${comboLabel}.`, 'warning');
    } else {
      const deckLabel = result.deckTotal === 1 ? 'deck' : 'decks';
      updateFilterMessage(`${result.deckTotal} ${deckLabel} match ${comboLabel}.`, 'info');
    }
    renderCards();
  } catch (error) {
    logger.error('Filter application failed', error);

    if (error instanceof AppError && error.context?.status === 404) {
      updateFilterMessage(`No decks match ${comboLabel}.`, 'warning');
      Object.assign(state, {
        items: [],
        archetypeDeckTotal: 0
      });
      renderCards();
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage && errorMessage.includes('timed out')) {
      updateFilterMessage(`Unable to load deck data for filtering. Request timed out.`, 'warning');
      Object.assign(state, {
        items: [],
        archetypeDeckTotal: 0
      });
      renderCards();
      return;
    }

    logger.exception('Failed to apply filter', error);
    updateFilterMessage('We ran into an issue loading that combination. Please try again.', 'warning');
    Object.assign(state, {
      items: [],
      archetypeDeckTotal: 0
    });
    renderCards();
  }
}

export async function applySuccessFilter(): Promise<void> {
  const baseline = await loadSuccessBaseline();
  const state = getState();
  Object.assign(state, {
    items: baseline.items,
    archetypeDeckTotal: baseline.deckTotal
  });
  const label = describeSuccessFilter(state.successFilter) || 'selected finish';
  if (!baseline.deckTotal) {
    updateFilterMessage(`No decks found for ${label}.`, 'warning');
  } else {
    updateFilterMessage('');
  }
  renderCards();
}
