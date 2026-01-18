import { PALETTE } from '../constants.js';
import { getState } from '../state.js';
import type { CardTimelineWeek, ChartLine, DayEntry, WeekEntry } from '../types.js';
import { elements } from '../ui/elements.js';
import { formatDate, formatPercent } from '../utils/format.js';

export function renderChart(): void {
  const state = getState();
  if (!elements.chart || !state.trendsData) {
    return;
  }

  const { weeks, days, cards } = state.trendsData;
  const tier = state.selectedTier;
  const isDaily = state.timeScale === 'daily';

  if (!days || days.length === 0) {
    return;
  }

  elements.chart.innerHTML = '';

  const timeData = isDaily ? days : weeks;
  if (!timeData || timeData.length === 0) {
    return;
  }

  const lines: ChartLine[] = Array.from(state.selectedCards)
    .map(uid => cards[uid])
    .filter(Boolean)
    .map((card, idx) => {
      let points: ChartLine['points'];

      if (isDaily) {
        points = days.map((entry, index) => {
          const entryData: CardTimelineWeek | undefined = card.timeline[index]?.[tier];
          const totalDecks = entry.totals[tier] || entry.totals.all || 1;
          const count = entryData ? entryData.count : 0;

          return {
            index,
            date: entry.date,
            share: (count / totalDecks) * 100,
            count,
            total: totalDecks
          };
        });
      } else {
        points = weeks.map((weekEntry, weekIdx) => {
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

          return {
            index: weekIdx,
            date: weekEntry.weekStart,
            share: totalDecks > 0 ? (totalCount / totalDecks) * 100 : 0,
            count: totalCount,
            total: totalDecks
          };
        });
      }

      return {
        card,
        color: PALETTE[idx % PALETTE.length],
        points
      };
    });

  state.chartLines = lines;

  if (lines.length === 0) {
    if (elements.chartSubtitle) {
      elements.chartSubtitle.textContent = 'Select cards from the list below to chart their playrate';
    }
    if (elements.chartLegend) {
      elements.chartLegend.innerHTML = '';
    }
    if (elements.chartSummary) {
      elements.chartSummary.hidden = true;
    }
    return;
  }

  if (elements.chartSubtitle) {
    elements.chartSubtitle.textContent = `Showing ${lines.length} card${lines.length === 1 ? '' : 's'} (${isDaily ? 'Daily' : 'Weekly'})`;
  }

  const containerRect = elements.chart.getBoundingClientRect();
  const width = Math.max(320, Math.round(containerRect.width || 800));
  const height = Math.min(400, Math.max(260, width * 0.4));
  const padX = 48;
  const padY = 32;
  const contentWidth = width - padX * 2;
  const contentHeight = height - padY * 2;
  const maxShare = 100;

  const xScale = (idx: number) => padX + (idx / (timeData.length - 1)) * contentWidth;
  const yScale = (share: number) => height - padY - (share / maxShare) * contentHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${height}px`);
  (svg as SVGSVGElement & { style: CSSStyleDeclaration }).style.height = `${height}px`;
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('trends-svg-v2');
  svg.setAttribute('role', 'img');

  const gridLevels = [0, 20, 40, 60, 80, 100];

  gridLevels.forEach(level => {
    const y = yScale(level);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(padX));
    line.setAttribute('x2', String(width - padX));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'rgba(124,134,168,0.2)');
    line.setAttribute('stroke-width', '1');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(padX - 10));
    text.setAttribute('y', String(y + 4));
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('fill', '#7c86a8');
    text.setAttribute('font-size', '11');
    text.textContent = `${level}%`;

    svg.appendChild(line);
    svg.appendChild(text);
  });

  lines.forEach(line => {
    const points = line.points.map(p => `${xScale(p.index)},${yScale(p.share)}`).join(' ');

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', line.color);
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('points', points);
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('data-name', line.card.name);
    polyline.classList.add('trends-line');
    svg.appendChild(polyline);
  });

  const labelIndices = new Set<number>();
  const count = timeData.length;

  if (count <= 4) {
    for (let i = 0; i < count; i += 1) {
      labelIndices.add(i);
    }
  } else {
    labelIndices.add(0);
    labelIndices.add(count - 1);
    const segment = (count - 1) / 3;
    labelIndices.add(Math.max(1, Math.round(segment)));
    labelIndices.add(Math.min(count - 2, Math.round(segment * 2)));
  }

  Array.from(labelIndices)
    .sort((a, b) => a - b)
    .forEach(i => {
      const dateStr = isDaily ? (timeData[i] as DayEntry).date : (timeData[i] as WeekEntry).weekStart;

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(xScale(i)));
      text.setAttribute('y', String(height - 6));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#7c86a8');
      text.setAttribute('font-size', '11');
      text.textContent = formatDate(dateStr);
      svg.appendChild(text);
    });

  elements.chart.appendChild(svg);
  if (elements.chartContainer) {
    elements.chartContainer.hidden = false;
  }

  renderLegend();
  renderChartSummary();
}

export function renderLegend(): void {
  const state = getState();
  if (!elements.chartLegend || !state.chartLines) {
    return;
  }
  elements.chartLegend.innerHTML = '';

  if (state.chartLines.length === 0) {
    elements.chartLegend.innerHTML = '<span class="chart-empty-hint">Select cards below to compare trends</span>';
    return;
  }

  state.chartLines.forEach(line => {
    const change = line.card.playrateChange;
    const deltaClass = change > 0 ? 'up' : change < 0 ? 'down' : '';
    const changeSign = change > 0 ? '+' : '';

    const div = document.createElement('div');
    div.className = 'legend-item-v2';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = line.color;

    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = line.card.name;

    const value = document.createElement('span');
    value.className = 'legend-value';
    value.innerHTML = `${formatPercent(line.card.currentPlayrate)} <span class="legend-delta ${deltaClass}">(${changeSign}${change.toFixed(Math.abs(change) % 1 === 0 ? 0 : 1)}%)</span>`;

    div.appendChild(swatch);
    div.appendChild(name);
    div.appendChild(value);
    elements.chartLegend?.appendChild(div);
  });
}

export function renderChartSummary(): void {
  const state = getState();
  if (!elements.chartSummary || !state.chartLines || state.chartLines.length === 0) {
    if (elements.chartSummary) {
      elements.chartSummary.hidden = true;
    }
    return;
  }

  const lines = state.chartLines;
  const cardsCount = lines.length;
  const avgPlayrate = lines.reduce((sum, l) => sum + l.card.currentPlayrate, 0) / cardsCount;

  let peakShare = 0;
  let peakCard = '';
  lines.forEach(line => {
    line.points.forEach(p => {
      if (p.share > peakShare) {
        peakShare = p.share;
        peakCard = line.card.name;
      }
    });
  });

  let firstHalfSum = 0;
  let firstHalfCount = 0;
  let secondHalfSum = 0;
  let secondHalfCount = 0;

  lines.forEach(line => {
    const midpoint = Math.floor(line.points.length / 2);
    line.points.forEach((p, idx) => {
      if (idx < midpoint) {
        firstHalfSum += p.share;
        firstHalfCount++;
      } else {
        secondHalfSum += p.share;
        secondHalfCount++;
      }
    });
  });

  const firstHalfAvg = firstHalfCount > 0 ? firstHalfSum / firstHalfCount : 0;
  const secondHalfAvg = secondHalfCount > 0 ? secondHalfSum / secondHalfCount : 0;
  const trendDelta = secondHalfAvg - firstHalfAvg;

  if (elements.summaryCardsCount) {
    elements.summaryCardsCount.textContent = String(cardsCount);
  }
  if (elements.summaryAvgPlayrate) {
    elements.summaryAvgPlayrate.textContent = formatPercent(avgPlayrate);
  }
  if (elements.summaryPeak) {
    elements.summaryPeak.textContent = formatPercent(peakShare);
    elements.summaryPeak.title = `Peak: ${peakCard}`;
  }
  if (elements.summaryTrend) {
    const trendIcon = trendDelta > 1 ? '^' : trendDelta < -1 ? 'v' : '>';
    const trendClass =
      trendDelta > 1 ? 'chart-summary-value--success' : trendDelta < -1 ? 'chart-summary-value--error' : '';

    elements.summaryTrend.textContent = trendIcon;
    elements.summaryTrend.className = `chart-summary-value ${trendClass}`;
    elements.summaryTrend.title = `${trendDelta > 0 ? '+' : ''}${trendDelta.toFixed(1)}% change`;
  }

  elements.chartSummary.hidden = false;
}
