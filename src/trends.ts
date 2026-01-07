// @ts-nocheck
// TODO: Enable strict type checking after migrating complex type definitions
/* eslint-disable id-length, no-param-reassign, no-unused-vars */
import './utils/buildVersion.js';
import { fetchTrendReport } from './api.js';
import { fetchAllDecks } from './utils/clientSideFiltering.js';
import {
  buildCardTrendDataset,
  buildTrendDataset,
  type CardTrendDataset,
  type TrendDataset
} from './utils/trendAggregator.js';
import { logger } from './utils/logger.js';
import { escapeHtml } from './utils/html.js';
import { getPerformanceLabel } from './data/performanceTiers.js';

// High-contrast palette with distinct hues - designed for dark backgrounds
const palette = [
  '#3b82f6', // bright blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber/orange
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#eab308', // yellow
  '#14b8a6', // teal
  '#f97316', // orange
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f43f5e', // rose
  '#0ea5e9', // sky blue
  '#d946ef', // fuchsia
  '#84cc16' // lime
];
const TRENDS_SOURCE = 'Trends - Last 30 Days';

const elements = {
  list: document.getElementById('trends-list'),
  loadingMeta: document.getElementById('trends-loading'),
  loadingArch: document.getElementById('trends-loading-arch'),
  summary: document.getElementById('trend-summary'),
  minSlider: document.getElementById('trend-min-tournaments') as HTMLInputElement | null,
  minValue: document.getElementById('trend-min-value'),
  status: document.getElementById('trend-status'),
  refresh: document.getElementById('trend-refresh'),
  metaChart: document.getElementById('trend-meta-chart'),
  metaPanel: document.getElementById('trend-meta'),
  archetypePanel: document.getElementById('trend-archetypes'),
  legend: document.getElementById('trend-legend'),
  metaRange: document.getElementById('trend-meta-range'),
  movers: document.getElementById('trend-movers'),
  cardMovers: document.getElementById('trend-card-movers'),
  modeMeta: document.getElementById('trend-mode-meta'),
  modeArchetypes: document.getElementById('trend-mode-archetypes'),
  performanceFilter: document.getElementById('trend-performance-filter') as HTMLSelectElement | null,
  densityFilter: document.getElementById('trend-density-filter') as HTMLSelectElement | null,
  timeFilter: document.getElementById('trend-time-filter') as HTMLSelectElement | null
};

interface TrendsState {
  trendData: TrendDataset | null;
  cardTrends: CardTrendDataset | null;
  rawDecks: unknown[] | null;
  rawTournaments: unknown[] | null;
  isLoading: boolean;
  isHydrating: boolean;
  minAppearances: number;
  mode: string;
  performanceFilter: string;
  chartDensity: number;
  timeRangeDays: number;
  resizeTimer: number | null;
}

const state: TrendsState = {
  trendData: null,
  cardTrends: null,
  rawDecks: null,
  rawTournaments: null,
  isLoading: false,
  isHydrating: false,
  minAppearances: 3,
  mode: 'meta',
  performanceFilter: 'all',
  chartDensity: 6,
  timeRangeDays: 14,
  resizeTimer: null
};

function setStatus(message) {
  if (elements.status) {
    elements.status.textContent = message || '';
    // Ensure status updates are announced to screen readers
    if (!elements.status.hasAttribute('role')) {
      elements.status.setAttribute('role', 'status');
      elements.status.setAttribute('aria-live', 'polite');
    }
  }
}

function setLoadingMeta(isLoading) {
  if (!elements.loadingMeta) {
    return;
  }
  elements.loadingMeta.style.display = isLoading ? 'block' : 'none';
}

function setLoadingArchetypes(isLoading) {
  if (!elements.loadingArch) {
    return;
  }
  elements.loadingArch.style.display = isLoading ? 'block' : 'none';
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  setLoadingMeta(isLoading);
  setLoadingArchetypes(isLoading);
}

function formatDate(value) {
  if (!value) {
    return 'unknown date';
  }
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPercent(value) {
  const pct = Math.round(value * 10) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function smoothSeries(series, window = 3) {
  if (!Array.isArray(series) || series.length === 0) {
    return series;
  }
  const w = Math.max(1, window);
  const result: Array<{ date: string; share: number }> = [];
  for (let i = 0; i < series.length; i += 1) {
    const slice = series.slice(Math.max(0, i - Math.floor(w / 2)), Math.min(series.length, i + Math.ceil(w / 2) + 1));
    const avg = slice.reduce((sum, point) => sum + (point.share || 0), 0) / slice.length;
    result.push({ ...series[i], share: avg });
  }
  return result;
}

function binDaily(timeline) {
  const byDay = new Map();
  (timeline || []).forEach(point => {
    if (!point?.date) {
      return;
    }
    const day = point.date.split('T')[0];
    const total = Number(point.totalDecks || point.total || 0);
    const share = Number(point.share) || 0;
    if (!byDay.has(day)) {
      byDay.set(day, { weighted: 0, decks: 0 });
    }
    const entry = byDay.get(day);
    entry.weighted += share * (total || 1);
    entry.decks += total || 1;
  });
  return Array.from(byDay.entries())
    .map(([date, val]) => ({
      date,
      share: val.decks ? val.weighted / val.decks : 0
    }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function buildMetaLines(trendData, topN = 8, timeRangeDays = 30) {
  if (!trendData || !Array.isArray(trendData.series)) {
    return null;
  }

  // Calculate cutoff date for time filtering
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - timeRangeDays * 24 * 60 * 60 * 1000);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  // OPTIMIZATION: Single pass to compute bins, collect dates, and calculate ranking data
  // Previously: 3 separate passes over series data
  const allDatesSet = new Set<string>();
  const allSeriesWithBins: Array<{
    displayName?: string;
    base: string;
    daily: Array<{ date: string; share: number }>;
    dailyByDate: Map<string, { date: string; share: number }>;
    startAvg: number;
    endAvg: number;
  }> = [];

  for (const entry of trendData.series) {
    const daily = binDaily(entry.timeline || []);
    // Filter by time range
    const filteredDaily = daily.filter(pt => pt.date >= cutoffDateStr);
    const smoothed = smoothSeries(filteredDaily, 3);

    if (smoothed.length === 0) {
      continue;
    }

    // Collect dates in the same pass
    for (const pt of smoothed) {
      if (pt.date) {
        allDatesSet.add(pt.date);
      }
    }

    // Pre-build Map for O(1) lookups later (instead of O(n) .find() calls)
    const dailyByDate = new Map(smoothed.map(pt => [pt.date, pt]));

    allSeriesWithBins.push({
      ...entry,
      daily: smoothed,
      dailyByDate,
      startAvg: 0, // Will be calculated after we know the date windows
      endAvg: 0
    });
  }

  // Get all unique dates sorted
  const allDates = Array.from(allDatesSet)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  if (!allDates.length) {
    return null;
  }

  // Calculate start and end date windows
  const windowSize = Math.max(1, Math.ceil(allDates.length * 0.3));
  const startDates = new Set(allDates.slice(0, windowSize));
  const endDates = new Set(allDates.slice(-windowSize));

  // OPTIMIZATION: Calculate ranking data using cached dailyByDate Map
  // Single pass with O(1) lookups instead of O(n) filter operations
  for (const entry of allSeriesWithBins) {
    let startSum = 0;
    let startCount = 0;
    let endSum = 0;
    let endCount = 0;

    for (const pt of entry.daily) {
      const share = pt.share || 0;
      if (startDates.has(pt.date)) {
        startSum += share;
        startCount++;
      }
      if (endDates.has(pt.date)) {
        endSum += share;
        endCount++;
      }
    }

    entry.startAvg = startCount ? startSum / startCount : 0;
    entry.endAvg = endCount ? endSum / endCount : 0;
  }

  // Get top N by start average (beginning of period)
  const topByStart = [...allSeriesWithBins].sort((a, b) => b.startAvg - a.startAvg).slice(0, topN);

  // Get top N by end average (end of period)
  const topByEnd = [...allSeriesWithBins].sort((a, b) => b.endAvg - a.endAvg).slice(0, topN);

  // Combine both sets (union), preserving order: start decks first, then new end decks
  const selectedNames = new Set<string>();
  const selectedSeries: typeof allSeriesWithBins = [];

  // Add top-at-start decks first
  for (const entry of topByStart) {
    const name = entry.displayName || entry.base;
    if (!selectedNames.has(name)) {
      selectedNames.add(name);
      selectedSeries.push(entry);
    }
  }

  // Add top-at-end decks that aren't already included
  for (const entry of topByEnd) {
    const name = entry.displayName || entry.base;
    if (!selectedNames.has(name)) {
      selectedNames.add(name);
      selectedSeries.push(entry);
    }
  }

  if (!selectedSeries.length) {
    return null;
  }

  // OPTIMIZATION: Build timeline dates from selected series only
  // Collect dates and assign colors in single pass
  const timelineDatesSet = new Set<string>();
  for (const entry of selectedSeries) {
    for (const pt of entry.daily) {
      if (pt.date) {
        timelineDatesSet.add(pt.date);
      }
    }
  }

  const timelineDates = Array.from(timelineDatesSet).sort((a, b) => Date.parse(a) - Date.parse(b));

  // OPTIMIZATION: Build lines using pre-computed dailyByDate Map
  // O(1) per date lookup instead of O(n) .find() calls
  const lines = selectedSeries.map((entry, index) => {
    const color = palette[index % palette.length];
    const points = timelineDates.map(d => entry.dailyByDate.get(d)?.share ?? 0);
    const delta = Math.round((entry.endAvg - entry.startAvg) * 10) / 10;
    return {
      name: entry.displayName || entry.base,
      color,
      points,
      latest: points.at(-1) || 0,
      delta
    };
  });

  return { dates: timelineDates, lines };
}

function findMovers(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    return { rising: [], falling: [] };
  }
  const sorted = [...lines].filter(line => line.name !== 'Other');
  sorted.sort((a, b) => b.delta - a.delta);
  return {
    rising: sorted.slice(0, 3),
    falling: [...sorted].sort((a, b) => a.delta - b.delta).slice(0, 3)
  };
}

function renderLegend(lines) {
  if (!elements.legend) {
    return;
  }
  elements.legend.innerHTML = '';
  if (!lines || !lines.length) {
    return;
  }
  lines.forEach(line => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = line.color;
    const label = document.createElement('span');
    label.className = 'legend-name';
    label.textContent = line.name;
    const value = document.createElement('span');
    value.className = 'legend-value';
    const sign = line.delta > 0 ? '+' : '';
    const deltaClass = line.delta > 0 ? 'up' : line.delta < 0 ? 'down' : '';
    value.innerHTML = `${formatPercent(line.latest)} <span class="legend-delta ${deltaClass}">(${sign}${line.delta.toFixed(Math.abs(line.delta) % 1 === 0 ? 0 : 1)}%)</span>`;
    item.appendChild(swatch);
    item.appendChild(label);
    item.appendChild(value);
    elements.legend.appendChild(item);
  });
}

function renderMovers(lines) {
  if (!elements.movers) {
    return;
  }
  elements.movers.innerHTML = '';
  if (!lines || !lines.length) {
    return;
  }
  const { rising, falling } = findMovers(lines);
  const buildGroup = (title, items, direction) => {
    const group = document.createElement('div');
    group.className = 'movers-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    group.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No changes yet.';
      group.appendChild(empty);
      return group;
    }
    const list = document.createElement('ul');
    list.className = 'movers-list';
    items.forEach(item => {
      const li = document.createElement('li');
      const sign = item.delta > 0 ? '+' : '';
      const url = `/${item.name.replace(/ /g, '_')}`;
      li.innerHTML = `
        <a href="${url}">
          <span class="dot" style="background:${item.color}"></span>
          <span class="name">${escapeHtml(item.name)}</span>
          <span class="perc">${formatPercent(item.latest)}</span>
          <span class="delta ${direction}">${sign}${item.delta.toFixed(Math.abs(item.delta) % 1 === 0 ? 0 : 1)}%</span>
        </a>
      `;
      list.appendChild(li);
    });
    group.appendChild(list);
    return group;
  };

  elements.movers.appendChild(buildGroup('Rising', rising, 'up'));
  elements.movers.appendChild(buildGroup('Cooling', falling, 'down'));
}

function renderCardMovers(cardTrends) {
  if (!elements.cardMovers) {
    return;
  }
  elements.cardMovers.innerHTML = '';
  const risingList = cardTrends?.rising || [];
  const fallingList = cardTrends?.falling || [];

  if (!risingList.length && !fallingList.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Card movement will appear once enough tournaments are available.';
    elements.cardMovers.appendChild(empty);
    return;
  }
  const normalizeCard = item => {
    const latest =
      item.recentAvg ?? item.latest ?? item.currentShare ?? item.endShare ?? item.startShare ?? item.avgShare ?? 0;
    // For cooling cards, use absDrop (positive value for decline) but negate it for display
    // For rising cards, use deltaAbs or delta
    let delta = 0;
    if (item.absDrop !== undefined && item.absDrop !== null) {
      // Cooling card - absDrop is positive, but we want to show it as negative
      delta = -Math.abs(item.absDrop);
    } else {
      // Rising card
      delta = item.deltaAbs ?? item.delta ?? 0;
    }
    return {
      name: item.name,
      set: item.set || null,
      number: item.number || null,
      archetype: item.archetype || null,
      latest,
      delta
    };
  };

  const buildGroup = (title, list, direction) => {
    const group = document.createElement('div');
    group.className = 'movers-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    group.appendChild(heading);
    const items = Array.isArray(list) ? list.slice(0, 6) : [];
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No data yet.';
      group.appendChild(empty);
      return group;
    }
    const ul = document.createElement('ul');
    ul.className = 'movers-list';
    items.forEach(raw => {
      const item = normalizeCard(raw);
      const li = document.createElement('li');
      const deltaSign = item.delta > 0 ? '+' : '';
      const idLabel = item.set && item.number ? ` (${item.set} ${item.number})` : '';
      let url = `/cards?card=${encodeURIComponent(item.name)}`;
      if (item.set && item.number) {
        url = `/card/${item.set}~${item.number}`;
      }
      li.innerHTML = `
        <a href="${url}">
          <span class="dot"></span>
          <span class="name">${escapeHtml(item.name)}${escapeHtml(idLabel)}</span>
          <span class="perc">${formatPercent(item.latest || 0)}</span>
          <span class="delta ${direction}">${deltaSign}${item.delta?.toFixed(Math.abs(item.delta) % 1 === 0 ? 0 : 1)}%</span>
        </a>
      `;
      ul.appendChild(li);
    });
    group.appendChild(ul);
    return group;
  };

  elements.cardMovers.appendChild(buildGroup('Cards rising', risingList, 'up'));
  elements.cardMovers.appendChild(buildGroup('Cards cooling', fallingList, 'down'));
}
function deriveTournamentsFromDecks(decks) {
  const map = new Map();
  (Array.isArray(decks) ? decks : []).forEach(deck => {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId) {
      return;
    }
    if (!map.has(tournamentId)) {
      map.set(tournamentId, {
        id: tournamentId,
        name: deck?.tournamentName || 'Unknown Tournament',
        date: deck?.tournamentDate || null,
        players: deck?.tournamentPlayers || null,
        format: deck?.tournamentFormat || null,
        platform: deck?.tournamentPlatform || null,
        organizer: deck?.tournamentOrganizer || null
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
}

function renderSummary() {
  if (!elements.summary || !state.trendData) {
    return;
  }
  const archetypes = state.trendData.series?.length || 0;
  const tournaments = state.trendData.tournamentCount || 0;
  const lastUpdated = state.trendData.generatedAt ? new Date(state.trendData.generatedAt).toLocaleString() : 'n/a';
  const firstDate = state.trendData.windowStart;
  const lastDate = state.trendData.windowEnd;
  const windowLabel = firstDate && lastDate ? `${formatDate(firstDate)} - ${formatDate(lastDate)}` : 'recent events';

  elements.summary.textContent = `Tracking ${archetypes} archetypes across ${tournaments} tournaments (${windowLabel}). Last updated ${lastUpdated}.`;
}

function updateMinSliderBounds() {
  const { minSlider } = elements;
  const { minValue } = elements;

  if (!minSlider || !minValue) {
    return;
  }
  const tournamentCount = state.trendData?.tournamentCount || Number(minSlider.max) || 8;
  const requiredMin = Math.max(1, Math.floor(tournamentCount / 2));
  const max = Math.max(requiredMin, tournamentCount);
  state.minAppearances = requiredMin;
  minSlider.max = String(max);
  minSlider.value = String(requiredMin);
  minSlider.disabled = true;
  minValue.textContent = `${requiredMin}+ (auto)`;
}

function buildSparkline(timeline) {
  const width = 220;
  const height = 56;
  const stroke = '#3b5bdb';
  const fill = 'rgba(59, 91, 219, 0.1)';
  const shares = timeline.map(entry => entry.share || 0);
  const maxShare = Math.max(...shares, 1);
  const count = timeline.length;

  const points = timeline.map((entry, index) => {
    const x = count === 1 ? width / 2 : (index / (count - 1)) * width;
    const y = height - (entry.share / maxShare) * height;
    return `${x},${y}`;
  });

  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(' ');

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="${fill}" stroke="none" points="${areaPoints}"></polyline>
      <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${points.join(' ')}"></polyline>
    </svg>
  `;
}

function renderSeriesCard(series) {
  const card = document.createElement('article');
  card.className = 'trend-card';

  const header = document.createElement('header');
  header.className = 'trend-card__header';

  const title = document.createElement('h3');
  const link = document.createElement('a');
  link.href = `/${(series.displayName || series.base).replace(/ /g, '_')}`;
  link.textContent = series.displayName || series.base;
  title.appendChild(link);
  header.appendChild(title);

  const stats = document.createElement('div');
  stats.className = 'trend-card__stats';
  const appearances = document.createElement('div');
  appearances.className = 'trend-card__stat';
  appearances.textContent = `${series.appearances} tournaments`;

  const avg = document.createElement('div');
  avg.className = 'trend-card__stat';
  avg.textContent = `Avg share ${formatPercent(series.avgShare)}`;

  const peak = document.createElement('div');
  peak.className = 'trend-card__stat';
  peak.textContent = `Peak share ${formatPercent(series.peakShare || series.maxShare)}`;

  const delta = document.createElement('div');
  delta.className = 'trend-card__stat';
  const firstShare = series.timeline[0]?.share || 0;
  const latestShare = series.timeline[series.timeline.length - 1]?.share || 0;
  const change = Math.round((latestShare - firstShare) * 10) / 10;
  const sign = change > 0 ? '+' : '';
  delta.textContent = `Change ${sign}${change.toFixed(Math.abs(change) % 1 === 0 ? 0 : 1)}%`;

  stats.appendChild(appearances);
  stats.appendChild(avg);
  stats.appendChild(peak);
  stats.appendChild(delta);

  const chart = document.createElement('div');
  chart.className = 'trend-card__chart';
  chart.innerHTML = buildSparkline(series.timeline);

  const timelineLabel = document.createElement('div');
  timelineLabel.className = 'trend-card__timeline';
  const firstLabel = series.timeline[0] ? formatDate(series.timeline[0].date) : '';
  const lastLabel = series.timeline[series.timeline.length - 1]
    ? formatDate(series.timeline[series.timeline.length - 1].date)
    : '';
  timelineLabel.textContent = `${firstLabel} -> ${lastLabel}`;

  card.appendChild(header);
  card.appendChild(stats);
  card.appendChild(chart);
  card.appendChild(timelineLabel);

  return card;
}

function renderMetaChart() {
  if (!elements.metaChart) {
    return;
  }
  elements.metaChart.innerHTML = '';
  const metaChart = buildMetaLines(state.trendData, state.chartDensity, state.timeRangeDays);
  const metaMovers =
    buildMetaLines(state.trendData, Math.max(16, state.chartDensity * 2), state.timeRangeDays) || metaChart;
  if (!metaChart || !metaChart.lines?.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Not enough data to show meta trends yet.';
    elements.metaChart.appendChild(empty);
    return;
  }

  const containerRect = elements.metaChart.getBoundingClientRect();
  const width = Math.max(320, Math.round(containerRect.width || 900));
  // favor a wide, shorter chart; allow shrinking height while still filling width
  const height = Math.round(Math.min(520, Math.max(260, containerRect.height || 0, width * 0.38)));
  const padX = 36;
  const padY = 32;
  const contentWidth = width - padX * 2;
  const contentHeight = height - padY * 2;
  const count = metaChart.dates.length;

  // Dynamic Y domain based on visible data - round bounds to nearest 0.5%
  const allShares = metaChart.lines.flatMap(line =>
    line.points.map(point => {
      const value = Number(point);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    })
  );
  const maxObserved = allShares.length ? Math.max(...allShares) : 0;
  const minObserved = allShares.length ? Math.min(...allShares) : 0;
  const yMax = Math.max(1, Math.ceil(maxObserved * 2) / 2); // Round up to nearest 0.5
  let yMin = Math.floor(minObserved * 2) / 2; // Round down to nearest 0.5
  if (!Number.isFinite(yMin) || yMin < 0) {
    yMin = 0;
  }
  if (yMin >= yMax) {
    yMin = Math.max(0, yMax - 1);
  }
  const yRange = yMax - yMin || 1;

  const xForIndex = idx => (count === 1 ? contentWidth / 2 : (idx / (count - 1)) * contentWidth) + padX;
  const yForShare = share => {
    const value = Number.isFinite(Number(share)) ? Number(share) : 0;
    const clamped = Math.min(yMax, Math.max(yMin, value));
    const normalized = (clamped - yMin) / yRange;
    return height - padY - normalized * contentHeight;
  };

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${height}px`);
  svg.style.height = `${height}px`;
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  // Add accessible description for the chart
  const chartLabel = `Meta share trends chart showing ${metaChart.lines.length} archetypes from ${formatDate(metaChart.dates[0])} to ${formatDate(metaChart.dates[metaChart.dates.length - 1])}`;
  svg.setAttribute('aria-label', chartLabel);
  svg.classList.add('meta-svg');

  // grid lines based on yMax - choose appropriate interval
  const gridLevels: number[] = [];
  // Choose grid interval based on span: aim for 3-6 grid lines
  const span = yMax - yMin;
  let gridInterval = 0.5;
  if (span > 20) {
    gridInterval = 5;
  } else if (span > 10) {
    gridInterval = 2.5;
  } else if (span > 5) {
    gridInterval = 2;
  } else if (span > 2) {
    gridInterval = 1;
  }

  for (let lvl = yMin; lvl <= yMax + 1e-6; lvl += gridInterval) {
    gridLevels.push(Number(lvl.toFixed(2)));
  }
  if (!gridLevels.includes(Number(yMax.toFixed(2)))) {
    gridLevels.push(Number(yMax.toFixed(2)));
  }
  if (!gridLevels.includes(Number(yMin.toFixed(2)))) {
    gridLevels.push(Number(yMin.toFixed(2)));
  }
  gridLevels.sort((a, b) => a - b);

  gridLevels.forEach(level => {
    const y = yForShare(level);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', `${padX}`);
    line.setAttribute('x2', `${width - padX}`);
    line.setAttribute('y1', `${y}`);
    line.setAttribute('y2', `${y}`);
    line.setAttribute('stroke', 'rgba(124,134,168,0.2)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${padX - 10}`);
    label.setAttribute('y', `${y + 4}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    // Format label: show decimal only if needed
    const labelText = level % 1 === 0 ? `${level}%` : `${level.toFixed(1)}%`;
    label.textContent = labelText;
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

  // x-axis labels (dates) — always show the first/last day plus two evenly spaced midpoints
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
  guideLine.setAttribute('y2', String(height - padY));
  guideLine.setAttribute('stroke', '#7c86a8');
  guideLine.setAttribute('stroke-width', '1');
  guideLine.setAttribute('stroke-dasharray', '4 4');
  guideLine.style.opacity = '0';
  guideLine.style.pointerEvents = 'none';
  svg.appendChild(guideLine);

  // Highlight dot
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

  elements.metaChart.style.position = 'relative';
  elements.metaChart.appendChild(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  elements.metaChart.appendChild(tooltip);

  if (elements.metaRange) {
    const formatAxisValue = (value: number) => (value % 1 === 0 ? `${value}%` : `${value.toFixed(1)}%`);
    elements.metaRange.textContent = `Y-axis ${formatAxisValue(yMin)} – ${formatAxisValue(yMax)}`;
  }
  renderLegend(metaChart.lines);
  renderMovers(metaMovers?.lines || metaChart.lines);

  // Interaction Logic
  const lines = Array.from(elements.metaChart.querySelectorAll<HTMLElement>('.meta-line'));
  const legendItems = elements.legend ? Array.from(elements.legend.querySelectorAll<HTMLElement>('.legend-item')) : [];

  const setActive = name => {
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

  const clearActive = () => {
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

  // Helper to convert screen coordinates to SVG coordinates
  // This properly handles SVG scaling, aspect ratio, and any transforms
  const screenToSVG = (screenX: number, screenY: number): { x: number; y: number } => {
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      // Fallback: simple bounding box calculation
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

  // Helper to convert SVG coordinates to screen coordinates (for tooltip positioning)
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

  let activeArchetype = null;

  overlay.addEventListener('mousemove', e => {
    // Convert screen coordinates to SVG coordinates using proper transform matrix
    const svgCoords = screenToSVG(e.clientX, e.clientY);
    const svgX = svgCoords.x;
    const svgY = svgCoords.y;

    // Calculate index from SVG X coordinate
    let idx = Math.round(((svgX - padX) / contentWidth) * (count - 1));
    idx = Math.max(0, Math.min(count - 1, idx));

    const targetX = xForIndex(idx);
    guideLine.setAttribute('x1', String(targetX));
    guideLine.setAttribute('x2', String(targetX));
    guideLine.style.opacity = '0.5';

    const date = metaChart.dates[idx];
    const values = metaChart.lines.map(line => ({ ...line, val: line.points[idx] })).sort((a, b) => b.val - a.val);

    // Find closest line using SVG Y coordinate
    let closest = null;
    let minDiff = Infinity;

    values.forEach(v => {
      const lineY = yForShare(v.val);
      const diff = Math.abs(lineY - svgY);
      if (diff < minDiff) {
        minDiff = diff;
        closest = v;
      }
    });

    // Highlight closest if within range (50 SVG units)
    activeArchetype = null;
    if (closest && minDiff < 50) {
      setActive(closest.name);
      activeArchetype = closest.name;

      // Move dot
      const dotY = yForShare(closest.val);
      highlightDot.setAttribute('cx', String(targetX));
      highlightDot.setAttribute('cy', String(dotY));
      highlightDot.setAttribute('stroke', closest.color);
      highlightDot.style.opacity = '1';
      overlay.style.cursor = 'pointer';
    } else {
      clearActive();
      // Keep guide line but hide dot
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

    // Position tooltip using proper SVG-to-screen conversion
    const containerRect = elements.metaChart.getBoundingClientRect();
    const screenPoint = svgToScreen(targetX, 0);
    const screenTargetX = screenPoint.x - containerRect.left;

    const tipRect = tooltip.getBoundingClientRect();
    const mouseY = e.clientY - containerRect.top;

    let left = screenTargetX + 20;
    let transform = 'translate(0, -50%)';

    if (left + tipRect.width > containerRect.width) {
      left = screenTargetX - 20;
      transform = 'translate(-100%, -50%)';
    }

    // Clamp Y
    let top = mouseY;
    if (top < tipRect.height / 2) {
      top = tipRect.height / 2;
    }
    if (top > containerRect.height - tipRect.height / 2) {
      top = containerRect.height - tipRect.height / 2;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = transform;
    tooltip.classList.add('is-visible');
  });

  overlay.addEventListener('click', () => {
    if (activeArchetype) {
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
  // Legend hover is still useful
  legendItems.forEach(item => {
    const label = item.querySelector('span:nth-child(2)');
    const name = label?.textContent;
    if (!name) {
      return;
    }
    // Make legend items keyboard accessible
    (item as HTMLElement).setAttribute('tabindex', '0');
    (item as HTMLElement).setAttribute('role', 'button');
    (item as HTMLElement).setAttribute('aria-label', `Highlight ${name} trend line`);
    item.addEventListener('mouseenter', () => setActive(name));
    item.addEventListener('mouseleave', clearActive);
    item.addEventListener('focus', () => setActive(name));
    item.addEventListener('blur', clearActive);
  });
}

function renderList() {
  if (!elements.list) {
    return;
  }
  elements.list.innerHTML = '';

  if (!state.trendData) {
    return;
  }

  const filtered = (state.trendData.series || []).filter(item => item.appearances >= state.minAppearances);

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'trend-empty';
    empty.textContent = 'No archetypes meet the current filters yet.';
    elements.list.appendChild(empty);
    return;
  }

  filtered.forEach(series => {
    const card = renderSeriesCard(series);
    elements.list.appendChild(card);
  });
}

function setMode(mode) {
  state.mode = mode;
  if (elements.modeMeta && elements.modeArchetypes) {
    elements.modeMeta.classList.toggle('is-active', mode === 'meta');
    elements.modeArchetypes.classList.toggle('is-active', mode === 'archetypes');
    // Update aria-pressed for screen readers
    elements.modeMeta.setAttribute('aria-pressed', String(mode === 'meta'));
    elements.modeArchetypes.setAttribute('aria-pressed', String(mode === 'archetypes'));
  }
  if (elements.metaPanel) {
    elements.metaPanel.hidden = mode !== 'meta';
  }
  if (elements.archetypePanel) {
    elements.archetypePanel.hidden = mode !== 'archetypes';
  }
}

async function hydrateFromDecks() {
  if (!state.trendData) {
    return;
  }
  try {
    state.isHydrating = true;
    setStatus('Recomputing from decks...');
    const decks = await fetchAllDecks(TRENDS_SOURCE);
    const tournaments = deriveTournamentsFromDecks(decks);

    // Store raw data for future filtering
    state.rawDecks = decks;
    state.rawTournaments = tournaments;

    const recomputed = buildTrendDataset(decks, tournaments, {
      minAppearances: 1,
      windowStart: state.trendData.windowStart,
      windowEnd: state.trendData.windowEnd,
      successFilter: state.performanceFilter
    });
    const cardTrends = buildCardTrendDataset(decks, tournaments, { minAppearances: 2 });
    state.trendData = { ...recomputed };
    state.cardTrends = cardTrends;
    updateMinSliderBounds();
    setStatus('Recomputed from latest decks');
    renderSummary();
    renderMetaChart();
    renderCardMovers(state.cardTrends);
    renderList();
  } catch (error) {
    logger.error('Failed to recompute trends from decks', { message: error?.message || error });
    setStatus('Could not recompute from decks');
  } finally {
    state.isHydrating = false;
  }
}

function rebuildWithFilter() {
  if (!state.rawDecks || !state.rawTournaments) {
    // No raw data available, need to fetch first
    hydrateFromDecks();
    return;
  }

  const recomputed = buildTrendDataset(state.rawDecks, state.rawTournaments, {
    minAppearances: 1,
    windowStart: state.trendData?.windowStart,
    windowEnd: state.trendData?.windowEnd,
    successFilter: state.performanceFilter
  });

  state.trendData = { ...recomputed };
  updateMinSliderBounds();
  renderSummary();
  renderMetaChart();
  renderList();

  const filterLabel = getPerformanceLabel(state.performanceFilter);
  setStatus(`Showing ${filterLabel.toLowerCase()} trends`);
}

function bindControls() {
  if (elements.minSlider && elements.minValue) {
    elements.minSlider.disabled = true;
  }

  if (elements.refresh) {
    elements.refresh.addEventListener('click', () => {
      if (state.isHydrating) {
        return;
      }
      hydrateFromDecks();
    });
  }

  if (elements.modeMeta) {
    elements.modeMeta.addEventListener('click', () => {
      setMode('meta');
    });
  }
  if (elements.modeArchetypes) {
    elements.modeArchetypes.addEventListener('click', () => {
      setMode('archetypes');
    });
  }

  // Performance filter dropdown
  if (elements.performanceFilter) {
    elements.performanceFilter.addEventListener('change', () => {
      const newFilter = elements.performanceFilter!.value;
      if (newFilter === state.performanceFilter) {
        return;
      }
      state.performanceFilter = newFilter;

      // If we don't have raw data yet, we need to fetch it first
      if (!state.rawDecks || !state.rawTournaments) {
        setStatus('Loading deck data for filtering...');
        hydrateFromDecks();
      } else {
        rebuildWithFilter();
      }
    });
  }

  // Density filter dropdown
  if (elements.densityFilter) {
    elements.densityFilter.addEventListener('change', () => {
      const newDensity = parseInt(elements.densityFilter!.value, 10);
      if (newDensity === state.chartDensity || isNaN(newDensity)) {
        return;
      }
      state.chartDensity = newDensity;
      // Just re-render the chart with new density - no need to refetch data
      renderMetaChart();
    });
  }

  // Time range filter dropdown
  if (elements.timeFilter) {
    elements.timeFilter.addEventListener('change', () => {
      const newTimeRange = parseInt(elements.timeFilter!.value, 10);
      if (newTimeRange === state.timeRangeDays || isNaN(newTimeRange)) {
        return;
      }
      state.timeRangeDays = newTimeRange;
      // Just re-render the chart with new time range - no need to refetch data
      renderMetaChart();
    });
  }
}

async function init() {
  if (state.isLoading) {
    return;
  }
  setLoading(true);
  try {
    const payload = await fetchTrendReport(TRENDS_SOURCE);
    state.trendData = payload?.trendReport || payload || null;
    state.cardTrends = payload?.cardTrends || null;
    updateMinSliderBounds();
    renderSummary();
    renderMetaChart();
    renderCardMovers(state.cardTrends);
    renderList();
    setStatus(`Showing pre-generated trends for ${TRENDS_SOURCE}`);
  } catch (error) {
    logger.warn('Failed to load pre-generated trends, falling back to decks', {
      message: error?.message || error
    });
    setStatus('Falling back to deck data...');
    try {
      const decks = await fetchAllDecks(TRENDS_SOURCE);
      const fallbackTournaments = deriveTournamentsFromDecks(decks);

      // Store raw data for future filtering
      state.rawDecks = decks;
      state.rawTournaments = fallbackTournaments;

      const archetypeTrends = buildTrendDataset(decks, fallbackTournaments, {
        minAppearances: 1,
        successFilter: state.performanceFilter
      });
      const cardTrends = buildCardTrendDataset(decks, fallbackTournaments, { minAppearances: 2 });
      state.trendData = archetypeTrends;
      state.cardTrends = cardTrends;
      updateMinSliderBounds();
      renderSummary();
      renderMetaChart();
      renderCardMovers(state.cardTrends);
      renderList();
      setStatus('Using live deck data');
    } catch (fallbackError) {
      logger.error('Failed to load any trend data', {
        message: fallbackError?.message || fallbackError
      });
      setStatus('Unable to load trend data right now.');
    }
  } finally {
    setLoading(false);
  }
}

bindControls();
setMode('meta');
init();

window.addEventListener('resize', () => {
  if (state.resizeTimer) {
    window.clearTimeout(state.resizeTimer);
  }
  state.resizeTimer = window.setTimeout(() => {
    renderMetaChart();
  }, 150);
});
