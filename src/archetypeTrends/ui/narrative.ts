import { escapeHtml } from '../../utils/html.js';
import { getState } from '../state.js';
import { elements } from './elements.js';

function generateNarrative(): string {
  const state = getState();
  if (!state.trendsData) {
    return '';
  }
  const { meta, insights, cards } = state.trendsData;

  const parts: string[] = [];

  parts.push(
    `Based on <span class="highlight">${meta.tournamentCount} tournaments</span> over ${meta.weekCount} weeks`
  );

  if (insights.risers.length > 0) {
    const topRiser = cards[insights.risers[0].uid];
    if (topRiser) {
      parts.push(
        `<span class="highlight">${escapeHtml(topRiser.name)}</span> is <span class="trend-up">trending up</span> (+${insights.risers[0].delta.toFixed(1)}%)`
      );
    }
  }

  if (insights.fallers.length > 0) {
    const topFaller = cards[insights.fallers[0].uid];
    if (topFaller) {
      parts.push(
        `while <span class="highlight">${escapeHtml(topFaller.name)}</span> is <span class="trend-down">declining</span> (${insights.fallers[0].delta.toFixed(1)}%)`
      );
    }
  }

  if (insights.coreCards.length > 0) {
    parts.push(
      `The deck has <span class="highlight">${insights.coreCards.length} core cards</span> that appear in nearly every build`
    );
  }

  return `${parts.join('. ')}.`;
}

export function renderNarrative(): void {
  if (!elements.narrativeSection || !elements.narrativeText) {
    return;
  }

  const narrative = generateNarrative();
  if (narrative) {
    elements.narrativeText.innerHTML = narrative;
    elements.narrativeSection.hidden = false;
  } else {
    elements.narrativeSection.hidden = true;
  }
}
