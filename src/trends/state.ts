import type { TrendsState } from './types';

export const elements = {
  list: document.getElementById('trends-list'),
  loadingMeta: document.getElementById('trends-loading'),
  loadingArch: document.getElementById('trends-loading-arch'),
  minSlider: document.getElementById('trend-min-tournaments') as HTMLInputElement | null,
  minValue: document.getElementById('trend-min-value'),
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

export const state: TrendsState = {
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

// High-contrast palette with distinct hues - designed for dark backgrounds
export const palette = [
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

export const TRENDS_SOURCE = 'Trends - Last 30 Days';
