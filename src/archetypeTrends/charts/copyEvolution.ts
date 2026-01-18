import { getState } from '../state.js';
import { elements } from '../ui/elements.js';
import { formatDate } from '../utils/format.js';

export function renderCopyEvolution(): void {
  const state = getState();
  if (!state.trendsData || !elements.copyEvolutionSection || !elements.copyChart) {
    return;
  }

  const { cards, weeks } = state.trendsData;
  const cardId = state.activeCopyCard;

  if (elements.copyCardSelect && elements.copyCardSelect.options.length <= 1) {
    const sortedCards = Object.entries(cards)
      .filter(([, c]) => c.currentPlayrate > 5)
      .sort((a, b) => b[1].currentPlayrate - a[1].currentPlayrate);

    sortedCards.forEach(([uid, card]) => {
      const option = document.createElement('option');
      option.value = uid;
      option.textContent = card.name;
      elements.copyCardSelect?.appendChild(option);
    });
  }

  if (!cardId || !cards[cardId]) {
    elements.copyChart.innerHTML = '<div class="chart-placeholder">Select a card to see copy evolution</div>';
    if (elements.copyStats) {
      elements.copyStats.hidden = true;
    }
    return;
  }

  const card = cards[cardId];
  const chartWidth = elements.copyChart.clientWidth || 800;
  const chartHeight = 240;
  const padX = 40;
  const padY = 20;
  const contentWidth = chartWidth - padX * 2;
  const contentHeight = chartHeight - padY * 2;
  const data = card.copyTrend;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`);
  svg.setAttribute('class', 'copy-evolution-svg');

  const barWidth = Math.min(40, (contentWidth / data.length) * 0.8);
  const gap = (contentWidth - barWidth * data.length) / (data.length + 1);
  const copyColors = ['#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'];

  data.forEach((weekData, i) => {
    const total = weekData.dist.reduce((a, b) => a + b, 0);
    if (total === 0) {
      return;
    }

    let currentY = chartHeight - padY;
    const x = padX + gap + i * (barWidth + gap);

    weekData.dist.forEach((count, copyIndex) => {
      const pct = count / total;
      const h = pct * contentHeight;

      if (h > 0) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(currentY - h));
        rect.setAttribute('width', String(barWidth));
        rect.setAttribute('height', String(h));
        rect.setAttribute('fill', copyColors[copyIndex]);
        rect.setAttribute('rx', '2');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${copyIndex + 1} Copy: ${Math.round(pct * 100)}% (${count} decks)\nWeek of ${formatDate(weeks[i]?.weekStart || '')}`;
        rect.appendChild(title);

        svg.appendChild(rect);
        currentY -= h;
      }
    });

    if (i % 2 === 0 || data.length < 8) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x + barWidth / 2));
      text.setAttribute('y', String(chartHeight - 2));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'chart-axis-label');
      text.textContent = formatDate(weeks[i]?.weekStart || '');
      svg.appendChild(text);
    }
  });

  elements.copyChart.innerHTML = '';
  elements.copyChart.appendChild(svg);

  if (elements.copyAvgCurrent) {
    elements.copyAvgCurrent.textContent = card.currentAvgCopies.toFixed(2);
  }
  if (elements.copyModeCurrent) {
    elements.copyModeCurrent.textContent = String(card.currentModeCopies);
  }
  if (elements.copyChange) {
    const sign = card.copiesChange > 0 ? '+' : '';
    elements.copyChange.textContent = `${sign}${card.copiesChange.toFixed(2)}`;
    elements.copyChange.className = `copy-stat-value ${card.copiesChange > 0 ? 'trend-up' : card.copiesChange < 0 ? 'trend-down' : ''}`;
  }

  elements.copyEvolutionSection.hidden = false;
  if (elements.copyStats) {
    elements.copyStats.hidden = false;
  }
}
