/**
 * Archetype Trends Page
 * Displays time-series trend data for card usage within a specific archetype.
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

interface ChartLine {
  uid: string;
  name: string;
  color: string;
  points: number[]; // share % per tournament
  latest: number;
  delta: number;
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
  cardSelect: document.getElementById('trends-card-select') as HTMLSelectElement | null,
  summaryContainer: document.getElementById('trends-summary') as HTMLElement | null,
  summaryText: document.getElementById('trends-summary-text') as HTMLElement | null,
  chartContainer: document.getElementById('trends-chart-container') as HTMLElement | null,
  chart: document.getElementById('trends-chart') as HTMLElement | null,
  chartLegend: document.getElementById('trends-chart-legend') as HTMLElement | null,
  moversContainer: document.getElementById('trends-movers') as HTMLElement | null,
  risingList: document.getElementById('trends-rising') as HTMLElement | null,
  fallingList: document.getElementById('trends-falling') as HTMLElement | null,
  emptyState: document.getElementById('trends-empty') as HTMLElement | null,
  controlsToggle: document.getElementById('controls-toggle') as HTMLButtonElement | null,
  controlsBody: document.getElementById('controls-body') as HTMLElement | null
};

// Application state
const state = {
  archetypeName: '',
  archetypeSlug: '',
  trendsData: null as TrendsData | null,
  selectedTier: 'top8',
  selectedCards: new Set<string>(),
  chartLines: [] as ChartLine[],
  resizeTimer: null as number | null
};

/**
 * Extract archetype name from URL path
 */
function extractArchetypeFromUrl(): string | null {
  const pathname = window.location.pathname;
  // Match /:name or /:name/trends
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const rawSlug = parts[0];
  try {
    return decodeURIComponent(rawSlug).replace(/_/g, ' ');
  } catch {
    return rawSlug.replace(/_/g, ' ');
  }
}

/**
 * Build the home page URL for the current archetype
 */
function buildHomeUrl(): string {
  return `/${encodeURIComponent(state.archetypeSlug)}`;
}

/**
 * Build the analysis page URL for the current archetype
 */
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

/**
 * Set page loading state
 */
function setPageState(status: 'loading' | 'ready' | 'error') {
  if (elements.page) {
    elements.page.setAttribute('data-state', status);
  }
  if (elements.loading) {
    elements.loading.hidden = status !== 'loading';
  }
  if (elements.error) {
    elements.error.hidden = status !== 'error';
  }
  if (elements.simple) {
    elements.simple.hidden = status !== 'ready';
  }
}

/**
 * Update page title
 */
function updateTitle() {
  if (elements.title) {
    elements.title.textContent = `${state.archetypeName} Trends`;
  }
  document.title = `${state.archetypeName} Trends \u2013 Ciphermaniac`;
}

/**
 * Populate the card selection dropdown
 */
function populateCardSelect() {
  if (!elements.cardSelect || !state.trendsData) {
    return;
  }

  elements.cardSelect.innerHTML = '';
  const cards = Object.entries(state.trendsData.cards);

  // Sort by number of tournaments (data points), then by name
  cards.sort((a, b) => {
    const aCount = Object.keys(a[1].timeline).length;
    const bCount = Object.keys(b[1].timeline).length;
    if (bCount !== aCount) {
      return bCount - aCount;
    }
    return a[1].name.localeCompare(b[1].name);
  });

  // Pre-select top 6 cards by default
  const defaultSelected = new Set<string>();
  cards.slice(0, 6).forEach(([uid]) => defaultSelected.add(uid));
  state.selectedCards = defaultSelected;

  for (const [uid, card] of cards) {
    const option = document.createElement('option');
    option.value = uid;
    option.textContent = card.set && card.number ? `${card.name} (${card.set} ${card.number})` : card.name;
    option.selected = defaultSelected.has(uid);
    elements.cardSelect.appendChild(option);
  }
}

/**
 * Calculate card share for a given tournament and tier
 */
function calculateShare(
  card: CardEntry,
  tournamentId: string,
  tier: string,
  tournament: TournamentEntry
): number | null {
  const tierData = card.timeline[tournamentId]?.[tier];
  if (!tierData) {
    return null;
  }
  const [includedCount] = tierData;
  const total = tournament.totals[tier as keyof TournamentTotals] ?? tournament.totals.all;
  if (!total || total === 0) {
    return null;
  }
  return (includedCount / total) * 100;
}

/**
 * Build chart lines for selected cards
 */
function buildChartLines(): ChartLine[] {
  if (!state.trendsData) {
    return [];
  }

  const { tournaments, cards } = state.trendsData;
  const tier = state.selectedTier;
  const lines: ChartLine[] = [];

  let colorIndex = 0;
  for (const uid of state.selectedCards) {
    const card = cards[uid];
    if (!card) continue;

    const points: number[] = [];
    let hasData = false;

    for (const t of tournaments) {
      const share = calculateShare(card, t.id, tier, t);
      if (share !== null) {
        hasData = true;
        points.push(share);
      } else {
        // Use 0 for missing data points
        points.push(0);
      }
    }

    if (!hasData) continue;

    const latest = points.length > 0 ? points[points.length - 1] : 0;
    const first = points.length > 0 ? points[0] : 0;
    const delta = latest - first;

    lines.push({
      uid,
      name: card.name,
      color: palette[colorIndex % palette.length],
      points,
      latest,
      delta
    });

    colorIndex++;
  }

  return lines;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Format percentage
 */
function formatPercent(value: number): string {
  const pct = Math.round(value * 10) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

/**
 * Render the trend chart
 */
function renderChart() {
  if (!elements.chart || !state.trendsData) {
    return;
  }

  elements.chart.innerHTML = '';
  const lines = buildChartLines();
  state.chartLines = lines;

  if (lines.length === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();

  const { tournaments } = state.trendsData;
  const count = tournaments.length;

  // Chart dimensions
  const containerRect = elements.chart.getBoundingClientRect();
  const width = Math.max(320, Math.round(containerRect.width || 800));
  const height = Math.min(400, Math.max(260, width * 0.4));
  const padX = 40;
  const padY = 32;
  const contentWidth = width - padX * 2;
  const contentHeight = height - padY * 2;

  // Calculate Y axis range
  const allShares = lines.flatMap(line => line.points);
  const maxObserved = allShares.length ? Math.max(...allShares) : 100;
  const minObserved = allShares.length ? Math.min(...allShares) : 0;
  const yMax = Math.max(10, Math.ceil(maxObserved * 1.1));
  const yMin = Math.max(0, Math.floor(minObserved * 0.9));
  const yRange = yMax - yMin || 1;

  // Coordinate helpers
  const xForIndex = (idx: number) => (count === 1 ? contentWidth / 2 : (idx / (count - 1)) * contentWidth) + padX;
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
  svg.classList.add('trends-svg');

  // Grid lines
  const gridInterval = yMax > 50 ? 20 : yMax > 20 ? 10 : 5;
  for (let lvl = yMin; lvl <= yMax; lvl += gridInterval) {
    const y = yForShare(lvl);

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
    label.setAttribute('text-anchor', 'end');
    label.textContent = `${lvl}%`;
    svg.appendChild(label);
  }

  // Draw lines
  for (const line of lines) {
    const points = line.points.map((share, idx) => `${xForIndex(idx)},${yForShare(share)}`).join(' ');

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', line.color);
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('points', points);
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    polyline.dataset.name = line.name;
    svg.appendChild(polyline);
  }

  // X-axis date labels
  const labelIndices = new Set<number>();
  if (count <= 4) {
    for (let i = 0; i < count; i++) {
      labelIndices.add(i);
    }
  } else {
    labelIndices.add(0);
    labelIndices.add(count - 1);
    const mid = Math.floor(count / 2);
    labelIndices.add(mid);
  }

  for (const idx of labelIndices) {
    const x = xForIndex(idx);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', `${x}`);
    label.setAttribute('y', `${height - 8}`);
    label.setAttribute('fill', '#7c86a8');
    label.setAttribute('font-size', '11');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = formatDate(tournaments[idx].date);
    svg.appendChild(label);
  }

  elements.chart.appendChild(svg);
  renderLegend();

  if (elements.chartContainer) {
    elements.chartContainer.hidden = false;
  }
}

/**
 * Render chart legend
 */
function renderLegend() {
  if (!elements.chartLegend) {
    return;
  }

  elements.chartLegend.innerHTML = '';

  for (const line of state.chartLines) {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = line.color;

    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = line.name;

    const value = document.createElement('span');
    value.className = 'legend-value';
    const sign = line.delta > 0 ? '+' : '';
    const deltaClass = line.delta > 0 ? 'up' : line.delta < 0 ? 'down' : '';
    value.innerHTML = `${formatPercent(line.latest)} <span class="legend-delta ${deltaClass}">(${sign}${line.delta.toFixed(1)}%)</span>`;

    item.appendChild(swatch);
    item.appendChild(name);
    item.appendChild(value);
    elements.chartLegend.appendChild(item);
  }
}

/**
 * Render summary text
 */
function renderSummary() {
  if (!elements.summaryContainer || !elements.summaryText || !state.trendsData) {
    return;
  }

  const { meta, tournaments } = state.trendsData;
  const tierLabel = PERFORMANCE_TIER_LABELS[state.selectedTier] || state.selectedTier;

  let dateRange = '';
  if (tournaments.length > 0) {
    const first = formatDate(tournaments[0].date);
    const last = formatDate(tournaments[tournaments.length - 1].date);
    dateRange = `${first} - ${last}`;
  }

  elements.summaryText.textContent =
    `Showing ${meta.cardCount} cards across ${meta.tournamentCount} tournaments (${dateRange}). ` +
    `Filtered by: ${tierLabel}.`;

  elements.summaryContainer.hidden = false;
}

/**
 * Calculate rising and falling cards
 */
function calculateMovers() {
  if (!state.trendsData) {
    return { rising: [], falling: [] };
  }

  const { tournaments, cards } = state.trendsData;
  const tier = state.selectedTier;

  interface Mover {
    uid: string;
    name: string;
    set: string | null;
    number: string | null;
    latest: number;
    delta: number;
  }

  const movers: Mover[] = [];

  for (const [uid, card] of Object.entries(cards)) {
    const timeline = card.timeline;
    const tIds = Object.keys(timeline).filter(id => tournaments.some(t => t.id === id));

    if (tIds.length < 2) continue;

    // Get first and last shares
    const sortedTIds = tIds.sort((a, b) => {
      const tA = tournaments.find(t => t.id === a);
      const tB = tournaments.find(t => t.id === b);
      return Date.parse(tA?.date || '0') - Date.parse(tB?.date || '0');
    });

    const firstTId = sortedTIds[0];
    const lastTId = sortedTIds[sortedTIds.length - 1];
    const firstT = tournaments.find(t => t.id === firstTId);
    const lastT = tournaments.find(t => t.id === lastTId);

    if (!firstT || !lastT) continue;

    const firstShare = calculateShare(card, firstTId, tier, firstT) ?? 0;
    const lastShare = calculateShare(card, lastTId, tier, lastT) ?? 0;
    const delta = lastShare - firstShare;

    if (Math.abs(delta) < 1) continue; // Ignore small changes

    movers.push({
      uid,
      name: card.name,
      set: card.set,
      number: card.number,
      latest: lastShare,
      delta
    });
  }

  movers.sort((a, b) => b.delta - a.delta);

  return {
    rising: movers.filter(m => m.delta > 0).slice(0, 5),
    falling: movers.filter(m => m.delta < 0).slice(0, 5)
  };
}

/**
 * Render movers section
 */
function renderMovers() {
  if (!elements.moversContainer || !elements.risingList || !elements.fallingList) {
    return;
  }

  const { rising, falling } = calculateMovers();

  const renderList = (
    list: ReturnType<typeof calculateMovers>['rising'],
    container: HTMLElement,
    direction: string
  ) => {
    container.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'No significant changes';
      container.appendChild(empty);
      return;
    }

    for (const mover of list) {
      const li = document.createElement('li');
      const sign = mover.delta > 0 ? '+' : '';
      const cardUrl =
        mover.set && mover.number
          ? `/card/${mover.set}~${mover.number}`
          : `/cards?card=${encodeURIComponent(mover.name)}`;

      li.innerHTML = `
        <a href="${cardUrl}">
          <span class="name">${mover.name}</span>
          <span class="perc">${formatPercent(mover.latest)}</span>
          <span class="delta ${direction}">${sign}${mover.delta.toFixed(1)}%</span>
        </a>
      `;
      container.appendChild(li);
    }
  };

  renderList(rising, elements.risingList, 'up');
  renderList(falling, elements.fallingList, 'down');

  elements.moversContainer.hidden = rising.length === 0 && falling.length === 0;
}

/**
 * Show empty state
 */
function showEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.hidden = false;
  }
  if (elements.chartContainer) {
    elements.chartContainer.hidden = true;
  }
  if (elements.moversContainer) {
    elements.moversContainer.hidden = true;
  }
}

/**
 * Hide empty state
 */
function hideEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.hidden = true;
  }
}

/**
 * Handle performance filter change
 */
function handleTierChange() {
  if (!elements.performanceFilter) {
    return;
  }
  state.selectedTier = elements.performanceFilter.value;
  renderChart();
  renderSummary();
  renderMovers();
}

/**
 * Handle card selection change
 */
function handleCardSelectionChange() {
  if (!elements.cardSelect) {
    return;
  }
  state.selectedCards = new Set(Array.from(elements.cardSelect.selectedOptions).map(opt => opt.value));
  renderChart();
}

/**
 * Setup controls toggle
 */
function setupControlsToggle() {
  if (!elements.controlsToggle || !elements.controlsBody) {
    return;
  }

  elements.controlsToggle.addEventListener('click', () => {
    const isExpanded = elements.controlsToggle!.getAttribute('aria-expanded') === 'true';
    elements.controlsToggle!.setAttribute('aria-expanded', String(!isExpanded));
    elements.controlsBody!.hidden = isExpanded;

    const icon = elements.controlsToggle!.querySelector('.icon');
    if (icon) {
      icon.textContent = isExpanded ? '▶' : '▼';
    }
  });
}

/**
 * Bind event listeners
 */
function bindEvents() {
  if (elements.performanceFilter) {
    elements.performanceFilter.addEventListener('change', handleTierChange);
  }

  if (elements.cardSelect) {
    elements.cardSelect.addEventListener('change', handleCardSelectionChange);
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

  setupControlsToggle();

  // Handle window resize
  window.addEventListener('resize', () => {
    if (state.resizeTimer) {
      window.clearTimeout(state.resizeTimer);
    }
    state.resizeTimer = window.setTimeout(() => {
      renderChart();
    }, 150);
  });
}

/**
 * Initialize the page
 */
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
  if (elements.tabHome) {
    elements.tabHome.href = buildHomeUrl();
  }
  if (elements.tabAnalysis) {
    elements.tabAnalysis.href = buildAnalysisUrl();
  }

  const trendsData = await fetchTrendsData(archetypeName);

  if (!trendsData || trendsData.tournaments.length < 2) {
    setPageState('ready');
    showEmptyState();
    return;
  }

  state.trendsData = trendsData;

  setPageState('ready');
  populateCardSelect();
  renderSummary();
  renderChart();
  renderMovers();
}

// Initialize
bindEvents();
init();
