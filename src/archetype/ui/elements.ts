import type { GridElement } from '../render.js';

export const elements = {
  page: document.querySelector('.archetype-page'),
  loading: document.getElementById('archetype-loading'),
  error: document.getElementById('archetype-error'),
  simple: /** @type {HTMLElement|null} */ document.querySelector('.archetype-simple'),
  grid: document.getElementById('grid') as GridElement | null,
  title: document.getElementById('archetype-title'),
  granularityRange: document.getElementById('archetype-granularity-range') as HTMLInputElement | null,
  granularityOutput: /** @type {HTMLOutputElement|null} */ document.getElementById('archetype-granularity-output'),
  successFilter: document.getElementById('archetype-success-filter') as HTMLSelectElement | null,
  filterRowsContainer: /** @type {HTMLElement|null} */ document.getElementById('archetype-filter-rows'),
  addFilterButton: /** @type {HTMLButtonElement|null} */ document.getElementById('archetype-add-filter'),
  filtersContainer: /** @type {HTMLElement|null} */ document.querySelector('.archetype-controls'),
  filterEmptyState: /** @type {HTMLElement|null} */ document.getElementById('archetype-filter-empty-state'),
  filterMessage: /** @type {HTMLElement|null} */ null,
  skeletonSummary: /** @type {HTMLElement|null} */ document.getElementById('skeleton-summary'),
  skeletonCountValue: /** @type {HTMLElement|null} */ document.getElementById('skeleton-count-value'),
  skeletonWarnings: /** @type {HTMLElement|null} */ document.getElementById('skeleton-warnings'),
  skeletonExportButton: /** @type {HTMLButtonElement|null} */ document.getElementById('skeleton-export-live'),
  skeletonExportStatus: /** @type {HTMLElement|null} */ document.getElementById('skeleton-export-status'),
  tabHome: document.getElementById('tab-home') as HTMLAnchorElement | null,
  tabAnalysis: document.getElementById('tab-analysis') as HTMLAnchorElement | null,
  tabTrends: document.getElementById('tab-trends') as HTMLAnchorElement | null
};
