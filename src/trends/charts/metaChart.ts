/* eslint-disable id-length, no-param-reassign */
import { elements, state } from '../state.js';
import { buildMetaLines, formatDate, formatPercent } from '../aggregator.js';
import type { MetaLine } from '../types';
import { renderLegend, renderMovers } from './movers.js';

const formatAxisValue = (value: number) => (value % 1 === 0 ? `${value}%` : `${value.toFixed(1)}%`);

const chooseGridInterval = (span: number): number => {
  if (span > 24) {
    return 5;
  }
  if (span > 12) {
    return 2.5;
  }
  if (span > 6) {
    return 2;
  }
  if (span > 3) {
    return 1;
  }
  return 0.5;
};

export function renderMetaChart(): void {
  const metaChartEl = elements.metaChart;
  if (!metaChartEl) {
    return;
  }
  metaChartEl.innerHTML = '';
  const minApps = Math.max(state.minAppearances, state.trendData?.minAppearances || 1);
  const metaChart = buildMetaLines(state.trendData, state.chartDensity, state.timeRangeDays, minApps);
  const metaMovers =
    buildMetaLines(state.trendData, Math.max(16, state.chartDensity * 2), state.timeRangeDays, minApps) || metaChart;
  if (!metaChart || !metaChart.lines?.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Not enough data to show meta trends yet.';
    metaChartEl.appendChild(empty);
    return;
  }

  const containerRect = metaChartEl.getBoundingClientRect();
  const width = Math.max(320, Math.round(containerRect.width || 900));
  // favor a wide, shorter chart; allow shrinking height while still filling width
  const height = Math.round(Math.min(520, Math.max(260, containerRect.height || 0, width * 0.38)));
  const count = metaChart.dates.length;
  const padTop = 32;
  const padBottom = 32;

  // Dynamic Y domain based on visible data - round bounds to nearest 0.5%
  const allShares = metaChart.lines.flatMap(line =>
    line.points.map(point => {
      const value = Number(point);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    })
  );
  const maxObserved = allShares.length ? Math.max(...allShares) : 0;
  const minObserved = allShares.length ? Math.min(...allShares) : 0;
  let yMax = Math.max(1, Math.ceil(maxObserved * 2) / 2);
  let yMin = Math.floor(minObserved * 2) / 2;
  if (!Number.isFinite(yMin) || yMin < 0) {
    yMin = 0;
  }
  if (yMin >= yMax) {
    yMin = Math.max(0, yMax - 1);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${height}px`);
  svg.style.height = `${height}px`;
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  const chartLabel = `Meta share trends chart showing ${metaChart.lines.length} archetypes from ${formatDate(metaChart.dates[0])} to ${formatDate(metaChart.dates[metaChart.dates.length - 1])}`;
  svg.setAttribute('aria-label', chartLabel);
  svg.classList.add('meta-svg');

  const gridInterval = chooseGridInterval(yMax - yMin);
  yMin = Math.max(0, Math.floor(yMin / gridInterval) * gridInterval);
  yMax = Math.max(yMin + gridInterval, Math.ceil(yMax / gridInterval) * gridInterval);

  const gridLevels: number[] = [];
  for (let lvl = yMin; lvl <= yMax + 1e-6; lvl += gridInterval) {
    gridLevels.push(Number(lvl.toFixed(2)));
  }
  if (!gridLevels.length) {
    gridLevels.push(yMin, yMax);
  }

  const longestAxisLabel = gridLevels.reduce((max, level) => Math.max(max, formatAxisValue(level).length), 0);
  const padLeft = Math.max(42, Math.ceil(longestAxisLabel * 6.4 + 12));
  const padRight = 36;
  const contentWidth = Math.max(1, width - padLeft - padRight);
  const contentHeight = Math.max(1, height - padTop - padBottom);
  const yRange = yMax - yMin || 1;

  const xForIndex = (idx: number): number =>
    (count === 1 ? contentWidth / 2 : (idx / (count - 1)) * contentWidth) + padLeft;
  const yForShare = (share: number): number => {
    const value = Number.isFinite(Number(share)) ? Number(share) : 0;
    const clamped = Math.min(yMax, Math.max(yMin, value));
    const normalized = (clamped - yMin) / yRange;
    return height - padBottom - normalized * contentHeight;
  };

  gridLevels.forEach(level => {
    const y = yForShare(level);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', `${padLeft}`);
    line.setAttribute('x2', `${width - padRight}`);
    line.setAttribute('y1', `${y}`);
    line.setAttribute('y2', `${y}`);
    line.setAttribute('stroke', 'rgba(124,134,168,0.2)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${padLeft - 8}`);
    label.setAttribute('y', `${y + 4}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    label.textContent = formatAxisValue(level);
    label.setAttribute('text-anchor', 'end');
    svg.appendChild(label);
  });

  metaChart.lines.forEach(line => {
    const points = line.points.map((share, idx) => `${xForIndex(idx)},${yForShare(share)}`).join(' ');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', line.color);
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('points', points);
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.dataset.name = line.name;
    polyline.classList.add('meta-line');
    svg.appendChild(polyline);
  });

  // x-axis labels
  const labelIndices = new Set<number>();
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
    .forEach(idx => {
      const x = xForIndex(idx);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', `${x}`);
      label.setAttribute('y', `${height - 6}`);
      label.setAttribute('fill', '#7c86a8');
      label.setAttribute('font-size', '11');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = formatDate(metaChart.dates[idx]);
      svg.appendChild(label);
    });

  // Interactive Elements
  const guideLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  guideLine.setAttribute('y1', '0');
  guideLine.setAttribute('y2', String(height - padBottom));
  guideLine.setAttribute('stroke', '#7c86a8');
  guideLine.setAttribute('stroke-width', '1');
  guideLine.setAttribute('stroke-dasharray', '4 4');
  guideLine.style.opacity = '0';
  guideLine.style.pointerEvents = 'none';
  svg.appendChild(guideLine);

  const highlightDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  highlightDot.setAttribute('r', '5');
  highlightDot.setAttribute('fill', 'var(--bg)');
  highlightDot.setAttribute('stroke', 'var(--text)');
  highlightDot.setAttribute('stroke-width', '2');
  highlightDot.style.opacity = '0';
  highlightDot.style.pointerEvents = 'none';
  svg.appendChild(highlightDot);

  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  overlay.setAttribute('width', String(width));
  overlay.setAttribute('height', String(height));
  overlay.setAttribute('fill', 'transparent');
  overlay.style.cursor = 'crosshair';
  svg.appendChild(overlay);

  metaChartEl.style.position = 'relative';
  metaChartEl.appendChild(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  metaChartEl.appendChild(tooltip);

  if (elements.metaRange) {
    elements.metaRange.textContent = `Y-axis ${formatAxisValue(yMin)} – ${formatAxisValue(yMax)}`;
  }
  renderLegend(metaChart.lines);
  renderMovers(metaMovers?.lines || metaChart.lines);

  // Interaction Logic
  const lines = Array.from(metaChartEl.querySelectorAll<HTMLElement>('.meta-line'));
  const legendItems = elements.legend ? Array.from(elements.legend.querySelectorAll<HTMLElement>('.legend-item')) : [];

  const setActive = (name: string): void => {
    lines.forEach(line => {
      const active = line.dataset.name === name;
      line.style.opacity = active ? '1' : '0.25';
      line.style.strokeWidth = active ? '3.5' : '2';
    });
    legendItems.forEach(item => {
      const label = item.querySelector('span:nth-child(2)');
      const active = label && label.textContent === name;
      item.style.opacity = active ? '1' : '0.5';
      const swatch = item.querySelector<HTMLElement>('.legend-swatch');
      item.style.borderColor = active ? swatch?.style.backgroundColor || '#6aa3ff' : '#2c335a';
    });
  };

  const clearActive = (): void => {
    lines.forEach(line => {
      line.style.opacity = '1';
      line.style.strokeWidth = '2.5';
    });
    legendItems.forEach(item => {
      item.style.opacity = '1';
      item.style.borderColor = '#2c335a';
    });
    highlightDot.style.opacity = '0';
  };

  const screenToSVG = (screenX: number, screenY: number): { x: number; y: number } => {
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      return {
        x: (screenX - rect.left) * scaleX,
        y: (screenY - rect.top) * scaleY
      };
    }
    const pt = svg.createSVGPoint();
    pt.x = screenX;
    pt.y = screenY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  };

  const svgToScreen = (svgX: number, svgY: number): { x: number; y: number } => {
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width / width;
      const scaleY = rect.height / height;
      return {
        x: rect.left + svgX * scaleX,
        y: rect.top + svgY * scaleY
      };
    }
    const pt = svg.createSVGPoint();
    pt.x = svgX;
    pt.y = svgY;
    const screenPt = pt.matrixTransform(ctm);
    return { x: screenPt.x, y: screenPt.y };
  };

  let activeArchetype: string | null = null;
  overlay.setAttribute('tabindex', '0');
  overlay.setAttribute('role', 'button');
  overlay.setAttribute('aria-label', 'Explore trend lines and press Enter to open the highlighted archetype');

  const handleOverlayMove = (clientX: number, clientY: number): void => {
    const svgCoords = screenToSVG(clientX, clientY);
    const svgX = svgCoords.x;
    const svgY = svgCoords.y;

    let idx = Math.round(((svgX - padLeft) / contentWidth) * (count - 1));
    idx = Math.max(0, Math.min(count - 1, idx));

    const targetX = xForIndex(idx);
    guideLine.setAttribute('x1', String(targetX));
    guideLine.setAttribute('x2', String(targetX));
    guideLine.style.opacity = '0.5';

    const date = metaChart.dates[idx];
    const values: Array<MetaLine & { val: number }> = metaChart.lines
      .map(line => ({ ...line, val: line.points[idx] ?? 0 }))
      .sort((a, b) => b.val - a.val);

    let closest: (MetaLine & { val: number }) | null = null;
    let minDiff = Infinity;

    values.forEach(v => {
      const lineY = yForShare(v.val);
      const diff = Math.abs(lineY - svgY);
      if (diff < minDiff) {
        minDiff = diff;
        closest = v;
      }
    });

    activeArchetype = null;
    if (closest && minDiff < 50) {
      const activeLine = closest as MetaLine & { val: number };
      setActive(activeLine.name);
      activeArchetype = activeLine.name;

      const dotY = yForShare(activeLine.val);
      highlightDot.setAttribute('cx', String(targetX));
      highlightDot.setAttribute('cy', String(dotY));
      highlightDot.setAttribute('stroke', activeLine.color);
      highlightDot.style.opacity = '1';
      overlay.style.cursor = 'pointer';
    } else {
      clearActive();
      highlightDot.style.opacity = '0';
      overlay.style.cursor = 'crosshair';
    }

    tooltip.innerHTML = `
        <div class="chart-tooltip-date">${formatDate(date)}</div>
        ${values
          .map(
            v => `
            <div class="chart-tooltip-item" style="${v.name === activeArchetype ? 'font-weight:700;background:rgba(255,255,255,0.05);border-radius:4px;margin:0 -4px;padding:2px 4px;' : ''}">
                <span class="chart-tooltip-swatch" style="background: ${v.color}"></span>
                <span class="chart-tooltip-name">${v.name}</span>
                <span class="chart-tooltip-value">${formatPercent(v.val)}</span>
            </div>
        `
          )
          .join('')}
    `;

    const cRect = metaChartEl.getBoundingClientRect();
    const screenPoint = svgToScreen(targetX, 0);
    const screenTargetX = screenPoint.x - cRect.left;

    const tipRect = tooltip.getBoundingClientRect();
    const mouseY = clientY - cRect.top;

    let left = screenTargetX + 20;
    let transform = 'translate(0, -50%)';

    if (left + tipRect.width > cRect.width) {
      left = screenTargetX - 20;
      transform = 'translate(-100%, -50%)';
    }

    let top = mouseY;
    if (top < tipRect.height / 2) {
      top = tipRect.height / 2;
    }
    if (top > cRect.height - tipRect.height / 2) {
      top = cRect.height - tipRect.height / 2;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = transform;
    tooltip.classList.add('is-visible');
  };

  overlay.addEventListener('mousemove', e => {
    handleOverlayMove(e.clientX, e.clientY);
  });

  overlay.addEventListener('pointermove', e => {
    handleOverlayMove(e.clientX, e.clientY);
  });

  overlay.addEventListener('focus', () => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    handleOverlayMove(rect.left + rect.width - 6, rect.top + rect.height / 2);
  });

  overlay.addEventListener('click', () => {
    if (activeArchetype) {
      const url = `/${activeArchetype.replace(/ /g, '_')}`;
      window.location.href = url;
    }
  });

  overlay.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && activeArchetype) {
      event.preventDefault();
      const url = `/${activeArchetype.replace(/ /g, '_')}`;
      window.location.href = url;
    }
  });

  overlay.addEventListener('mouseleave', () => {
    guideLine.style.opacity = '0';
    highlightDot.style.opacity = '0';
    tooltip.classList.remove('is-visible');
    clearActive();
    activeArchetype = null;
  });
  overlay.addEventListener('pointerleave', () => {
    guideLine.style.opacity = '0';
    highlightDot.style.opacity = '0';
    tooltip.classList.remove('is-visible');
    clearActive();
    activeArchetype = null;
  });

  legendItems.forEach(item => {
    const label = item.querySelector('span:nth-child(2)');
    const name = label?.textContent;
    if (!name) {
      return;
    }
    (item as HTMLElement).setAttribute('tabindex', '0');
    (item as HTMLElement).setAttribute('role', 'button');
    (item as HTMLElement).setAttribute('aria-label', `Highlight ${name} trend line`);
    item.addEventListener('mouseenter', () => setActive(name));
    item.addEventListener('mouseleave', clearActive);
    item.addEventListener('focus', () => setActive(name));
    item.addEventListener('blur', clearActive);
  });
}
