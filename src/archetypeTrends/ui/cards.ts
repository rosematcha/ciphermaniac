import { CATEGORY_LABELS, PALETTE } from '../constants.js';
import { getState } from '../state.js';
import type { AppState, EnhancedCardEntry } from '../types.js';
import { elements } from './elements.js';
import { formatPercent } from '../utils/format.js';
import { buildCardUrl } from '../utils/url.js';
import { escapeHtml } from '../../utils/html.js';
import { renderChart } from '../charts/trendsChart.js';

function getCardColor(uid: string): string {
  const state = getState();
  if (!state.selectedCards.has(uid)) {
    return '';
  }
  const index = Array.from(state.selectedCards).indexOf(uid);
  return PALETTE[index % PALETTE.length];
}

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

export function renderCardList(): void {
  const state = getState();
  if (!state.trendsData || !elements.cardListBody || !elements.cardListSection) {
    return;
  }

  const { cards } = state.trendsData;
  let rows = Object.values(cards);

  if (state.categoryFilter !== 'all') {
    rows = rows.filter(c => c.category === state.categoryFilter);
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

  elements.cardListBody.innerHTML = '';

  rows.forEach(card => {
    const uid = Object.keys(cards).find(key => cards[key] === card) || card.name;
    const isSelected = state.selectedCards.has(uid);
    const color = getCardColor(uid);
    const cardUrl = buildCardUrl(card);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-chart">
        <label class="chart-checkbox">
          <input type="checkbox" data-uid="${uid}" ${isSelected ? 'checked' : ''} aria-label="Toggle ${escapeHtml(card.name)}">
          <span class="checkbox-indicator" ${color ? `style="background-color: ${color}"` : ''}></span>
        </label>
      </td>
      <td class="col-name">
        <a href="${cardUrl}">${escapeHtml(card.name)}</a>
      </td>
      <td class="col-category">
        <span class="category-badge cat-${card.category}">${CATEGORY_LABELS[card.category]}</span>
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

    const checkbox = tr.querySelector('input');
    checkbox?.addEventListener('change', e => {
      const { checked } = e.target as HTMLInputElement;
      if (checked) {
        if (state.selectedCards.size < 10) {
          state.selectedCards.add(uid);
        }
      } else {
        state.selectedCards.delete(uid);
      }
      renderChart();
      renderCardList();
    });

    elements.cardListBody?.appendChild(tr);
  });

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
        state.categoryFilter = category as AppState['categoryFilter'];

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
