/**
 * Chart and visualization functions for card page
 * @module card/charts
 */

import { escapeHtml, hideGraphTooltip, showGraphTooltip } from './ui.js';
import { prettyTournamentName } from '../utils/format.js';
import { hideSkeleton } from '../components/placeholders.js';

/**
 * Render main usage chart showing meta-share over tournaments
 * @param {HTMLElement} container - Container element for the chart
 * @param {Array} points - Array of data points with tournament and percentage info
 */
export function renderChart(container, points) {
  if (!points.length) {
    const noDataContent = document.createTextNode('No data.');
    if (container.classList.contains('showing-skeleton')) {
      hideSkeleton(container, noDataContent);
    } else {
      // Clear container without parameter reassignment
      const containerElement = container;
      while (containerElement.firstChild) {
        containerElement.removeChild(containerElement.firstChild);
      }
      containerElement.appendChild(noDataContent);
    }
    return;
  }

  // Use the container's actual width to avoid overflow; cap min/max for readability
  const containerWidth = container.getBoundingClientRect
    ? container.getBoundingClientRect().width
    : container.clientWidth || 0;
  const width = Math.max(220, Math.min(700, containerWidth || 600));
  const height = 180;
  const padding = 28;
  const xValues = points.map((_, index) => index);
  const yValues = points.map(point => point.pct || 0);
  const maxY = Math.max(10, Math.ceil(Math.max(...yValues)));
  const scaleX = index => padding + (index * (width - 2 * padding)) / Math.max(1, xValues.length - 1);
  const scaleY = yValue => height - padding - (yValue * (height - 2 * padding)) / maxY;
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${scaleX(index)},${scaleY(point.pct || 0)}`)
    .join(' ');

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  // Create axes
  const xAxis = document.createElementNS(svgNamespace, 'line');
  xAxis.setAttribute('x1', String(padding));
  xAxis.setAttribute('y1', String(height - padding));
  xAxis.setAttribute('x2', String(width - padding));
  xAxis.setAttribute('y2', String(height - padding));
  xAxis.setAttribute('stroke', '#39425f');
  svg.appendChild(xAxis);

  const yAxis = document.createElementNS(svgNamespace, 'line');
  yAxis.setAttribute('x1', String(padding));
  yAxis.setAttribute('y1', String(padding));
  yAxis.setAttribute('x2', String(padding));
  yAxis.setAttribute('y2', String(height - padding));
  yAxis.setAttribute('stroke', '#39425f');
  svg.appendChild(yAxis);

  // Add axis labels
  const yLabel = document.createElementNS(svgNamespace, 'text');
  yLabel.setAttribute('x', String(12));
  yLabel.setAttribute('y', String(padding - 8));
  yLabel.setAttribute('fill', '#a3a8b7');
  yLabel.setAttribute('font-size', '11');
  yLabel.setAttribute('font-family', 'system-ui, sans-serif');
  yLabel.textContent = 'Usage %';
  svg.appendChild(yLabel);

  // Add Y-axis tick marks and labels
  const yTicks = Math.min(4, Math.ceil(maxY / 10));
  for (let index = 0; index <= yTicks; index++) {
    const tickValue = (index * maxY) / yTicks;
    const tickY = scaleY(tickValue);

    // Tick mark
    const tick = document.createElementNS(svgNamespace, 'line');
    tick.setAttribute('x1', String(padding - 3));
    tick.setAttribute('y1', String(tickY));
    tick.setAttribute('x2', String(padding));
    tick.setAttribute('y2', String(tickY));
    tick.setAttribute('stroke', '#39425f');
    svg.appendChild(tick);

    // Tick label
    const tickLabel = document.createElementNS(svgNamespace, 'text');
    tickLabel.setAttribute('x', String(padding - 6));
    tickLabel.setAttribute('y', String(tickY + 3));
    tickLabel.setAttribute('fill', '#a3a8b7');
    tickLabel.setAttribute('font-size', '10');
    tickLabel.setAttribute('font-family', 'system-ui, sans-serif');
    tickLabel.setAttribute('text-anchor', 'end');
    tickLabel.textContent = tickValue.toFixed(0);
    svg.appendChild(tickLabel);
  }

  // X-axis label
  const xLabel = document.createElementNS(svgNamespace, 'text');
  xLabel.setAttribute('x', String((width - 2 * padding) / 2 + padding));
  xLabel.setAttribute('y', String(height - 8));
  xLabel.setAttribute('fill', '#a3a8b7');
  xLabel.setAttribute('font-size', '11');
  xLabel.setAttribute('font-family', 'system-ui, sans-serif');
  xLabel.setAttribute('text-anchor', 'middle');
  xLabel.textContent = 'Tournaments (Chronological)';
  svg.appendChild(xLabel);

  // Main line path
  const line = document.createElementNS(svgNamespace, 'path');
  line.setAttribute('d', path);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#6aa3ff');
  line.setAttribute('stroke-width', '2');
  svg.appendChild(line);

  // Add transparent grid hit area for hover interactions across entire chart area
  const gridHitArea = document.createElementNS(svgNamespace, 'rect');
  gridHitArea.setAttribute('x', String(padding));
  gridHitArea.setAttribute('y', String(padding));
  gridHitArea.setAttribute('width', String(width - 2 * padding));
  gridHitArea.setAttribute('height', String(height - 2 * padding));
  gridHitArea.setAttribute('fill', 'transparent');
  gridHitArea.setAttribute('pointer-events', 'all');
  svg.appendChild(gridHitArea);

  function onHitMove(event) {
    try {
      const rect = svg.getBoundingClientRect();
      const svgX = event.clientX - rect.left;
      const normalizedPosition = (svgX - padding) / (width - 2 * padding);
      const index = Math.round(normalizedPosition * Math.max(1, xValues.length - 1));
      const clampedIndex = Math.max(0, Math.min(xValues.length - 1, index));
      const point = points[clampedIndex];
      if (point) {
        showGraphTooltip(
          `<strong>${escapeHtml(prettyTournamentName(point.tournament))}</strong><div>${(point.pct || 0).toFixed(1)}%</div>`,
          event.clientX,
          event.clientY
        );
      }
    } catch {
      // Ignore chart interaction errors
    }
  }

  gridHitArea.addEventListener('mousemove', onHitMove);
  gridHitArea.addEventListener('mouseenter', onHitMove);
  gridHitArea.addEventListener('mouseleave', hideGraphTooltip);

  // Add data points as circles
  points.forEach((point, index) => {
    const circleX = scaleX(index);
    const circleY = scaleY(point.pct || 0);

    // Visible dot
    const dot = document.createElementNS(svgNamespace, 'circle');
    dot.setAttribute('cx', String(circleX));
    dot.setAttribute('cy', String(circleY));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#6aa3ff');
    svg.appendChild(dot);

    // Larger invisible hit target
    const hitDot = document.createElementNS(svgNamespace, 'circle');
    hitDot.setAttribute('cx', String(circleX));
    hitDot.setAttribute('cy', String(circleY));
    hitDot.setAttribute('r', '12');
    hitDot.setAttribute('fill', 'transparent');
    hitDot.setAttribute('pointer-events', 'all');

    const tooltipText = `${prettyTournamentName(point.tournament)}: ${(point.pct || 0).toFixed(1)}%`;
    hitDot.setAttribute('tabindex', '0');
    hitDot.setAttribute('role', 'img');
    hitDot.setAttribute('aria-label', tooltipText);

    hitDot.addEventListener('mousemove', event =>
      showGraphTooltip(
        `<strong>${escapeHtml(prettyTournamentName(point.tournament))}</strong><div>${(point.pct || 0).toFixed(1)}%</div>`,
        event.clientX,
        event.clientY
      )
    );
    hitDot.addEventListener('mouseenter', event =>
      showGraphTooltip(
        `<strong>${escapeHtml(prettyTournamentName(point.tournament))}</strong><div>${(point.pct || 0).toFixed(1)}%</div>`,
        event.clientX,
        event.clientY
      )
    );
    hitDot.addEventListener('mouseleave', hideGraphTooltip);
    hitDot.addEventListener('blur', hideGraphTooltip);
    svg.appendChild(hitDot);
  });

  const chartContent = document.createDocumentFragment();
  chartContent.appendChild(svg);

  if (container.classList.contains('showing-skeleton')) {
    hideSkeleton(container, chartContent);
  } else {
    // eslint-disable-next-line no-param-reassign
    container.innerHTML = '';
    container.appendChild(chartContent);
  }
}

/**
 * Render histogram showing copies distribution
 * @param {HTMLElement} container - Container element for the histogram
 * @param {object} overall - Overall distribution data with dist and total properties
 */
export function renderCopiesHistogram(container, overall) {
  const histogramContent = document.createDocumentFragment();

  const histogramElement = document.createElement('div');
  histogramElement.className = 'hist';

  const distribution = overall?.dist || [];
  const totalPlayers = overall?.total || 0;
  const maxPercentage = Math.max(
    1,
    ...distribution.map(distributionItem => {
      return totalPlayers ? (100 * (distributionItem.players || 0)) / totalPlayers : distributionItem.percent || 0;
    })
  );

  // Get all copy counts from the distribution data and sort them
  const copyCountsInData = distribution.map(item => item.copies).sort((countA, countB) => countA - countB);

  // If no distribution data, default to 1-4
  const copiesToShow = copyCountsInData.length > 0 ? copyCountsInData : [1, 2, 3, 4];

  for (const copies of copiesToShow) {
    const distributionData = distribution.find(item => item.copies === copies);
    const percentage = distributionData
      ? totalPlayers
        ? (100 * (distributionData.players || 0)) / totalPlayers
        : distributionData.percent || 0
      : 0;

    const column = document.createElement('div');
    column.className = 'col';

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${Math.max(2, Math.round(86 * (percentage / maxPercentage)))}px`;

    const label = document.createElement('div');
    label.className = 'lbl';
    label.textContent = String(copies);

    const tooltipText = distributionData
      ? `${copies}x: ${percentage.toFixed(1)}%${distributionData && totalPlayers ? ` (${distributionData.players}/${totalPlayers})` : ''}`
      : `${copies}x: 0%`;

    column.setAttribute('tabindex', '0');
    column.setAttribute('role', 'img');
    column.setAttribute('aria-label', tooltipText);
    column.addEventListener('mousemove', event =>
      showGraphTooltip(escapeHtml(tooltipText), event.clientX, event.clientY)
    );
    column.addEventListener('mouseenter', event =>
      showGraphTooltip(escapeHtml(tooltipText), event.clientX, event.clientY)
    );
    column.addEventListener('mouseleave', hideGraphTooltip);
    column.addEventListener('blur', hideGraphTooltip);

    column.appendChild(bar);
    column.appendChild(label);
    histogramElement.appendChild(column);
  }

  histogramContent.appendChild(histogramElement);

  if (container.classList.contains('showing-skeleton')) {
    hideSkeleton(container, histogramContent);
  } else {
    // eslint-disable-next-line no-param-reassign
    container.innerHTML = '';
    container.appendChild(histogramContent);
  }
}

/**
 * Render events table showing tournament usage data
 * @param {HTMLElement} container - Container element for the events table
 * @param {Array} rows - Array of tournament data rows
 */
export function renderEvents(container, rows) {
  if (!rows.length) {
    const emptyContent = document.createTextNode('No recent events data.');
    if (container.classList.contains('showing-skeleton')) {
      hideSkeleton(container, emptyContent);
    } else {
      // eslint-disable-next-line no-param-reassign
      container.innerHTML = '';
      container.appendChild(emptyContent);
    }
    return;
  }

  const table = document.createElement('table');
  table.style.width = '80%';
  table.style.marginLeft = 'auto';
  table.style.marginRight = 'auto';
  table.style.borderCollapse = 'collapse';
  table.style.background = 'var(--panel)';
  table.style.border = '1px solid #242a4a';
  table.style.borderRadius = '8px';

  const tableHead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  ['Tournament', 'Usage %'].forEach((headerText, index) => {
    const tableHeader = document.createElement('th');
    tableHeader.textContent = headerText;
    tableHeader.style.textAlign = index === 1 ? 'right' : 'left';
    tableHeader.style.padding = '11px 12px';
    tableHeader.style.borderBottom = '1px solid #2c335a';
    tableHeader.style.color = 'var(--muted)';
    headerRow.appendChild(tableHeader);
  });

  tableHead.appendChild(headerRow);
  table.appendChild(tableHead);

  const tableBody = document.createElement('tbody');
  rows.forEach(rowData => {
    const tableRow = document.createElement('tr');

    const tournamentLink = document.createElement('a');
    tournamentLink.href = `/index.html?tour=${encodeURIComponent(rowData.tournament)}`;
    tournamentLink.textContent = prettyTournamentName(rowData.tournament);

    const cellValues = [tournamentLink, rowData.pct !== null ? `${rowData.pct.toFixed(1)}%` : '—'];

    cellValues.forEach((value, index) => {
      const tableCell = document.createElement('td');
      if (value instanceof HTMLElement) {
        tableCell.appendChild(value);
      } else {
        tableCell.textContent = value;
      }
      tableCell.style.padding = '11px 12px';
      if (index === 1) {
        tableCell.style.textAlign = 'right';
      }
      tableRow.appendChild(tableCell);
    });

    tableBody.appendChild(tableRow);
  });

  table.appendChild(tableBody);

  if (container.classList.contains('showing-skeleton')) {
    hideSkeleton(container, table);
  } else {
    // eslint-disable-next-line no-param-reassign
    container.innerHTML = '';
    container.appendChild(table);
  }
}
