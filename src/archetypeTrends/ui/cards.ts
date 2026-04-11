import { CATEGORY_LABELS } from '../constants.js';
import { getState } from '../state.js';
import type { EnhancedCardEntry } from '../types.js';
import { elements } from './elements.js';
import { formatPercent } from '../utils/format.js';
import { buildCardUrl } from '../utils/url.js';
import { escapeHtml } from '../../utils/html.js';

function renderSparkline(card: EnhancedCardEntry): string {
  const state = getState();
  const width = 80;
  const height = 24;
  const tier = state.selectedTier;
  const isDaily = state.timeScale === 'daily';

  const days = state.trendsData?.days;
  const weeks = state.trendsData?.weeks;
  if (!days || days.length === 0) {
    return '';
  }

  let points: number[];

  if (isDaily) {
    points = days.map((entry, idx) => {
      const entryData = card.timeline[idx]?.[tier];
      const total = entry.totals[tier] || entry.totals.all || 1;
      return entryData ? (entryData.count / total) * 100 : 0;
    });
  } else {
    if (!weeks) {
      return '';
    }
    points = weeks.map(weekEntry => {
      let totalCount = 0;
      let totalDecks = 0;

      days.forEach((day, dayIdx) => {
        if (day.date >= weekEntry.weekStart && day.date <= weekEntry.weekEnd) {
          const dayData = card.timeline[dayIdx]?.[tier];
          if (dayData) {
            totalCount += dayData.count;
          }
          totalDecks += day.totals[tier] || day.totals.all || 0;
        }
      });

      return totalDecks > 0 ? (totalCount / totalDecks) * 100 : 0;
    });
  }

  if (points.length < 2) {
    return '';
  }

  const max = Math.max(...points, 1);
  const xStep = width / (points.length - 1);

  const coords = points
    .map((pt, idx) => `${(idx * xStep).toFixed(1)},${(height - (pt / max) * height).toFixed(1)}`)
    .join(' ');

  const trendClass = points[points.length - 1] > points[0] ? 'spark-up' : 'spark-down';

  return `<svg width="${width}" height="${height}" class="sparkline ${trendClass}" aria-hidden="true">
    <polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${coords}" />
  </svg>`;
}

const MAX_KEY_CARDS = 18;

function cardInterestScore(card: EnhancedCardEntry): number {
  const changeMagnitude = Math.abs(card.playrateChange);
  const playrateWeight = Math.min(card.currentPlayrate / 100, 1);

  let score = changeMagnitude * 2 + card.volatility;

  if (card.category === 'flex' || card.category === 'emerging' || card.category === 'fading') {
    score += 10;
  } else if (card.category === 'staple') {
    score += 3;
  } else if (card.category === 'core') {
    score += changeMagnitude > 1 ? 5 : 1;
  }

  score *= 0.5 + playrateWeight;

  return score;
}

export function renderCardList(): void {
  const state = getState();
  if (!state.trendsData || !elements.cardListBody || !elements.cardListSection) {
    return;
  }

  const { cards } = state.trendsData;
  let rows = Object.values(cards);
  const totalCardCount = rows.length;

  if (state.categoryFilter !== 'all') {
    rows = rows.filter(c => c.category === state.categoryFilter);
  }

  let isShowingKeyOnly = false;
  let hiddenCount = 0;

  if (state.categoryFilter === 'all' && !state.showAllCards) {
    const scored = rows.map(card => ({ card, score: cardInterestScore(card) })).sort((a, b) => b.score - a.score);

    const keyCards = scored.slice(0, MAX_KEY_CARDS).map(s => s.card);
    hiddenCount = rows.length - keyCards.length;
    if (hiddenCount > 0) {
      isShowingKeyOnly = true;
      rows = keyCards;
    }
  }

  rows.sort((a, b) => {
    switch (state.sortBy) {
      case 'playrate':
        return b.currentPlayrate - a.currentPlayrate;
      case 'trending':
        return b.playrateChange - a.playrateChange;
      case 'name':
        return a.name.localeCompare(b.name);
      case 'copies':
        return b.currentAvgCopies - a.currentAvgCopies;
      case 'volatility':
        return b.volatility - a.volatility;
      default:
        return b.currentPlayrate - a.currentPlayrate;
    }
  });

  const heading = elements.cardListSection.querySelector('.card-list-header h2');
  if (heading) {
    if (state.categoryFilter === 'all') {
      heading.textContent = isShowingKeyOnly ? 'Card Data' : 'All Cards';
    } else {
      heading.textContent = `${CATEGORY_LABELS[state.categoryFilter]} Cards`;
    }
  }

  elements.cardListBody.innerHTML = '';

  rows.forEach(card => {
    const cardUrl = buildCardUrl(card);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-name">
        <a href="${cardUrl}">${escapeHtml(card.name)}</a>
      </td>
      <td class="col-playrate">${formatPercent(card.currentPlayrate)}</td>
      <td class="col-copies">${card.currentAvgCopies.toFixed(2)}</td>
      <td class="col-change ${card.playrateChange > 0 ? 'trend-up' : 'trend-down'}">
        ${card.playrateChange > 0 ? '+' : ''}${card.playrateChange.toFixed(1)}%
      </td>
      <td class="col-sparkline">
        ${renderSparkline(card)}
      </td>
    `;

    elements.cardListBody?.appendChild(tr);
  });

  let showAllBtn = elements.cardListSection.querySelector('.show-all-cards-btn') as HTMLButtonElement | null;
  if (state.categoryFilter === 'all' && (isShowingKeyOnly || state.showAllCards)) {
    if (!showAllBtn) {
      showAllBtn = document.createElement('button');
      showAllBtn.type = 'button';
      showAllBtn.className = 'show-all-cards-btn';
      const tableWrapper = elements.cardListSection.querySelector('.card-list-table-wrapper');
      if (tableWrapper) {
        tableWrapper.insertAdjacentElement('afterend', showAllBtn);
      }
    }

    if (isShowingKeyOnly) {
      showAllBtn.textContent = `Show all ${totalCardCount} cards`;
      showAllBtn.hidden = false;
    } else {
      showAllBtn.textContent = 'Show interesting cards only';
      showAllBtn.hidden = false;
    }

    showAllBtn.onclick = () => {
      state.showAllCards = !state.showAllCards;
      renderCardList();
    };
  } else if (showAllBtn) {
    showAllBtn.hidden = true;
  }

  elements.cardListSection.hidden = false;
}

export function updateCategoryCounts(): void {
  const state = getState();
  if (!state.trendsData) {
    return;
  }
  const { cards } = state.trendsData;

  const counts = {
    all: 0,
    core: 0,
    staple: 0,
    flex: 0,
    tech: 0,
    emerging: 0,
    fading: 0
  };

  Object.values(cards).forEach(card => {
    counts.all++;
    if (card.category in counts) {
      counts[card.category as keyof typeof counts]++;
    }
  });

  Object.entries(counts).forEach(([category, count]) => {
    const countEl = document.getElementById(`count-${category}`);
    if (countEl) {
      countEl.textContent = String(count);
    }
  });
}

export function setupCategoryTabs(): void {
  const state = getState();
  const tabs = document.querySelectorAll('.category-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const { category } = (tab as HTMLElement).dataset;
      if (category) {
        state.categoryFilter = category as typeof state.categoryFilter;

        if (category !== 'all') {
          state.showAllCards = false;
        }

        tabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        renderCardList();
      }
    });
  });
}
