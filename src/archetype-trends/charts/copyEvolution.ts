import { getState } from '../state.js';
import { elements } from '../ui/elements.js';
import { formatDate } from '../utils/format.js';

const COPY_COLORS = ['#475569', '#67e8f9', '#3b82f6', '#a855f7', '#e879a0'];
const COPY_LABELS = ['0 copies', '1 copy', '2 copies', '3 copies', '4 copies'];

function ensureTooltip(): HTMLElement {
  let tip = document.getElementById('copy-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'copy-tooltip';
    tip.className = 'copy-chart-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}

function hideTooltip(): void {
  const tip = document.getElementById('copy-tooltip');
  if (tip) {
    tip.style.opacity = '0';
    tip.style.pointerEvents = 'none';
  }
}

export function renderCopyEvolution(): void {
  const state = getState();
  if (!state.trendsData || !elements.copyEvolutionSection || !elements.copyChart) {
    return;
  }

  const { cards, days } = state.trendsData;
  const tier = state.selectedTier;
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

  if (elements.copyCardSelect && cardId && elements.copyCardSelect.value !== cardId) {
    elements.copyCardSelect.value = cardId;
  }

  if (!cardId || !cards[cardId]) {
    elements.copyChart.innerHTML = `
      <div class="copy-evolution-empty">
        <svg class="copy-evolution-empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <rect x="8" y="28" width="8" height="12" rx="2" fill="rgba(139, 92, 246, 0.3)" stroke="rgba(139, 92, 246, 0.6)" stroke-width="1.5"/>
          <rect x="20" y="18" width="8" height="22" rx="2" fill="rgba(59, 130, 246, 0.3)" stroke="rgba(59, 130, 246, 0.6)" stroke-width="1.5"/>
          <rect x="32" y="10" width="8" height="30" rx="2" fill="rgba(147, 197, 253, 0.3)" stroke="rgba(147, 197, 253, 0.6)" stroke-width="1.5"/>
        </svg>
        <p class="copy-evolution-empty-title">Choose a card to explore</p>
        <p class="copy-evolution-empty-hint">Use the dropdown above to see how copy counts shift week to week</p>
      </div>`;
    if (elements.copyStats) {
      elements.copyStats.hidden = true;
    }
    return;
  }

  const card = cards[cardId];
  const chartWidth = elements.copyChart.clientWidth || 800;
  const chartHeight = 220;
  const padLeft = 36;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 24;
  const contentWidth = chartWidth - padLeft - padRight;
  const contentHeight = chartHeight - padTop - padBottom;
  const data = card.copyTrend;

  // Build enriched data with 0-copy counts
  const enrichedData = data.map((entry, i) => {
    const totalDecks = days[i]?.totals[tier] || days[i]?.totals.all || 0;
    const includedDecks = entry.dist.reduce((a, b) => a + b, 0);
    const excludedDecks = Math.max(0, totalDecks - includedDecks);
    // dist with 0-copies prepended: [0copies, 1copy, 2copies, 3copies, 4copies]
    const fullDist = [excludedDecks, ...entry.dist];
    const fullTotal = excludedDecks + includedDecks;
    return { fullDist, fullTotal, date: days[i]?.date || null };
  });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`);
  svg.setAttribute('class', 'copy-evolution-svg');

  // Grid lines
  const gridLevels = [0, 50, 100];
  gridLevels.forEach(level => {
    const y = chartHeight - padBottom - (level / 100) * contentHeight;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(padLeft));
    line.setAttribute('x2', String(chartWidth - padRight));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', level === 0 ? 'rgba(124, 134, 168, 0.25)' : 'rgba(124, 134, 168, 0.1)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    if (level > 0) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(padLeft - 6));
      text.setAttribute('y', String(y + 3));
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('fill', 'rgba(124, 134, 168, 0.5)');
      text.setAttribute('font-size', '9');
      text.setAttribute('font-family', 'var(--font-family)');
      text.textContent = `${level}%`;
      svg.appendChild(text);
    }
  });

  // Bar geometry
  const totalBarSpace = contentWidth * 0.85;
  const barWidth = Math.min(32, totalBarSpace / enrichedData.length);
  const totalBarsWidth = barWidth * enrichedData.length;
  const gap = enrichedData.length > 1 ? (contentWidth - totalBarsWidth) / (enrichedData.length - 1) : 0;
  const offsetX = padLeft + (contentWidth - totalBarsWidth - gap * Math.max(0, enrichedData.length - 1)) / 2;

  // Label interval — show every Nth day so labels don't overlap
  const labelInterval = enrichedData.length > 14 ? 3 : enrichedData.length > 7 ? 2 : 1;

  // Bars
  enrichedData.forEach((entry, i) => {
    if (entry.fullTotal === 0) {
      return;
    }

    const x = offsetX + i * (barWidth + gap);
    let currentY = chartHeight - padBottom;

    // Invisible hit area
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hitArea.setAttribute('x', String(x - gap / 2));
    hitArea.setAttribute('y', String(padTop));
    hitArea.setAttribute('width', String(barWidth + gap));
    hitArea.setAttribute('height', String(contentHeight));
    hitArea.setAttribute('fill', 'transparent');
    hitArea.setAttribute('class', 'copy-bar-hit');
    hitArea.dataset.weekIndex = String(i);
    svg.appendChild(hitArea);

    // Segments bottom-up: 0copies, 1copy, 2copies, 3copies, 4copies
    const segments: SVGRectElement[] = [];
    entry.fullDist.forEach((count, copyIndex) => {
      const pct = count / entry.fullTotal;
      const h = pct * contentHeight;

      if (h > 0.5) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(currentY - h));
        rect.setAttribute('width', String(barWidth));
        rect.setAttribute('height', String(Math.max(h, 1)));
        rect.setAttribute('fill', COPY_COLORS[copyIndex] || COPY_COLORS[COPY_COLORS.length - 1]);
        rect.setAttribute('class', 'copy-bar-segment');
        rect.dataset.weekIndex = String(i);
        rect.dataset.copyIndex = String(copyIndex);
        segments.push(rect);
        svg.appendChild(rect);
        currentY -= h;
      }
    });

    if (segments.length > 0) {
      segments[segments.length - 1].setAttribute('rx', '2');
      segments[segments.length - 1].setAttribute('ry', '2');
    }

    // X-axis date label
    if (i % labelInterval === 0) {
      const dateStr = entry.date;
      if (dateStr) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(x + barWidth / 2));
        text.setAttribute('y', String(chartHeight - 4));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'rgba(124, 134, 168, 0.5)');
        text.setAttribute('font-size', '9');
        text.setAttribute('font-family', 'var(--font-family)');
        text.textContent = formatDate(dateStr);
        svg.appendChild(text);
      }
    }
  });

  // Hover interactions
  const tooltip = ensureTooltip();

  const showTip = (e: MouseEvent, dayIdx: number) => {
    const entry = enrichedData[dayIdx];
    if (!entry || entry.fullTotal === 0) {
      return;
    }

    const dateStr = entry.date ? formatDate(entry.date) : `Day ${dayIdx + 1}`;

    const rows = entry.fullDist
      .map((count, ci) => {
        if (count === 0) {
          return '';
        }
        const pct = Math.round((count / entry.fullTotal) * 100);
        return `<div class="copy-tip-row">
          <span class="copy-tip-swatch" style="background:${COPY_COLORS[ci]}"></span>
          <span class="copy-tip-label">${COPY_LABELS[ci]}</span>
          <span class="copy-tip-value">${pct}%</span>
          <span class="copy-tip-count">${count} decks</span>
        </div>`;
      })
      .filter(Boolean)
      .reverse()
      .join('');

    tooltip.innerHTML = `<div class="copy-tip-date">${dateStr}</div>${rows}`;
    tooltip.style.opacity = '1';
    tooltip.style.pointerEvents = 'none';

    const tipRect = tooltip.getBoundingClientRect();
    let tipX = e.clientX + 12;
    let tipY = e.clientY - tipRect.height - 8;

    if (tipX + tipRect.width > window.innerWidth - 8) {
      tipX = e.clientX - tipRect.width - 12;
    }
    if (tipY < 8) {
      tipY = e.clientY + 16;
    }

    tooltip.style.left = `${tipX}px`;
    tooltip.style.top = `${tipY}px`;
  };

  svg.addEventListener('mousemove', (e: MouseEvent) => {
    const target = e.target as SVGElement;
    const weekIdx = target.dataset?.weekIndex;
    if (weekIdx != null) {
      svg.querySelectorAll('.copy-bar-segment').forEach(seg => {
        const el = seg as SVGElement;
        el.style.opacity = el.dataset.weekIndex === weekIdx ? '1' : '0.35';
      });
      showTip(e, Number(weekIdx));
    } else {
      svg.querySelectorAll('.copy-bar-segment').forEach(el => {
        (el as SVGElement).style.opacity = '1';
      });
      hideTooltip();
    }
  });

  svg.addEventListener('mouseleave', () => {
    svg.querySelectorAll('.copy-bar-segment').forEach(el => {
      (el as SVGElement).style.opacity = '1';
    });
    hideTooltip();
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
