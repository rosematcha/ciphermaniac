import type { CardItem } from '../../types/index.js';
import { render } from '../../render.js';
import { RENDER_COMPACT_OPTIONS } from '../constants.js';
import { filterItemsByThreshold, sortItemsForDisplay } from '../data/items.js';
import { getState } from '../state.js';
import { updateSkeletonSummary } from './skeleton.js';
import { elements } from './elements.js';
import { configureGranularity, syncGranularityOutput } from './granularity.js';

let lastRenderedThreshold: number | null = null;
let thresholdRenderPending = false;

export function renderCardsWithThreshold(threshold: number): void {
  const state = getState();
  if (lastRenderedThreshold === threshold) {
    return;
  }

  if (thresholdRenderPending) {
    return;
  }

  thresholdRenderPending = true;

  requestAnimationFrame(() => {
    thresholdRenderPending = false;

    const currentThreshold =
      typeof state.thresholdPercent === 'number' && Number.isFinite(state.thresholdPercent)
        ? state.thresholdPercent
        : threshold;
    if (lastRenderedThreshold === currentThreshold) {
      return;
    }

    const visibleItems = filterItemsByThreshold(state.items, currentThreshold);
    const sortedVisibleItems = sortItemsForDisplay(visibleItems);

    if (elements.grid) {
      elements.grid._visibleRows = 24;
    }

    render(sortedVisibleItems as CardItem[], state.overrides, RENDER_COMPACT_OPTIONS);
    lastRenderedThreshold = currentThreshold;

    syncGranularityOutput(currentThreshold);
    updateSkeletonSummary(sortedVisibleItems);
  });
}

export function renderCards(): void {
  const state = getState();
  if (!Array.isArray(state.items)) {
    return;
  }

  configureGranularity(state.items);
  const threshold =
    typeof state.thresholdPercent === 'number' && Number.isFinite(state.thresholdPercent)
      ? state.thresholdPercent
      : 0;
  const visibleItems = filterItemsByThreshold(state.items, threshold);
  const sortedVisibleItems = sortItemsForDisplay(visibleItems);

  if (elements.grid) {
    elements.grid._visibleRows = 24;
  }
  render(sortedVisibleItems as CardItem[], state.overrides, RENDER_COMPACT_OPTIONS);
  lastRenderedThreshold = threshold;
  syncGranularityOutput(threshold);
  updateSkeletonSummary(sortedVisibleItems);
}
