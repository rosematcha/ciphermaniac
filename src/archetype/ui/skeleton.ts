import { SUCCESS_FILTER_LABELS } from '../constants.js';
import { buildSkeletonExportEntries } from '../data/skeleton.js';
import type { CardItemData, FilterRow } from '../types.js';
import { copyDecklistToClipboard } from '../export/clipboard.js';
import { buildTcgliveExportString } from '../export/tcgLive.js';
import { getState } from '../state.js';
import { isAceSpec } from '../cardCategories.js';
import { elements } from './elements.js';
import { logger } from '../../utils/logger.js';

let quickFilterHandler: ((cardName: string) => void) | null = null;

export function setQuickFilterHandler(handler: ((cardName: string) => void) | null): void {
  quickFilterHandler = handler;
}

function updateSkeletonExportStatus(message: string, tone: string = 'info'): void {
  if (!elements.skeletonExportStatus) {
    return;
  }
  if (!message) {
    elements.skeletonExportStatus.textContent = '';
    elements.skeletonExportStatus.hidden = true;
    elements.skeletonExportStatus.removeAttribute('data-tone');
    return;
  }
  elements.skeletonExportStatus.textContent = message;
  elements.skeletonExportStatus.hidden = false;
  if (tone) {
    elements.skeletonExportStatus.dataset.tone = tone;
  } else {
    elements.skeletonExportStatus.removeAttribute('data-tone');
  }
}

function syncSkeletonExportState(): void {
  const exportButton = document.getElementById('skeleton-export-live') as HTMLButtonElement | null;
  if (!exportButton) {
    return;
  }

  const state = getState();
  const hasCards = state.skeleton.exportEntries.length > 0;
  exportButton.disabled = !hasCards;
  if (!hasCards) {
    updateSkeletonExportStatus('');
  }
}

async function handleSkeletonExport(event: Event): Promise<void> {
  event.preventDefault();

  const state = getState();
  const { exportEntries, plainWarnings } = state.skeleton;
  if (!Array.isArray(exportEntries) || exportEntries.length === 0) {
    updateSkeletonExportStatus('No cards are available to export yet.', 'warning');
    return;
  }

  const exportText = buildTcgliveExportString(exportEntries);
  if (!exportText) {
    updateSkeletonExportStatus('Unable to build the TCG Live export.', 'error');
    return;
  }

  state.skeleton.lastExportText = exportText;

  try {
    const method = await copyDecklistToClipboard(exportText);
    const hasWarnings = Array.isArray(plainWarnings) && plainWarnings.length > 0;
    const warningNote = hasWarnings ? ` Warning: ${plainWarnings.join('; ')}` : '';
    const baseMessage =
      method === 'prompt' ? 'Deck list ready in a prompt for manual copy.' : 'Copied TCG Live deck list to clipboard.';
    const tone = hasWarnings ? 'warning' : 'success';
    updateSkeletonExportStatus(`${baseMessage}${warningNote}`, tone);
  } catch (error) {
    logger.warn('TCG Live export cancelled or failed', error);
    const isCancelled = error instanceof Error && error.message === 'TCGLiveExportCopyCancelled';
    const message = isCancelled
      ? 'Export cancelled before copy. Try again when you are ready.'
      : 'Unable to copy the deck list. Please try again.';
    updateSkeletonExportStatus(message, 'error');
  }
}

export function setupSkeletonExport(): void {
  const exportButton = document.getElementById('skeleton-export-live');
  if (!exportButton) {
    return;
  }
  exportButton.addEventListener('click', handleSkeletonExport);
  syncSkeletonExportState();
}

export function updateSkeletonSummary(items: CardItemData[]): void {
  if (!elements.skeletonSummary || !elements.skeletonWarnings) {
    return;
  }

  const state = getState();

  if (!elements.skeletonSummary.hasAttribute('aria-live')) {
    elements.skeletonSummary.setAttribute('aria-live', 'polite');
  }
  if (!elements.skeletonWarnings.hasAttribute('role')) {
    elements.skeletonWarnings.setAttribute('role', 'alert');
    elements.skeletonWarnings.setAttribute('aria-live', 'assertive');
  }

  updateSkeletonExportStatus('');

  const exportEntries = buildSkeletonExportEntries(items);

  let totalCount = 0;
  let aceSpecCount = 0;
  const aceSpecCards: string[] = [];

  exportEntries.forEach(entry => {
    totalCount += entry.copies;
    if (isAceSpec(entry.name)) {
      aceSpecCount += entry.copies;
      if (!aceSpecCards.includes(entry.name)) {
        aceSpecCards.push(entry.name);
      }
    }
  });

  const displayWarnings: string[] = [];
  let hasAceSpecWarning = false;
  if (aceSpecCount > 1) {
    hasAceSpecWarning = true;
    const warningText = `Multiple Ace Spec cards detected: ${aceSpecCards.join(', ')}`;
    displayWarnings.push(warningText);
  }
  if (totalCount > 60) {
    const warningText = `Deck exceeds 60 cards (${totalCount} cards)`;
    displayWarnings.push(warningText);
  }

  const skeletonWarningsEl = elements.skeletonWarnings;
  if (displayWarnings.length > 0) {
    skeletonWarningsEl.innerHTML = '';

    if (hasAceSpecWarning) {
      const aceSpecPrefixSpan = document.createElement('span');
      aceSpecPrefixSpan.textContent = 'Multiple Ace Spec cards detected: ';
      skeletonWarningsEl.appendChild(aceSpecPrefixSpan);

      aceSpecCards.forEach((cardName, index) => {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'ace-spec-quick-filter';
        link.textContent = cardName;
        link.title = `Filter decks with ${cardName}`;
        link.setAttribute('aria-label', `Add filter for ${cardName} Ace Spec card`);
        link.addEventListener('click', event => {
          event.preventDefault();
          quickFilterHandler?.(cardName);
        });
        skeletonWarningsEl.appendChild(link);

        if (index < aceSpecCards.length - 1) {
          const separator = document.createElement('span');
          separator.textContent = ', ';
          skeletonWarningsEl.appendChild(separator);
        }
      });

      if (displayWarnings.length > 1) {
        const bulletSeparator = document.createElement('span');
        bulletSeparator.textContent = ' \u2022 ';
        skeletonWarningsEl.appendChild(bulletSeparator);

        const otherWarnings = displayWarnings.slice(1).join(' \u2022 ');
        const otherWarningsSpan = document.createElement('span');
        otherWarningsSpan.textContent = otherWarnings;
        skeletonWarningsEl.appendChild(otherWarningsSpan);
      }
    } else {
      skeletonWarningsEl.textContent = displayWarnings.join(' \u2022 ');
    }

    skeletonWarningsEl.hidden = false;
  } else {
    skeletonWarningsEl.innerHTML = '';
    skeletonWarningsEl.hidden = true;
  }

  const deckCount = state.archetypeDeckTotal || 0;
  const deckLabel = deckCount === 1 ? 'deck' : 'decks';
  const cardLabel = totalCount === 1 ? 'card' : 'cards';

  let finishLabel = SUCCESS_FILTER_LABELS[state.successFilter] || state.successFilter;
  if (finishLabel === 'all finishes') {
    finishLabel = 'all';
  }

  if (finishLabel !== 'all' && !finishLabel.startsWith('top')) {
    finishLabel = finishLabel.charAt(0).toUpperCase() + finishLabel.slice(1);
  } else if (finishLabel.startsWith('top')) {
    finishLabel = finishLabel.charAt(0).toUpperCase() + finishLabel.slice(1);
  }

  const archetypeName = state.archetypeLabel || 'Unknown';

  let message = `${deckCount} ${deckLabel} and ${totalCount} ${cardLabel} from ${finishLabel} ${archetypeName} decks`;

  const activeFilters = state.filterRows.filter((r): r is FilterRow & { cardId: string } => r.cardId !== null);
  if (activeFilters.length > 0) {
    const filterDescriptions = activeFilters.map(filter => {
      const cardName = state.cardLookup.get(filter.cardId)?.name || 'Unknown Card';
      const { operator } = filter;
      const { count } = filter;

      if (operator === '') {
        return `no ${cardName}`;
      }
      if (!operator || operator === 'any') {
        return `any ${cardName}`;
      }
      if (operator === '=') {
        return `${count} ${cardName}`;
      }
      if (operator === '>') {
        return `more than ${count} ${cardName}`;
      }
      if (operator === '<') {
        return `less than ${count} ${cardName}`;
      }
      return `${operator} ${count} ${cardName}`;
    });

    if (filterDescriptions.length === 1) {
      message += ` including ${filterDescriptions[0]}`;
    } else {
      const last = filterDescriptions.pop();
      message += ` including ${filterDescriptions.join(', ')} and ${last}`;
    }
  }

  message += '.';

  elements.skeletonSummary.textContent = message;
  elements.skeletonSummary.hidden = false;

  state.skeleton.totalCards = totalCount;
  state.skeleton.exportEntries = exportEntries;
  state.skeleton.displayWarnings = displayWarnings;

  syncSkeletonExportState();
}
