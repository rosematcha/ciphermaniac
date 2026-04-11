import { PERFORMANCE_TIER_LABELS } from '../../data/performanceTiers.js';
import { getState } from '../state.js';
import { elements } from './elements.js';

function computeTotalLists(): number {
  const state = getState();
  if (!state.trendsData?.days) {
    return 0;
  }
  const tier = state.selectedTier;
  return state.trendsData.days.reduce((sum, day) => {
    return sum + (day.totals[tier] || day.totals.all || 0);
  }, 0);
}

export function renderStats(): void {
  const state = getState();
  if (!state.trendsData) {
    return;
  }
  const { meta } = state.trendsData;

  if (elements.statsSection) {
    elements.statsSection.hidden = true;
  }

  if (elements.metaInfo) {
    const tierLabel = PERFORMANCE_TIER_LABELS[state.selectedTier] || state.selectedTier;
    const totalLists = computeTotalLists();
    const listsPart = totalLists > 0 ? ` · ${totalLists.toLocaleString()} lists` : '';
    elements.metaInfo.textContent = `${meta.tournamentCount} tournaments${listsPart}, ${tierLabel}`;
  }
}
