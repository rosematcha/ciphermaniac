/* eslint-disable id-length, curly, prefer-destructuring, one-var, no-param-reassign */
/**
 * Archetype Trends Page - Redesigned v3 (Weekly Aggregation)
 * Displays weekly time-series trend data, copy count evolution, and deck building insights.
 * Features:
 * - Weekly playrate trends
 * - Copy count distribution charts
 * - Automated insights (Core/Flex/Risers/Fallers)
 * - Substitution patterns
 */
import './utils/buildVersion.js';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { PERFORMANCE_TIER_LABELS } from './data/performanceTiers.js';

// --- Interfaces ---

interface TrendsMeta {
  generatedAt: string;
  tournamentCount: number;
  cardCount: number;
  weekCount: number;
  dayCount: number;
  windowStart: string;
  windowEnd: string;
}

interface WeekEntry {
  weekStart: string;
  weekEnd: string;
  tournamentIds: string[];
  totals: {
    all: number;
    winner?: number;
    top8?: number;
    [key: string]: number | undefined;
  };
}

interface DayEntry {
  date: string;
  tournamentIds: string[];
  totals: {
    all: number;
    winner?: number;
    top8?: number;
    [key: string]: number | undefined;
  };
}

interface CardTimelineWeek {
  count: number;
  avg: number;
  mode: number;
  dist: number[]; // [0-count, 1-count, 2-count, 3-count, 4+ count]
}

interface CopyTrendWeek {
  avg: number;
  mode: number;
  dist: number[]; // [1-count, 2-count, 3-count, 4+ count] (excludes 0)
}

interface EnhancedCardEntry {
  name: string;
  set: string | null;
  number: string | null;
  category: 'core' | 'staple' | 'flex' | 'tech' | 'emerging' | 'fading';
  currentPlayrate: number;
  currentAvgCopies: number;
  currentModeCopies: number;
  playrateChange: number;
  copiesChange: number;
  volatility: number;
  timeline: {
    [weekIndex: string]: {
      [tier: string]: CardTimelineWeek;
    };
  };
  timelineDays?: {
    [dayIndex: string]: {
      [tier: string]: CardTimelineWeek;
    };
  };
  copyTrend: CopyTrendWeek[];
}

interface Insights {
  coreCards: string[];
  flexSlots: Array<{ uid: string; variance: number; copyRange: [number, number] }>;
  risers: Array<{ uid: string; delta: number; from: number; to: number }>;
  fallers: Array<{ uid: string; delta: number; from: number; to: number }>;
  substitutions: Array<{ cardA: string; cardB: string; correlation: number }>;
}

interface MatchupStats {
  opponent: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  winRate: number;
}

interface TrendsData {
  meta: TrendsMeta;
  weeks: WeekEntry[];
  days: DayEntry[];
  cards: Record<string, EnhancedCardEntry>;
  insights: Insights;
  matchups: Record<string, MatchupStats>;
}

interface ChartLine {
  card: EnhancedCardEntry;
  color: string;
  points: {
    index: number;
    date: string;
    share: number;
    count: number;
    total: number;
  }[];
}

// Internal app state
interface AppState {
  archetypeName: string;
  archetypeSlug: string;
  trendsData: TrendsData | null;
  selectedTier: string;
  selectedCards: Set<string>; // UIDs
  categoryFilter: 'all' | 'core' | 'staple' | 'flex' | 'tech' | 'emerging' | 'fading';
  sortBy: 'playrate' | 'trending' | 'name' | 'copies' | 'volatility';
  timeScale: 'daily' | 'weekly';
  resizeTimer: number | null;
  activeCopyCard: string | null; // UID for copy evolution chart
  chartLines: ChartLine[];
  showAllMatchups: boolean; // Whether to show all matchups or just top 10
}

// --- Constants & Config ---

const R2_BASE_URL = CONFIG.API.R2_BASE;

// Vibrant, distinct palette for charts
const PALETTE = [
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

const CATEGORY_LABELS: Record<string, string> = {
  core: 'Core',
  staple: 'Staple',
  flex: 'Flex',
  tech: 'Tech',
  emerging: 'Emerging',
  fading: 'Fading'
};

// --- DOM Elements ---

const elements = {
  page: document.querySelector('.archetype-page') as HTMLElement | null,
  loading: document.getElementById('archetype-loading'),
  error: document.getElementById('archetype-error'),
  simple: document.querySelector('.archetype-simple') as HTMLElement | null,
  title: document.getElementById('archetype-title'),

  // Navigation
  tabHome: document.getElementById('tab-home') as HTMLAnchorElement | null,
  tabAnalysis: document.getElementById('tab-analysis') as HTMLAnchorElement | null,
  tabTrends: document.getElementById('tab-trends') as HTMLAnchorElement | null,

  // Controls
  performanceFilter: document.getElementById('trends-performance-filter') as HTMLSelectElement | null,
  metaInfo: document.getElementById('trends-meta-info') as HTMLElement | null,

  // Stats
  statsSection: document.getElementById('trends-stats') as HTMLElement | null,
  statWeeks: document.getElementById('stat-weeks'),
  statTournaments: document.getElementById('stat-tournaments'),
  statCards: document.getElementById('stat-cards'),
  statRange: document.getElementById('stat-range'),

  // Insights
  insightsSection: document.getElementById('trends-insights') as HTMLElement | null,
  insightCore: document.getElementById('insight-core'),
  insightFlex: document.getElementById('insight-flex'),
  insightRising: document.getElementById('insight-rising'),
  insightFalling: document.getElementById('insight-falling'),

  coreCount: document.getElementById('core-count'),
  flexCount: document.getElementById('flex-count'),
  risingCount: document.getElementById('rising-count'),
  fallingCount: document.getElementById('falling-count'),

  coreList: document.getElementById('core-cards-list'),
  flexList: document.getElementById('flex-cards-list'),
  risingList: document.getElementById('rising-cards-list'),
  fallingList: document.getElementById('falling-cards-list'),

  substitutionsSection: document.getElementById('substitutions-section'),
  substitutionsList: document.getElementById('substitutions-list'),

  // Matchups
  matchupsSection: document.getElementById('trends-matchups'),
  matchupsList: document.getElementById('matchups-list'),
  matchupsToggle: document.getElementById('matchups-toggle') as HTMLButtonElement | null,

  // Copy Evolution
  copyEvolutionSection: document.getElementById('copy-evolution'),
  copyCardSelect: document.getElementById('copy-card-select') as HTMLSelectElement | null,
  copyChart: document.getElementById('copy-chart'),
  copyStats: document.getElementById('copy-stats'),
  copyAvgCurrent: document.getElementById('copy-avg-current'),
  copyModeCurrent: document.getElementById('copy-mode-current'),
  copyChange: document.getElementById('copy-change'),

  // Main Chart
  chartContainer: document.getElementById('trends-chart-container'),
  chartSubtitle: document.getElementById('chart-subtitle'),
  chart: document.getElementById('trends-chart'),
  chartLegend: document.getElementById('trends-chart-legend'),
  toggleWeekly: document.getElementById('chart-toggle-weekly'),
  toggleDaily: document.getElementById('chart-toggle-daily'),

  // Card List
  cardListSection: document.getElementById('trends-card-list'),
  cardCategoryFilter: document.getElementById('card-category-filter') as HTMLSelectElement | null,
  cardSortSelect: document.getElementById('card-sort') as HTMLSelectElement | null,
  cardListBody: document.getElementById('card-list-body'),

  // Empty State
  emptyState: document.getElementById('trends-empty')
};

const state: AppState = {
  archetypeName: '',
  archetypeSlug: '',
  trendsData: null,
  selectedTier: 'top8',
  selectedCards: new Set(),
  categoryFilter: 'all',
  sortBy: 'playrate',
  timeScale: 'daily',
  resizeTimer: null,
  activeCopyCard: null,
  chartLines: [],
  showAllMatchups: false
};

// --- Utilities ---

function formatPercent(value: number): string {
  const pct = Math.round(value * 10) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

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

function buildCardUrl(card: { name: string; set: string | null; number: string | null }): string {
  if (card.set && card.number) {
    return `/card/${card.set}~${card.number}`;
  }
  return `/cards?card=${encodeURIComponent(card.name)}`;
}

function getCardColor(uid: string): string {
  if (!state.selectedCards.has(uid)) return '';
  const index = Array.from(state.selectedCards).indexOf(uid);
  return PALETTE[index % PALETTE.length];
}

// --- Data Fetching ---

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

// --- Rendering: Stats ---

function renderStats() {
  if (!state.trendsData || !elements.statsSection) return;
  const { meta } = state.trendsData;

  if (elements.statWeeks) elements.statWeeks.textContent = String(meta.weekCount);
  if (elements.statTournaments) elements.statTournaments.textContent = String(meta.tournamentCount);
  if (elements.statCards) elements.statCards.textContent = String(meta.cardCount);
  if (elements.statRange) {
    elements.statRange.textContent = `${formatDate(meta.windowStart)} – ${formatDate(meta.windowEnd)}`;
  }

  elements.statsSection.hidden = false;

  if (elements.metaInfo) {
    const tierLabel = PERFORMANCE_TIER_LABELS[state.selectedTier] || state.selectedTier;
    elements.metaInfo.textContent = `${meta.tournamentCount} tournaments, ${tierLabel}`;
  }
}

// --- Rendering: Insights ---

function renderInsights() {
  if (!state.trendsData || !elements.insightsSection) return;
  const { insights, cards } = state.trendsData;

  // 1. Core Cards
  if (elements.coreCount) elements.coreCount.textContent = String(insights.coreCards.length);
  if (elements.coreList) {
    elements.coreList.innerHTML = insights.coreCards.length ? '' : '<li class="muted">No core cards identified</li>';
    insights.coreCards.slice(0, 5).forEach(uid => {
      const card = cards[uid];
      if (card) {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${buildCardUrl(card)}" class="insight-link">${card.name}</a>`;
        elements.coreList!.appendChild(li);
      }
    });
  }

  // 2. Flex Slots
  if (elements.flexCount) elements.flexCount.textContent = String(insights.flexSlots.length);
  if (elements.flexList) {
    elements.flexList.innerHTML = insights.flexSlots.length ? '' : '<li class="muted">No highly variable slots</li>';
    insights.flexSlots.slice(0, 5).forEach(slot => {
      const card = cards[slot.uid];
      if (card) {
        const li = document.createElement('li');
        li.innerHTML = `
          <a href="${buildCardUrl(card)}" class="insight-link">
            <span>${card.name}</span>
            <span class="insight-meta">${slot.copyRange[0]}-${slot.copyRange[1]} copies</span>
          </a>`;
        elements.flexList!.appendChild(li);
      }
    });
  }

  // 3. Risers
  if (elements.risingCount) elements.risingCount.textContent = String(insights.risers.length);
  if (elements.risingList) {
    elements.risingList.innerHTML = insights.risers.length ? '' : '<li class="muted">No significant risers</li>';
    insights.risers.forEach(item => {
      const card = cards[item.uid];
      if (card) {
        const li = document.createElement('li');
        li.innerHTML = `
          <a href="${buildCardUrl(card)}" class="insight-link">
            <span>${card.name}</span>
            <span class="trend-up">+${item.delta.toFixed(1)}%</span>
          </a>`;
        elements.risingList!.appendChild(li);
      }
    });
  }

  // 4. Fallers
  if (elements.fallingCount) elements.fallingCount.textContent = String(insights.fallers.length);
  if (elements.fallingList) {
    elements.fallingList.innerHTML = insights.fallers.length ? '' : '<li class="muted">No significant fallers</li>';
    insights.fallers.forEach(item => {
      const card = cards[item.uid];
      if (card) {
        const li = document.createElement('li');
        li.innerHTML = `
          <a href="${buildCardUrl(card)}" class="insight-link">
            <span>${card.name}</span>
            <span class="trend-down">${item.delta.toFixed(1)}%</span>
          </a>`;
        elements.fallingList!.appendChild(li);
      }
    });
  }

  elements.insightsSection.hidden = false;

  // Substitutions
  if (elements.substitutionsSection && elements.substitutionsList) {
    if (insights.substitutions.length > 0) {
      elements.substitutionsList.innerHTML = '';
      insights.substitutions.forEach(sub => {
        const c1 = cards[sub.cardA];
        const c2 = cards[sub.cardB];
        if (c1 && c2) {
          const div = document.createElement('div');
          div.className = 'substitution-card';
          div.innerHTML = `
            <div class="sub-pair">
              <a href="${buildCardUrl(c1)}">${c1.name}</a>
              <span class="sub-arrow">↔</span>
              <a href="${buildCardUrl(c2)}">${c2.name}</a>
            </div>
            <div class="sub-meta">Strong negative correlation (${sub.correlation.toFixed(2)})</div>
          `;
          elements.substitutionsList!.appendChild(div);
        }
      });
      elements.substitutionsSection.hidden = false;
    } else {
      elements.substitutionsSection.hidden = true;
    }
  }
}

// --- Rendering: Matchups ---

const MAX_MATCHUPS_DEFAULT = 10;

function renderMatchups() {
  if (!state.trendsData || !elements.matchupsSection || !elements.matchupsList) return;
  const { matchups } = state.trendsData;

  if (!matchups || Object.keys(matchups).length === 0) {
    elements.matchupsSection.hidden = true;
    return;
  }

  const allRows = Object.values(matchups).sort((a, b) => b.total - a.total);
  const totalMatchups = allRows.length;
  const showAll = state.showAllMatchups;
  const rows = showAll ? allRows : allRows.slice(0, MAX_MATCHUPS_DEFAULT);

  elements.matchupsList.innerHTML = '';
  rows.forEach(mt => {
    const tr = document.createElement('tr');

    // Determine winrate class - winRate is now 0-100 percentage
    let wrClass = 'winrate-mid';
    if (mt.winRate > 55) wrClass = 'winrate-high';
    else if (mt.winRate < 45) wrClass = 'winrate-low';

    tr.innerHTML = `
      <td class="col-opponent">${mt.opponent}</td>
      <td class="col-winrate">
        <span class="${wrClass}">${mt.winRate.toFixed(1)}%</span>
      </td>
      <td class="col-record">${mt.wins}-${mt.losses}-${mt.ties}</td>
      <td class="col-total">${mt.total}</td>
    `;
    elements.matchupsList!.appendChild(tr);
  });

  // Add toggle button if there are more than MAX_MATCHUPS_DEFAULT
  if (totalMatchups > MAX_MATCHUPS_DEFAULT && elements.matchupsToggle) {
    elements.matchupsToggle.textContent = showAll ? `Show Top ${MAX_MATCHUPS_DEFAULT}` : `Show All (${totalMatchups})`;
    elements.matchupsToggle.hidden = false;
  } else if (elements.matchupsToggle) {
    elements.matchupsToggle.hidden = true;
  }

  elements.matchupsSection.hidden = false;
}

// --- Rendering: Copy Evolution Chart ---

function renderCopyEvolution() {
  if (!state.trendsData || !elements.copyEvolutionSection || !elements.copyChart) return;

  const { cards, weeks } = state.trendsData;
  const cardId = state.activeCopyCard;

  // Populate dropdown if empty
  if (elements.copyCardSelect && elements.copyCardSelect.options.length <= 1) {
    const sortedCards = Object.entries(cards)
      .filter(([_, c]) => c.currentPlayrate > 5) // Only show relevant cards
      .sort((a, b) => b[1].currentPlayrate - a[1].currentPlayrate);

    sortedCards.forEach(([uid, card]) => {
      const option = document.createElement('option');
      option.value = uid;
      option.textContent = card.name;
      elements.copyCardSelect!.appendChild(option);
    });
  }

  if (!cardId || !cards[cardId]) {
    elements.copyChart.innerHTML = '<div class="chart-placeholder">Select a card to see copy evolution</div>';
    if (elements.copyStats) elements.copyStats.hidden = true;
    return;
  }

  const card = cards[cardId];
  const chartWidth = elements.copyChart.clientWidth || 800;
  const chartHeight = 240;
  const padX = 40;
  const padY = 20;
  const contentWidth = chartWidth - padX * 2;
  const contentHeight = chartHeight - padY * 2;

  // Prepare data: stacked bars for 1, 2, 3, 4 copies
  // We use card.copyTrend which aligns with weeks
  const data = card.copyTrend;

  // Calculate max stack height (should represent 100% of decks running the card)
  // Actually, copyTrend dist sums to the total decks WITH the card.
  // We want to visualize the distribution of copies among decks that play it.

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`);
  svg.setAttribute('class', 'copy-evolution-svg');

  const barWidth = Math.min(40, (contentWidth / data.length) * 0.8);
  const gap = (contentWidth - barWidth * data.length) / (data.length + 1);

  // Colors for 1, 2, 3, 4 copies
  const copyColors = ['#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8']; // Shades of blue

  data.forEach((weekData, i) => {
    const total = weekData.dist.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    let currentY = chartHeight - padY;
    const x = padX + gap + i * (barWidth + gap);

    // Draw stacks for 1, 2, 3, 4 copies
    // weekData.dist is [1-count, 2-count, 3-count, 4-count]
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

        // Tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${copyIndex + 1} Copy: ${Math.round(pct * 100)}% (${count} decks)\nWeek of ${formatDate(weeks[i].weekStart)}`;
        rect.appendChild(title);

        svg.appendChild(rect);
        currentY -= h;
      }
    });

    // X-Axis Label (Week)
    if (i % 2 === 0 || data.length < 8) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x + barWidth / 2));
      text.setAttribute('y', String(chartHeight - 2));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'chart-axis-label');
      text.textContent = formatDate(weeks[i].weekStart);
      svg.appendChild(text);
    }
  });

  elements.copyChart.innerHTML = '';
  elements.copyChart.appendChild(svg);

  // Update Copy Stats
  if (elements.copyAvgCurrent) elements.copyAvgCurrent.textContent = card.currentAvgCopies.toFixed(2);
  if (elements.copyModeCurrent) elements.copyModeCurrent.textContent = String(card.currentModeCopies);
  if (elements.copyChange) {
    const sign = card.copiesChange > 0 ? '+' : '';
    elements.copyChange.textContent = `${sign}${card.copiesChange.toFixed(2)}`;
    elements.copyChange.className = `copy-stat-value ${card.copiesChange > 0 ? 'trend-up' : card.copiesChange < 0 ? 'trend-down' : ''}`;
  }

  elements.copyEvolutionSection.hidden = false;
  if (elements.copyStats) elements.copyStats.hidden = false;
}

// --- Rendering: Main Trend Chart ---

function renderChart() {
  if (!elements.chart || !state.trendsData) return;

  const { weeks, days, cards } = state.trendsData;
  const tier = state.selectedTier;
  const isDaily = state.timeScale === 'daily';

  // Always use daily data from backend - aggregate to weekly on frontend if needed
  if (!days || days.length === 0) return;

  elements.chart.innerHTML = '';

  // Build day-to-week mapping for weekly aggregation
  const dayToWeekIdx = new Map<number, number>();
  if (!isDaily && weeks) {
    days.forEach((day, dayIdx) => {
      const weekIdx = weeks.findIndex(wk => day.date >= wk.weekStart && day.date <= wk.weekEnd);
      if (weekIdx >= 0) {
        dayToWeekIdx.set(dayIdx, weekIdx);
      }
    });
  }

  const timeData = isDaily ? days : weeks;
  if (!timeData || timeData.length === 0) return;

  const lines: ChartLine[] = Array.from(state.selectedCards)
    .map(uid => cards[uid])
    .filter(Boolean)
    .map((card, idx) => {
      let points: ChartLine['points'];

      if (isDaily) {
        // Daily: direct mapping - timeline is keyed by day index
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
        // Weekly: aggregate daily timeline data into weeks
        points = weeks.map((weekEntry, weekIdx) => {
          let totalCount = 0;
          let totalDecks = 0;

          // Sum up all days in this week
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

  state.chartLines = lines; // Save for legend

  if (lines.length === 0) {
    if (elements.chartSubtitle)
      elements.chartSubtitle.textContent = 'Select cards from the list below to chart their playrate';
    if (elements.chartLegend) elements.chartLegend.innerHTML = '';
    return;
  }

  if (elements.chartSubtitle) {
    elements.chartSubtitle.textContent = `Showing ${lines.length} card${lines.length === 1 ? '' : 's'} (${isDaily ? 'Daily' : 'Weekly'})`;
  }

  // Chart dimensions
  const containerRect = elements.chart.getBoundingClientRect();
  const width = Math.max(320, Math.round(containerRect.width || 800));
  const height = Math.min(400, Math.max(260, width * 0.4));
  const padX = 48;
  const padY = 32;
  const contentWidth = width - padX * 2;
  const contentHeight = height - padY * 2;

  // Scales
  const allShares = lines.flatMap(l => l.points.map(p => p.share));
  const maxShare = Math.max(10, Math.ceil(Math.max(...allShares) * 1.1));

  const xScale = (idx: number) => padX + (idx / (timeData.length - 1)) * contentWidth;
  const yScale = (share: number) => height - padY - (share / maxShare) * contentHeight;

  // SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('trends-svg-v2');
  svg.setAttribute('role', 'img');

  // Grid
  const gridSteps = 5;
  for (let i = 0; i <= gridSteps; i++) {
    const val = (maxShare / gridSteps) * i;
    const y = yScale(val);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(padX));
    line.setAttribute('x2', String(width - padX));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'rgba(124,134,168,0.15)');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(padX - 8));
    text.setAttribute('y', String(y + 4));
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('class', 'chart-axis-label');
    text.textContent = `${Math.round(val)}%`;

    svg.appendChild(line);
    svg.appendChild(text);
  }

  // Draw Lines
  lines.forEach(line => {
    const d = line.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.index)} ${yScale(p.share)}`).join(' ');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', line.color);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    // Points
    line.points.forEach(p => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(xScale(p.index)));
      circle.setAttribute('cy', String(yScale(p.share)));
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', line.color);
      circle.setAttribute('stroke', '#0c1020');
      circle.setAttribute('stroke-width', '1.5');
      circle.classList.add('chart-point');

      // Interaction data
      circle.dataset.name = line.card.name;
      circle.dataset.share = p.share.toFixed(1);
      circle.dataset.date = formatDate(p.date);

      // Tooltip logic (simplified inline for brevity, better to use shared tooltip)
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${line.card.name}\n${formatDate(p.date)}: ${p.share.toFixed(1)}%`;
      circle.appendChild(title);

      svg.appendChild(circle);
    });
  });

  // X-Axis Labels
  const maxLabels = 8;
  const skip = Math.ceil(timeData.length / maxLabels);

  timeData.forEach((entry, i) => {
    // Show label logic: first, last, and every 'skip' in between
    if (i !== 0 && i !== timeData.length - 1 && i % skip !== 0) return;

    const dateStr = isDaily ? (entry as DayEntry).date : (entry as WeekEntry).weekStart;

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(xScale(i)));
    text.setAttribute('y', String(height - 5));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'chart-axis-label');
    text.textContent = formatDate(dateStr);
    svg.appendChild(text);
  });

  elements.chart.appendChild(svg);
  if (elements.chartContainer) elements.chartContainer.hidden = false;

  renderLegend();
}

function renderLegend() {
  if (!elements.chartLegend || !state.chartLines) return;
  elements.chartLegend.innerHTML = '';

  state.chartLines.forEach(line => {
    const div = document.createElement('div');
    div.className = 'legend-item-v2';
    div.innerHTML = `
      <span class="legend-swatch" style="background-color: ${line.color}"></span>
      <span class="legend-name">${line.card.name}</span>
      <span class="legend-value">${formatPercent(line.card.currentPlayrate)}</span>
    `;
    elements.chartLegend!.appendChild(div);
  });
}

// --- Rendering: Card List ---

function renderSparkline(card: EnhancedCardEntry): string {
  const width = 80;
  const height = 24;
  const tier = state.selectedTier;
  const isDaily = state.timeScale === 'daily';

  const days = state.trendsData?.days;
  const weeks = state.trendsData?.weeks;
  if (!days || days.length === 0) return '';

  let points: number[];

  if (isDaily) {
    // Daily: direct mapping
    points = days.map((entry, idx) => {
      const entryData = card.timeline[idx]?.[tier];
      const total = entry.totals[tier] || entry.totals.all || 1;
      return entryData ? (entryData.count / total) * 100 : 0;
    });
  } else {
    // Weekly: aggregate daily data
    if (!weeks) return '';
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

  if (points.length < 2) return '';

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

function renderCardList() {
  if (!state.trendsData || !elements.cardListBody || !elements.cardListSection) return;

  const { cards } = state.trendsData;
  let rows = Object.values(cards);

  // Filter
  if (state.categoryFilter !== 'all') {
    rows = rows.filter(c => c.category === state.categoryFilter);
  }

  // Sort
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
    // Generate UID by name if set/number missing (fallback)
    const uid = Object.keys(cards).find(key => cards[key] === card) || card.name;
    const isSelected = state.selectedCards.has(uid);
    const color = getCardColor(uid);
    const cardUrl = buildCardUrl(card);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-chart">
        <label class="chart-checkbox">
          <input type="checkbox" data-uid="${uid}" ${isSelected ? 'checked' : ''} aria-label="Toggle ${card.name}">
          <span class="checkbox-indicator" ${color ? `style="background-color: ${color}"` : ''}></span>
        </label>
      </td>
      <td class="col-name">
        <a href="${cardUrl}">${card.name}</a>
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

    // Event listener for checkbox
    const checkbox = tr.querySelector('input');
    checkbox?.addEventListener('change', e => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) {
        if (state.selectedCards.size < 10) state.selectedCards.add(uid);
      } else {
        state.selectedCards.delete(uid);
      }
      renderChart();
      renderCardList(); // Re-render to update colors
    });

    elements.cardListBody!.appendChild(tr);
  });

  elements.cardListSection.hidden = false;
}

// --- Initialization & Events ---

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

function bindEvents() {
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

  // Tier Filter
  if (elements.performanceFilter) {
    elements.performanceFilter.addEventListener('change', () => {
      state.selectedTier = elements.performanceFilter!.value;
      renderChart();
      renderCardList();
      renderStats(); // Update meta info text
    });
  }

  // Category Filter
  if (elements.cardCategoryFilter) {
    elements.cardCategoryFilter.addEventListener('change', () => {
      state.categoryFilter = elements.cardCategoryFilter!.value as any;
      renderCardList();
    });
  }

  // Sort Filter
  if (elements.cardSortSelect) {
    elements.cardSortSelect.addEventListener('change', () => {
      state.sortBy = elements.cardSortSelect!.value as any;
      renderCardList();
    });
  }

  // Copy Evolution Dropdown
  if (elements.copyCardSelect) {
    elements.copyCardSelect.addEventListener('change', () => {
      state.activeCopyCard = elements.copyCardSelect!.value;
      renderCopyEvolution();
    });
  }

  // Chart Toggle
  if (elements.toggleWeekly && elements.toggleDaily) {
    elements.toggleWeekly.addEventListener('click', () => {
      if (state.timeScale === 'weekly') return;
      state.timeScale = 'weekly';
      elements.toggleWeekly!.classList.add('active');
      elements.toggleDaily!.classList.remove('active');
      renderChart();
      renderCardList();
    });
    elements.toggleDaily.addEventListener('click', () => {
      if (state.timeScale === 'daily') return;
      // Check if we have daily data
      if (!state.trendsData?.days || state.trendsData.days.length === 0) {
        console.warn('No daily data available');
        return;
      }

      state.timeScale = 'daily';
      elements.toggleDaily!.classList.add('active');
      elements.toggleWeekly!.classList.remove('active');
      renderChart();
      renderCardList();
    });
  }

  // Matchups Toggle
  if (elements.matchupsToggle) {
    elements.matchupsToggle.addEventListener('click', () => {
      state.showAllMatchups = !state.showAllMatchups;
      renderMatchups();
    });
  }

  // Resize Handler
  window.addEventListener('resize', () => {
    if (state.resizeTimer) clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => {
      renderChart();
      renderCopyEvolution();
    }, 200);
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

  // Update nav links
  if (elements.tabHome) elements.tabHome.href = buildHomeUrl();
  if (elements.tabAnalysis) elements.tabAnalysis.href = buildAnalysisUrl();

  const data = await fetchTrendsData(state.archetypeSlug);

  if (!data || !data.weeks || data.weeks.length < 2) {
    setPageState('ready');
    if (elements.emptyState) elements.emptyState.hidden = false;
    return;
  }

  state.trendsData = data;

  // Initial Selection: Top 5 Core/Staple cards
  const initialCards = Object.entries(data.cards)
    .sort((a, b) => b[1].currentPlayrate - a[1].currentPlayrate)
    .slice(0, 5)
    .map(([uid]) => uid);
  state.selectedCards = new Set(initialCards);

  // Initial Copy Card: Most popular card
  if (initialCards.length > 0) {
    state.activeCopyCard = initialCards[0];
  }

  setPageState('ready');
  if (elements.emptyState) elements.emptyState.hidden = true;

  renderStats();
  renderInsights();
  renderMatchups();
  renderChart();
  renderCardList();
  renderCopyEvolution();
}

// Start
bindEvents();
init();
