import { PERFORMANCE_TIER_LABELS } from '../../data/performanceTiers.js';
import { getState } from '../state.js';
import { elements } from './elements.js';
import { formatDate } from '../utils/format.js';

export function renderStats(): void {
  const state = getState();
  if (!state.trendsData || !elements.statsSection) {
    return;
  }
  const { meta } = state.trendsData;

  if (elements.statWeeks) {
    elements.statWeeks.textContent = String(meta.weekCount);
  }
  if (elements.statTournaments) {
    elements.statTournaments.textContent = String(meta.tournamentCount);
  }
  if (elements.statCards) {
    elements.statCards.textContent = String(meta.cardCount);
  }
  if (elements.statRange) {
    elements.statRange.textContent = `${formatDate(meta.windowStart)} - ${formatDate(meta.windowEnd)}`;
  }

  elements.statsSection.hidden = false;

  if (elements.metaInfo) {
    const tierLabel = PERFORMANCE_TIER_LABELS[state.selectedTier] || state.selectedTier;
    elements.metaInfo.textContent = `${meta.tournamentCount} tournaments, ${tierLabel}`;
  }
}
