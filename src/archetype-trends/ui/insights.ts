import { escapeHtml } from '../../utils/html.js';
import { getState } from '../state.js';
import { elements } from './elements.js';
import { formatPercent } from '../utils/format.js';
import { buildCardUrl } from '../utils/url.js';
import type { EnhancedCardEntry } from '../types.js';

function renderInsightItem(card: EnhancedCardEntry, stat?: string, statClass?: string): HTMLElement {
  const div = document.createElement('a');
  div.className = 'insight-item';
  div.href = buildCardUrl(card);
  div.innerHTML = `
    <span class="insight-item-name">${escapeHtml(card.name)}</span>
    ${stat ? `<span class="insight-item-stat ${statClass || ''}">${stat}</span>` : ''}
  `;
  return div;
}

export function renderInsights(): void {
  const state = getState();
  if (!state.trendsData || !elements.insightsSection) {
    return;
  }
  const { insights, cards } = state.trendsData;

  if (elements.coreCount) {
    elements.coreCount.textContent = String(insights.coreCards.length);
  }
  if (elements.coreList) {
    elements.coreList.innerHTML = '';
    if (insights.coreCards.length === 0) {
      elements.coreList.innerHTML = '<div class="insight-empty">No core cards identified</div>';
    } else {
      insights.coreCards.slice(0, 5).forEach(uid => {
        const card = cards[uid];
        if (card) {
          elements.coreList?.appendChild(renderInsightItem(card, formatPercent(card.currentPlayrate)));
        }
      });
    }
  }

  if (elements.flexCount) {
    elements.flexCount.textContent = String(insights.flexSlots.length);
  }
  if (elements.flexList) {
    elements.flexList.innerHTML = '';
    if (insights.flexSlots.length === 0) {
      elements.flexList.innerHTML = '<div class="insight-empty">No highly variable slots</div>';
    } else {
      insights.flexSlots.slice(0, 5).forEach(slot => {
        const card = cards[slot.uid];
        if (card) {
          elements.flexList?.appendChild(renderInsightItem(card, `${slot.copyRange[0]}-${slot.copyRange[1]}`));
        }
      });
    }
  }

  if (elements.risingCount) {
    elements.risingCount.textContent = String(insights.risers.length);
  }
  if (elements.risingList) {
    elements.risingList.innerHTML = '';
    if (insights.risers.length === 0) {
      elements.risingList.innerHTML = '<div class="insight-empty">No significant risers</div>';
    } else {
      insights.risers.slice(0, 5).forEach(item => {
        const card = cards[item.uid];
        if (card) {
          elements.risingList?.appendChild(
            renderInsightItem(card, `+${item.delta.toFixed(1)}%`, 'insight-item-stat--rising')
          );
        }
      });
    }
  }

  if (elements.fallingCount) {
    elements.fallingCount.textContent = String(insights.fallers.length);
  }
  if (elements.fallingList) {
    elements.fallingList.innerHTML = '';
    if (insights.fallers.length === 0) {
      elements.fallingList.innerHTML = '<div class="insight-empty">No significant fallers</div>';
    } else {
      insights.fallers.slice(0, 5).forEach(item => {
        const card = cards[item.uid];
        if (card) {
          elements.fallingList?.appendChild(
            renderInsightItem(card, `${item.delta.toFixed(1)}%`, 'insight-item-stat--falling')
          );
        }
      });
    }
  }

  elements.insightsSection.hidden = false;

  if (elements.substitutionsSection && elements.substitutionsList) {
    if (insights.substitutions.length > 0) {
      elements.substitutionsList.innerHTML = '';
      insights.substitutions.forEach(sub => {
        const c1 = cards[sub.cardA];
        const c2 = cards[sub.cardB];
        if (c1 && c2) {
          const div = document.createElement('div');
          div.className = 'substitution-item';
          div.innerHTML = `
            <div class="substitution-cards">
              <a href="${buildCardUrl(c1)}">${escapeHtml(c1.name)}</a>
              <span class="substitution-arrow">&harr;</span>
              <a href="${buildCardUrl(c2)}">${escapeHtml(c2.name)}</a>
            </div>
            <span class="substitution-correlation">${sub.correlation.toFixed(2)}</span>
          `;
          elements.substitutionsList?.appendChild(div);
        }
      });
      elements.substitutionsSection.hidden = false;
    } else {
      elements.substitutionsSection.hidden = true;
    }
  }
}
