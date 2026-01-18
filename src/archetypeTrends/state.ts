import type { AppState } from './types.js';

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

export function getState(): AppState {
  return state;
}
