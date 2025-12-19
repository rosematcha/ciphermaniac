/* eslint-disable id-length, curly, prefer-destructuring, one-var, no-param-reassign */
/**
 * Archetype Trends Page - Redesigned v2
 * Displays time-series trend data for card usage within a specific archetype.
 * Features: stats overview, sparklines, interactive chart, rising/cooling cards.
 * Data processing: Normalizes irregular tournament data into daily bins and applies smoothing.
 */
import './utils/buildVersion.js';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { PERFORMANCE_TIER_LABELS } from './data/performanceTiers.js';

// Types for trends data
interface TrendsMeta {
  generatedAt: string;
  tournamentCount: number;
  cardCount: number;
}

interface TournamentTotals {
  all: number;
  winner?: number;
  top2?: number;
  top4?: number;
  top8?: number;
  top16?: number;
  top10?: number;
  top25?: number;
  top50?: number;
}

interface TournamentEntry {
  id: string;
  date: string;
  name: string;
  totals: TournamentTotals;
}

interface CardTimeline {
  [tournamentId: string]: {
    [tier: string]: [number, number]; // [includedCount, avgCopies]
  };
}

interface CardEntry {
  name: string;
  set: string | null;
  number: string | null;
  timeline: CardTimeline;
}

interface TrendsData {
  meta: TrendsMeta;
  tournaments: TournamentEntry[];
  cards: Record<string, CardEntry>;
}

interface DailyPoint {
  date: string;
  share: number;
  copies: number;
  count: number;
  total: number;
}

interface ChartLine {
  uid: string;
  name: string;
  color: string;
  points: DailyPoint[];
  latestShare: number;
  latestCopies: number;
  delta: number;
  slope: number; // Trend direction for sorting
}

interface CardRowData {
  uid: string;
  name: string;
  set: string | null;
  number: string | null;
  latestShare: number;
  latestCopies: number;
  delta: number;
  slope: number;
  sparklinePoints: DailyPoint[];
  dataPoints: number;
}

// High-contrast palette for chart lines
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
  '#10b981' // emerald
];

const R2_BASE_URL = CONFIG.API.R2_BASE;

// DOM Elements
const elements = {
  page: document.querySelector('.archetype-page') as HTMLElement | null,
  loading: document.getElementById('archetype-loading'),
  error: document.getElementById('archetype-error'),
  simple: document.querySelector('.archetype-simple') as HTMLElement | null,
  title: document.getElementById('archetype-title'),
  tabHome: document.getElementById('tab-home') as HTMLAnchorElement | null,
  tabAnalysis: document.getElementById('tab-analysis') as HTMLAnchorElement | null,
  tabTrends: document.getElementById('tab-trends') as HTMLAnchorElement | null,
  performanceFilter: document.getElementById('trends-performance-filter') as HTMLSelectElement | null,
  metaInfo: document.getElementById('trends-meta-info') as HTMLElement | null,

  // Stats section
  statsSection: document.getElementById('trends-stats') as HTMLElement | null,
  statTournaments: document.getElementById('stat-tournaments') as HTMLElement | null,
  statCards: document.getElementById('stat-cards') as HTMLElement | null,
  statRange: document.getElementById('stat-range') as HTMLElement | null,
  statMostPlayed: document.getElementById('stat-most-played') as HTMLElement | null,

  // Movers
  moversContainer: document.getElementById('trends-movers') as HTMLElement | null,
  risingList: document.getElementById('trends-rising') as HTMLElement | null,
  fallingList: document.getElementById('trends-falling') as HTMLElement | null,

  // Chart
  chartContainer: document.getElementById('trends-chart-container') as HTMLElement | null,
  chartSubtitle: document.getElementById('chart-subtitle') as HTMLElement | null,
  chart: document.getElementById('trends-chart') as HTMLElement | null,
  chartLegend: document.getElementById('trends-chart-legend') as HTMLElement | null,

  // Card list
  cardListSection: document.getElementById('trends-card-list') as HTMLElement | null,
  cardSortSelect: document.getElementById('card-sort') as HTMLSelectElement | null,
  cardListBody: document.getElementById('card-list-body') as HTMLElement | null,

  // Empty state
  emptyState: document.getElementById('trends-empty') as HTMLElement | null
};

// Application state
const state = {
  archetypeName: '',
  archetypeSlug: '',
  trendsData: null as TrendsData | null,
  selectedTier: 'top8',
  selectedCards: new Set<string>(),
  chartLines: [] as ChartLine[],
  cardRows: [] as CardRowData[],
  sortBy: 'playrate' as 'playrate' | 'trending' | 'name' | 'copies',
  resizeTimer: null as number | null
};

/**
 * Extract archetype name from URL path
 */
function extractArchetypeFromUrl(): string | null {
  const pathname = window.location.pathname;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const rawSlug = parts[0];
  try {
    return decodeURIComponent(rawSlug).replace(/_/g, ' ');
  } catch {
    return rawSlug.replace(/_/g, ' ');
  }
}

function buildHomeUrl(): string {
  return `/${encodeURIComponent(state.archetypeSlug)}`;
}

function buildAnalysisUrl(): string {
  return `/${encodeURIComponent(state.archetypeSlug)}/analysis`;
}

/**
 * Fetch trends.json for the archetype
 */
async function fetchTrendsData(archetypeName: string): Promise<TrendsData | null> {
  const encodedName = encodeURIComponent(archetypeName);
  const url = `${R2_BASE_URL}/reports/Online%20-%20Last%2014%20Days/archetypes/${encodedName}/trends.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        logger.warn('Trends data not found', { archetypeName });
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as TrendsData;
  } catch (error) {
    logger.error('Failed to fetch trends data', { archetypeName, error });
    return null;
  }
}

function setPageState(status: 'loading' | 'ready' | 'error') {
  if (elements.page) elements.page.setAttribute('data-state', status);
  if (elements.loading) elements.loading.hidden = status !== 'loading';
  if (elements.error) elements.error.hidden = status !== 'error';
  if (elements.simple) elements.simple.hidden = status !== 'ready';
}

function updateTitle() {
  if (elements.title) elements.title.textContent = `${state.archetypeName} Trends`;
  document.title = `${state.archetypeName} Trends \u2013 Ciphermaniac`;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatPercent(value: number): string {
  const pct = Math.round(value * 10) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

/**
 * Calculate card stats for a given tournament and tier
 */
function getCardStats(
  card: CardEntry,
  tournamentId: string,
  tier: string,
  tournament: TournamentEntry
): { share: number; copies: number; count: number; total: number } | null {
  const tierData = card.timeline[tournamentId]?.[tier];
  if (!tierData) return null;

  const [includedCount, avgCopies] = tierData;
  const total = tournament.totals[tier as keyof TournamentTotals] ?? tournament.totals.all;
  if (!total || total === 0) return null;

  return {
    share: (includedCount / total) * 100,
    copies: avgCopies,
    count: includedCount,
    total
  };
}

/**
 * Flatten card timeline into daily points, including 0-values for missing tournaments
 */
function flattenCardTimeline(card: CardEntry, tournaments: TournamentEntry[], tier: string): DailyPoint[] {
  const points: DailyPoint[] = [];

  for (const t of tournaments) {
    const stats = getCardStats(card, t.id, tier, t);
    if (stats) {
      points.push({
        date: t.date,
        ...stats
      });
    } else {
      // Card not present in this tournament (0% usage)
      const total = t.totals[tier as keyof TournamentTotals] ?? t.totals.all ?? 0;
      points.push({
        date: t.date,
        share: 0,
        copies: 0,
        count: 0,
        total
      });
    }
  }

  return points.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Bin points by day to normalize irregular tournament schedules
 */
function binDaily(points: DailyPoint[]): DailyPoint[] {
  const byDay = new Map<string, { weightedShare: number; weightedCopies: number; totalDecks: number; count: number }>();

  for (const p of points) {
    // Standardize date to YYYY-MM-DD
    const day = p.date.split('T')[0];

    if (!byDay.has(day)) {
      byDay.set(day, { weightedShare: 0, weightedCopies: 0, totalDecks: 0, count: 0 });
    }

    const entry = byDay.get(day)!;
    // Weight by tournament size (total decks)
    entry.weightedShare += p.share * p.total;
    entry.weightedCopies += p.copies * p.total;
    entry.totalDecks += p.total;
    entry.count += p.count;
  }

  return Array.from(byDay.entries())
    .map(([date, val]) => ({
      date,
      share: val.totalDecks ? val.weightedShare / val.totalDecks : 0,
      copies: val.totalDecks ? val.weightedCopies / val.totalDecks : 0,
      count: val.count,
      total: val.totalDecks
    }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Smooth series using a moving average
 */
function smoothSeries(series: DailyPoint[], window = 3): DailyPoint[] {
  if (!Array.isArray(series) || series.length === 0) return series;

  const w = Math.max(1, window);
  const result: DailyPoint[] = [];

  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - Math.floor(w / 2));
    const end = Math.min(series.length, i + Math.ceil(w / 2));
    const slice = series.slice(start, end);

    if (slice.length === 0) continue;

    const avgShare = slice.reduce((sum, p) => sum + p.share, 0) / slice.length;
    const avgCopies = slice.reduce((sum, p) => sum + p.copies, 0) / slice.length;

    result.push({
      ...series[i],
      share: avgShare,
      copies: avgCopies
    });
  }

  return result;
}

/**
 * Calculate linear regression slope for trend direction
 */
function calculateSlope(points: DailyPoint[]): number {
  if (points.length < 2) return 0;

  const yValues = points.map(p => p.share);
  const n = yValues.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += yValues[i];
    sumXY += i * yValues[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Build card row data for all cards
 */
function buildCardRowData(): CardRowData[] {
  if (!state.trendsData) return [];

  const { tournaments, cards } = state.trendsData;
  const tier = state.selectedTier;
  const rows: CardRowData[] = [];

  for (const [uid, card] of Object.entries(cards)) {
    // 1. Flatten into time series
    const rawPoints = flattenCardTimeline(card, tournaments, tier);
    if (rawPoints.length === 0) continue;

    // 2. Bin by day
    const binnedPoints = binDaily(rawPoints);

    // 3. Smooth
    const smoothedPoints = smoothSeries(binnedPoints, 3);

    if (smoothedPoints.length === 0) continue;

    const latest = smoothedPoints[smoothedPoints.length - 1];
    const first = smoothedPoints[0];
    const delta = latest.share - first.share;
    const slope = calculateSlope(smoothedPoints);

    rows.push({
      uid,
      name: card.name,
      set: card.set,
      number: card.number,
      latestShare: latest.share,
      latestCopies: latest.copies,
      delta,
      slope,
      sparklinePoints: smoothedPoints,
      dataPoints: rawPoints.length
    });
  }

  return rows;
}

/**
 * Sort card rows based on current sort setting
 */
function sortCardRows(rows: CardRowData[]): CardRowData[] {
  const sorted = [...rows];

  switch (state.sortBy) {
    case 'playrate':
      sorted.sort((a, b) => b.latestShare - a.latestShare);
      break;
    case 'trending':
      sorted.sort((a, b) => b.slope - a.slope);
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'copies':
      sorted.sort((a, b) => b.latestCopies - a.latestCopies);
      break;
    default:
      sorted.sort((a, b) => b.latestShare - a.latestShare);
  }

  return sorted;
}

/**
 * Render a mini sparkline SVG
 */
function renderSparkline(points: DailyPoint[], width = 80, height = 24): string {
  if (points.length < 2) {
    return `<svg width="${width}" height="${height}" class="sparkline"></svg>`;
  }

  const values = points.map(p => p.share);
  const maxVal = Math.max(...values, 1);
  const minVal = 0; // Always anchor to 0
  const range = maxVal - minVal || 1;

  const xStep = width / (points.length - 1);
  const coords = values.map((p, i) => {
    const x = i * xStep;
    const y = height - 2 - ((p - minVal) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Determine trend color
  const first = values[0];
  const last = values[values.length - 1];
  const trendClass = last > first ? 'spark-up' : last < first ? 'spark-down' : 'spark-flat';

  return `<svg width="${width}" height="${height}" class="sparkline ${trendClass}" viewBox="0 0 ${width} ${height}">
    <polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${coords.join(' ')}" />
  </svg>`;
}

/**
 * Render stats overview section
 */
function renderStats() {
  if (!state.trendsData || !elements.statsSection) return;

  const { meta, tournaments } = state.trendsData;

  if (elements.statTournaments) {
    elements.statTournaments.textContent = String(meta.tournamentCount);
  }

  if (elements.statCards) {
    elements.statCards.textContent = String(meta.cardCount);
  }

  if (elements.statRange && tournaments.length > 0) {
    const first = formatDate(tournaments[0].date);
    const last = formatDate(tournaments[tournaments.length - 1].date);
    elements.statRange.textContent = `${first} – ${last}`;
  }

  // Find most played card
  if (elements.statMostPlayed && state.cardRows.length > 0) {
    const sorted = [...state.cardRows].sort((a, b) => b.latestShare - a.latestShare);
    const top = sorted[0];
    elements.statMostPlayed.textContent = `${top.name} (${formatPercent(top.latestShare)})`;
  }

  elements.statsSection.hidden = false;
}

/**
 * Calculate and render rising/cooling cards
 */
function renderMovers() {
  if (!elements.moversContainer || !elements.risingList || !elements.fallingList) return;
  if (!state.cardRows.length) {
    elements.moversContainer.hidden = true;
    return;
  }

  // Filter cards with significant data and movement
  const significantCards = state.cardRows.filter(c => c.dataPoints >= 2 && Math.abs(c.delta) >= 1);

  // Sort by slope for more accurate trending
  const bySlope = [...significantCards].sort((a, b) => b.slope - a.slope);

  const rising = bySlope.filter(c => c.slope > 0).slice(0, 5);
  const cooling = bySlope.filter(c => c.slope < 0).slice(0, 5);

  const renderList = (items: CardRowData[], container: HTMLElement, direction: 'up' | 'down') => {
    container.innerHTML = '';

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No significant changes';
      container.appendChild(li);
      return;
    }

    for (const item of items) {
      const li = document.createElement('li');
      const cardUrl =
        item.set && item.number ? `/card/${item.set}~${item.number}` : `/cards?card=${encodeURIComponent(item.name)}`;

      const sign = item.delta > 0 ? '+' : '';
      li.innerHTML = `
        <a href="${cardUrl}" class="mover-item">
          <span class="mover-name">${item.name}</span>
          <span class="mover-stats">
            <span class="mover-share">${formatPercent(item.latestShare)}</span>
            <span class="mover-delta ${direction}">${sign}${item.delta.toFixed(1)}%</span>
          </span>
        </a>
      `;
      container.appendChild(li);
    }
  };

  renderList(rising, elements.risingList, 'up');
  renderList(cooling, elements.fallingList, 'down');

  elements.moversContainer.hidden = rising.length === 0 && cooling.length === 0;
}

/**
 * Render the card list with sparklines
 */
function renderCardList() {
  if (!elements.cardListSection || !elements.cardListBody) return;

  const sorted = sortCardRows(state.cardRows);
  elements.cardListBody.innerHTML = '';

  for (const card of sorted) {
    const row = document.createElement('tr');
    const isSelected = state.selectedCards.has(card.uid);
    const colorIndex = Array.from(state.selectedCards).indexOf(card.uid);
    const color = colorIndex >= 0 ? palette[colorIndex % palette.length] : '';

    const cardUrl =
      card.set && card.number ? `/card/${card.set}~${card.number}` : `/cards?card=${encodeURIComponent(card.name)}`;

    const deltaSign = card.delta > 0 ? '+' : '';
    const deltaClass = card.delta > 2 ? 'delta-up' : card.delta < -2 ? 'delta-down' : 'delta-flat';

    row.innerHTML = `
      <td class="col-chart">
        <label class="chart-checkbox">
          <input type="checkbox" data-uid="${card.uid}" ${isSelected ? 'checked' : ''} />
          <span class="checkbox-indicator" ${color ? `style="background-color: ${color}"` : ''}></span>
        </label>
      </td>
      <td class="col-name"><a href="${cardUrl}">${card.name}</a></td>
      <td class="col-sparkline">${renderSparkline(card.sparklinePoints)}</td>
      <td class="col-playrate">${formatPercent(card.latestShare)}</td>
      <td class="col-copies">${card.latestCopies.toFixed(1)}</td>
      <td class="col-change ${deltaClass}">${deltaSign}${card.delta.toFixed(1)}%</td>
    `;

    // Bind checkbox event
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox?.addEventListener('change', () => handleCardToggle(card.uid, checkbox.checked));

    elements.cardListBody.appendChild(row);
  }

  elements.cardListSection.hidden = false;
}

/**
 * Handle card selection toggle
 */
function handleCardToggle(uid: string, checked: boolean) {
  if (checked) {
    if (state.selectedCards.size < 12) {
      state.selectedCards.add(uid);
    }
  } else {
    state.selectedCards.delete(uid);
  }
  renderChart();
  renderCardList(); // Re-render to update checkbox colors
}

/**
 * Build chart lines for selected cards
 */
function buildChartLines(): ChartLine[] {
  if (!state.trendsData) return [];

  const { tournaments, cards } = state.trendsData;
  const tier = state.selectedTier;
  const lines: ChartLine[] = [];

  let colorIndex = 0;
  for (const uid of state.selectedCards) {
    const card = cards[uid];
    if (!card) continue;

    // Use same processing pipeline as rows
    const rawPoints = flattenCardTimeline(card, tournaments, tier);
    const binnedPoints = binDaily(rawPoints);
    const smoothedPoints = smoothSeries(binnedPoints, 3);

    if (smoothedPoints.length === 0) continue;

    const latest = smoothedPoints[smoothedPoints.length - 1];
    const first = smoothedPoints[0];

    lines.push({
      uid,
      name: card.name,
      color: palette[colorIndex % palette.length],
      points: smoothedPoints,
      latestShare: latest.share,
      latestCopies: latest.copies,
      delta: latest.share - first.share,
      slope: calculateSlope(smoothedPoints)
    });

    colorIndex++;
  }

  return lines;
}

/**
 * Render the main trend chart
 */
function renderChart() {
  if (!elements.chart || !state.trendsData) return;

  elements.chart.innerHTML = '';
  const lines = buildChartLines();
  state.chartLines = lines;

  if (lines.length === 0) {
    if (elements.chartSubtitle) {
      elements.chartSubtitle.textContent = 'Select cards from the list below to chart their playrate';
    }
    if (elements.chartContainer) elements.chartContainer.hidden = false;
    if (elements.chartLegend) elements.chartLegend.innerHTML = '';
    return;
  }

  if (elements.chartSubtitle) {
    elements.chartSubtitle.textContent = `Showing ${lines.length} card${lines.length === 1 ? '' : 's'}`;
  }

  // Chart dimensions
  const containerRect = elements.chart.getBoundingClientRect();
  const width = Math.max(320, Math.round(containerRect.width || 800));
  const height = Math.min(400, Math.max(260, width * 0.4));
  const padX = 48;
  const padY = 32;
  const contentWidth = width - padX * 2;
  const contentHeight = height - padY * 2;

  // Calculate Y axis range
  const allShares = lines.flatMap(line => line.points.map(p => p.share));
  const maxObserved = allShares.length ? Math.max(...allShares) : 100;
  const minObserved = allShares.length ? Math.min(...allShares) : 0;
  const yMax = Math.max(10, Math.ceil(maxObserved * 1.1));
  const yMin = Math.max(0, Math.floor(minObserved * 0.9));
  const yRange = yMax - yMin || 1;

  // Calculate X axis range (Time)
  const allDates = lines.flatMap(line => line.points.map(p => new Date(p.date).getTime()));
  const minTime = Math.min(...allDates);
  const maxTime = Math.max(...allDates);
  const timeRange = maxTime - minTime || 1;

  const xForTime = (time: number) => {
    return padX + ((time - minTime) / timeRange) * contentWidth;
  };

  const yForShare = (share: number) => {
    const clamped = Math.min(yMax, Math.max(yMin, share));
    const normalized = (clamped - yMin) / yRange;
    return height - padY - normalized * contentHeight;
  };

  // Create SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${height}px`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.classList.add('trends-svg-v2');

  // Grid lines
  const gridInterval = yMax > 50 ? 20 : yMax > 20 ? 10 : 5;
  for (let lvl = yMin; lvl <= yMax; lvl += gridInterval) {
    const y = yForShare(lvl);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', `${padX}`);
    line.setAttribute('x2', `${width - padX}`);
    line.setAttribute('y1', `${y}`);
    line.setAttribute('y2', `${y}`);
    line.setAttribute('stroke', 'rgba(124,134,168,0.15)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${padX - 8}`);
    label.setAttribute('y', `${y + 4}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    label.setAttribute('text-anchor', 'end');
    label.textContent = `${lvl}%`;
    svg.appendChild(label);
  }

  // Draw lines
  for (const line of lines) {
    const pointsStr = line.points
      .map(pt => {
        const t = new Date(pt.date).getTime();
        return `${xForTime(t)},${yForShare(pt.share)}`;
      })
      .join(' ');

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', line.color);
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('points', pointsStr);
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    polyline.dataset.name = line.name;
    svg.appendChild(polyline);

    // Draw data points
    line.points.forEach(pt => {
      if (pt.share > 0) {
        const t = new Date(pt.date).getTime();
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', `${xForTime(t)}`);
        circle.setAttribute('cy', `${yForShare(pt.share)}`);
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', line.color);
        circle.setAttribute('stroke', '#0c1020');
        circle.setAttribute('stroke-width', '1.5');
        circle.classList.add('chart-point');

        // Tooltip data
        circle.dataset.name = line.name;
        circle.dataset.share = pt.share.toFixed(1);
        circle.dataset.copies = pt.copies.toFixed(1);
        circle.dataset.count = String(pt.count);
        circle.dataset.total = String(pt.total);
        circle.dataset.date = formatDate(pt.date);

        svg.appendChild(circle);
      }
    });
  }

  // X-axis date labels
  // Choose ~5 evenly spaced timestamps
  const labelCount = 5;
  for (let i = 0; i < labelCount; i++) {
    const t = minTime + (timeRange * i) / (labelCount - 1);
    const dateStr = new Date(t).toISOString(); // Approximate

    const x = xForTime(t);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${x}`);
    label.setAttribute('y', `${height - 8}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = formatDate(dateStr);
    svg.appendChild(label);
  }

  // Add tooltip container
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  elements.chart.appendChild(tooltip);

  elements.chart.appendChild(svg);

  // Add hover interactions
  svg.querySelectorAll('.chart-point').forEach(point => {
    point.addEventListener('mouseenter', (e: Event) => {
      const el = e.target as SVGCircleElement;
      tooltip.innerHTML = `
        <strong>${el.dataset.name}</strong><br/>
        ${el.dataset.date}: ${el.dataset.share}%<br/>
        ${el.dataset.count}/${el.dataset.total} decks, ${el.dataset.copies} avg copies
      `;
      tooltip.hidden = false;

      const rect = elements.chart!.getBoundingClientRect();
      const cx = parseFloat(el.getAttribute('cx') || '0');
      const cy = parseFloat(el.getAttribute('cy') || '0');
      const scaleX = rect.width / width;
      const scaleY = rect.height / height;

      tooltip.style.left = `${cx * scaleX}px`;
      tooltip.style.top = `${cy * scaleY - 10}px`;
    });

    point.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
    });
  });

  renderLegend();

  if (elements.chartContainer) elements.chartContainer.hidden = false;
}

/**
 * Render chart legend
 */
function renderLegend() {
  if (!elements.chartLegend) return;

  elements.chartLegend.innerHTML = '';

  for (const line of state.chartLines) {
    const item = document.createElement('div');
    item.className = 'legend-item-v2';

    const sign = line.delta > 0 ? '+' : '';
    const deltaClass = line.delta > 0 ? 'up' : line.delta < 0 ? 'down' : '';

    item.innerHTML = `
      <span class="legend-swatch" style="background-color: ${line.color}"></span>
      <span class="legend-name">${line.name}</span>
      <span class="legend-value">${formatPercent(line.latestShare)}</span>
      <span class="legend-delta ${deltaClass}">${sign}${line.delta.toFixed(1)}%</span>
    `;

    elements.chartLegend.appendChild(item);
  }
}

function showEmptyState() {
  if (elements.emptyState) elements.emptyState.hidden = false;
  if (elements.chartContainer) elements.chartContainer.hidden = true;
  if (elements.moversContainer) elements.moversContainer.hidden = true;
  if (elements.cardListSection) elements.cardListSection.hidden = true;
  if (elements.statsSection) elements.statsSection.hidden = true;
}

function hideEmptyState() {
  if (elements.emptyState) elements.emptyState.hidden = true;
}

function handleTierChange() {
  if (!elements.performanceFilter) return;
  state.selectedTier = elements.performanceFilter.value;
  state.cardRows = buildCardRowData();

  // Auto-select top 6 cards when tier changes
  const sorted = sortCardRows(state.cardRows);
  state.selectedCards = new Set(sorted.slice(0, 6).map(c => c.uid));

  renderStats();
  renderMovers();
  renderChart();
  renderCardList();
}

function handleSortChange() {
  if (!elements.cardSortSelect) return;
  state.sortBy = elements.cardSortSelect.value as typeof state.sortBy;
  renderCardList();
}

function bindEvents() {
  if (elements.performanceFilter) {
    elements.performanceFilter.addEventListener('change', handleTierChange);
  }

  if (elements.cardSortSelect) {
    elements.cardSortSelect.addEventListener('change', handleSortChange);
  }

  if (elements.tabHome) {
    elements.tabHome.addEventListener('click', e => {
      e.preventDefault();
      window.location.href = buildHomeUrl();
    });
  }

  if (elements.tabAnalysis) {
    elements.tabAnalysis.addEventListener('click', e => {
      e.preventDefault();
      window.location.href = buildAnalysisUrl();
    });
  }

  // Handle window resize
  window.addEventListener('resize', () => {
    if (state.resizeTimer) window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => {
      renderChart();
    }, 150);
  });
}

async function init() {
  const archetypeName = extractArchetypeFromUrl();

  if (!archetypeName) {
    setPageState('error');
    return;
  }

  state.archetypeName = archetypeName;
  state.archetypeSlug = archetypeName.replace(/ /g, '_');
  updateTitle();

  // Update tab links
  if (elements.tabHome) elements.tabHome.href = buildHomeUrl();
  if (elements.tabAnalysis) elements.tabAnalysis.href = buildAnalysisUrl();

  const trendsData = await fetchTrendsData(state.archetypeSlug);

  if (!trendsData || trendsData.tournaments.length < 2) {
    setPageState('ready');
    showEmptyState();
    return;
  }

  state.trendsData = trendsData;
  state.cardRows = buildCardRowData();

  // Auto-select top 6 cards by playrate
  const sorted = sortCardRows(state.cardRows);
  state.selectedCards = new Set(sorted.slice(0, 6).map(c => c.uid));

  setPageState('ready');
  hideEmptyState();
  renderStats();
  renderMovers();
  renderChart();
  renderCardList();

  // Update meta info
  if (elements.metaInfo) {
    const tierLabel = PERFORMANCE_TIER_LABELS[state.selectedTier] || state.selectedTier;
    elements.metaInfo.textContent = `${trendsData.meta.tournamentCount} tournaments, ${tierLabel}`;
  }
}

// Initialize
bindEvents();
init();
