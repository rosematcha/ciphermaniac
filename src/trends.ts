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
import { getPerformanceLabel } from './data/performanceTiers.js';
import { buildThumbCandidates } from './thumbs.js';
import type { Deck, TrendReport } from './types/index.js';

type TrendSeries = TrendDataset['series'][number];
type TrendTimelineEntry = TrendSeries['timeline'][number];
type TrendsMode = 'meta' | 'archetypes';

interface TrendSharePoint {
  date: string;
  share: number;
  decks?: number;
  totalDecks?: number;
}

interface TrendTimelinePoint {
  date?: string | null;
  share?: number;
  totalDecks?: number;
  total?: number;
}

interface MetaLine {
  name: string;
  color: string;
  points: number[];
  latestPointShare: number;
  windowShare: number;
  delta: number;
}

interface MetaChart {
  dates: string[];
  lines: MetaLine[];
}

interface TrendTournament {
  id: string;
  name: string;
  date: string;
  players: number | string | null;
  format: string | null;
  platform: string | null;
  organizer: string | null;
}

interface CardTrendMover {
  name: string;
  set?: string | null;
  number?: string | null;
  archetype?: string | null;
  recentAvg?: number;
  latest?: number;
  currentShare?: number;
  endShare?: number;
  startShare?: number;
  avgShare?: number;
  absDrop?: number;
  deltaAbs?: number;
  delta?: number;
}

interface CardMoversPayload {
  rising?: CardTrendMover[];
  falling?: CardTrendMover[];
}

interface NormalizedCardMover {
  name: string;
  set: string | null;
  number: string | null;
  latest: number;
  delta: number;
}

interface DisplayCardMover extends NormalizedCardMover {
  variantCount: number;
}

type CardTrendsState = CardTrendDataset | CardMoversPayload | null;

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
  cardTrends: CardTrendsState;
  rawDecks: Deck[] | null;
  rawTournaments: TrendTournament[] | null;
  isLoading: boolean;
  isHydrating: boolean;
  minAppearances: number;
  mode: TrendsMode;
  performanceFilter: string;
  chartDensity: number;
  timeRangeDays: number;
  resizeTimer: number | null;
  archetypeThumbnails: Map<string, string[]>;
  thumbIndexLoading: boolean;
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
  resizeTimer: null,
  archetypeThumbnails: new Map(),
  thumbIndexLoading: false
};

function setStatus(message: string | null | undefined): void {
  if (elements.status) {
    elements.status.textContent = message || '';
    // Ensure status updates are announced to screen readers
    if (!elements.status.hasAttribute('role')) {
      elements.status.setAttribute('role', 'status');
      elements.status.setAttribute('aria-live', 'polite');
    }
  }
}

function setLoadingMeta(isLoading: boolean): void {
  if (!elements.loadingMeta) {
    return;
  }
  elements.loadingMeta.style.display = isLoading ? 'block' : 'none';
}

function setLoadingArchetypes(isLoading: boolean): void {
  if (!elements.loadingArch) {
    return;
  }
  elements.loadingArch.style.display = isLoading ? 'block' : 'none';
}

function setLoading(isLoading: boolean): void {
  state.isLoading = isLoading;
  setLoadingMeta(isLoading);
  setLoadingArchetypes(isLoading);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown date';
  }
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPercent(value: number): string {
  const pct = Math.round(value * 10) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const normalized = Math.abs(rounded) < 0.05 ? 0 : rounded;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(Math.abs(normalized) % 1 === 0 ? 0 : 1)}%`;
}

function normalizeLookupKey(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildFallbackLabel(value: string, maxWords = 2): string {
  const parts = value
    .replace(/_/g, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, maxWords);
  if (!parts.length) {
    return '?';
  }
  return parts.map(part => part[0]?.toUpperCase() || '').join('');
}

function buildArchetypeHref(name: string): string {
  return `/${name.replace(/\s+/g, '_')}`;
}

function buildCardHref(card: NormalizedCardMover): string {
  if (card.set && card.number) {
    return `/card/${encodeURIComponent(card.set)}~${encodeURIComponent(card.number)}`;
  }
  return `/cards?q=${encodeURIComponent(card.name)}`;
}

function normalizeCardMover(item: CardTrendMover): NormalizedCardMover {
  const latest =
    item.recentAvg ?? item.latest ?? item.currentShare ?? item.endShare ?? item.startShare ?? item.avgShare ?? 0;

  // For cooling cards, absDrop is reported as positive; convert to negative for UI consistency.
  const delta =
    item.absDrop !== undefined && item.absDrop !== null
      ? -Math.abs(item.absDrop)
      : (item.deltaAbs ?? item.delta ?? 0);

  return {
    name: item.name,
    set: item.set || null,
    number: item.number || null,
    latest,
    delta
  };
}

function parseSetNumber(value: string | null | undefined): { set: string; number: string } | null {
  if (!value) {
    return null;
  }
  const [setRaw, numberRaw] = value.split('/');
  const set = String(setRaw || '').trim();
  const number = String(numberRaw || '').trim();
  if (!set || !number) {
    return null;
  }
  return { set, number };
}

function getArchetypeThumbUrl(archetypeName: string): string | null {
  const normalized = normalizeLookupKey(archetypeName);
  if (!normalized || !state.archetypeThumbnails.size) {
    return null;
  }

  const direct = state.archetypeThumbnails.get(normalized);
  const candidates =
    direct ||
    Array.from(state.archetypeThumbnails.entries()).find(
      ([key]) => normalized.includes(key) || key.includes(normalized)
    )?.[1] ||
    null;

  const firstCard = parseSetNumber(candidates?.[0] || null);
  if (!firstCard) {
    return null;
  }
  return buildThumbCandidates(archetypeName, false, undefined, firstCard)[0] || null;
}

function getCardThumbUrl(card: NormalizedCardMover): string | null {
  if (!card.set || !card.number) {
    return null;
  }
  return buildThumbCandidates(card.name, false, undefined, { set: card.set, number: card.number })[0] || null;
}

function createMoverMedia(name: string, mediaUrl: string | null): HTMLElement {
  const media = document.createElement('span');
  media.className = 'mover-media';
  if (mediaUrl) {
    const img = document.createElement('img');
    img.src = mediaUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    media.appendChild(img);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'mover-media-fallback';
    fallback.textContent = buildFallbackLabel(name);
    media.appendChild(fallback);
  }
  return media;
}

async function loadArchetypeThumbnails(): Promise<void> {
  if (state.thumbIndexLoading || state.archetypeThumbnails.size) {
    return;
  }
  state.thumbIndexLoading = true;
  try {
    const response = await fetch('/assets/data/archetype-thumbnails.json', { cache: 'force-cache' });
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as Record<string, string[]>;
    const nextMap = new Map<string, string[]>();
    Object.entries(data || {}).forEach(([name, cards]) => {
      const key = normalizeLookupKey(name);
      if (!key || !Array.isArray(cards)) {
        return;
      }
      nextMap.set(key, cards.filter(Boolean));
    });
    state.archetypeThumbnails = nextMap;
    if (state.trendData) {
      renderMetaChart();
      renderCardMovers(state.cardTrends);
    }
  } catch (error) {
    logger.warn('Unable to load archetype thumbnails for trends media', { message: error?.message || error });
  } finally {
    state.thumbIndexLoading = false;
  }
}

function smoothSeries(series: TrendSharePoint[], window = 3): TrendSharePoint[] {
  if (!Array.isArray(series) || series.length === 0) {
    return series;
  }
  const w = Math.max(1, window);
  const result: TrendSharePoint[] = [];
  for (let i = 0; i < series.length; i += 1) {
    const slice = series.slice(Math.max(0, i - Math.floor(w / 2)), Math.min(series.length, i + Math.ceil(w / 2) + 1));
    const avg = slice.reduce((sum, point) => sum + (point.share || 0), 0) / slice.length;
    result.push({ ...series[i], share: avg });
  }
  return result;
}

function binDaily(timeline: TrendTimelinePoint[]): TrendSharePoint[] {
  const byDay = new Map<string, { decks: number; totalDecks: number }>();
  (timeline || []).forEach(point => {
    if (!point?.date) {
      return;
    }
    const day = point.date.split('T')[0];
    const totalDecks = Number(point.totalDecks || point.total || 0);
    const fallbackTotal = totalDecks > 0 ? totalDecks : 1;
    const explicitDecks = Number((point as { decks?: number }).decks);
    const share = Number(point.share) || 0;
    const decks = Number.isFinite(explicitDecks) && explicitDecks >= 0 ? explicitDecks : (share / 100) * fallbackTotal;
    if (!byDay.has(day)) {
      byDay.set(day, { decks: 0, totalDecks: 0 });
    }
    const entry = byDay.get(day);
    if (!entry) {
      return;
    }
    entry.decks += decks;
    entry.totalDecks += fallbackTotal;
  });
  return Array.from(byDay.entries())
    .map(([date, val]) => ({
      date,
      decks: val.decks,
      totalDecks: val.totalDecks,
      share: val.totalDecks ? (val.decks / val.totalDecks) * 100 : 0
    }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function buildMetaLines(
  trendData: TrendDataset | null,
  topN = 8,
  timeRangeDays = 30,
  minAppearances = 1
): MetaChart | null {
  if (!trendData || !Array.isArray(trendData.series)) {
    return null;
  }

  // Calculate cutoff date for time filtering
  const anchor = trendData.windowEnd ? new Date(trendData.windowEnd) : new Date();
  const anchorMs = Number.isFinite(anchor.getTime()) ? anchor.getTime() : Date.now();
  const cutoffDate = new Date(anchorMs - timeRangeDays * 24 * 60 * 60 * 1000);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  // OPTIMIZATION: Single pass to compute bins, collect dates, and calculate ranking data
  // Previously: 3 separate passes over series data
  const allDatesSet = new Set<string>();
  const allSeriesWithBins: Array<{
    displayName?: string;
    base: string;
    rawDaily: TrendSharePoint[];
    daily: TrendSharePoint[];
    dailyByDate: Map<string, TrendSharePoint>;
    windowShare: number;
    latestPointShare: number;
    startShare: number;
    endShare: number;
  }> = [];

  for (const entry of trendData.series) {
    if (entry.appearances && entry.appearances < minAppearances) {
      continue;
    }

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
    const windowTotalDecks = filteredDaily.reduce((sum, point) => sum + (Number(point.totalDecks) || 0), 0);
    const windowDecks = filteredDaily.reduce((sum, point) => sum + (Number(point.decks) || 0), 0);
    const fallbackWindowShare = filteredDaily.length
      ? filteredDaily.reduce((sum, point) => sum + (Number(point.share) || 0), 0) / filteredDaily.length
      : 0;
    const windowShare = windowTotalDecks > 0 ? (windowDecks / windowTotalDecks) * 100 : fallbackWindowShare;
    const latestPointShare = smoothed.at(-1)?.share ?? 0;

    allSeriesWithBins.push({
      ...entry,
      rawDaily: filteredDaily,
      daily: smoothed,
      dailyByDate,
      windowShare,
      latestPointShare,
      startShare: 0,
      endShare: 0
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
    let startDecks = 0;
    let startTotalDecks = 0;
    let endDecks = 0;
    let endTotalDecks = 0;

    for (const pt of entry.rawDaily) {
      const decks = Number(pt.decks) || 0;
      const totalDecks = Number(pt.totalDecks) || 0;
      if (startDates.has(pt.date)) {
        startDecks += decks;
        startTotalDecks += totalDecks;
      }
      if (endDates.has(pt.date)) {
        endDecks += decks;
        endTotalDecks += totalDecks;
      }
    }

    entry.startShare = startTotalDecks ? (startDecks / startTotalDecks) * 100 : 0;
    entry.endShare = endTotalDecks ? (endDecks / endTotalDecks) * 100 : 0;
  }

  // Rank by weighted share across the selected window to reflect tournament results.
  const ranked = [...allSeriesWithBins]
    .filter(series => series.windowShare > 0.05) // ignore effectively zero-share noise
    .sort((a, b) => b.windowShare - a.windowShare || b.latestPointShare - a.latestPointShare);

  const selectedSeries = ranked.slice(0, topN);

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
  const lines: MetaLine[] = selectedSeries.map((entry, index) => {
    const color = palette[index % palette.length];
    const points = timelineDates.map(d => entry.dailyByDate.get(d)?.share ?? 0);
    const delta = Math.round((entry.endShare - entry.startShare) * 10) / 10;
    return {
      name: entry.displayName || entry.base,
      color,
      points,
      latestPointShare: points.at(-1) || 0,
      windowShare: Math.round(entry.windowShare * 10) / 10,
      delta
    };
  });

  return { dates: timelineDates, lines };
}

function normalizeTrendReport(report: TrendReport): TrendDataset {
  return {
    generatedAt: report.generatedAt,
    windowStart: report.windowStart,
    windowEnd: report.windowEnd,
    minAppearances: report.minAppearances,
    deckTotal: report.deckTotal,
    tournamentCount: report.tournamentCount,
    archetypeCount: report.archetypeCount,
    tournaments: (report.tournaments || []).map(tournament => ({
      id: tournament.id,
      name: tournament.name,
      date: tournament.date,
      deckTotal: typeof tournament.deckTotal === 'number' ? tournament.deckTotal : 0
    })),
    series: report.series.map(series => ({
      ...series,
      timeline: series.timeline.map(point => ({
        tournamentId: point.date || '',
        tournamentName: point.date || '',
        date: point.date || null,
        decks: typeof point.decks === 'number' ? point.decks : 0,
        success: (point as { success?: Record<string, number> }).success || {},
        totalDecks: point.totalDecks,
        share: typeof point.share === 'number' ? point.share : 0
      }))
    }))
  };
}

function findMovers(lines: MetaLine[]): { rising: MetaLine[]; falling: MetaLine[] } {
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

function renderLegend(lines: MetaLine[]): void {
  const { legend } = elements;
  if (!legend) {
    return;
  }
  legend.innerHTML = '';
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
    value.innerHTML = `${formatPercent(line.windowShare)} <span class="legend-delta ${deltaClass}">(${sign}${line.delta.toFixed(Math.abs(line.delta) % 1 === 0 ? 0 : 1)}%)</span>`;
    item.appendChild(swatch);
    item.appendChild(label);
    item.appendChild(value);
    legend.appendChild(item);
  });
}

function renderMovers(lines: MetaLine[]): void {
  if (!elements.movers) {
    return;
  }
  elements.movers.innerHTML = '';
  if (!lines || !lines.length) {
    return;
  }
  const { rising, falling } = findMovers(lines);
  const buildGroup = (title: string, items: MetaLine[], direction: 'up' | 'down') => {
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
    items.forEach((item, index) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'mover-link';
      link.href = buildArchetypeHref(item.name);

      const mediaUrl = getArchetypeThumbUrl(item.name);
      const media = createMoverMedia(item.name, mediaUrl);
      link.appendChild(media);

      const copy = document.createElement('span');
      copy.className = 'mover-copy';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;

      const share = document.createElement('span');
      share.className = 'perc';
      share.textContent = `#${index + 1} | ${formatPercent(item.windowShare)} share`;

      copy.appendChild(name);
      copy.appendChild(share);
      link.appendChild(copy);

      const delta = document.createElement('span');
      delta.className = `delta ${direction}`;
      delta.textContent = formatSignedPercent(item.delta);
      link.appendChild(delta);

      li.appendChild(link);
      list.appendChild(li);
    });
    group.appendChild(list);
    return group;
  };

  elements.movers.appendChild(buildGroup('Rising', rising, 'up'));
  elements.movers.appendChild(buildGroup('Cooling', falling, 'down'));
}

function aggregateCardMoverDirection(
  list: CardTrendMover[],
  direction: 'up' | 'down',
  includeZero = false
): DisplayCardMover[] {
  const normalized = (Array.isArray(list) ? list : []).map(normalizeCardMover).filter(item => item.name);
  const groups = new Map<
    string,
    {
      name: string;
      latest: number;
      delta: number;
      variants: Map<string, NormalizedCardMover>;
    }
  >();

  normalized.forEach(item => {
    const nameKey = normalizeLookupKey(item.name);
    if (!groups.has(nameKey)) {
      groups.set(nameKey, {
        name: item.name,
        latest: 0,
        delta: 0,
        variants: new Map()
      });
    }
    const group = groups.get(nameKey);
    if (!group) {
      return;
    }

    const variantKey = `${item.name}::${item.set || ''}::${item.number || ''}`;
    if (group.variants.has(variantKey)) {
      return;
    }
    group.variants.set(variantKey, item);
    group.latest += Math.max(0, item.latest || 0);
    if (direction === 'up') {
      group.delta += Math.max(0, item.delta || 0);
    } else {
      group.delta += Math.min(0, item.delta || 0);
    }
  });

  const merged = Array.from(groups.values())
    .map(group => {
      const variants = Array.from(group.variants.values());
      const preferred =
        variants.sort(
          (a, b) => (b.latest || 0) - (a.latest || 0) || Math.abs(b.delta || 0) - Math.abs(a.delta || 0)
        )[0] || null;
      return {
        name: group.name,
        set: preferred?.set || null,
        number: preferred?.number || null,
        latest: Math.min(100, Math.max(0, group.latest)),
        delta: Math.round(group.delta * 10) / 10,
        variantCount: variants.length
      } satisfies DisplayCardMover;
    })
    .filter(item => (direction === 'up' ? (includeZero ? item.delta >= 0 : item.delta > 0) : includeZero ? item.delta <= 0 : item.delta < 0))
    .sort((a, b) => (direction === 'up' ? b.delta - a.delta : a.delta - b.delta) || b.latest - a.latest)
    .slice(0, 8);

  return merged;
}

function renderCardMovers(cardTrends: CardTrendsState): void {
  if (!elements.cardMovers) {
    return;
  }
  elements.cardMovers.innerHTML = '';
  const risingList = (cardTrends && 'rising' in cardTrends ? cardTrends.rising : []) || [];
  const fallingList = (cardTrends && 'falling' in cardTrends ? cardTrends.falling : []) || [];

  // Pre-generated payloads can lag behind set reprints; if cooling cards collapse to 0,
  // trigger a one-time deck hydration so card trends are recomputed from raw decklists.
  const hasZeroCooling = fallingList.some(item => (normalizeCardMover(item).latest || 0) <= 0.05);
  if (hasZeroCooling && !state.rawDecks && !state.isHydrating) {
    void hydrateFromDecks();
  }

  if (!risingList.length && !fallingList.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Card movement will appear once enough tournaments are available.';
    elements.cardMovers.appendChild(empty);
    return;
  }

  const merged = {
    rising: aggregateCardMoverDirection(risingList, 'up'),
    falling: aggregateCardMoverDirection(fallingList, 'down')
  };

  if (!merged.rising.length && risingList.length) {
    merged.rising = aggregateCardMoverDirection(risingList, 'up', true);
  }
  if (!merged.falling.length && fallingList.length) {
    merged.falling = aggregateCardMoverDirection(fallingList, 'down', true);
  }

  const buildGroup = (title: string, list: DisplayCardMover[], direction: 'up' | 'down') => {
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
    items.forEach(item => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'mover-link mover-link--card';
      link.href = buildCardHref(item);

      link.appendChild(createMoverMedia(item.name, getCardThumbUrl(item)));

      const copy = document.createElement('span');
      copy.className = 'mover-copy';

      const name = document.createElement('span');
      name.className = 'name';
      const idLabel = item.set && item.number ? ` (${item.set} ${item.number})` : '';
      name.textContent = `${item.name}${idLabel}`;

      const share = document.createElement('span');
      share.className = 'perc';
      const printingsLabel = item.variantCount > 1 ? ` | ${item.variantCount} printings` : '';
      share.textContent = `Seen in ${formatPercent(item.latest || 0)} of decks${printingsLabel}`;

      copy.appendChild(name);
      copy.appendChild(share);
      link.appendChild(copy);

      const delta = document.createElement('span');
      delta.className = `delta ${direction}`;
      delta.textContent = formatSignedPercent(item.delta || 0);
      link.appendChild(delta);

      li.appendChild(link);
      ul.appendChild(li);
    });
    group.appendChild(ul);
    return group;
  };

  elements.cardMovers.appendChild(buildGroup('Cards rising', merged.rising, 'up'));
  elements.cardMovers.appendChild(buildGroup('Cards cooling', merged.falling, 'down'));
}
function deriveTournamentsFromDecks(decks: Deck[] | null | undefined): TrendTournament[] {
  const map = new Map<string, TrendTournament>();
  (Array.isArray(decks) ? decks : []).forEach(deck => {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId) {
      return;
    }
    if (!map.has(tournamentId)) {
      map.set(tournamentId, {
        id: tournamentId,
        name: deck?.tournamentName || 'Unknown Tournament',
        date: deck?.tournamentDate || '',
        players: deck?.tournamentPlayers || null,
        format: deck?.tournamentFormat || null,
        platform: deck?.tournamentPlatform || null,
        organizer: deck?.tournamentOrganizer || null
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => Date.parse(a.date || '') - Date.parse(b.date || ''));
}

function renderSummary(): void {
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

function updateMinSliderBounds(): void {
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

function buildSparkline(timeline: TrendTimelineEntry[]): string {
  const width = 220;
  const height = 56;
  const stroke = '#3b5bdb';
  const fill = 'rgba(59, 91, 219, 0.1)';
  const shares = timeline.map(entry => entry.share || 0);
  const maxShare = Math.max(...shares, 1);
  const count = timeline.length;

  const points = timeline.map((entry, index) => {
    const x = count === 1 ? width / 2 : (index / (count - 1)) * width;
    const share = typeof entry.share === 'number' && Number.isFinite(entry.share) ? entry.share : 0;
    const y = height - (share / maxShare) * height;
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

function renderSeriesCard(series: TrendSeries): HTMLElement {
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
  peak.textContent = `Peak share ${formatPercent(series.maxShare)}`;

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

function renderMetaChart(): void {
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
  let yMax = Math.max(1, Math.ceil(maxObserved * 2) / 2); // Round up to nearest 0.5
  let yMin = Math.floor(minObserved * 2) / 2; // Round down to nearest 0.5
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
  // Add accessible description for the chart
  const chartLabel = `Meta share trends chart showing ${metaChart.lines.length} archetypes from ${formatDate(metaChart.dates[0])} to ${formatDate(metaChart.dates[metaChart.dates.length - 1])}`;
  svg.setAttribute('aria-label', chartLabel);
  svg.classList.add('meta-svg');

  const formatAxisValue = (value: number) => (value % 1 === 0 ? `${value}%` : `${value.toFixed(1)}%`);

  // Choose a readable Y-axis interval and then snap bounds to it.
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
  guideLine.setAttribute('y2', String(height - padBottom));
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

  let activeArchetype: string | null = null;
  overlay.setAttribute('tabindex', '0');
  overlay.setAttribute('role', 'button');
  overlay.setAttribute('aria-label', 'Explore trend lines and press Enter to open the highlighted archetype');

  const handleOverlayMove = (clientX: number, clientY: number): void => {
    // Convert screen coordinates to SVG coordinates using proper transform matrix
    const svgCoords = screenToSVG(clientX, clientY);
    const svgX = svgCoords.x;
    const svgY = svgCoords.y;

    // Calculate index from SVG X coordinate
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

    // Find closest line using SVG Y coordinate
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

    // Highlight closest if within range (50 SVG units)
    activeArchetype = null;
    if (closest && minDiff < 50) {
      const activeLine = closest as MetaLine & { val: number };
      setActive(activeLine.name);
      activeArchetype = activeLine.name;

      // Move dot
      const dotY = yForShare(activeLine.val);
      highlightDot.setAttribute('cx', String(targetX));
      highlightDot.setAttribute('cy', String(dotY));
      highlightDot.setAttribute('stroke', activeLine.color);
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
    const containerRect = metaChartEl.getBoundingClientRect();
    const screenPoint = svgToScreen(targetX, 0);
    const screenTargetX = screenPoint.x - containerRect.left;

    const tipRect = tooltip.getBoundingClientRect();
    const mouseY = clientY - containerRect.top;

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

function renderList(): void {
  const { list } = elements;
  if (!list) {
    return;
  }
  list.innerHTML = '';

  if (!state.trendData) {
    return;
  }

  const filtered = (state.trendData.series || []).filter(item => item.appearances >= state.minAppearances);

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'trend-empty';
    empty.textContent = 'No archetypes meet the current filters yet.';
    list.appendChild(empty);
    return;
  }

  filtered.forEach(series => {
    const card = renderSeriesCard(series);
    list.appendChild(card);
  });
}

function setMode(mode: TrendsMode): void {
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
    const cardTrends = buildCardTrendDataset(decks, tournaments, { minAppearances: 2, topCount: 72 });
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
  loadArchetypeThumbnails();
  setLoading(true);
  try {
    const payload = await fetchTrendReport(TRENDS_SOURCE);
    const trendReport =
      (payload?.trendReport ? normalizeTrendReport(payload.trendReport) : null) ||
      (payload && 'series' in payload ? (payload as unknown as TrendDataset) : null) ||
      null;
    state.trendData = trendReport;
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
      const cardTrends = buildCardTrendDataset(decks, fallbackTournaments, { minAppearances: 2, topCount: 72 });
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
