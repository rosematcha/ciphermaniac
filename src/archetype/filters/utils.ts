import { normalizeCardNumber } from '../../card/routing.js';
import { GRANULARITY_STEP_PERCENT, SUCCESS_FILTER_LABELS } from '../constants.js';
import { buildCardId } from '../data/cards.js';
import { elements } from '../ui/elements.js';
import { filterRowCardsCache, getState } from '../state.js';
import type { CardItemData, FilterDescriptor } from '../types.js';

/**
 * Get cached sorted cards and duplicate counts for filter row population.
 * Recalculates only when the source data changes.
 */
export function getFilterRowCardsData(
  cards: CardItemData[],
  deckTotal: number
): {
  sortedCards: CardItemData[];
  duplicateCounts: Map<string, number>;
} {
  if (
    filterRowCardsCache.sourceArray === cards &&
    filterRowCardsCache.deckTotal === deckTotal &&
    filterRowCardsCache.sortedCards.length > 0
  ) {
    return {
      sortedCards: filterRowCardsCache.sortedCards,
      duplicateCounts: filterRowCardsCache.duplicateCounts
    };
  }

  const sortedCards = [...cards].sort((left, right) => {
    const leftFound = Number(left.found ?? 0);
    const leftTotal = Number(left.total ?? deckTotal);
    const leftPct = leftTotal > 0 ? (leftFound / leftTotal) * 100 : 0;

    const rightFound = Number(right.found ?? 0);
    const rightTotal = Number(right.total ?? deckTotal);
    const rightPct = rightTotal > 0 ? (rightFound / rightTotal) * 100 : 0;

    if (rightPct !== leftPct) {
      return rightPct - leftPct;
    }
    return (left.name || '').localeCompare(right.name || '');
  });

  const duplicateCounts = new Map<string, number>();
  cards.forEach(card => {
    const cardId = buildCardId(card);
    const baseName = card?.name;
    if (!cardId || !baseName) {
      return;
    }
    duplicateCounts.set(baseName, (duplicateCounts.get(baseName) || 0) + 1);
  });

  filterRowCardsCache.sourceArray = cards;
  filterRowCardsCache.deckTotal = deckTotal;
  filterRowCardsCache.sortedCards = sortedCards;
  filterRowCardsCache.duplicateCounts = duplicateCounts;

  return { sortedCards, duplicateCounts };
}

export function formatCardOptionLabel(card: CardItemData, duplicateCounts: Map<string, number>): string {
  const baseName = card?.name || '';
  const count = duplicateCounts.get(baseName) || 0;
  if (!baseName) {
    return buildCardId(card) || 'Unknown Card';
  }
  if (count <= 1) {
    return baseName;
  }
  const setCode = String(card?.set ?? '')
    .toUpperCase()
    .trim();
  const number = normalizeCardNumber(card?.number);
  if (setCode && number) {
    return `${baseName} (${setCode} ${number})`;
  }
  const fallbackId = buildCardId(card);
  return fallbackId ? `${baseName} (${fallbackId.replace('~', ' ')})` : baseName;
}

export function ensureFilterMessageElement(): HTMLElement | null {
  return null;
}

export function updateFilterMessage(text: string, tone = 'info'): void {
  const message = ensureFilterMessageElement();
  if (!message) {
    return;
  }
  if (!text) {
    message.hidden = true;
    message.textContent = '';
    delete message.dataset.tone;
    return;
  }
  message.hidden = false;
  message.textContent = text;
  message.dataset.tone = tone;
}

export function updateFilterEmptyState(): void {
  const message = elements.filterEmptyState;
  if (!message) {
    return;
  }
  const state = getState();
  const hasFilters = state.filterRows.length > 0;
  message.hidden = hasFilters;
}

export function describeFilters(filters: FilterDescriptor[]): string {
  const state = getState();
  if (!filters || filters.length === 0) {
    return 'the baseline list';
  }

  const descriptions = filters.map(filter => {
    const info = state.cardLookup.get(filter.cardId);
    let desc = `${info?.name ?? filter.cardId}`;

    if (filter.operator === 'any') {
      desc += ' (any count)';
    } else if (!filter.operator || filter.operator === '') {
      desc += ' (none)';
    } else if (filter.count !== null && filter.count !== undefined) {
      const operatorText =
        {
          '=': 'exactly',
          '<': 'less than',
          '>': 'more than',
          '<=': 'at most',
          '>=': 'at least'
        }[filter.operator] || filter.operator;

      desc += ` (${operatorText} ${filter.count})`;
    }

    return desc;
  });

  if (descriptions.length === 1) {
    return `including ${descriptions[0]}`;
  }

  return `including ${descriptions.slice(0, -1).join(', ')} and ${descriptions[descriptions.length - 1]}`;
}

export function describeSuccessFilter(tag: string): string {
  if (!tag || tag === 'all') {
    return '';
  }
  return SUCCESS_FILTER_LABELS[tag] || tag;
}

export function getFilterKey(filters: FilterDescriptor[], successFilter = 'all'): string {
  const base = successFilter || 'all';
  if (!filters || filters.length === 0) {
    return `${base}::null`;
  }

  return `${base}::${filters
    .map(f => {
      let part = f.cardId || 'null';
      if (f.operator === 'any') {
        part += '::any';
      } else if (f.operator === '') {
        part += '::none';
      } else if (f.operator && f.count !== null && f.count !== undefined) {
        part += `::${f.operator}${f.count}`;
      }
      return part;
    })
    .join('||')}`;
}

export function normalizeThreshold(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max <= min) {
    return min;
  }

  const clamped = Math.max(min, Math.min(max, value));
  const rounded = min + Math.round((clamped - min) / GRANULARITY_STEP_PERCENT) * GRANULARITY_STEP_PERCENT;
  return Math.max(min, Math.min(max, rounded));
}
